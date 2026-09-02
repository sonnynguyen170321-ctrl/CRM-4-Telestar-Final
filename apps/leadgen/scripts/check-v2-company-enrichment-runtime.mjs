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
  enqueueCompanyEnrichmentJob,
  buildCompanyEnrichmentJobIdempotencyKey,
  companyEnrichmentJobHandler,
} = loadTsModule("lib/v2/company-intelligence/index.ts");
const {
  buildIntelligenceProfileIdempotencyKey,
  buildResearchSnapshotIdempotencyKey,
} = loadTsModule("lib/v2/company-intelligence/companyEnrichmentHandler.ts");
const { runCompanyResearch } = loadTsModule(
  "lib/v2/company-intelligence/runCompanyResearch.ts"
);
const { claimNextV2Job, processV2Job } = loadTsModule("lib/v2/jobs/index.ts");
const { TELESTAR_SDR_OUTSOURCING_ICP_RULES } = loadTsModule(
  "lib/v2/scoring/__fixtures__/sampleIcpRules.ts"
);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = createPgDb(pool);

const ids = {
  organization: "company_enrich_smoke_org",
  organizationSlug: "company-enrich-smoke-organization",
  otherOrganization: "company_enrich_smoke_org_other",
  user: "company_enrich_smoke_user",
  membership: "company_enrich_smoke_membership",
  clientAccount: "company_enrich_smoke_client",
  project: "company_enrich_smoke_project",
  offer: "company_enrich_smoke_offer",
  icpProfile: "company_enrich_smoke_icp_profile",
  icpVersion1: "company_enrich_smoke_icp_version_1",
  icpVersion2: "company_enrich_smoke_icp_version_2",
  company: "company_enrich_smoke_company",
  noWebsiteCompany: "company_enrich_smoke_no_website_company",
  leadAssignment1: "company_enrich_smoke_lead_1",
  leadAssignment2: "company_enrich_smoke_lead_2",
};

const rulesJson = {
  ...TELESTAR_SDR_OUTSOURCING_ICP_RULES,
  ruleSetId: "company-enrich-smoke",
  displayName: "Company Enrich Smoke ICP",
};

const fixtureHtml = `<html><body><main>${[
  "Acme provides a SaaS cybersecurity platform for banking customers.",
  "The company is headquartered in Singapore and sells B2B cloud infrastructure software.",
  "Our pricing plans support enterprise teams.",
].join(" ").repeat(8)}</main></body></html>`;

