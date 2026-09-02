import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { Pool } = require("pg");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

loadEnvFiles([".env.local", ".env", ".env.production"]);

const {
  createIngestionJob,
  enqueueIngestionNormalizeJob,
  identityMatchIngestionJobHandler,
} = loadTsModule("lib/v2/ingestion/index.ts");
const { leadAssignmentUpsertIngestionJobHandler } = loadTsModule(
  "lib/v2/ingestion/upsertLeadAssignments.ts"
);
const {
  buildCompanyEnrichmentJobIdempotencyKey,
} = loadTsModule("lib/v2/company-intelligence/index.ts");
const { claimNextV2Job, processV2Job: processJobFromJobs } = loadTsModule(
  "lib/v2/jobs/index.ts"
);
const { TELESTAR_SDR_OUTSOURCING_ICP_RULES } = loadTsModule(
  "lib/v2/scoring/__fixtures__/sampleIcpRules.ts"
);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = createPgDb(pool);

const ids = {
  organization: "ingest_s3_smoke_org",
  organizationSlug: "ingest-s3-smoke-organization",
  user: "ingest_s3_smoke_user",
  membership: "ingest_s3_smoke_membership",
  clientAccount: "ingest_s3_smoke_client",
  project: "ingest_s3_smoke_project",
  offer: "ingest_s3_smoke_offer",
  icpProfile: "ingest_s3_smoke_icp_profile",
  icpVersion: "ingest_s3_smoke_icp_version",
  company: "ingest_s3_smoke_company_alpha",
};

const csvText = [
  "company,website,domain,email,notes",
  "Alpha Smoke,https://example.com,example.com,jane@example.com,exact domain",
  "Alpha Smoke Platform,,,,fuzzy candidate only",
  "Beta Unknown,https://example.org,,,none valid company",
  "Gamma Domain,,example.net,,none explicit domain",
  ",,,,invalid empty row",
  ",https://iana.org,,,none missing name",
].join("\n");

const rulesJson = {
  ...TELESTAR_SDR_OUTSOURCING_ICP_RULES,
  ruleSetId: "ingest-s3-smoke",
  displayName: "INGEST S3 Smoke ICP",
  requiredEvidenceForFinalQualification: {
    explicitGeo: true,
    employeeSize: false,
    personaTitle: false,
  },
};

