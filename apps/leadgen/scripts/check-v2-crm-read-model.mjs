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
runStaticCrm1Checks();

const {
  getLeadWorkspaceDetail,
  listLeadWorkspaceFilterOptions,
  queryLeadWorkspace,
  queryContactLeads,
  queryContactLeadMetrics,
} = loadTsModule("lib/v2/crm/index.ts");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const readModelDb = {
  async $queryRawUnsafe(query, ...values) {
    const result = await pool.query(query, values);

    return result.rows;
  },
};

const ids = {
  orgA: "crm0_smoke_org_a",
  orgB: "crm0_smoke_org_b",
  clientA: "crm0_smoke_client_a",
  clientB: "crm0_smoke_client_b",
  projectA: "crm0_smoke_project_a",
  projectB: "crm0_smoke_project_b",
  offerA: "crm0_smoke_offer_a",
  offerB: "crm0_smoke_offer_b",
  icpProfileA: "crm0_smoke_icp_profile_a",
  icpProfileB: "crm0_smoke_icp_profile_b",
  icpVersionA: "crm0_smoke_icp_version_a",
  icpVersionB: "crm0_smoke_icp_version_b",
  companyOnlyCompany: "crm0_smoke_company_only_company",
  contactCompany: "crm0_smoke_contact_company",
  unscoredCompany: "crm0_smoke_unscored_company",
  deletedCompany: "crm0_smoke_deleted_company",
  tenantBCompany: "crm0_smoke_tenant_b_company",
  contact: "crm0_smoke_contact",
  tenantBContact: "crm0_smoke_tenant_b_contact",
  companyOnlyLead: "crm0_smoke_company_only_lead",
  contactLead: "crm0_smoke_contact_lead",
  olderContactLead: "crm0_smoke_older_contact_lead",
  deletedContactLead: "crm0_smoke_deleted_contact_lead",
  unscoredLead: "crm0_smoke_unscored_lead",
  deletedLead: "crm0_smoke_deleted_lead",
  tenantBLead: "crm0_smoke_tenant_b_lead",
};