try {
  await cleanupSmokeData();
  await seedSmokeData();

  await assertPureResearchStatuses();

  const restoreFetch = installMockFetch({
    "/robots.txt": { status: 404, body: "" },
    "/": { status: 200, body: fixtureHtml },
    "/pricing": { status: 200, body: "Pricing plans for SaaS cybersecurity platform.".repeat(20) },
  });

  try {
    const enqueueResult1 = await enqueueCompanyEnrichmentJob(db, {
      organizationId: ids.organization,
      companyId: ids.company,
      createdByUserId: ids.user,
    });
    assert.equal(enqueueResult1.kind, "created");
    assert.equal(
      enqueueResult1.job.idempotencyKey,
      buildCompanyEnrichmentJobIdempotencyKey(ids.organization, ids.company, 1)
    );

    const enqueueResult2 = await enqueueCompanyEnrichmentJob(db, {
      organizationId: ids.organization,
      companyId: ids.company,
      createdByUserId: ids.user,
    });
    assert.equal(enqueueResult2.kind, "existing");
    assert.equal(await countCompanyEnrichmentJobs(), 1);
    console.log("PASS one COMPANY_ENRICHMENT job is enqueued per company, not per LeadAssignment");

    const result = await processRequired("COMPANY_ENRICHMENT");
    const snapshot = result.job.resultSnapshotJson;
    assert.equal(snapshot.researchSnapshot.status, "SUCCESS");
    assert.equal(snapshot.researchSnapshot.reused, false);
    assert.equal(snapshot.intelligenceProfile.profileStatus, "EXTRACTED");
    assert.equal(snapshot.intelligenceProfile.reused, false);
    assert.deepEqual(
      [...snapshot.leadAssignmentIds].sort(),
      [ids.leadAssignment1, ids.leadAssignment2].sort()
    );
    assert.equal(snapshot.scoreJob.result, "created");
    assert.equal(await countResearchSnapshots(ids.company), 1);
    assert.equal(await countIntelligenceProfiles(ids.company), 1);
    await assertProfileFacts(ids.company, [
      "offering.saas",
      "offering.cybersecurity",
      "industry.banking",
      "geo.hq_country_singapore",
      "maturity.has_pricing_page",
    ]);
    console.log("PASS COMPANY_ENRICHMENT writes SUCCESS snapshot + EXTRACTED neutral intelligence profile");

    const scoreJob = await claimNextV2Job(db, {
      organizationId: ids.organization,
      jobType: "ICP_SCORE",
    });
    assert.ok(scoreJob);
    const scoreResult = await processV2Job(db, scoreJob);
    assert.equal(scoreResult.kind, "succeeded");
    assert.equal(await countAssessments(ids.leadAssignment1), 1);
    assert.equal(await countAssessments(ids.leadAssignment2), 1);
    console.log("PASS company enrichment fan-out scores every active LeadAssignment across ICP versions");

    const rerunResult = await companyEnrichmentJobHandler({
      db,
      job: result.job,
      organizationId: ids.organization,
      payload: {
        schemaVersion: "v2.company-enrichment.job.v1",
        organizationId: ids.organization,
        companyId: ids.company,
        researchVersion: 1,
      },
      signal: new AbortController().signal,
      updateProgress: async () => {},
    });
    assert.equal(rerunResult.resultSnapshotJson.researchSnapshot.reused, true);
    assert.equal(rerunResult.resultSnapshotJson.intelligenceProfile.reused, true);
    assert.equal(await countResearchSnapshots(ids.company), 1);
    assert.equal(await countIntelligenceProfiles(ids.company), 1);
    assert.equal(await countIcpScoreJobs(), 1);
    console.log("PASS rerunning COMPANY_ENRICHMENT creates zero duplicate snapshots, profiles, or score jobs");

    const enqueueResultV2 = await enqueueCompanyEnrichmentJob(db, {
      organizationId: ids.organization,
      companyId: ids.company,
      researchVersion: 2,
      createdByUserId: ids.user,
    });
    assert.equal(enqueueResultV2.kind, "created");
    assert.equal(
      enqueueResultV2.job.idempotencyKey,
      buildCompanyEnrichmentJobIdempotencyKey(ids.organization, ids.company, 2)
    );
    assert.notEqual(
      enqueueResultV2.job.idempotencyKey,
      buildCompanyEnrichmentJobIdempotencyKey(ids.organization, ids.company, 1)
    );
    assert.notEqual(
      buildResearchSnapshotIdempotencyKey(ids.organization, ids.company, 1),
      buildResearchSnapshotIdempotencyKey(ids.organization, ids.company, 2)
    );
    assert.notEqual(
      buildIntelligenceProfileIdempotencyKey(ids.organization, ids.company, 1),
      buildIntelligenceProfileIdempotencyKey(ids.organization, ids.company, 2)
    );
    console.log("PASS researchVersion=1 and researchVersion=2 produce distinct enrichment idempotency keys");

    const resultV2 = await processRequired("COMPANY_ENRICHMENT");
    const snapshotV2 = resultV2.job.resultSnapshotJson;
    assert.equal(snapshotV2.researchSnapshot.status, "SUCCESS");
    assert.equal(snapshotV2.intelligenceProfile.profileStatus, "EXTRACTED");
    assert.equal(await countResearchSnapshots(ids.company), 2);
    assert.equal(await countIntelligenceProfiles(ids.company), 2);
    assert.equal(snapshotV2.scoreJob.result, "existing");
    assert.equal(await countIcpScoreJobs(), 1);
    console.log("PASS researchVersion=2 creates a second immutable snapshot/profile and reuses score job");
  } finally {
    restoreFetch();
  }

  const noWebsiteJob = await enqueueCompanyEnrichmentJob(db, {
    organizationId: ids.organization,
    companyId: ids.noWebsiteCompany,
    createdByUserId: ids.user,
  });
  assert.equal(noWebsiteJob.kind, "created");
  const noWebsiteResult = await processRequired("COMPANY_ENRICHMENT");
  assert.equal(noWebsiteResult.job.resultSnapshotJson.researchSnapshot.status, "NO_WEBSITE");
  assert.equal(noWebsiteResult.job.resultSnapshotJson.intelligenceProfile.profileStatus, "FAILED");
  await assertProfileFacts(ids.noWebsiteCompany, []);
  console.log("PASS NO_WEBSITE degrades safely with empty facts and still completes enrichment");

  await assertTenantIsolation();
  console.log("PASS COMPANY_ENRICHMENT enforces tenant isolation");

  assertNoForbiddenDependencies();
  console.log("PASS company-intelligence uses stub search provider and no real browser/search dependency");

  await cleanupSmokeData();
  console.log("PASS V2 company enrichment runtime smoke checks complete");
} finally {
  await pool.end();
}