try {
  await cleanupSmokeData();
  await seedSmokeData();
  await assertManualMappingFlow();
  await cleanupSmokeData();
  await seedSmokeData();

  const { ingestionJobId, enqueueResult } = await createIngestionJob(db, {
    organizationId: ids.organization,
    projectId: ids.project,
    icpVersionId: ids.icpVersion,
    uploadedByUserId: ids.user,
    originalFileName: "ingest-s3-smoke.csv",
    csvText,
    importProfileSuggestion: "company_upload",
  });
  assert.equal(enqueueResult.kind, "created");
  console.log("PASS creates context-carrying V2IngestionJob and parse job");

  await assertClaimNextJobScopesByIngestionJobId(ingestionJobId);

  await processRequired("INGESTION_PARSE");
  await processRequired("INGESTION_NORMALIZE");
  const identityResult = await processRequired("IDENTITY_MATCH");
  assert.equal(identityResult.job.resultSnapshotJson.downstreamJobsEnqueued[0].jobType, "LEAD_ASSIGNMENT_UPSERT");
  console.log("PASS NORMALIZE -> IDENTITY_MATCH -> LEAD_ASSIGNMENT_UPSERT chain enqueued");

  const identityRows = await loadIdentityRows(ingestionJobId);
  assert.equal(identityRows.identityKinds.exact_company, 1);
  assert.equal(identityRows.identityKinds.candidate, 1);
  assert.equal(identityRows.identityKinds.none, 3);
  assert.equal(identityRows.error, 1);
  assert.ok(identityRows.matchedCompanyIds.includes(ids.company));
  console.log("PASS identity match marks exact, candidate, none, and error rows");

  const upsertResult = await processRequired("LEAD_ASSIGNMENT_UPSERT");
  const upsertSnapshot = upsertResult.job.resultSnapshotJson;
  assert.equal(upsertSnapshot.counts.created, 3);
  assert.equal(upsertSnapshot.counts.reviewCreated, 1);
  assert.equal(upsertSnapshot.counts.skippedNone, 0);
  assert.equal(upsertSnapshot.counts.errors, 1);
  assert.equal(upsertSnapshot.enrichCompanyIds.length, 3);
  assert.equal(upsertSnapshot.enrichmentJobs.length, 3);
  for (const enrichmentJob of upsertSnapshot.enrichmentJobs) {
    assert.equal(enrichmentJob.result, "created");
    assert.equal(
      enrichmentJob.idempotencyKey,
      buildCompanyEnrichmentJobIdempotencyKey(ids.organization, enrichmentJob.companyId, 1)
    );
  }
  console.log("PASS LEAD_ASSIGNMENT_UPSERT creates lead, review item, and per-company enrichment jobs");

  const betaCompanyRows = await db.$queryRaw`
    SELECT "id", "websiteUrl", "canonicalDomain"
    FROM "V2Company"
    WHERE "organizationId" = ${ids.organization}
      AND "websiteUrl" = 'https://example.org'
  `;
  assert.equal(betaCompanyRows[0].canonicalDomain, "example.org");
  const betaCompanyId = betaCompanyRows[0].id;

  const gammaCompanyRows = await db.$queryRaw`
    SELECT "id", "websiteUrl", "canonicalDomain"
    FROM "V2Company"
    WHERE "organizationId" = ${ids.organization}
      AND "canonicalDomain" = 'example.net'
  `;
  assert.equal(gammaCompanyRows[0].websiteUrl, "example.net");
  const gammaCompanyId = gammaCompanyRows[0].id;
  console.log("PASS mapped website is persisted to V2Company.websiteUrl and canonicalDomain is derived or explicitly stored");

  const restoreFetch = installCompanyEnrichmentMockFetch();
  let enrichmentResults;
  try {
    enrichmentResults = await processAll("COMPANY_ENRICHMENT");
  } finally {
    restoreFetch();
  }
  assert.equal(enrichmentResults.length, 3);

  for (const enrichmentResult of enrichmentResults) {
    const enrichmentSnapshot = enrichmentResult.job.resultSnapshotJson;
  console.log("DEBUG enrichment snapshot", JSON.stringify(enrichmentSnapshot.researchSnapshot));
  assert.equal(enrichmentSnapshot.researchSnapshot.status, "SUCCESS");
    assert.equal(enrichmentSnapshot.researchSnapshot.reused, false);
    assert.equal(enrichmentSnapshot.intelligenceProfile.profileStatus, "EXTRACTED");
    assert.equal(enrichmentSnapshot.leadAssignmentIds.length, 1);
    assert.equal(enrichmentSnapshot.scoreJob.result, "created");
  }
  console.log("PASS COMPANY_ENRICHMENT inserts SUCCESS snapshots/profiles and enqueues ICP_SCORE per company");

  const leadAssignmentId1 = await loadLeadAssignmentIdForCompany(ids.company);
  const leadAssignmentId2 = await loadLeadAssignmentIdForCompany(betaCompanyId);
  const leadAssignmentId3 = await loadLeadAssignmentIdForCompany(gammaCompanyId);

  await processAll("ICP_SCORE");
  assert.equal(await countLeadAssignments(), 3);
  assert.equal(await countCompanyAssignments(), 1);
  assert.equal(await countActiveReviewItems(), 1);
  assert.equal(await countAssessments(leadAssignmentId1), 1);
  assert.equal(await countAssessments(leadAssignmentId2), 1);
  assert.equal(await countAssessments(leadAssignmentId3), 1);
  console.log("PASS valid NONE company row creates/reuses V2Company and company-level V2LeadAssignment");
  console.log("PASS clean upsert is scored and candidate creates exactly one review");

  const upsertedExactRow = await loadAppliedExactRow(ingestionJobId);
  assert.equal(upsertedExactRow.identityKind, "exact_company");
  assert.ok(upsertedExactRow.upsertLeadAssignmentId);
  assert.equal(upsertedExactRow.upsertAction, "created");
  assert.ok(upsertedExactRow.normalizedRowJson.identityMatch);
  console.log("PASS normalizedRowJson.identityMatch is preserved after leadAssignmentUpsert write");

  const rerunResult = await leadAssignmentUpsertIngestionJobHandler({
    db,
    job: upsertResult.job,
    organizationId: ids.organization,
    payload: {
      schemaVersion: "v2.ingestion.lead-assignment-upsert-job.v1",
      ingestionJobId,
    },
    signal: new AbortController().signal,
    updateProgress: async () => {},
  });
  assert.equal(rerunResult.resultSnapshotJson.enrichCompanyIds.length, 0);
  assert.equal(rerunResult.resultSnapshotJson.enrichmentJobs.length, 0);
  assert.equal(await countLeadAssignments(), 3);
  assert.equal(await countActiveReviewItems(), 1);
  assert.equal(await countAssessments(leadAssignmentId1), 1);
  assert.equal(await countAssessments(leadAssignmentId2), 1);
  assert.equal(await countAssessments(leadAssignmentId3), 1);
  assert.equal(await countIcpScoreJobs(), 3);
  assert.equal(await countCompanyEnrichmentJobs(), 3);
  console.log("PASS rerunning upsert creates zero duplicate leads, reviews, jobs, or assessments");

  await identityMatchIngestionJobHandler({
    db,
    job: identityResult.job,
    organizationId: ids.organization,
    payload: {
      schemaVersion: "v2.ingestion.identity-match-job.v1",
      ingestionJobId,
    },
    signal: new AbortController().signal,
    updateProgress: async () => {},
  });
  assert.equal(await countLeadAssignments(), 3);
  assert.equal(await countActiveReviewItems(), 1);
  console.log("PASS rerunning identity match remains row-idempotent");

  await assertMissingContextDoesNotSpamReviews();
  assertNoForbiddenRuntimeImports();
  console.log("PASS no V1 scoring/activity import leaks in ingestion runtime");

  await cleanupSmokeData();
  console.log("PASS V2 ingestion runtime smoke checks complete");
} finally {
  await pool.end();
}

