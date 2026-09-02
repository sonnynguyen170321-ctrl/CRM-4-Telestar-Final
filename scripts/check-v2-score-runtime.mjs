import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { Pool } = require("pg");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

loadEnvFiles([".env.local", ".env", ".env.production"]);

const {
  buildIcpScoreJobIdempotencyKey,
  enqueueIcpScoreJob,
} = loadTsModule("lib/v2/scoring/runtime/enqueueScoringJobs.ts");
const { claimNextV2Job, enqueueV2Job, processV2Job } = loadTsModule(
  "lib/v2/jobs/index.ts"
);
const { TELESTAR_SDR_OUTSOURCING_ICP_RULES } = loadTsModule(
  "lib/v2/scoring/__fixtures__/sampleIcpRules.ts"
);
const { TELESTAR } = loadTsModule(
  "lib/v2/scoring/__fixtures__/icpCorpus/index.ts"
);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = createPgJobDb(pool);

const ids = {
  organization: "scorehv0_smoke_org",
  clientAccount: "scorehv0_smoke_client",
  project: "scorehv0_smoke_project",
  offer: "scorehv0_smoke_offer",
  icpProfile: "scorehv0_smoke_icp_profile",
  icpVersion: "scorehv0_smoke_icp_version",
  rulesV2IcpVersion: "scorehv0_smoke_rules_v2_icp_version",
  invalidIcpVersion: "scorehv0_smoke_invalid_icp_version",
  qualifiedCompany: "scorehv0_smoke_company_qualified",
  reviewCompany: "scorehv0_smoke_company_review",
  unqualifiedCompany: "scorehv0_smoke_company_unqualified",
  rulesV2QualifiedCompany: "scorehv0_smoke_rules_v2_company_qualified",
  rulesV2NeedsContactCompany: "scorehv0_smoke_rules_v2_company_needs_contact",
  rulesV2UnqualifiedCompany: "scorehv0_smoke_rules_v2_company_unqualified",
  rulesV2ReviewCompany: "scorehv0_smoke_rules_v2_company_review",
  invalidCompany: "scorehv0_smoke_company_invalid",
  softDeletedCompany: "scorehv0_smoke_company_deleted",
  qualifiedContact: "scorehv0_smoke_contact_qualified",
  unqualifiedContact: "scorehv0_smoke_contact_unqualified",
  rulesV2QualifiedContact: "scorehv0_smoke_rules_v2_contact_qualified",
  rulesV2UnqualifiedContact: "scorehv0_smoke_rules_v2_contact_unqualified",
  rulesV2ReviewContact: "scorehv0_smoke_rules_v2_contact_review",
  invalidContact: "scorehv0_smoke_contact_invalid",
  qualifiedLead: "scorehv0_smoke_lead_qualified",
  reviewLead: "scorehv0_smoke_lead_review",
  unqualifiedLead: "scorehv0_smoke_lead_unqualified",
  rulesV2QualifiedLead: "scorehv0_smoke_rules_v2_lead_qualified",
  rulesV2NeedsContactLead: "scorehv0_smoke_rules_v2_lead_needs_contact",
  rulesV2UnqualifiedLead: "scorehv0_smoke_rules_v2_lead_unqualified",
  rulesV2ReviewLead: "scorehv0_smoke_rules_v2_lead_review",
  invalidLead: "scorehv0_smoke_lead_invalid",
  softDeletedLead: "scorehv0_smoke_lead_deleted",
  oldAssessment: "scorehv0_smoke_assessment_old",
};

const scoringRules = {
  ...TELESTAR_SDR_OUTSOURCING_ICP_RULES,
  ruleSetId: "scorehv0-smoke-saas-apac",
  displayName: "SCORE-HV0 Smoke SaaS APAC",
  requiredEvidenceForFinalQualification: {
    explicitGeo: true,
    employeeSize: false,
    personaTitle: true,
  },
};
const invalidRules = {
  ...scoringRules,
  confidencePolicy: {
    highConfidenceThreshold: 0.75,
    mediumConfidenceThreshold: 0.45,
  },
};
const rulesV2ScoringRules = {
  ...TELESTAR,
  ruleSetId: "scorehv0-smoke-rules-v2-telestar",
  displayName: "SCORE-HV0 Smoke Rules V2 TeleStar",
  requiredEvidenceForFinalQualification: {
    ...TELESTAR.requiredEvidenceForFinalQualification,
    employeeSize: false,
    websiteReachable: false,
  },
};

