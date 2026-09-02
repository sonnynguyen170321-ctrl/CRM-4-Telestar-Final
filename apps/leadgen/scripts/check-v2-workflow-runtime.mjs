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
runStaticChecks();

const { updateLeadWorkflowStatus } = loadTsModule(
  "lib/v2/crm/updateLeadWorkflowStatus.ts"
);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = createWorkflowDb(pool);

const ids = {
  orgA: "wf1_smoke_org_a",
  orgB: "wf1_smoke_org_b",
  userA: "wf1_smoke_user_a",
  membershipA: "wf1_smoke_membership_a",
  clientA: "wf1_smoke_client_a",
  clientB: "wf1_smoke_client_b",
  projectA: "wf1_smoke_project_a",
  projectB: "wf1_smoke_project_b",
  offerA: "wf1_smoke_offer_a",
  offerB: "wf1_smoke_offer_b",
  icpProfileA: "wf1_smoke_icp_profile_a",
  icpProfileB: "wf1_smoke_icp_profile_b",
  icpVersionA: "wf1_smoke_icp_version_a",
  icpVersionB: "wf1_smoke_icp_version_b",
  companyA: "wf1_smoke_company_a",
  companyB: "wf1_smoke_company_b",
  deletedCompany: "wf1_smoke_deleted_company",
  inactiveCompany: "wf1_smoke_inactive_company",
  leadA: "wf1_smoke_lead_a",
  leadB: "wf1_smoke_lead_b",
  deletedLead: "wf1_smoke_deleted_lead",
  inactiveLead: "wf1_smoke_inactive_lead",
  assessmentA: "wf1_smoke_assessment_a",
};

try {
  await cleanupSmokeData();
  await seedSmokeData();

  const before = await readLead(ids.leadA, ids.orgA);
  const assessmentCountBefore = await countAssessments(ids.orgA);
  const jobCountBefore = await countRows("V2Job", ids.orgA);
  const auditCountBefore = await countAuditEvents(ids.orgA);

  const updated = await updateLeadWorkflowStatus(
    {
      organizationId: ids.orgA,
      actorUserId: ids.userA,
      membershipId: ids.membershipA,
      leadAssignmentId: ids.leadA,
      previousStatus: "NEW",
      nextStatus: "WORKING",
      note: "Workflow smoke note",
      source: "CRM_UI",
    },
    db
  );
  assert.deepEqual(updated, { kind: "updated", workflowStatus: "WORKING" });

  const after = await readLead(ids.leadA, ids.orgA);
  assert.equal(after.workflowStatus, "WORKING");
  assert.notEqual(after.updatedAt, before.updatedAt);
  assert.equal(after.latestHardRuleAssessmentId, before.latestHardRuleAssessmentId);
  assert.equal(after.qualification, "QUALIFIED");
  assert.equal(await countAssessments(ids.orgA), assessmentCountBefore);
  assert.equal(await countRows("V2Job", ids.orgA), jobCountBefore);
  assert.equal(await countAuditEvents(ids.orgA), auditCountBefore + 1);

  const audit = await readLatestAudit(ids.orgA, ids.leadA);
  assert.equal(audit.actorUserId, ids.userA);
  assert.equal(audit.eventType, "lead_assignment.workflow_status_changed");
  assert.equal(audit.entityType, "V2LeadAssignment");
  assert.equal(audit.entityId, ids.leadA);
  assert.equal(audit.metadataJson.previousStatus, "NEW");
  assert.equal(audit.metadataJson.nextStatus, "WORKING");
  assert.equal(audit.metadataJson.source, "CRM_UI");
  assert.equal(audit.metadataJson.membershipId, ids.membershipA);
  assert.equal(audit.metadataJson.note, "Workflow smoke note");

  const stale = await updateLeadWorkflowStatus(
    {
      organizationId: ids.orgA,
      actorUserId: ids.userA,
      membershipId: ids.membershipA,
      leadAssignmentId: ids.leadA,
      previousStatus: "NEW",
      nextStatus: "CONTACTED",
      source: "CRM_UI",
    },
    db
  );
  assert.deepEqual(stale, { kind: "stale", currentStatus: "WORKING" });

  const crossTenant = await updateLeadWorkflowStatus(
    {
      organizationId: ids.orgA,
      actorUserId: ids.userA,
      membershipId: ids.membershipA,
      leadAssignmentId: ids.leadB,
      previousStatus: "NEW",
      nextStatus: "WORKING",
      source: "CRM_UI",
    },
    db
  );
  assert.deepEqual(crossTenant, { kind: "not_found" });

  const deleted = await updateLeadWorkflowStatus(
    {
      organizationId: ids.orgA,
      actorUserId: ids.userA,
      membershipId: ids.membershipA,
      leadAssignmentId: ids.deletedLead,
      previousStatus: "NEW",
      nextStatus: "WORKING",
      source: "CRM_UI",
    },
    db
  );
  assert.deepEqual(deleted, { kind: "not_found" });

  const inactive = await updateLeadWorkflowStatus(
    {
      organizationId: ids.orgA,
      actorUserId: ids.userA,
      membershipId: ids.membershipA,
      leadAssignmentId: ids.inactiveLead,
      previousStatus: "NEW",
      nextStatus: "WORKING",
      source: "CRM_UI",
    },
    db
  );
  assert.deepEqual(inactive, { kind: "not_found" });

  assert.equal(await readWorkflowStatus(ids.leadB, ids.orgB), "NEW");
  assert.equal(await readWorkflowStatus(ids.deletedLead, ids.orgA), "NEW");
  assert.equal(await readWorkflowStatus(ids.inactiveLead, ids.orgA), "NEW");
  assert.equal(await countAssessments(ids.orgA), assessmentCountBefore);
  assert.equal(await countRows("V2Job", ids.orgA), jobCountBefore);

  await cleanupSmokeData();
  console.log("PASS V2.WF1 workflow runtime checks complete");
} finally {
  await pool.end();
}