async function assertPureResearchStatuses() {
  const blocked = await runCompanyResearch({
    companyName: "Blocked Co",
    canonicalDomainInput: "https://blocked.example",
    websiteUrl: "https://blocked.example",
    fetchOptions: {
      fetchImpl: createMockFetch({
        "/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /\n" },
        "/": { status: 200, body: fixtureHtml },
      }),
      rateLimitIntervalMs: 0,
    },
  });
  assert.equal(blocked.status, "BLOCKED");
  assert.deepEqual(blocked.profile.factsJson, []);

  const offline = await runCompanyResearch({
    companyName: "Offline Co",
    canonicalDomainInput: "https://offline.example",
    websiteUrl: "https://offline.example",
    fetchOptions: {
      fetchImpl: createMockFetch({ "/": "network_error" }),
      rateLimitIntervalMs: 0,
    },
  });
  assert.equal(offline.status, "OFFLINE");
  assert.deepEqual(offline.profile.factsJson, []);

  const jsRequired = await runCompanyResearch({
    companyName: "JS Co",
    canonicalDomainInput: "HTTPS://WWW.Example.COM/about?x=1",
    websiteUrl: "HTTPS://WWW.Example.COM/about?x=1",
    fetchOptions: {
      fetchImpl: createMockFetch({ "/": { status: 200, body: "Hi." } }),
      rateLimitIntervalMs: 0,
    },
    playwrightOptions: { isEnabled: () => false },
  });
  assert.equal(jsRequired.canonicalDomain, "example.com");
  assert.equal(jsRequired.status, "JS_RENDER_REQUIRED");
  assert.equal(jsRequired.profile.sourceCoverageJson.playwrightFallbackUsed, false);

  for (const item of blocked.profile.evidenceItemsJson) {
    assertNoQualificationLikeFields(item);
  }
  console.log("PASS fixture research statuses are mocked and degrade without live network");
}

async function processRequired(jobType) {
  const job = await claimNextV2Job(db, {
    organizationId: ids.organization,
    jobType,
  });
  assert.ok(job, `Expected queued ${jobType} job`);
  const result = await processV2Job(db, job);
  assert.equal(result.kind, "succeeded");
  return result;
}

async function assertTenantIsolation() {
  const baseJobRecord = { createdByUserId: null };

  await assert.rejects(
    companyEnrichmentJobHandler({
      db,
      job: baseJobRecord,
      organizationId: ids.otherOrganization,
      payload: {
        schemaVersion: "v2.company-enrichment.job.v1",
        organizationId: ids.organization,
        companyId: ids.company,
        researchVersion: 1,
      },
      signal: new AbortController().signal,
      updateProgress: async () => {},
    }),
    (error) => {
      assert.equal(error.errorCode, "TENANT_MISMATCH");
      assert.equal(error.retryable, false);
      return true;
    }
  );

  await assert.rejects(
    companyEnrichmentJobHandler({
      db,
      job: baseJobRecord,
      organizationId: ids.otherOrganization,
      payload: {
        schemaVersion: "v2.company-enrichment.job.v1",
        organizationId: ids.otherOrganization,
        companyId: ids.company,
        researchVersion: 1,
      },
      signal: new AbortController().signal,
      updateProgress: async () => {},
    }),
    (error) => {
      assert.equal(error.errorCode, "COMPANY_NOT_FOUND");
      assert.equal(error.retryable, false);
      return true;
    }
  );
}