async function processRequired(jobType) {
  const job = await claimNextV2Job(db, { organizationId: ids.organization, jobType });
  assert.ok(job, `Expected ${jobType} job to be claimed`);
  const result = await processJobFromJobs(db, job);
  assert.equal(result.kind, "succeeded");
  return result;
}

async function processAll(jobType) {
  const results = [];

  while (true) {
    const job = await claimNextV2Job(db, { organizationId: ids.organization, jobType });

    if (!job) {
      break;
    }

    const result = await processJobFromJobs(db, job);
    assert.equal(result.kind, "succeeded");
    results.push(result);
  }

  return results;
}

async function seedSmokeData() {
  await db.$queryRaw`
    INSERT INTO "V2Organization" ("id", "name", "slug", "status", "createdAt", "updatedAt")
    VALUES (${ids.organization}, 'INGEST S3 Smoke Organization', ${ids.organizationSlug}, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `;
  await db.$queryRaw`
    INSERT INTO "V2User" ("id", "email", "emailNormalized", "name", "status", "createdAt", "updatedAt")
    VALUES (${ids.user}, 'ingest-s3-smoke@example.test', 'ingest-s3-smoke@example.test', 'Ingest S3 Smoke', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `;
  await db.$queryRaw`
    INSERT INTO "V2OrganizationMembership" ("id", "organizationId", "userId", "role", "status", "createdAt", "updatedAt")
    VALUES (${ids.membership}, ${ids.organization}, ${ids.user}, 'OWNER', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `;
  await db.$queryRaw`
    INSERT INTO "V2ClientAccount" ("id", "organizationId", "name", "status", "createdAt", "updatedAt")
    VALUES (${ids.clientAccount}, ${ids.organization}, 'INGEST S3 Smoke Client', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `;
  await db.$queryRaw`
    INSERT INTO "V2Project" ("id", "organizationId", "clientAccountId", "name", "status", "createdAt", "updatedAt")
    VALUES (${ids.project}, ${ids.organization}, ${ids.clientAccount}, 'INGEST S3 Smoke Project', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `;
  await db.$queryRaw`
    INSERT INTO "V2Offer" ("id", "organizationId", "projectId", "name", "status", "createdAt", "updatedAt")
    VALUES (${ids.offer}, ${ids.organization}, ${ids.project}, 'INGEST S3 Smoke Offer', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `;
  await db.$queryRaw`
    INSERT INTO "V2ICPProfile" ("id", "organizationId", "offerId", "name", "status", "createdAt", "updatedAt")
    VALUES (${ids.icpProfile}, ${ids.organization}, ${ids.offer}, 'INGEST S3 Smoke ICP', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `;
  await db.$queryRaw`
    INSERT INTO "V2ICPVersion" (
      "id", "organizationId", "icpProfileId", "versionNumber", "status", "rulesJson",
      "publishedAt", "version", "createdAt", "updatedAt"
    )
    VALUES (${ids.icpVersion}, ${ids.organization}, ${ids.icpProfile}, 1, 'PUBLISHED', ${JSON.stringify(rulesJson)}::jsonb, CURRENT_TIMESTAMP, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `;
  await db.$queryRaw`
    INSERT INTO "V2Company" (
      "id",
      "organizationId",
      "name",
      "nameNormalized",
      "canonicalDomain",
      "websiteUrl",
      "country",
      "status",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${ids.company},
      ${ids.organization},
      'Alpha Smoke',
      'alpha smoke',
      'example.com',
      'https://example.com',
      'Singapore',
      'ACTIVE',
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
  `;
}