function runStaticChecks() {
  const helperSource = read("lib/v2/crm/updateLeadWorkflowStatus.ts");
  const routeSource = read("app/v2/leads/[leadAssignmentId]/workflow/route.ts");
  const auditSource = read("lib/v2/audit/recordAuditEvent.ts");
  const formSource = read("components/v2/leads/WorkflowStatusForm.tsx");
  const drawerSource = read("components/v2/leads/LeadDrawer.tsx");

  assert.match(routeSource, /requirePermission\("workflow\.update"\)/);
  assert.match(routeSource, /INVALID_WORKFLOW_STATUS/);
  assert.match(routeSource, /isWorkflowStatus\(input\.nextStatus\)/);
  assert.match(routeSource, /updateLeadWorkflowStatus/);
  assert.doesNotMatch(routeSource, /organizationId.*body|body.*organizationId/);
  assert.doesNotMatch(routeSource, /actorUserId.*body|body.*actorUserId/);
  assert.doesNotMatch(routeSource, /role.*body|body.*role/);

  for (const requiredField of [
    "organizationId",
    "actorUserId",
    "membershipId",
    "leadAssignmentId",
    "previousStatus",
    "nextStatus",
  ]) {
    assert.match(helperSource, new RegExp(requiredField));
  }

  assert.match(helperSource, /status" = 'ACTIVE'/);
  assert.match(helperSource, /"deletedAt" IS NULL/);
  assert.match(helperSource, /FOR UPDATE/);
  assert.match(helperSource, /recordAuditEvent/);
  assert.doesNotMatch(helperSource, /latestHardRuleAssessmentId\s*=/);
  assert.doesNotMatch(helperSource, /V2Job|V2HardRuleAssessment|ManagerReviewItem|CompanyRecord|ContactRecord/);
  assert.match(auditSource, /"V2AuditEvent"/);
  assert.match(auditSource, /metadataJson/);
  assert.match(formSource, /"use client"/);
  assert.match(formSource, /previousStatus/);
  assert.match(drawerSource, /WorkflowStatusForm/);
}

async function seedSmokeData() {
  await insertOrganization(ids.orgA, "WF1 Smoke Org A", "wf1-smoke-org-a");
  await insertOrganization(ids.orgB, "WF1 Smoke Org B", "wf1-smoke-org-b");
  await insertUser(ids.userA, "wf1.smoke@example.com");
  await insertMembership(ids.membershipA, ids.orgA, ids.userA);
  await insertClient(ids.clientA, ids.orgA, "WF1 Smoke Client A");
  await insertClient(ids.clientB, ids.orgB, "WF1 Smoke Client B");
  await insertProject(ids.projectA, ids.orgA, ids.clientA, "WF1 Smoke Project A");
  await insertProject(ids.projectB, ids.orgB, ids.clientB, "WF1 Smoke Project B");
  await insertOffer(ids.offerA, ids.orgA, ids.projectA, "WF1 Smoke Offer A");
  await insertOffer(ids.offerB, ids.orgB, ids.projectB, "WF1 Smoke Offer B");
  await insertIcpProfile(ids.icpProfileA, ids.orgA, ids.offerA, "WF1 Smoke ICP A");
  await insertIcpProfile(ids.icpProfileB, ids.orgB, ids.offerB, "WF1 Smoke ICP B");
  await insertIcpVersion(ids.icpVersionA, ids.orgA, ids.icpProfileA, 1);
  await insertIcpVersion(ids.icpVersionB, ids.orgB, ids.icpProfileB, 1);
  await insertCompany(ids.companyA, ids.orgA, "WF1 Company A", "wf1-a.example", null);
  await insertCompany(ids.companyB, ids.orgB, "WF1 Company B", "wf1-b.example", null);
  await insertCompany(
    ids.deletedCompany,
    ids.orgA,
    "WF1 Deleted Company",
    "wf1-deleted.example",
    null
  );
  await insertCompany(
    ids.inactiveCompany,
    ids.orgA,
    "WF1 Inactive Company",
    "wf1-inactive.example",
    null
  );
  await insertLead(ids.leadA, ids.orgA, ids.companyA, ids.projectA, ids.icpVersionA, "ACTIVE", null);
  await insertLead(ids.leadB, ids.orgB, ids.companyB, ids.projectB, ids.icpVersionB, "ACTIVE", null);
  await insertLead(
    ids.deletedLead,
    ids.orgA,
    ids.deletedCompany,
    ids.projectA,
    ids.icpVersionA,
    "ACTIVE",
    new Date()
  );
  await insertLead(
    ids.inactiveLead,
    ids.orgA,
    ids.inactiveCompany,
    ids.projectA,
    ids.icpVersionA,
    "DISABLED",
    null
  );
  await insertAssessment(ids.assessmentA, ids.orgA, ids.leadA, ids.icpVersionA);
  await updateLatestAssessment(ids.leadA, ids.orgA, ids.assessmentA);
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

async function insertUser(id, email) {
  await pool.query(
    `
      INSERT INTO "V2User" ("id", "email", "emailNormalized", "name", "status", "createdAt", "updatedAt")
      VALUES ($1, $2, $2, 'WF1 Smoke User', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    [id, email]
  );
}

async function insertMembership(id, organizationId, userId) {
  await pool.query(
    `
      INSERT INTO "V2OrganizationMembership" (
        "id", "organizationId", "userId", "role", "status", "createdAt", "updatedAt"
      )
      VALUES ($1, $2, $3, 'MANAGER', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    [id, organizationId, userId]
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

async function insertCompany(id, organizationId, name, domain, deletedAt) {
  await pool.query(
    `
      INSERT INTO "V2Company" (
        "id", "organizationId", "name", "nameNormalized", "canonicalDomain",
        "websiteUrl", "country", "status", "deletedAt", "createdAt", "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'Singapore', 'ACTIVE', $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    [id, organizationId, name, name.toLowerCase(), domain, `https://${domain}`, deletedAt]
  );
}

async function insertLead(id, organizationId, companyId, projectId, icpVersionId, status, deletedAt) {
  await pool.query(
    `
      INSERT INTO "V2LeadAssignment" (
        "id", "organizationId", "companyId", "contactId", "projectId", "icpVersionId",
        "assignmentLevel", "workflowStatus", "status", "deletedAt", "createdAt", "updatedAt"
      )
      VALUES (
        $1, $2, $3, NULL, $4, $5, 'COMPANY', 'NEW',
        $6::"V2RecordStatus", $7,
        CURRENT_TIMESTAMP - INTERVAL '1 hour',
        CURRENT_TIMESTAMP - INTERVAL '1 hour'
      )
    `,
    [id, organizationId, companyId, projectId, icpVersionId, status, deletedAt]
  );
}

async function insertAssessment(id, organizationId, leadAssignmentId, icpVersionId) {
  await pool.query(
    `
      INSERT INTO "V2HardRuleAssessment" (
        "id", "organizationId", "leadAssignmentId", "icpVersionId", "fitScore", "confidence",
        "qualification", "companyType", "reason", "oneSentenceCompanySummary",
        "evidenceSnapshotJson", "hardGateResultsJson", "confidenceBreakdownJson", "dataQualityJson",
        "inputFingerprint", "icpRulesHash", "scoringSource", "scoringVersion", "createdAt"
      )
      VALUES (
        $1, $2, $3, $4, 91, 0.91, 'QUALIFIED', 'PRODUCT_SAAS',
        'WF1 smoke assessment.', 'WF1 smoke summary.',
        '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
        'wf1-smoke-fingerprint', 'wf1-smoke-rules-hash',
        'icp1r_hard_rules', 'V2.SCORE-HV0:icp1r.v1', CURRENT_TIMESTAMP
      )
    `,
    [id, organizationId, leadAssignmentId, icpVersionId]
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

async function readLead(id, organizationId) {
  const result = await pool.query(
    `
      SELECT
        la."workflowStatus"::text AS "workflowStatus",
        la."latestHardRuleAssessmentId",
        la."updatedAt",
        assessment."qualification"::text AS "qualification"
      FROM "V2LeadAssignment" la
      LEFT JOIN "V2HardRuleAssessment" assessment
        ON assessment."id" = la."latestHardRuleAssessmentId"
        AND assessment."organizationId" = la."organizationId"
      WHERE la."id" = $1 AND la."organizationId" = $2
    `,
    [id, organizationId]
  );
  const row = result.rows[0];

  return {
    ...row,
    updatedAt: row.updatedAt?.toISOString() ?? null,
  };
}

async function readWorkflowStatus(id, organizationId) {
  const result = await pool.query(
    `
      SELECT "workflowStatus"::text AS "workflowStatus"
      FROM "V2LeadAssignment"
      WHERE "id" = $1 AND "organizationId" = $2
    `,
    [id, organizationId]
  );

  return result.rows[0]?.workflowStatus ?? null;
}

async function readLatestAudit(organizationId, entityId) {
  const result = await pool.query(
    `
      SELECT "actorUserId", "eventType", "entityType", "entityId", "metadataJson"
      FROM "V2AuditEvent"
      WHERE "organizationId" = $1 AND "entityId" = $2
      ORDER BY "createdAt" DESC
      LIMIT 1
    `,
    [organizationId, entityId]
  );

  return result.rows[0];
}

async function countRows(tableName, organizationId) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM "${tableName}" WHERE "organizationId" = $1`,
    [organizationId]
  );

  return result.rows[0].count;
}

async function countAssessments(organizationId) {
  return countRows("V2HardRuleAssessment", organizationId);
}

async function countAuditEvents(organizationId) {
  return countRows("V2AuditEvent", organizationId);
}

async function cleanupSmokeData() {
  for (const organizationId of [ids.orgA, ids.orgB]) {
    await pool.query(`DELETE FROM "V2AuditEvent" WHERE "organizationId" = $1`, [organizationId]);
    await pool.query(`DELETE FROM "V2Job" WHERE "organizationId" = $1`, [organizationId]);
    await pool.query(
      `UPDATE "V2LeadAssignment" SET "latestHardRuleAssessmentId" = NULL WHERE "organizationId" = $1`,
      [organizationId]
    );
    await pool.query(`DELETE FROM "V2HardRuleAssessment" WHERE "organizationId" = $1`, [organizationId]);
    await pool.query(`DELETE FROM "V2LeadAssignment" WHERE "organizationId" = $1`, [organizationId]);
    await pool.query(`DELETE FROM "V2Company" WHERE "organizationId" = $1`, [organizationId]);
    await pool.query(`DELETE FROM "V2ICPVersion" WHERE "organizationId" = $1`, [organizationId]);
    await pool.query(`DELETE FROM "V2ICPProfile" WHERE "organizationId" = $1`, [organizationId]);
    await pool.query(`DELETE FROM "V2Offer" WHERE "organizationId" = $1`, [organizationId]);
    await pool.query(`DELETE FROM "V2Project" WHERE "organizationId" = $1`, [organizationId]);
    await pool.query(`DELETE FROM "V2ClientAccount" WHERE "organizationId" = $1`, [organizationId]);
    await pool.query(`DELETE FROM "V2OrganizationMembership" WHERE "organizationId" = $1`, [organizationId]);
    await pool.query(`DELETE FROM "V2Organization" WHERE "id" = $1`, [organizationId]);
  }

  await pool.query(`DELETE FROM "V2User" WHERE "id" = $1`, [ids.userA]);
}

function createWorkflowDb(activePool) {
  return {
    async $transaction(callback) {
      const client = await activePool.connect();

      try {
        await client.query("BEGIN");
        const result = await callback(createQueryDb(client));
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

function createQueryDb(queryable) {
  return {
    async $queryRawUnsafe(query, ...values) {
      const result = await queryable.query(query, values);

      return result.rows;
    },
  };
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

function resolveModulePath(basePath) {
  for (const candidate of [`${basePath}.ts`, resolve(basePath, "index.ts")]) {
    if (existsSync(candidate)) {
      return candidate.slice(rootDir.length + 1);
    }
  }

  throw new Error(`Unable to resolve module ${basePath}`);
}

function read(relativePath) {
  return readFileSync(resolve(rootDir, relativePath), "utf8");
}