try {
  await cleanupSmokeData();
  await seedSmokeData();

  const companyBefore = await readUpdatedAt("V2Company", ids.qualifiedCompany);
  const contactBefore = await readUpdatedAt("V2Contact", ids.qualifiedContact);
  const workflowBefore = await readWorkflowStatus(ids.qualifiedLead);
  const priorInsightCount = await countInsightRows();

  const enqueueResult = await enqueueIcpScoreJob(db, {
    organizationId: ids.organization,
    selection: {
      kind: "lead_assignment_ids",
      leadAssignmentIds: [
        ids.qualifiedLead,
        ids.reviewLead,
        ids.unqualifiedLead,
        ids.invalidLead,
        ids.softDeletedLead,
      ],
    },
    batchSize: 2,
  });
  assert.equal(enqueueResult.kind, "created");

  const firstResult = await processNextScoreJob();
  const firstSnapshot = firstResult.job.resultSnapshotJson;
  assert.equal(firstResult.kind, "succeeded");
  assert.equal(firstSnapshot.counts.scored, 3);
  assert.equal(firstSnapshot.counts.created, 3);
  assert.equal(firstSnapshot.counts.failed, 1);
  assert.equal(firstSnapshot.counts.skipped, 1);
  assert.ok(
    firstSnapshot.failures.some(
      (failure) =>
        failure.leadAssignmentId === ids.invalidLead &&
        failure.code === "ICP_VERSION_RULES_INVALID"
    )
  );
  assert.ok(
    firstSnapshot.failures.some(
      (failure) =>
        failure.leadAssignmentId === ids.softDeletedLead &&
        failure.code === "LEAD_ASSIGNMENT_NOT_ELIGIBLE"
    )
  );

  const qualified = firstSnapshot.results.find(
    (result) => result.leadAssignmentId === ids.qualifiedLead
  );
  const needsReview = firstSnapshot.results.find(
    (result) => result.leadAssignmentId === ids.reviewLead
  );
  const unqualified = firstSnapshot.results.find(
    (result) => result.leadAssignmentId === ids.unqualifiedLead
  );
  assert.equal(qualified.qualification, "QUALIFIED");
  assert.equal(needsReview.qualification, "NEEDS_REVIEW");
  assert.equal(unqualified.qualification, "UNQUALIFIED");
  assert.equal(qualified.previousAssessmentId, ids.oldAssessment);

  const latestPointer = await readLatestPointer(ids.qualifiedLead);
  assert.equal(latestPointer, qualified.assessmentId);
  assert.notEqual(latestPointer, ids.oldAssessment);
  await assertOldAssessmentUnchanged();
  assert.equal(await readWorkflowStatus(ids.qualifiedLead), workflowBefore);
  assert.equal(await readUpdatedAt("V2Company", ids.qualifiedCompany), companyBefore);
  assert.equal(await readUpdatedAt("V2Contact", ids.qualifiedContact), contactBefore);
  assert.equal(await countAssessments(ids.invalidLead), 0);
  assert.equal(await countAssessments(ids.softDeletedLead), 0);
  assert.equal(await countInsightRows(), priorInsightCount);
  console.log("PASS SCORE-HV0 first run creates immutable assessments safely");

  await enqueueV2Job(db, {
    organizationId: ids.organization,
    jobType: "ICP_SCORE",
    sourceType: "MANUAL",
    idempotencyKey: "scorehv0-smoke-rerun-explicit",
    payload: {
      schemaVersion: "v2.score-hv0.icp-score-job.v1",
      selection: {
        kind: "lead_assignment_ids",
        leadAssignmentIds: [ids.qualifiedLead, ids.reviewLead, ids.unqualifiedLead],
      },
    },
  });
  const rerunResult = await processNextScoreJob();
  const rerunSnapshot = rerunResult.job.resultSnapshotJson;
  assert.equal(rerunResult.kind, "succeeded");
  assert.equal(rerunSnapshot.counts.scored, 3);
  assert.equal(rerunSnapshot.counts.reused, 3);
  assert.equal(await countAssessments(ids.qualifiedLead), 2);
  console.log("PASS SCORE-HV0 rerun reuses matching input fingerprints");

  const projectEnqueue = await enqueueIcpScoreJob(db, {
    organizationId: ids.organization,
    selection: {
      kind: "project_icp",
      projectId: ids.project,
      icpVersionId: ids.icpVersion,
    },
    batchSize: 2,
  });
  assert.equal(projectEnqueue.kind, "created");
  assert.equal(
    buildIcpScoreJobIdempotencyKey(ids.organization, {
      kind: "project_icp",
      projectId: ids.project,
      icpVersionId: ids.icpVersion,
    }),
    `icp-score:${ids.organization}:project:${ids.project}:icp:${ids.icpVersion}:active`
  );
  const projectResult = await processNextScoreJob();
  assert.equal(projectResult.kind, "succeeded");
  assert.equal(projectResult.job.resultSnapshotJson.counts.reused, 3);
  console.log("PASS SCORE-HV0 project_icp selection reuses existing assessments");

  const rulesV2Enqueue = await enqueueIcpScoreJob(db, {
    organizationId: ids.organization,
    selection: {
      kind: "lead_assignment_ids",
      leadAssignmentIds: [
        ids.rulesV2QualifiedLead,
        ids.rulesV2NeedsContactLead,
        ids.rulesV2UnqualifiedLead,
        ids.rulesV2ReviewLead,
      ],
    },
    batchSize: 2,
  });
  assert.equal(rulesV2Enqueue.kind, "created");
  const rulesV2Result = await processNextScoreJob();
  const rulesV2Snapshot = rulesV2Result.job.resultSnapshotJson;
  assert.equal(rulesV2Result.kind, "succeeded");
  assert.equal(rulesV2Snapshot.counts.scored, 4);
  assert.equal(rulesV2Snapshot.counts.created, 4);

  const rulesV2Qualified = findResult(rulesV2Snapshot, ids.rulesV2QualifiedLead);
  const rulesV2NeedsContact = findResult(rulesV2Snapshot, ids.rulesV2NeedsContactLead);
  const rulesV2Unqualified = findResult(rulesV2Snapshot, ids.rulesV2UnqualifiedLead);
  const rulesV2Review = findResult(rulesV2Snapshot, ids.rulesV2ReviewLead);
  assert.equal(rulesV2Qualified.qualification, "QUALIFIED");
  assert.equal(rulesV2NeedsContact.qualification, "COMPANY_QUALIFIED_NEEDS_CONTACT");
  assert.equal(rulesV2Unqualified.qualification, "UNQUALIFIED");
  assert.equal(rulesV2Review.qualification, "NEEDS_REVIEW");
  assert.equal(rulesV2Qualified.accountPreRank, "STRONG_ACCOUNT_FIT");
  assert.equal(rulesV2NeedsContact.accountPreRank, "STRONG_ACCOUNT_FIT");
  assert.equal(rulesV2Unqualified.accountPreRank, "CLEAR_MISMATCH");
  assert.ok(rulesV2Review.fitScore >= 45, "Rules-v2 review case should be plausible, not low-fit.");

  const persistedRulesV2Qualified = await readAssessment(rulesV2Qualified.assessmentId);
  assert.equal(persistedRulesV2Qualified.scoringVersion, "V2.SCORE-HV0:rules-v2.v1");
  assert.equal(persistedRulesV2Qualified.scoringSource, "rules_v2_hard_rules");
  assert.equal(
    persistedRulesV2Qualified.evidenceSnapshotJson?.rulesSnapshot?.schemaVersion,
    "v2"
  );
  assert.ok(
    persistedRulesV2Qualified.evidenceSnapshotJson?.subScores?.persona >= 75,
    "Rules-v2 snapshot should persist per-dimension subScores."
  );
  assert.equal(
    persistedRulesV2Qualified.evidenceSnapshotJson?.inputSnapshot?.companyEvidence?.employeeCount,
    250
  );
  assert.equal(
    persistedRulesV2Qualified.evidenceSnapshotJson?.inputSnapshot?.companyEvidence?.revenueUsd,
    2500000
  );
  assert.deepEqual(
    persistedRulesV2Qualified.evidenceSnapshotJson?.inputSnapshot?.companyEvidence?.officeCountries,
    ["Singapore"]
  );
  assert.equal(
    persistedRulesV2Qualified.evidenceSnapshotJson?.inputSnapshot?.companyEvidence?.locationCount,
    3
  );
  const persistedSizeDimension =
    persistedRulesV2Qualified.evidenceSnapshotJson?.dimensionResults?.size;
  assert.ok(persistedSizeDimension, "Rules-v2 snapshot should include size dimension.");
  assert.ok(
    !persistedSizeDimension.missingEvidence?.includes("size_unknown"),
    "Explicit employee/revenue/location facts should satisfy size evidence."
  );
  assert.equal(
    persistedRulesV2Qualified.confidenceBreakdownJson?.confidence,
    "HIGH"
  );
  assert.ok(
    !JSON.stringify(persistedRulesV2Qualified.dataQualityJson).includes("UNCERTAIN"),
    "Rules-v2 persistence must not emit canonical UNCERTAIN."
  );

  const persistedRulesV2NeedsContact = await readAssessment(rulesV2NeedsContact.assessmentId);
  assert.ok(
    persistedRulesV2NeedsContact.dataQualityJson?.requiredEvidenceMissing?.includes(
      "required_persona_title_missing"
    ),
    "Rules-v2 needs-contact case should preserve required missing persona evidence."
  );
  const persistedRulesV2Unqualified = await readAssessment(rulesV2Unqualified.assessmentId);
  assert.ok(
    persistedRulesV2Unqualified.hardGateResultsJson?.hardDisqualifiersHit?.some(
      (hit) => hit.id === "excluded_country"
    ),
    "Rules-v2 unqualified case should persist terminal gate hits."
  );
  console.log("PASS SCORE-HV0 rules-v2 runtime creates balanced immutable assessments");

  await enqueueV2Job(db, {
    organizationId: ids.organization,
    jobType: "ICP_SCORE",
    sourceType: "MANUAL",
    idempotencyKey: "scorehv0-smoke-rules-v2-rerun-explicit",
    payload: {
      schemaVersion: "v2.score-hv0.icp-score-job.v1",
      selection: {
        kind: "lead_assignment_ids",
        leadAssignmentIds: [
          ids.rulesV2QualifiedLead,
          ids.rulesV2NeedsContactLead,
          ids.rulesV2UnqualifiedLead,
          ids.rulesV2ReviewLead,
        ],
      },
    },
  });
  const rulesV2RerunResult = await processNextScoreJob();
  assert.equal(rulesV2RerunResult.kind, "succeeded");
  assert.equal(rulesV2RerunResult.job.resultSnapshotJson.counts.reused, 4);
  assert.equal(await countAssessments(ids.rulesV2QualifiedLead), 1);
  console.log("PASS SCORE-HV0 rules-v2 rerun reuses matching fingerprints");

  await insertIntelligenceProfile(
    ids.rulesV2QualifiedCompany,
    "rulesv2-qualified.scorehv0.example",
    ["offering.saas", "business_model.b2b", "size.employee_count_325", "geo.office_country_singapore"],
    "SUCCESS",
    "v2"
  );
  await enqueueV2Job(db, {
    organizationId: ids.organization,
    jobType: "ICP_SCORE",
    sourceType: "MANUAL",
    idempotencyKey: "scorehv0-smoke-rules-v2-facts-change",
    payload: {
      schemaVersion: "v2.score-hv0.icp-score-job.v1",
      selection: {
        kind: "lead_assignment_ids",
        leadAssignmentIds: [ids.rulesV2QualifiedLead],
      },
    },
  });
  const changedFactsResult = await processNextScoreJob();
  assert.equal(changedFactsResult.kind, "succeeded");
  assert.equal(changedFactsResult.job.resultSnapshotJson.counts.created, 1);
  assert.equal(await countAssessments(ids.rulesV2QualifiedLead), 2);
  console.log("PASS SCORE-HV0 rules-v2 changed evidence creates a new immutable assessment");

  const rulesV2ProjectEnqueue = await enqueueIcpScoreJob(db, {
    organizationId: ids.organization,
    selection: {
      kind: "project_icp",
      projectId: ids.project,
      icpVersionId: ids.rulesV2IcpVersion,
    },
    batchSize: 2,
  });
  assert.equal(rulesV2ProjectEnqueue.kind, "created");
  const rulesV2ProjectResult = await processNextScoreJob();
  assert.equal(rulesV2ProjectResult.kind, "succeeded");
  assert.equal(rulesV2ProjectResult.job.resultSnapshotJson.counts.reused, 4);
  console.log("PASS SCORE-HV0 rules-v2 project_icp selection reuses existing assessments");

  await cleanupSmokeData();
  console.log("PASS V2.SCORE-HV0 runtime smoke checks complete");
} finally {
  await pool.end();
}