async function assertManualMappingFlow() {
  const manualCsvText = [
    "Company Name,Website URL,Work Email,Notes",
    "Alpha Smoke,https://example.com,jane@example.com,mapped exact domain",
  ].join("\n");
  const { ingestionJobId, enqueueResult } = await createIngestionJob(db, {
    organizationId: ids.organization,
    projectId: ids.project,
    icpVersionId: ids.icpVersion,
    uploadedByUserId: ids.user,
    runMode: "manual_mapping",
    clientRequestId: "ingest-s4-manual-request",
    sourceFileStorageKey: `v2-upload:${ids.organization}:ingest-s4-manual-request`,
    fileHash: "ingest-s4-manual-file-hash",
    headerHash: "ingest-s4-manual-header-hash",
    headers: ["Company Name", "Website URL", "Work Email", "Notes"],
    previewRows: [
      {
        "Company Name": "Alpha Smoke",
        "Website URL": "https://example.com",
        "Work Email": "jane@example.com",
        Notes: "mapped exact domain",
      },
    ],
    fileSizeBytes: manualCsvText.length,
    originalFileName: "ingest-s4-manual.csv",
    csvText: manualCsvText,
    importProfileSuggestion: "company_upload",
  });
  assert.equal(enqueueResult.kind, "created");

  const parseResult = await processRequired("INGESTION_PARSE");
  assert.equal(parseResult.job.resultSnapshotJson.mappingRequired, true);
  assert.equal(parseResult.job.resultSnapshotJson.normalizeJob, null);
  const noNormalizeJob = await claimNextV2Job(db, {
    organizationId: ids.organization,
    jobType: "INGESTION_NORMALIZE",
  });
  assert.equal(noNormalizeJob, null);
  console.log("PASS manual mapping upload pauses after parse");

  const mappingJson = await loadMappingJson(ingestionJobId);
  await db.$queryRaw`
    UPDATE "V2IngestionJob"
    SET "mappingJson" = ${JSON.stringify({
      ...mappingJson,
      columnMapping: {
        schemaVersion: "v2.ingestion.column-mapping.v1",
        fields: {
          company: "Company Name",
          website: "Website URL",
          domain: null,
          email: "Work Email",
          contact: null,
          linkedin: null,
        },
      },
    })}::jsonb,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${ingestionJobId}
      AND "organizationId" = ${ids.organization}
  `;
  const normalizeEnqueue = await enqueueIngestionNormalizeJob(db, {
    organizationId: ids.organization,
    ingestionJobId,
    createdByUserId: ids.user,
  });
  assert.equal(normalizeEnqueue.kind, "created");
  assert.equal(
    (await enqueueIngestionNormalizeJob(db, {
      organizationId: ids.organization,
      ingestionJobId,
      createdByUserId: ids.user,
    })).kind,
    "existing"
  );
  console.log("PASS mapping submit enqueues normalize exactly once");

  await processRequired("INGESTION_NORMALIZE");
  await processRequired("IDENTITY_MATCH");
  const identityRows = await loadIdentityRows(ingestionJobId);
  assert.equal(identityRows.identityKinds.exact_company, 1);
  assert.ok(identityRows.matchedCompanyIds.includes(ids.company));
  console.log("PASS mapped non-canonical headers normalize into identity match");

  const upsertResult = await processRequired("LEAD_ASSIGNMENT_UPSERT");
  const upsertSnapshot = upsertResult.job.resultSnapshotJson;
  assert.equal(upsertSnapshot.enrichCompanyIds.length, 1);
  assert.equal(upsertSnapshot.enrichCompanyIds[0], ids.company);

  const restoreFetch = installCompanyEnrichmentMockFetch();
  let enrichmentResult;
  try {
    enrichmentResult = await processRequired("COMPANY_ENRICHMENT");
  } finally {
    restoreFetch();
  }
  const enrichmentSnapshot = enrichmentResult.job.resultSnapshotJson;
  console.log("DEBUG enrichment snapshot", JSON.stringify(enrichmentSnapshot.researchSnapshot));
  assert.equal(enrichmentSnapshot.researchSnapshot.status, "SUCCESS");
  assert.equal(enrichmentSnapshot.intelligenceProfile.profileStatus, "EXTRACTED");
  assert.equal(enrichmentSnapshot.leadAssignmentIds.length, 1);
  const leadAssignmentId = enrichmentSnapshot.leadAssignmentIds[0];

  await processRequired("ICP_SCORE");
  assert.equal(await countCompanyAssignments(), 1);
  assert.equal(await countAssessments(leadAssignmentId), 1);
  console.log("PASS manual mapping flow reaches lead upsert, enrichment, and scoring");
}