try {
  await cleanupSmokeData();
  await seedSmokeData();

  const workflowBefore = await readWorkflowStatus(ids.contactLead);
  const companyUpdatedBefore = await readUpdatedAt("V2Company", ids.contactCompany, ids.orgA);
  const contactUpdatedBefore = await readUpdatedAt("V2Contact", ids.contact, ids.orgA);
  const leadUpdatedBefore = await readUpdatedAt(
    "V2LeadAssignment",
    ids.contactLead,
    ids.orgA
  );
  const jobCountBefore = await countRows("V2Job", ids.orgA);
  const insightCountBefore = await countInsightRows(ids.orgA);

  const options = await listLeadWorkspaceFilterOptions(
    { organizationId: ids.orgA },
    readModelDb
  );
  assert.equal(options.projects.length, 1);
  assert.equal(options.icpVersions.length, 1);

  const result = await queryLeadWorkspace(
    {
      organizationId: ids.orgA,
      page: 1,
      pageSize: 100,
    },
    readModelDb
  );
  const leadIds = result.rows.map((row) => row.leadAssignmentId).sort();
  assert.deepEqual(leadIds, [
    ids.companyOnlyLead,
    ids.contactLead,
    ids.unscoredLead,
  ].sort());
  assert.ok(!leadIds.includes(ids.tenantBLead));
  assert.ok(!leadIds.includes(ids.deletedLead));

  const companyOnly = result.rows.find(
    (row) => row.leadAssignmentId === ids.companyOnlyLead
  );
  assert.equal(companyOnly.assignmentLevel, "COMPANY");
  assert.equal(companyOnly.contactId, null);
  assert.equal(companyOnly.latestAssessment.qualification, "NEEDS_REVIEW");

  const contactLevel = result.rows.find(
    (row) => row.leadAssignmentId === ids.contactLead
  );
  assert.equal(contactLevel.assignmentLevel, "CONTACT");
  assert.equal(contactLevel.contactName, "Casey Contact");
  assert.equal(contactLevel.latestAssessment.qualification, "QUALIFIED");
  assert.equal(contactLevel.latestAssessment.fitScore, 88);
  assert.equal(contactLevel.latestAssessment.confidenceScore, 91);
  assert.equal(contactLevel.latestAssessment.confidenceBand, "HIGH");

  const unscored = result.rows.find(
    (row) => row.leadAssignmentId === ids.unscoredLead
  );
  assert.equal(unscored.latestAssessment, null);

  const filtered = await queryLeadWorkspace(
    {
      organizationId: ids.orgA,
      filters: {
        search: "casey",
        assignmentLevel: "CONTACT",
        qualification: ["QUALIFIED"],
        scored: "scored",
        confidenceBand: ["HIGH"],
      },
    },
    readModelDb
  );
  assert.equal(filtered.rows.length, 1);
  assert.equal(filtered.rows[0].leadAssignmentId, ids.contactLead);

  const detail = await getLeadWorkspaceDetail(
    {
      organizationId: ids.orgA,
      leadAssignmentId: ids.contactLead,
    },
    readModelDb
  );
  assert.ok(detail);
  assert.equal(detail.assessmentHistory.length, 10);
  assert.equal(detail.assessmentHistory[0].qualification, "QUALIFIED");
  assert.equal(detail.latestAssessment.id, `${ids.contactLead}_assessment_11`);

  await insertLead(
    ids.olderContactLead,
    ids.orgA,
    ids.unscoredCompany,
    ids.contact,
    ids.projectA,
    ids.icpVersionA,
    "CONTACT",
    null
  );
  await pool.query(
    `UPDATE "V2LeadAssignment" SET "updatedAt" = CURRENT_TIMESTAMP - INTERVAL '1 day' WHERE "id" = $1`,
    [ids.olderContactLead]
  );
  await insertLead(
    ids.deletedContactLead,
    ids.orgA,
    ids.deletedCompany,
    ids.contact,
    ids.projectA,
    ids.icpVersionA,
    "CONTACT",
    new Date()
  );
  await insertEnrollment("crm0_smoke_enrollment_1", ids.contactLead, ids.contact, "crm0_sequence_1");
  await insertEnrollment("crm0_smoke_enrollment_2", ids.olderContactLead, ids.contact, "crm0_sequence_2");

  const contactFilters = {
    clientAccountId: ids.clientA,
    projectId: ids.projectA,
    icpVersionId: ids.icpVersionA,
  };
  const contactResult = await queryContactLeads(
    {
      organizationId: ids.orgA,
      page: 1,
      pageSize: 100,
      filters: contactFilters,
    },
    readModelDb
  );
  assert.equal(contactResult.pagination.total, 1, "one row per contact in context");
  assert.equal(contactResult.rows[0].contactId, ids.contact);
  assert.equal(contactResult.rows[0].leadAssignmentId, ids.contactLead, "newest active assignment is primary");
  assert.equal(contactResult.rows[0].leadCount, 2, "deleted assignment is excluded from rollup");
  assert.equal(contactResult.rows[0].email, "casey@example.test");
  assert.equal(contactResult.rows[0].phone, "+84901234567");
  assert.equal(contactResult.rows[0].linkedInUrl, "https://linkedin.com/in/casey-contact");
  assert.equal(contactResult.rows[0].contactCity, "Ho Chi Minh City");
  assert.equal(contactResult.rows[0].contactCountry, "Vietnam");
  assert.equal(contactResult.rows[0].hasUsableEmail, true);
  assert.equal(contactResult.rows[0].activeEnrollmentCount, 2, "enrollment rollup is a true count");
  assert.ok(!contactResult.rows.some((row) => row.contactId === ids.tenantBContact));
  assert.ok(!contactResult.rows.some((row) => row.leadAssignmentId === ids.companyOnlyLead));

  const searchedContacts = await queryContactLeads(
    {
      organizationId: ids.orgA,
      filters: { ...contactFilters, search: "+84901234567" },
    },
    readModelDb
  );
  assert.equal(searchedContacts.rows.length, 1, "phone participates in contact search");

  const contactMetrics = await queryContactLeadMetrics(
    { organizationId: ids.orgA, filters: contactFilters },
    readModelDb
  );
  assert.equal(contactMetrics.total, contactResult.pagination.total);
  assert.equal(contactMetrics.qualified, 1);

  assert.equal(await readWorkflowStatus(ids.contactLead), workflowBefore);
  assert.equal(
    await readUpdatedAt("V2Company", ids.contactCompany, ids.orgA),
    companyUpdatedBefore
  );
  assert.equal(
    await readUpdatedAt("V2Contact", ids.contact, ids.orgA),
    contactUpdatedBefore
  );
  assert.equal(
    await readUpdatedAt("V2LeadAssignment", ids.contactLead, ids.orgA),
    leadUpdatedBefore
  );
  assert.equal(await countRows("V2Job", ids.orgA), jobCountBefore);
  assert.equal(await countInsightRows(ids.orgA), insightCountBefore);

  await cleanupSmokeData();
  console.log("PASS V2.CRM0 read model smoke checks complete");
} finally {
  await pool.end();
}