async function seedSmokeData() {
  await db.$queryRaw`
    INSERT INTO "V2Organization" ("id", "name", "slug", "status", "createdAt", "updatedAt")
    VALUES (${ids.organization}, 'Company Enrich Smoke Organization', ${ids.organizationSlug}, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `;
  await db.$queryRaw`
    INSERT INTO "V2User" ("id", "email", "emailNormalized", "name", "status", "createdAt", "updatedAt")
    VALUES (${ids.user}, 'company-enrich-smoke@example.test', 'company-enrich-smoke@example.test', 'Company Enrich Smoke', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `;
  await db.$queryRaw`
    INSERT INTO "V2OrganizationMembership" ("id", "organizationId", "userId", "role", "status", "createdAt", "updatedAt")
    VALUES (${ids.membership}, ${ids.organization}, ${ids.user}, 'OWNER', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `;
  await db.$queryRaw`
    INSERT INTO "V2ClientAccount" ("id", "organizationId", "name", "status", "createdAt", "updatedAt")
    VALUES (${ids.clientAccount}, ${ids.organization}, 'Company Enrich Smoke Client', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `;
  await db.$queryRaw`
    INSERT INTO "V2Project" ("id", "organizationId", "clientAccountId", "name", "status", "createdAt", "updatedAt")
    VALUES (${ids.project}, ${ids.organization}, ${ids.clientAccount}, 'Company Enrich Smoke Project', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `;
  await db.$queryRaw`
    INSERT INTO "V2Offer" ("id", "organizationId", "projectId", "name", "status", "createdAt", "updatedAt")
    VALUES (${ids.offer}, ${ids.organization}, ${ids.project}, 'Company Enrich Smoke Offer', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `;
  await db.$queryRaw`
    INSERT INTO "V2ICPProfile" ("id", "organizationId", "offerId", "name", "status", "createdAt", "updatedAt")
    VALUES (${ids.icpProfile}, ${ids.organization}, ${ids.offer}, 'Company Enrich Smoke ICP', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `;
  await db.$queryRaw`
    INSERT INTO "V2ICPVersion" (
      "id", "organizationId", "icpProfileId", "versionNumber", "status", "rulesJson",
      "publishedAt", "version", "createdAt", "updatedAt"
    )
    VALUES (${ids.icpVersion1}, ${ids.organization}, ${ids.icpProfile}, 1, 'PUBLISHED', ${JSON.stringify(rulesJson)}::jsonb, CURRENT_TIMESTAMP, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `;
  await db.$queryRaw`
    INSERT INTO "V2ICPVersion" (
      "id", "organizationId", "icpProfileId", "versionNumber", "status", "rulesJson",
      "publishedAt", "version", "createdAt", "updatedAt"
    )
    VALUES (${ids.icpVersion2}, ${ids.organization}, ${ids.icpProfile}, 2, 'PUBLISHED', ${JSON.stringify(rulesJson)}::jsonb, CURRENT_TIMESTAMP, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `;
  await db.$queryRaw`
    INSERT INTO "V2Company" (
      "id", "organizationId", "name", "nameNormalized", "canonicalDomain", "websiteUrl",
      "country", "status", "createdAt", "updatedAt"
    )
    VALUES (
      ${ids.company}, ${ids.organization}, 'Company Enrich Smoke Co', 'company enrich smoke co',
      'company-enrich-smoke.example', 'https://www.company-enrich-smoke.example/about?x=1', 'Singapore', 'ACTIVE',
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `;
  await db.$queryRaw`
    INSERT INTO "V2Company" (
      "id", "organizationId", "name", "nameNormalized", "canonicalDomain", "websiteUrl",
      "country", "status", "createdAt", "updatedAt"
    )
    VALUES (
      ${ids.noWebsiteCompany}, ${ids.organization}, 'No Website Smoke Co', 'no website smoke co',
      NULL, NULL, 'Singapore', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `;
  await db.$queryRaw`
    INSERT INTO "V2LeadAssignment" (
      "id", "organizationId", "projectId", "icpVersionId", "companyId", "contactId",
      "assignmentLevel", "workflowStatus", "status", "createdAt", "updatedAt"
    )
    VALUES (
      ${ids.leadAssignment1}, ${ids.organization}, ${ids.project}, ${ids.icpVersion1}, ${ids.company}, NULL,
      'COMPANY'::"V2LeadAssignmentLevel", 'NEW', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `;
  await db.$queryRaw`
    INSERT INTO "V2LeadAssignment" (
      "id", "organizationId", "projectId", "icpVersionId", "companyId", "contactId",
      "assignmentLevel", "workflowStatus", "status", "createdAt", "updatedAt"
    )
    VALUES (
      ${ids.leadAssignment2}, ${ids.organization}, ${ids.project}, ${ids.icpVersion2}, ${ids.company}, NULL,
      'COMPANY'::"V2LeadAssignmentLevel", 'NEW', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `;
}