async function assertMissingContextDoesNotSpamReviews() {
  const beforeReviews = await countActiveReviewItems();
  const { ingestionJobId } = await createIngestionJob(db, {
    organizationId: ids.organization,
    projectId: ids.project,
    uploadedByUserId: ids.user,
    originalFileName: "ingest-s3-smoke-missing-context.csv",
    csvText,
    importProfileSuggestion: "company_upload",
  });
  await processRequired("INGESTION_PARSE");
  await processRequired("INGESTION_NORMALIZE");
  await processRequired("IDENTITY_MATCH");
  await processRequired("LEAD_ASSIGNMENT_UPSERT");
  const afterReviews = await countActiveReviewItems();
  const contextErrors = await db.$queryRaw`
    SELECT COUNT(*)::int AS count
    FROM "V2IngestionRow"
    WHERE "organizationId" = ${ids.organization}
      AND "jobId" = ${ingestionJobId}
      AND "rowStatus" = 'ERROR'
      AND "errorMessage" = 'NO_PROJECT_CONTEXT'
  `;

  assert.equal(afterReviews, beforeReviews);
  assert.ok(Number(contextErrors[0].count) >= 1);
  console.log("PASS missing project/ICP context creates row errors, not per-row review spam");
}

async function assertClaimNextJobScopesByIngestionJobId(ingestionJobId) {
  const decoyIngestionJobId = "ingest_s3_smoke_decoy_ingestion_job";

  await db.$executeRaw`
    INSERT INTO "V2Job" (
      "id", "organizationId", "jobType", "sourceType", "sourceId",
      "status", "idempotencyKey", "createdAt", "updatedAt"
    )
    VALUES (
      'ingest_s3_smoke_decoy_parse_job', ${ids.organization}, 'INGESTION_PARSE', 'INGESTION_JOB', ${decoyIngestionJobId},
      'QUEUED', 'ingest-s3-smoke-decoy-parse', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `;

  try {
    const ownJob = await claimNextV2Job(db, {
      organizationId: ids.organization,
      ingestionJobId,
      jobType: "INGESTION_PARSE",
    });
    assert.ok(ownJob, "Expected the real ingestion job's INGESTION_PARSE job to be claimable");
    assert.equal(ownJob.sourceId, ingestionJobId);

    const noCrossJob = await claimNextV2Job(db, {
      organizationId: ids.organization,
      ingestionJobId,
      jobType: "INGESTION_PARSE",
    });
    assert.equal(noCrossJob, null, "Scoped claim must not pick up another ingestion job's queued job");

    const decoyJob = await claimNextV2Job(db, {
      organizationId: ids.organization,
      ingestionJobId: decoyIngestionJobId,
      jobType: "INGESTION_PARSE",
    });
    assert.ok(decoyJob, "Expected the decoy ingestion job's INGESTION_PARSE job to be claimable on its own scope");
    assert.equal(decoyJob.sourceId, decoyIngestionJobId);

    await db.$executeRaw`
      UPDATE "V2Job"
      SET "status" = 'QUEUED', "retryCount" = 0
      WHERE "id" = ${ownJob.id}
        AND "organizationId" = ${ids.organization}
    `;
  } finally {
    await db.$executeRaw`
      DELETE FROM "V2Job"
      WHERE "id" = 'ingest_s3_smoke_decoy_parse_job'
        AND "organizationId" = ${ids.organization}
    `;
  }

  console.log("PASS claimNextV2Job ingestionJobId scoping isolates concurrent ingestion job queues");
}