process.exit(0);

async function seedSmokeData() {
  await insertOrganization(ids.orgA, "CRM0 Smoke Org A", "crm0-smoke-org-a");
  await insertOrganization(ids.orgB, "CRM0 Smoke Org B", "crm0-smoke-org-b");
  await insertClient(ids.clientA, ids.orgA, "CRM0 Smoke Client A");
  await insertClient(ids.clientB, ids.orgB, "CRM0 Smoke Client B");
  await insertProject(ids.projectA, ids.orgA, ids.clientA, "CRM0 Smoke Project A");
  await insertProject(ids.projectB, ids.orgB, ids.clientB, "CRM0 Smoke Project B");
  await insertOffer(ids.offerA, ids.orgA, ids.projectA, "CRM0 Smoke Offer A");
  await insertOffer(ids.offerB, ids.orgB, ids.projectB, "CRM0 Smoke Offer B");
  await insertIcpProfile(ids.icpProfileA, ids.orgA, ids.offerA, "CRM0 Smoke ICP A");
  await insertIcpProfile(ids.icpProfileB, ids.orgB, ids.offerB, "CRM0 Smoke ICP B");
  await insertIcpVersion(ids.icpVersionA, ids.orgA, ids.icpProfileA, 1);
  await insertIcpVersion(ids.icpVersionB, ids.orgB, ids.icpProfileB, 1);
  await insertCompany(
    ids.companyOnlyCompany,
    ids.orgA,
    "Company Only Platform",
    "company-only.crm0.example",
    "Singapore",
    null
  );
  await insertCompany(
    ids.contactCompany,
    ids.orgA,
    "Contact Level Platform",
    "contact-level.crm0.example",
    "Singapore",
    null
  );
  await insertCompany(
    ids.unscoredCompany,
    ids.orgA,
    "Unscored Platform",
    "unscored.crm0.example",
    "Vietnam",
    null
  );
  await insertCompany(
    ids.deletedCompany,
    ids.orgA,
    "Deleted Platform",
    "deleted.crm0.example",
    "Singapore",
    null
  );
  await insertCompany(
    ids.tenantBCompany,
    ids.orgB,
    "Tenant B Platform",
    "tenant-b.crm0.example",
    "Singapore",
    null
  );
  await insertContact(ids.contact, ids.orgA, "Casey Contact", "Chief Revenue Officer");
  await pool.query(
    `UPDATE "V2Contact" SET "city" = 'Ho Chi Minh City', "country" = 'Vietnam' WHERE "id" = $1 AND "organizationId" = $2`,
    [ids.contact, ids.orgA]
  );
  await insertContact(ids.tenantBContact, ids.orgB, "Terry Tenant", "Chief Revenue Officer");
  await insertIdentifier("crm0_smoke_email", ids.orgA, ids.contact, "EMAIL", "casey@example.test");
  await insertIdentifier("crm0_smoke_phone", ids.orgA, ids.contact, "PHONE", "+84901234567");
  await insertIdentifier("crm0_smoke_linkedin", ids.orgA, ids.contact, "LINKEDIN", "https://linkedin.com/in/casey-contact");
  await insertLead(
    ids.companyOnlyLead,
    ids.orgA,
    ids.companyOnlyCompany,
    null,
    ids.projectA,
    ids.icpVersionA,
    "COMPANY",
    null
  );
  await insertLead(
    ids.contactLead,
    ids.orgA,
    ids.contactCompany,
    ids.contact,
    ids.projectA,
    ids.icpVersionA,
    "CONTACT",
    null
  );
  await insertLead(
    ids.unscoredLead,
    ids.orgA,
    ids.unscoredCompany,
    null,
    ids.projectA,
    ids.icpVersionA,
    "COMPANY",
    null
  );
  await insertLead(
    ids.deletedLead,
    ids.orgA,
    ids.deletedCompany,
    null,
    ids.projectA,
    ids.icpVersionA,
    "COMPANY",
    new Date()
  );
  await insertLead(
    ids.tenantBLead,
    ids.orgB,
    ids.tenantBCompany,
    ids.tenantBContact,
    ids.projectB,
    ids.icpVersionB,
    "CONTACT",
    null
  );
  await insertAssessment(`${ids.companyOnlyLead}_assessment_0`, ids.orgA, ids.companyOnlyLead, ids.icpVersionA, {
    fitScore: 72,
    confidence: 0.62,
    confidenceScore: 62,
    confidenceBand: "MEDIUM",
    qualification: "NEEDS_REVIEW",
    reason: "Company-only evidence requires review.",
    createdOffsetMinutes: 60,
  });
  await updateLatestAssessment(ids.companyOnlyLead, ids.orgA, `${ids.companyOnlyLead}_assessment_0`);
  for (let index = 0; index < 12; index += 1) {
    await insertAssessment(`${ids.contactLead}_assessment_${index}`, ids.orgA, ids.contactLead, ids.icpVersionA, {
      fitScore: 77 + index,
      confidence: 0.8 + index / 100,
      confidenceScore: 80 + index,
      confidenceBand: "HIGH",
      qualification: "QUALIFIED",
      reason: `Qualified smoke assessment ${index}`,
      createdOffsetMinutes: 12 - index,
    });
  }
  await updateLatestAssessment(ids.contactLead, ids.orgA, `${ids.contactLead}_assessment_11`);
}