async function assertProfileFacts(companyId, expectedFacts) {
  const rows = await db.$queryRaw`
    SELECT "factsJson", "evidenceItemsJson"
    FROM "V2CompanyIntelligenceProfile"
    WHERE "organizationId" = ${ids.organization}
      AND "companyId" = ${companyId}
    ORDER BY "createdAt" DESC
    LIMIT 1
  `;
  assert.ok(rows[0]);
  const facts = Array.isArray(rows[0].factsJson) ? rows[0].factsJson : [];
  assert.deepEqual(
    expectedFacts.filter((fact) => !facts.includes(fact)),
    []
  );

  const evidenceItems = Array.isArray(rows[0].evidenceItemsJson)
    ? rows[0].evidenceItemsJson
    : [];
  for (const item of evidenceItems) {
    assertNoQualificationLikeFields(item);
  }
}

function assertNoQualificationLikeFields(value) {
  for (const key of ["qualification", "fitScore", "confidenceScore", "status", "verdict"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(value, key), false);
  }
}

function installMockFetch(routes) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetch(routes);
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function createMockFetch(routes) {
  return async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = new URL(url).pathname;
    const route = routes[path] ?? { status: 404, body: "" };

    if (route === "network_error") {
      throw new TypeError("network error");
    }

    return {
      status: route.status,
      url,
      text: async () => route.body,
    };
  };
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

async function countIcpScoreJobs() {
  const rows = await db.$queryRaw`
    SELECT COUNT(*)::int AS count
    FROM "V2Job"
    WHERE "organizationId" = ${ids.organization}
      AND "jobType" = 'ICP_SCORE'
  `;

  return Number(rows[0].count);
}

async function countResearchSnapshots(companyId) {
  const rows = await db.$queryRaw`
    SELECT COUNT(*)::int AS count
    FROM "V2CompanyResearchSnapshot"
    WHERE "organizationId" = ${ids.organization}
      AND "companyId" = ${companyId}
  `;

  return Number(rows[0].count);
}

async function countIntelligenceProfiles(companyId) {
  const rows = await db.$queryRaw`
    SELECT COUNT(*)::int AS count
    FROM "V2CompanyIntelligenceProfile"
    WHERE "organizationId" = ${ids.organization}
      AND "companyId" = ${companyId}
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

async function cleanupSmokeData() {
  await db.$executeRaw`DELETE FROM "V2Job" WHERE "organizationId" IN (${ids.organization}, ${ids.otherOrganization})`;
  await db.$executeRaw`DELETE FROM "V2CompanyIntelligenceProfile" WHERE "organizationId" = ${ids.organization}`;
  await db.$executeRaw`DELETE FROM "V2CompanyResearchSnapshot" WHERE "organizationId" = ${ids.organization}`;
  await db.$executeRaw`UPDATE "V2LeadAssignment" SET "latestHardRuleAssessmentId" = NULL WHERE "organizationId" = ${ids.organization}`;
  await db.$executeRaw`DELETE FROM "V2HardRuleAssessment" WHERE "organizationId" = ${ids.organization}`;
  await db.$executeRaw`DELETE FROM "V2LeadAssignment" WHERE "organizationId" = ${ids.organization}`;
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

function assertNoForbiddenDependencies() {
  const packageJson = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8"));
  const allDeps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  for (const dependency of ["playwright", "playwright-core", "cheerio", "axios"]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(allDeps, dependency),
      false,
      `${dependency} must not be added for S-ENRICH-B without explicit provider/runtime approval`
    );
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