async function loadMappingJson(ingestionJobId) {
  const rows = await db.$queryRaw`
    SELECT "mappingJson"
    FROM "V2IngestionJob"
    WHERE "id" = ${ingestionJobId}
      AND "organizationId" = ${ids.organization}
    LIMIT 1
  `;

  assert.ok(rows[0]);
  return rows[0].mappingJson;
}

async function loadIdentityRows(ingestionJobId) {
  const rows = await db.$queryRaw`
    SELECT
      "rowStatus",
      "matchedCompanyId",
      "normalizedRowJson"->'identityMatch'->>'kind' AS "identityKind"
    FROM "V2IngestionRow"
    WHERE "organizationId" = ${ids.organization}
      AND "jobId" = ${ingestionJobId}
  `;
  const identityKinds = {
    exact_company: 0,
    exact_contact: 0,
    candidate: 0,
    none: 0,
  };

  for (const row of rows) {
    if (row.identityKind && identityKinds[row.identityKind] !== undefined) {
      identityKinds[row.identityKind] += 1;
    }
  }

  return {
    error: rows.filter((row) => row.rowStatus === "ERROR").length,
    matchedCompanyIds: rows
      .map((row) => row.matchedCompanyId)
      .filter((value) => typeof value === "string"),
    identityKinds,
  };
}

async function loadAppliedExactRow(ingestionJobId) {
  const rows = await db.$queryRaw`
    SELECT
      "normalizedRowJson",
      "normalizedRowJson"->'identityMatch'->>'kind' AS "identityKind",
      "normalizedRowJson"->'leadAssignmentUpsert'->>'leadAssignmentId' AS "upsertLeadAssignmentId",
      "normalizedRowJson"->'leadAssignmentUpsert'->>'action' AS "upsertAction"
    FROM "V2IngestionRow"
    WHERE "organizationId" = ${ids.organization}
      AND "jobId" = ${ingestionJobId}
      AND "normalizedRowJson"->'identityMatch'->>'kind' = 'exact_company'
    LIMIT 1
  `;

  assert.ok(rows[0]);
  return rows[0];
}

async function countLeadAssignments() {
  const rows = await db.$queryRaw`
    SELECT COUNT(*)::int AS count
    FROM "V2LeadAssignment"
    WHERE "organizationId" = ${ids.organization}
      AND "projectId" = ${ids.project}
      AND "icpVersionId" = ${ids.icpVersion}
      AND "status" = 'ACTIVE'
      AND "deletedAt" IS NULL
  `;

  return Number(rows[0].count);
}

async function countCompanyAssignments() {
  const rows = await db.$queryRaw`
    SELECT COUNT(*)::int AS count
    FROM "V2LeadAssignment"
    WHERE "organizationId" = ${ids.organization}
      AND "projectId" = ${ids.project}
      AND "icpVersionId" = ${ids.icpVersion}
      AND "companyId" = ${ids.company}
      AND "contactId" IS NULL
      AND "assignmentLevel" = 'COMPANY'
      AND "status" = 'ACTIVE'
      AND "deletedAt" IS NULL
  `;

  return Number(rows[0].count);
}

async function countActiveReviewItems() {
  const rows = await db.$queryRaw`
    SELECT COUNT(*)::int AS count
    FROM "V2ManagerReviewItem"
    WHERE "organizationId" = ${ids.organization}
      AND "sourceType" = 'IDENTITY_MATCH'
      AND "reasonCode" = 'FUZZY_NAME_ONLY'
      AND "status" IN ('OPEN', 'IN_PROGRESS', 'SNOOZED')
      AND "deletedAt" IS NULL
  `;

  return Number(rows[0].count);
}

async function countAssessments(leadAssignmentId) {
  const rows = await db.$queryRaw`
    SELECT COUNT(*)::int AS count
    FROM "V2HardRuleAssessment"
    WHERE "organizationId" = ${ids.organization}
      AND "leadAssignmentId" = ${leadAssignmentId}
  `;

  return Number(rows[0].count);
}

async function countIcpScoreJobs() {
  const rows = await db.$queryRaw`
    SELECT COUNT(*)::int AS count
    FROM "V2Job"
    WHERE "organizationId" = ${ids.organization}
      AND "jobType" = 'ICP_SCORE'
  `;

  return Number(rows[0].count);
}

async function countCompanyEnrichmentJobs() {
  const rows = await db.$queryRaw`
    SELECT COUNT(*)::int AS count
    FROM "V2Job"
    WHERE "organizationId" = ${ids.organization}
      AND "jobType" = 'COMPANY_ENRICHMENT'
  `;

  return Number(rows[0].count);
}