async function processNextScoreJob() {
  const claimed = await claimNextV2Job(db, {
    organizationId: ids.organization,
    jobType: "ICP_SCORE",
  });
  assert.ok(claimed, "Expected an ICP_SCORE job to be claimable");

  return processV2Job(db, claimed);
}

async function seedSmokeData() {
  await pool.query(`
    INSERT INTO "V2Organization" ("id", "name", "slug", "status", "createdAt", "updatedAt")
    VALUES ($1, 'SCORE-HV0 Smoke Organization', 'scorehv0-smoke-organization', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [ids.organization]);
  await pool.query(`
    INSERT INTO "V2ClientAccount" ("id", "organizationId", "name", "status", "createdAt", "updatedAt")
    VALUES ($1, $2, 'SCORE-HV0 Smoke Client', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [ids.clientAccount, ids.organization]);
  await pool.query(`
    INSERT INTO "V2Project" ("id", "organizationId", "clientAccountId", "name", "status", "createdAt", "updatedAt")
    VALUES ($1, $2, $3, 'SCORE-HV0 Smoke Project', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [ids.project, ids.organization, ids.clientAccount]);
  await pool.query(`
    INSERT INTO "V2Offer" ("id", "organizationId", "projectId", "name", "status", "createdAt", "updatedAt")
    VALUES ($1, $2, $3, 'SCORE-HV0 Smoke Offer', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [ids.offer, ids.organization, ids.project]);
  await pool.query(`
    INSERT INTO "V2ICPProfile" ("id", "organizationId", "offerId", "name", "status", "createdAt", "updatedAt")
    VALUES ($1, $2, $3, 'SCORE-HV0 Smoke ICP', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [ids.icpProfile, ids.organization, ids.offer]);
  await insertIcpVersion(ids.icpVersion, 1, scoringRules);
  await insertIcpVersion(ids.rulesV2IcpVersion, 3, rulesV2ScoringRules);
  await insertIcpVersion(ids.invalidIcpVersion, 2, invalidRules);
  await insertCompany(ids.qualifiedCompany, "Qualified Loyalty SaaS Platform", "qualified.scorehv0.example", "Singapore");
  await insertCompany(ids.reviewCompany, "Review Loyalty SaaS Platform", "review.scorehv0.example", "Singapore");
  await insertCompany(ids.unqualifiedCompany, "Excluded Loyalty SaaS Platform", "excluded.scorehv0.example", "India");
  await insertCompany(ids.rulesV2QualifiedCompany, "Rules V2 Qualified SaaS Platform", "rulesv2-qualified.scorehv0.example", "Singapore");
  await insertCompany(ids.rulesV2NeedsContactCompany, "Rules V2 Needs Contact SaaS Platform", "rulesv2-needs-contact.scorehv0.example", "Singapore");
  await insertCompany(ids.rulesV2UnqualifiedCompany, "Rules V2 Excluded SaaS Platform", "rulesv2-excluded.scorehv0.example", "India");
  await insertCompany(ids.rulesV2ReviewCompany, "Rules V2 Review SaaS Platform", "rulesv2-review.scorehv0.example", "Singapore");
  await insertCompany(ids.invalidCompany, "Invalid Rules Loyalty SaaS Platform", "invalid.scorehv0.example", "Singapore");
  await insertCompany(ids.softDeletedCompany, "Deleted Loyalty SaaS Platform", "deleted.scorehv0.example", "Singapore");
  await insertContact(ids.qualifiedContact, "Quinn Qualified", "Chief Revenue Officer");
  await insertContact(ids.unqualifiedContact, "Uma Unqualified", "Chief Revenue Officer");
  await insertContact(ids.rulesV2QualifiedContact, "Riley Rules V2", "Director of Sales");
  await insertContact(ids.rulesV2UnqualifiedContact, "Gina Gate", "Director of Sales");
  await insertContact(ids.rulesV2ReviewContact, "Jordan Review", "Junior Analyst");
  await insertContact(ids.invalidContact, "Ivan Invalid", "Chief Revenue Officer");
  await insertIdentifier(ids.qualifiedContact, "quinn@qualified.scorehv0.example");
  await insertIdentifier(ids.rulesV2QualifiedContact, "riley@rulesv2-qualified.scorehv0.example");
  await insertIdentifier(ids.rulesV2UnqualifiedContact, "gina@rulesv2-excluded.scorehv0.example");
  await insertIdentifier(ids.rulesV2ReviewContact, "jordan@rulesv2-review.scorehv0.example");
  await insertIntelligenceProfile(ids.rulesV2QualifiedCompany, "rulesv2-qualified.scorehv0.example", [
    "offering.saas",
    "business_model.b2b",
    "size.employee_count_250",
    "revenue.usd_2500000",
    "geo.office_country_singapore",
    "location.count_3",
  ]);
  await insertIntelligenceProfile(ids.rulesV2NeedsContactCompany, "rulesv2-needs-contact.scorehv0.example", ["offering.saas", "business_model.b2b"]);
  await insertIntelligenceProfile(ids.rulesV2UnqualifiedCompany, "rulesv2-excluded.scorehv0.example", ["offering.saas", "business_model.b2b"]);
  await insertIntelligenceProfile(ids.rulesV2ReviewCompany, "rulesv2-review.scorehv0.example", ["offering.saas", "business_model.b2b"]);
  await insertLead(ids.qualifiedLead, ids.qualifiedCompany, ids.qualifiedContact, ids.icpVersion, "CONTACT", null);
  await insertLead(ids.reviewLead, ids.reviewCompany, null, ids.icpVersion, "COMPANY", null);
  await insertLead(ids.unqualifiedLead, ids.unqualifiedCompany, ids.unqualifiedContact, ids.icpVersion, "CONTACT", null);
  await insertLead(ids.rulesV2QualifiedLead, ids.rulesV2QualifiedCompany, ids.rulesV2QualifiedContact, ids.rulesV2IcpVersion, "CONTACT", null);
  await insertLead(ids.rulesV2NeedsContactLead, ids.rulesV2NeedsContactCompany, null, ids.rulesV2IcpVersion, "COMPANY", null);
  await insertLead(ids.rulesV2UnqualifiedLead, ids.rulesV2UnqualifiedCompany, ids.rulesV2UnqualifiedContact, ids.rulesV2IcpVersion, "CONTACT", null);
  await insertLead(ids.rulesV2ReviewLead, ids.rulesV2ReviewCompany, ids.rulesV2ReviewContact, ids.rulesV2IcpVersion, "CONTACT", null);
  await insertLead(ids.invalidLead, ids.invalidCompany, ids.invalidContact, ids.invalidIcpVersion, "CONTACT", null);
  await insertLead(ids.softDeletedLead, ids.softDeletedCompany, null, ids.icpVersion, "COMPANY", new Date());
  await insertOldAssessment();
}

async function insertIcpVersion(id, versionNumber, rulesJson) {
  await pool.query(`
    INSERT INTO "V2ICPVersion" (
      "id", "organizationId", "icpProfileId", "versionNumber", "status", "rulesJson",
      "publishedAt", "version", "createdAt", "updatedAt"
    )
    VALUES ($1, $2, $3, $4, 'PUBLISHED', $5::jsonb, CURRENT_TIMESTAMP, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [id, ids.organization, ids.icpProfile, versionNumber, JSON.stringify(rulesJson)]);
}

async function insertCompany(id, name, domain, country) {
  await pool.query(`
    INSERT INTO "V2Company" (
      "id", "organizationId", "name", "nameNormalized", "canonicalDomain",
      "websiteUrl", "country", "status", "createdAt", "updatedAt"
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [id, ids.organization, name, name.toLowerCase(), domain, `https://${domain}`, country]);
}

async function insertContact(id, fullName, title) {
  await pool.query(`
    INSERT INTO "V2Contact" (
      "id", "organizationId", "fullName", "fullNameNormalized", "title",
      "status", "createdAt", "updatedAt"
    )
    VALUES ($1, $2, $3, $4, $5, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [id, ids.organization, fullName, fullName.toLowerCase(), title]);
}

async function insertIdentifier(contactId, email) {
  await pool.query(`
    INSERT INTO "V2ContactIdentifier" (
      "id", "organizationId", "contactId", "type", "normalizedValue", "rawValue",
      "isGeneric", "isValid", "validityStatus", "createdAt", "updatedAt"
    )
    VALUES ($1, $2, $3, 'EMAIL', $4, $4, false, true, 'VALID', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [`${contactId}_email`, ids.organization, contactId, email]);
}

async function insertIntelligenceProfile(
  companyId,
  domain,
  factsJson,
  fetchStatus = "SUCCESS",
  version = "v1"
) {
  await pool.query(`
    INSERT INTO "V2CompanyIntelligenceProfile" (
      "id", "organizationId", "companyId", "canonicalDomain", "factsJson",
      "sourceCoverageJson", "profileStatus", "researchVersion", "staleAt", "idempotencyKey", "createdAt"
    )
    VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, 'EXTRACTED', $7, CURRENT_TIMESTAMP + INTERVAL '1 day', $8, CURRENT_TIMESTAMP)
  `, [
    `${companyId}_intel_${version}`,
    ids.organization,
    companyId,
    domain,
    JSON.stringify(factsJson),
    JSON.stringify({ fetchStatus, pagesFetched: 1, pagesWithContent: 1 }),
    version === "v2" ? 2 : 1,
    `${companyId}:intel:${version}`,
  ]);
}

async function insertLead(id, companyId, contactId, icpVersionId, assignmentLevel, deletedAt) {
  await pool.query(`
    INSERT INTO "V2LeadAssignment" (
      "id", "organizationId", "companyId", "contactId", "projectId", "icpVersionId",
      "assignmentLevel", "workflowStatus", "status", "deletedAt", "createdAt", "updatedAt"
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7::"V2LeadAssignmentLevel", 'NEW', 'ACTIVE', $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [id, ids.organization, companyId, contactId, ids.project, icpVersionId, assignmentLevel, deletedAt]);
}

async function insertOldAssessment() {
  await pool.query(`
    INSERT INTO "V2HardRuleAssessment" (
      "id", "organizationId", "leadAssignmentId", "icpVersionId", "fitScore", "confidence",
      "qualification", "reason", "inputFingerprint", "scoringSource", "scoringVersion", "createdAt"
    )
    VALUES ($1, $2, $3, $4, 1, 0.01, 'NEEDS_REVIEW', 'Old smoke assessment', 'old-scorehv0-fingerprint', 'icp1r_hard_rules', 'V2.SCORE-HV0:icp1r.v1', CURRENT_TIMESTAMP)
  `, [ids.oldAssessment, ids.organization, ids.qualifiedLead, ids.icpVersion]);
  await pool.query(`
    UPDATE "V2LeadAssignment"
    SET "latestHardRuleAssessmentId" = $1
    WHERE "id" = $2 AND "organizationId" = $3
  `, [ids.oldAssessment, ids.qualifiedLead, ids.organization]);
}

async function assertOldAssessmentUnchanged() {
  const result = await pool.query(`
    SELECT "fitScore", "reason"
    FROM "V2HardRuleAssessment"
    WHERE "id" = $1 AND "organizationId" = $2
  `, [ids.oldAssessment, ids.organization]);
  assert.equal(result.rows[0].fitScore, 1);
  assert.equal(result.rows[0].reason, "Old smoke assessment");
}

async function readLatestPointer(leadAssignmentId) {
  const result = await pool.query(`
    SELECT "latestHardRuleAssessmentId"
    FROM "V2LeadAssignment"
    WHERE "id" = $1 AND "organizationId" = $2
  `, [leadAssignmentId, ids.organization]);

  return result.rows[0]?.latestHardRuleAssessmentId ?? null;
}

async function readWorkflowStatus(leadAssignmentId) {
  const result = await pool.query(`
    SELECT "workflowStatus"::text AS "workflowStatus"
    FROM "V2LeadAssignment"
    WHERE "id" = $1 AND "organizationId" = $2
  `, [leadAssignmentId, ids.organization]);

  return result.rows[0]?.workflowStatus ?? null;
}

async function readAssessment(assessmentId) {
  const result = await pool.query(`
    SELECT
      "id",
      "scoringSource",
      "scoringVersion",
      "evidenceSnapshotJson",
      "hardGateResultsJson",
      "confidenceBreakdownJson",
      "dataQualityJson"
    FROM "V2HardRuleAssessment"
    WHERE "id" = $1 AND "organizationId" = $2
  `, [assessmentId, ids.organization]);

  assert.ok(result.rows[0], `Expected assessment ${assessmentId} to exist.`);
  return result.rows[0];
}

async function readUpdatedAt(tableName, id) {
  const result = await pool.query(
    `SELECT "updatedAt" FROM "${tableName}" WHERE "id" = $1 AND "organizationId" = $2`,
    [id, ids.organization]
  );

  return result.rows[0]?.updatedAt?.toISOString() ?? null;
}

async function countAssessments(leadAssignmentId) {
  const result = await pool.query(`
    SELECT COUNT(*)::int AS count
    FROM "V2HardRuleAssessment"
    WHERE "organizationId" = $1 AND "leadAssignmentId" = $2
  `, [ids.organization, leadAssignmentId]);

  return result.rows[0].count;
}

async function countInsightRows() {
  const tableName = '"V2' + 'AiInsight"';
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM ${tableName} WHERE "organizationId" = $1`,
    [ids.organization]
  );

  return result.rows[0].count;
}

async function cleanupSmokeData() {
  await pool.query(`DELETE FROM "V2Job" WHERE "organizationId" = $1`, [ids.organization]);
  await pool.query(`UPDATE "V2LeadAssignment" SET "latestHardRuleAssessmentId" = NULL WHERE "organizationId" = $1`, [ids.organization]);
  await pool.query(`DELETE FROM "V2HardRuleAssessment" WHERE "organizationId" = $1`, [ids.organization]);
  await pool.query(`DELETE FROM "V2LeadAssignment" WHERE "organizationId" = $1`, [ids.organization]);
  await pool.query(`DELETE FROM "V2ContactIdentifier" WHERE "organizationId" = $1`, [ids.organization]);
  await pool.query(`DELETE FROM "V2Contact" WHERE "organizationId" = $1`, [ids.organization]);
  await pool.query(`DELETE FROM "V2CompanyIntelligenceProfile" WHERE "organizationId" = $1`, [ids.organization]);
  await pool.query(`DELETE FROM "V2Company" WHERE "organizationId" = $1`, [ids.organization]);
  await pool.query(`DELETE FROM "V2ICPVersion" WHERE "organizationId" = $1`, [ids.organization]);
  await pool.query(`DELETE FROM "V2ICPProfile" WHERE "organizationId" = $1`, [ids.organization]);
  await pool.query(`DELETE FROM "V2Offer" WHERE "organizationId" = $1`, [ids.organization]);
  await pool.query(`DELETE FROM "V2Project" WHERE "organizationId" = $1`, [ids.organization]);
  await pool.query(`DELETE FROM "V2ClientAccount" WHERE "organizationId" = $1`, [ids.organization]);
  await pool.query(`DELETE FROM "V2Organization" WHERE "id" = $1`, [ids.organization]);
}

function findResult(snapshot, leadAssignmentId) {
  const result = snapshot.results.find((item) => item.leadAssignmentId === leadAssignmentId);
  assert.ok(result, `Expected result for ${leadAssignmentId}.`);
  return result;
}

function createPgJobDb(poolOrClient) {
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
    async $transaction(callback) {
      const client = await poolOrClient.connect();

      try {
        await client.query("BEGIN");
        const result = await callback(createPgJobDb(client));
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
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
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