async function insertOrganization(id, name, slug) {
  await pool.query(
    `
      INSERT INTO "V2Organization" ("id", "name", "slug", "status", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    [id, name, slug]
  );
}

async function insertClient(id, organizationId, name) {
  await pool.query(
    `
      INSERT INTO "V2ClientAccount" ("id", "organizationId", "name", "status", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    [id, organizationId, name]
  );
}

async function insertProject(id, organizationId, clientAccountId, name) {
  await pool.query(
    `
      INSERT INTO "V2Project" ("id", "organizationId", "clientAccountId", "name", "status", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    [id, organizationId, clientAccountId, name]
  );
}

async function insertOffer(id, organizationId, projectId, name) {
  await pool.query(
    `
      INSERT INTO "V2Offer" ("id", "organizationId", "projectId", "name", "status", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    [id, organizationId, projectId, name]
  );
}

async function insertIcpProfile(id, organizationId, offerId, name) {
  await pool.query(
    `
      INSERT INTO "V2ICPProfile" ("id", "organizationId", "offerId", "name", "status", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    [id, organizationId, offerId, name]
  );
}

async function insertIcpVersion(id, organizationId, icpProfileId, versionNumber) {
  await pool.query(
    `
      INSERT INTO "V2ICPVersion" (
        "id", "organizationId", "icpProfileId", "versionNumber", "status", "rulesJson",
        "publishedAt", "version", "createdAt", "updatedAt"
      )
      VALUES ($1, $2, $3, $4, 'PUBLISHED', '{}'::jsonb, CURRENT_TIMESTAMP, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    [id, organizationId, icpProfileId, versionNumber]
  );
}

async function insertCompany(id, organizationId, name, domain, country, deletedAt) {
  await pool.query(
    `
      INSERT INTO "V2Company" (
        "id", "organizationId", "name", "nameNormalized", "canonicalDomain",
        "websiteUrl", "country", "status", "deletedAt", "createdAt", "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    [id, organizationId, name, name.toLowerCase(), domain, `https://${domain}`, country, deletedAt]
  );
}

async function insertContact(id, organizationId, fullName, title) {
  await pool.query(
    `
      INSERT INTO "V2Contact" (
        "id", "organizationId", "fullName", "fullNameNormalized", "title",
        "status", "createdAt", "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    [id, organizationId, fullName, fullName.toLowerCase(), title]
  );
}

async function insertIdentifier(id, organizationId, contactId, type, value) {
  await pool.query(
    `
      INSERT INTO "V2ContactIdentifier" (
        "id", "organizationId", "contactId", "type", "normalizedValue", "rawValue",
        "isGeneric", "isValid", "validityStatus", "source", "createdAt", "updatedAt"
      )
      VALUES ($1, $2, $3, $4::"V2ContactIdentifierType", $5, $5, false, true, 'VALID', 'crm_smoke', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    [id, organizationId, contactId, type, value]
  );
}

async function insertEnrollment(id, leadAssignmentId, contactId, sequenceId) {
  await pool.query(
    `
      INSERT INTO "V2SequenceEnrollment" (
        "id", "organizationId", "sequenceId", "leadAssignmentId", "contactId",
        "senderAccountId", "status", "currentStepOrdinal", "createdAt", "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, 'crm0_sender', 'ACTIVE', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    [id, ids.orgA, sequenceId, leadAssignmentId, contactId]
  );
}

async function insertLead(
  id,
  organizationId,
  companyId,
  contactId,
  projectId,
  icpVersionId,
  assignmentLevel,
  deletedAt
) {
  await pool.query(
    `
      INSERT INTO "V2LeadAssignment" (
        "id", "organizationId", "companyId", "contactId", "projectId", "icpVersionId",
        "assignmentLevel", "workflowStatus", "status", "deletedAt", "createdAt", "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::"V2LeadAssignmentLevel", 'NEW', 'ACTIVE', $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    [
      id,
      organizationId,
      companyId,
      contactId,
      projectId,
      icpVersionId,
      assignmentLevel,
      deletedAt,
    ]
  );
}

async function insertAssessment(id, organizationId, leadAssignmentId, icpVersionId, input) {
  await pool.query(
    `
      INSERT INTO "V2HardRuleAssessment" (
        "id", "organizationId", "leadAssignmentId", "icpVersionId", "fitScore", "confidence",
        "qualification", "companyType", "reason", "oneSentenceCompanySummary",
        "evidenceSnapshotJson", "hardGateResultsJson", "confidenceBreakdownJson", "dataQualityJson",
        "inputFingerprint", "icpRulesHash", "scoringSource", "scoringVersion", "createdAt"
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7::"V2Qualification", 'PRODUCT_SAAS', $8, $9,
        $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb,
        $14, $15, 'icp1r_hard_rules', 'V2.SCORE-HV0:icp1r.v1',
        CURRENT_TIMESTAMP - ($16 * INTERVAL '1 minute')
      )
    `,
    [
      id,
      organizationId,
      leadAssignmentId,
      icpVersionId,
      input.fitScore,
      input.confidence,
      input.qualification,
      input.reason,
      "Smoke company summary",
      JSON.stringify({ evidenceSummary: ["Geo: explicit - Singapore"] }),
      JSON.stringify([]),
      JSON.stringify({
        confidenceScore: input.confidenceScore,
        confidence: input.confidenceBand,
      }),
      JSON.stringify({
        reasonCodes: ["target_geo_match_explicit"],
        reviewFlags: [],
        missingEvidence: [],
      }),
      `${id}_fingerprint`,
      "crm0-smoke-rules-hash",
      input.createdOffsetMinutes,
    ]
  );
}

async function updateLatestAssessment(leadAssignmentId, organizationId, assessmentId) {
  await pool.query(
    `
      UPDATE "V2LeadAssignment"
      SET "latestHardRuleAssessmentId" = $1
      WHERE "id" = $2 AND "organizationId" = $3
    `,
    [assessmentId, leadAssignmentId, organizationId]
  );
}

async function readWorkflowStatus(leadAssignmentId) {
  const result = await pool.query(
    `
      SELECT "workflowStatus"::text AS "workflowStatus"
      FROM "V2LeadAssignment"
      WHERE "id" = $1 AND "organizationId" = $2
    `,
    [leadAssignmentId, ids.orgA]
  );

  return result.rows[0]?.workflowStatus ?? null;
}

async function readUpdatedAt(tableName, id, organizationId) {
  const result = await pool.query(
    `SELECT "updatedAt" FROM "${tableName}" WHERE "id" = $1 AND "organizationId" = $2`,
    [id, organizationId]
  );

  return result.rows[0]?.updatedAt?.toISOString() ?? null;
}

async function countRows(tableName, organizationId) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM "${tableName}" WHERE "organizationId" = $1`,
    [organizationId]
  );

  return result.rows[0].count;
}

async function countInsightRows(organizationId) {
  const tableName = '"V2' + 'AiInsight"';
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM ${tableName} WHERE "organizationId" = $1`,
    [organizationId]
  );

  return result.rows[0].count;
}

async function cleanupSmokeData() {
  const organizations = [ids.orgA, ids.orgB];

  for (const organizationId of organizations) {
    await pool.query(`DELETE FROM "V2Job" WHERE "organizationId" = $1`, [organizationId]);
    await pool.query(`DELETE FROM "V2SequenceEnrollment" WHERE "organizationId" = $1`, [organizationId]);
    await pool.query(
      `UPDATE "V2LeadAssignment" SET "latestHardRuleAssessmentId" = NULL WHERE "organizationId" = $1`,
      [organizationId]
    );
    await pool.query(`DELETE FROM "V2HardRuleAssessment" WHERE "organizationId" = $1`, [organizationId]);
    await pool.query(`DELETE FROM "V2LeadAssignment" WHERE "organizationId" = $1`, [organizationId]);
    await pool.query(`DELETE FROM "V2ContactIdentifier" WHERE "organizationId" = $1`, [organizationId]);
    await pool.query(`DELETE FROM "V2Contact" WHERE "organizationId" = $1`, [organizationId]);
    await pool.query(`DELETE FROM "V2Company" WHERE "organizationId" = $1`, [organizationId]);
    await pool.query(`DELETE FROM "V2ICPVersion" WHERE "organizationId" = $1`, [organizationId]);
    await pool.query(`DELETE FROM "V2ICPProfile" WHERE "organizationId" = $1`, [organizationId]);
    await pool.query(`DELETE FROM "V2Offer" WHERE "organizationId" = $1`, [organizationId]);
    await pool.query(`DELETE FROM "V2Project" WHERE "organizationId" = $1`, [organizationId]);
    await pool.query(`DELETE FROM "V2ClientAccount" WHERE "organizationId" = $1`, [organizationId]);
    await pool.query(`DELETE FROM "V2Organization" WHERE "id" = $1`, [organizationId]);
  }
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

function runStaticCrm1Checks() {
  const accountsPageSource = read("app/v2/accounts/page.tsx");
  const accountAliasSource = read("app/v2/account/page.tsx");
  const accountDetailSource = read("app/v2/accounts/[accountId]/page.tsx");
  const projectsPageSource = read("app/v2/projects/page.tsx");
  const projectDetailSource = read("app/v2/projects/[projectId]/page.tsx");
  const accountWorkspaceSource = read("components/v2/accounts/AccountWorkspaceClient.tsx");
  const productTreeSource = read("lib/v2/product-tree/queryProductTree.ts");
  const contextBarSource = read("components/v2/shell/ContextBar.tsx");
  const sideNavSource = read("components/shared/SideNav.tsx");

  assert.match(accountsPageSource, /queryAccountWorkspace/, "accounts page must use the unified account workspace read model");
  assert.match(accountsPageSource, /AccountWorkspaceClient/, "accounts page must render the unified account workspace");
  assert.match(accountAliasSource, /redirect\("\/v2\/accounts"\)/, "singular account route must alias to canonical accounts route");
  assert.match(accountDetailSource, /redirect\(`\/v2\/accounts\?accountId=\$\{accountId\}&drawer=account`\)/, "account detail route must redirect to canonical account workspace");
  assert.match(projectsPageSource, /redirect\(`\/v2\/accounts\?\$\{next\.toString\(\)\}`\)/, "projects index must redirect to account workspace");
  assert.match(projectDetailSource, /organizationId: context\.organizationId/, "project compatibility redirect must be tenant scoped");
  assert.match(projectDetailSource, /projectId=\$\{project\.id\}/, "project detail redirect must preserve projectId");
  assert.match(productTreeSource, /export async function queryAccountWorkspace/, "product tree must expose queryAccountWorkspace");
  assert.match(productTreeSource, /buildAccountReadiness/, "workspace must compute account readiness");
  assert.match(productTreeSource, /buildProjectReadiness/, "workspace must compute project readiness");
  assert.match(productTreeSource, /AccountWorkspaceOfferRow/, "workspace must expose Offer-backed rows");
  assert.match(productTreeSource, /queryRunningWork/, "workspace must expose running work inside accounts");
  assert.match(productTreeSource, /V2RuntimeRun/, "running work must read runtime runs");
  assert.match(productTreeSource, /V2OutreachMessage/, "running work must read outreach messages");
  assert.match(productTreeSource, /queryAccountCompaniesContactsLeads/, "workspace must expose companies, contacts, and leads in account scope");
  assert.match(productTreeSource, /V2CompanyIntelligenceProfile/, "workspace data quality must use company intelligence profiles");
  assert.match(accountsPageSource, /offerId: pick\(params, "offerId"\)/, "accounts page must accept offerId URL state");
  assert.match(accountsPageSource, /icpVersionId: pick\(params, "icpVersionId"\)/, "accounts page must accept icpVersionId URL state");
  assert.match(accountWorkspaceSource, /Account \/ Project \/ Offer \/ ICP/, "workspace must show Account -> Project -> Offer -> ICP flow labels");
  assert.match(productTreeSource, /drawer=company/, "workspace must render in-page company drawer links");
  assert.doesNotMatch(accountWorkspaceSource, /\/v2\/reviews/, "account workspace primary actions must not route to reviews");
  assert.match(productTreeSource, /la\."deletedAt" IS NULL/, "workspace lead rollups must respect soft deletes");
  assert.doesNotMatch(contextBarSource, /href="\/v2\/projects"/, "ContextBar must not link to old projects page as primary UI");
  assert.doesNotMatch(sideNavSource, /href: "\/v2\/projects"/, "SideNav must not expose old projects page as primary UI");
  assert.doesNotMatch(accountWorkspaceSource, /Mocked|Meetings|Manager Reviews/, "account workspace must not show fake account/project metrics");
  const leadsPageSource = read("app/v2/leads/page.tsx");
  const filterSource = read("components/v2/leads/LeadFilterSidebar.tsx");
  const tableSource = read("components/v2/leads/LeadWorkspaceTable.tsx");
  const drawerSource = read("components/v2/leads/ContactLeadDrawer.tsx");
  const workflowFormSource = read("components/v2/leads/WorkflowStatusForm.tsx");
  const workflowRouteSource = read("app/v2/leads/[leadAssignmentId]/workflow/route.ts");
  const tenantSource = read("lib/v2/tenant/requireTenantContext.ts");

  // toLeadWorkspaceQueryRecord (which strips organizationId from the URL query)
  // was refactored out of the page into lib/v2/crm/leadWorkspaceFilters.ts.
  const queryRecordSource = read("lib/v2/crm/leadWorkspaceFilters.ts");

  assert.match(leadsPageSource, /requirePermission\("crm\.read"\)/);
  assert.doesNotMatch(
    leadsPageSource,
    /const organizationId = getParam\(rawParams, "organizationId"\)/
  );
  assert.match(queryRecordSource, /if \(key === "organizationId"\)/);
  assert.match(leadsPageSource, /getTenantErrorMessage\(error\)/);
  assert.match(leadsPageSource, /tenantContext\.organizationName/);
  assert.match(leadsPageSource, /tenantContext\.userName/);
  assert.match(leadsPageSource, /\/v2\/logout/);

  assert.doesNotMatch(filterSource, /name="organizationId"/);
  assert.doesNotMatch(filterSource, /organizationId=\{/);
  assert.doesNotMatch(filterSource, /organizationId=/);
  assert.doesNotMatch(filterSource, /IN_PROGRESS|MANAGER_REVIEW|CLOSED/);

  assert.doesNotMatch(tableSource, /organizationId/);
  assert.doesNotMatch(drawerSource, /organizationId/);
  assert.match(workflowFormSource, /fetch\(`\/v2\/leads\/\$\{leadAssignmentId\}\/workflow`/);
  assert.match(workflowRouteSource, /requirePermission\("workflow\.update"\)/);
  assert.doesNotMatch(workflowRouteSource, /organizationId.*request|request.*organizationId/);
  assert.match(tenantSource, /userName: user\.name/);
  assert.match(tenantSource, /organizationName: membership\.organization\.name/);

  // NOTE: the CRM1-era "leads view is read-only" assertion (no Re-score / Send
  // outreach / Enroll sequence / Bulk action labels) was intentionally retired.
  // The leads workspace is now an interactive SDR cockpit (rescore, compose,
  // enroll, bulk actions) per the workflow-wiring plan, so those labels are
  // EXPECTED. Tenant-scoping + read-model behavior assertions above remain the
  // contract. Keep `escapeRegExp` referenced for any future label checks.
  void escapeRegExp;
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
  // This custom CommonJS loader evaluates transpiled modules via `new Function`, where
  // `import.meta` is a SyntaxError ("Cannot use 'import.meta' outside a module"). Some V2
  // modules derive __dirname from `import.meta.url`, so substitute this module's own file URL
  // before evaluation. (P0.2 / Z1: fixes the custom-loader import.meta failure.)
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
      return loadTsModule(resolveModulePath(resolve(rootDir, specifier.slice(2))));
    }

    if (!specifier.startsWith(".")) {
      return require(specifier);
    }

    return loadTsModule(resolveModulePath(resolve(dirname(absolutePath), specifier)));
  };

  new Function("require", "module", "exports", output)(
    localRequire,
    loadedModule,
    loadedModule.exports
  );

  return loadedModule.exports;
}

function read(relativePath) {
  return readFileSync(resolve(rootDir, relativePath), "utf8");
}


function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveModulePath(basePath) {
  for (const candidate of [`${basePath}.ts`, resolve(basePath, "index.ts")]) {
    if (existsSync(candidate)) {
      return candidate.slice(rootDir.length + 1);
    }
  }

  throw new Error(`Unable to resolve module ${basePath}`);
}