async function loadLeadAssignmentIdForCompany(companyId) {
  const rows = await db.$queryRaw`
    SELECT "id"
    FROM "V2LeadAssignment"
    WHERE "organizationId" = ${ids.organization}
      AND "projectId" = ${ids.project}
      AND "icpVersionId" = ${ids.icpVersion}
      AND "companyId" = ${companyId}
      AND "status" = 'ACTIVE'
      AND "deletedAt" IS NULL
    LIMIT 1
  `;

  assert.ok(rows[0]);
  return rows[0].id;
}

function installCompanyEnrichmentMockFetch() {
  const originalFetch = globalThis.fetch;
  const html = `<html><body><main>${[
    "Smoke company provides a SaaS cybersecurity platform for banking customers.",
    "The company is headquartered in Singapore and sells B2B cloud infrastructure software.",
    "Our pricing plans support enterprise teams.",
  ].join(" ").repeat(8)}</main></body></html>`;

  globalThis.fetch = async (input) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : typeof input?.url === "string"
          ? input.url
          : input.toString();
    const path = new URL(url).pathname;

    if (path === "/robots.txt") {
      return {
        ok: false,
        headers: { get: () => "text/html" },
        status: 404,
        url,
        text: async () => "",
      };
    }

    if (path === "/" || path === "/pricing") {
      return {
        ok: true,
        headers: { get: () => "text/html" },
        status: 200,
        url,
        text: async () => html,
      };
    }

    return {
      ok: false,
      status: 404,
      url,
      text: async () => "",
    };
  };

  return () => {
    globalThis.fetch = originalFetch;
  };
}

async function cleanupSmokeData() {
  await db.$executeRaw`DELETE FROM "V2Job" WHERE "organizationId" = ${ids.organization}`;
  await db.$executeRaw`DELETE FROM "V2AuditEvent" WHERE "organizationId" = ${ids.organization}`;
  await db.$executeRaw`DELETE FROM "V2ManagerReviewItem" WHERE "organizationId" = ${ids.organization}`;
  await db.$executeRaw`UPDATE "V2LeadAssignment" SET "latestHardRuleAssessmentId" = NULL WHERE "organizationId" = ${ids.organization}`;
  await db.$executeRaw`DELETE FROM "V2HardRuleAssessment" WHERE "organizationId" = ${ids.organization}`;
  await db.$executeRaw`DELETE FROM "V2LeadAssignment" WHERE "organizationId" = ${ids.organization}`;
  await db.$executeRaw`DELETE FROM "V2IngestionRow" WHERE "organizationId" = ${ids.organization}`;
  await db.$executeRaw`DELETE FROM "V2IngestionJob" WHERE "organizationId" = ${ids.organization}`;
  await db.$executeRaw`DELETE FROM "V2ContactIdentifier" WHERE "organizationId" = ${ids.organization}`;
  await db.$executeRaw`DELETE FROM "V2Contact" WHERE "organizationId" = ${ids.organization}`;
  await db.$executeRaw`DELETE FROM "V2CompanyIntelligenceProfile" WHERE "organizationId" = ${ids.organization}`;
  await db.$executeRaw`DELETE FROM "V2CompanyResearchSnapshot" WHERE "organizationId" = ${ids.organization}`;
  await db.$executeRaw`DELETE FROM "V2Company" WHERE "organizationId" = ${ids.organization}`;
  await db.$executeRaw`DELETE FROM "V2ICPVersion" WHERE "organizationId" = ${ids.organization}`;
  await db.$executeRaw`DELETE FROM "V2ICPProfile" WHERE "organizationId" = ${ids.organization}`;
  await db.$executeRaw`DELETE FROM "V2Offer" WHERE "organizationId" = ${ids.organization}`;
  await db.$executeRaw`DELETE FROM "V2Project" WHERE "organizationId" = ${ids.organization}`;
  await db.$executeRaw`DELETE FROM "V2ClientAccount" WHERE "organizationId" = ${ids.organization}`;
  await db.$executeRaw`DELETE FROM "V2OrganizationMembership" WHERE "organizationId" = ${ids.organization}`;
  await db.$executeRaw`DELETE FROM "V2User" WHERE "id" = ${ids.user}`;
  await db.$executeRaw`DELETE FROM "V2Organization" WHERE "id" = ${ids.organization}`;
}

function assertNoForbiddenRuntimeImports() {
  const files = [
    "lib/v2/ingestion/types.ts",
    "lib/v2/ingestion/hash.ts",
    "lib/v2/ingestion/parseCsvRows.ts",
    "lib/v2/ingestion/classifyImportProfile.ts",
    "lib/v2/ingestion/validateIngestionRow.ts",
    "lib/v2/ingestion/createIngestionJob.ts",
    "lib/v2/ingestion/persistIngestionRows.ts",
    "lib/v2/ingestion/enqueueIngestionJobs.ts",
    "lib/v2/ingestion/handlers.ts",
    "lib/v2/ingestion/upsertLeadAssignments.ts",
    "lib/v2/ingestion/index.ts",
    "lib/v2/company-intelligence/types.ts",
    "lib/v2/company-intelligence/companyEnrichmentHandler.ts",
    "lib/v2/company-intelligence/index.ts",
    "scripts/check-v2-ingestion-runtime.mjs",
  ];
  const forbiddenFragments = [
    "Company" + "Record",
    "Upload" + "Job",
    "Company" + "Score" + "Result",
    "Company" + "Ai" + "Job",
    "lib/activity" + "Recaps",
    "assessCompany" + "AgainstIcp",
  ];

  for (const file of files) {
    const source = readFileSync(resolve(rootDir, file), "utf8");

    for (const fragment of forbiddenFragments) {
      assert.equal(
        source.includes(fragment),
        false,
        `${file} must not include ${fragment}`
      );
    }
  }
}

function createPgDb(poolOrClient) {
  return {
    async $queryRaw(strings, ...values) {
      const query = buildParameterizedQuery(strings, values);
      const result = await poolOrClient.query(query.text, query.values);
      return result.rows;
    },
    async $executeRaw(strings, ...values) {
      const query = buildParameterizedQuery(strings, values);
      const result = await poolOrClient.query(query.text, query.values);
      return result.rowCount ?? 0;
    },
    async $queryRawUnsafe(text, ...values) {
      const result = await poolOrClient.query(text, values);
      return result.rows;
    },
    async $transaction(callback) {
      const client = await poolOrClient.connect();

      try {
        await client.query("BEGIN");
        const result = await callback(createPgDb(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

function buildParameterizedQuery(strings, values) {
  let text = "";

  for (let index = 0; index < strings.length; index += 1) {
    text += strings[index];

    if (index < values.length) {
      text += `$${index + 1}`;
    }
  }

  return { text, values };
}

function loadEnvFiles(fileNames) {
  for (const fileName of fileNames) {
    const filePath = resolve(rootDir, fileName);

    if (!existsSync(filePath)) {
      continue;
    }

    for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
        continue;
      }

      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      const rawValue = trimmed.slice(index + 1).trim();

      if (key && process.env[key] === undefined) {
        process.env[key] = rawValue.replace(/^["']|["']$/g, "");
      }
    }
  }
}

function loadTsModule(relativePath) {
  const absolutePath = resolve(rootDir, relativePath);

  if (moduleCache.has(absolutePath)) {
    return moduleCache.get(absolutePath).exports;
  }

  const source = readFileSync(absolutePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const moduleUrl = JSON.stringify(pathToFileURL(absolutePath).href);
  const output = transpiled
    .split("import.meta.url")
    .join(moduleUrl)
    .split("import.meta")
    .join(`({ url: ${moduleUrl} })`);
  const loadedModule = { exports: {} };
  moduleCache.set(absolutePath, loadedModule);

  const localRequire = (specifier) => {
    if (specifier === "server-only") {
      return {};
    }

    if (specifier.startsWith("@/")) {
      const aliasPath = resolve(rootDir, specifier.slice(2));
      const resolvedPath = existsSync(`${aliasPath}.ts`)
        ? `${aliasPath}.ts`
        : resolve(aliasPath, "index.ts");

      return loadTsModule(resolvedPath.slice(rootDir.length + 1));
    }

    if (!specifier.startsWith(".")) {
      return require(specifier);
    }

    const modulePath = resolve(dirname(absolutePath), specifier);
    const resolvedPath = existsSync(`${modulePath}.ts`)
      ? `${modulePath}.ts`
      : resolve(modulePath, "index.ts");
    const relativeToRoot = resolvedPath.slice(rootDir.length + 1);

    return loadTsModule(relativeToRoot);
  };

  new Function("require", "module", "exports", output)(
    localRequire,
    loadedModule,
    loadedModule.exports
  );

  return loadedModule.exports;
}
