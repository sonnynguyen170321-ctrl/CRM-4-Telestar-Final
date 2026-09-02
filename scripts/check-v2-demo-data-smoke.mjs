import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { Pool } = require("pg");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SMOKE_MARKER = "local_dev_smoke";
const DEFAULT_USER_EMAIL = "v2.smoke.owner@example.test";

loadEnvFiles([".env.local", ".env", ".env.production"]);

let tenantContext;
let ids;

function buildIds(context) {
  const suffix = context.usesExistingTenant
    ? `_${hashShort(context.organizationId)}`
    : "";
  const scoped = (base) => `v2_demo_smoke${suffix}_${base}`;

  return {
    organization: context.organizationId,
    user: context.userId,
    membership: context.membershipId,
    clientAccount: scoped("client_account"),
    project: scoped("project"),
    offer: scoped("offer"),
    icpProfile: scoped("icp_profile"),
    icpVersion: scoped("icp_version"),
    qualifiedCompany: scoped("company_qualified"),
    reviewCompany: scoped("company_review"),
    unqualifiedCompany: scoped("company_unqualified"),
    qualifiedAssessment: scoped("assessment_qualified"),
    reviewAssessment: scoped("assessment_needs_review"),
    unqualifiedAssessment: scoped("assessment_unqualified"),
    reviewItem: scoped("manager_review_item"),
  };
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  tenantContext = await resolveTenantContext();
  ids = buildIds(tenantContext);
  const result = await checkSmokeData();
  console.log("PASS V2 demo data smoke checks complete");
  console.log(JSON.stringify(result, null, 2));
  console.log("Browser checklist:");
  console.log("- /v2/leads should show 3 active rows");
  console.log("- /v2/icp-library should show 1 ICP version");
  console.log("- /v2/reviews should show 1 open item");
} finally {
  await pool.end();
}

async function checkSmokeData() {
  const organization = await one(
    `
      SELECT "id", "name", "slug", "status"::text AS "status"
      FROM "V2Organization"
      WHERE "id" = $1
    `,
    [ids.organization],
    "V2 smoke organization is missing."
  );
  assert.equal(organization.status, "ACTIVE");
  if (!tenantContext.usesExistingTenant) {
    assert.equal(organization.slug, "v2-demo-smoke");
  }

  const user = await one(
    `
      SELECT "id", "emailNormalized", "status"::text AS "status"
      FROM "V2User"
      WHERE "emailNormalized" = $1
    `,
    [tenantContext.userEmail],
    `V2 smoke target user ${tenantContext.userEmail} is missing.`
  );
  assert.equal(user.status, "ACTIVE");
  assert.equal(user.id, ids.user);

  const membership = await one(
    `
      SELECT "id", "role"::text AS "role", "status"::text AS "status"
      FROM "V2OrganizationMembership"
      WHERE "organizationId" = $1
        AND "userId" = $2
    `,
    [ids.organization, user.id],
    "V2 smoke user membership is missing."
  );
  assert.equal(membership.status, "ACTIVE");
  assert.equal(membership.id, ids.membership);
  assert.ok(
    ["OWNER", "ADMIN", "MANAGER"].includes(membership.role),
    "Smoke user role must be able to read CRM, update workflow, and read Manager Review."
  );

  const hierarchy = await one(
    `
      SELECT
        account."id" AS "clientAccountId",
        project."id" AS "projectId",
        offer."id" AS "offerId",
        profile."id" AS "icpProfileId",
        icp."id" AS "icpVersionId",
        icp."status"::text AS "icpStatus",
        icp."rulesJson" AS "rulesJson"
      FROM "V2ClientAccount" account
      INNER JOIN "V2Project" project
        ON project."clientAccountId" = account."id"
        AND project."organizationId" = account."organizationId"
      INNER JOIN "V2Offer" offer
        ON offer."projectId" = project."id"
        AND offer."organizationId" = account."organizationId"
      INNER JOIN "V2ICPProfile" profile
        ON profile."offerId" = offer."id"
        AND profile."organizationId" = account."organizationId"
      INNER JOIN "V2ICPVersion" icp
        ON icp."icpProfileId" = profile."id"
        AND icp."organizationId" = account."organizationId"
      WHERE account."organizationId" = $1
        AND account."id" = $2
        AND project."id" = $3
        AND offer."id" = $4
        AND profile."id" = $5
        AND icp."id" = $6
        AND account."status" = 'ACTIVE'
        AND project."status" = 'ACTIVE'
        AND offer."status" = 'ACTIVE'
        AND profile."status" = 'ACTIVE'
        AND icp."deletedAt" IS NULL
    `,
    [
      ids.organization,
      ids.clientAccount,
      ids.project,
      ids.offer,
      ids.icpProfile,
      ids.icpVersion,
    ],
    "V2 smoke client/project/offer/ICP hierarchy is missing."
  );
  assert.equal(hierarchy.icpStatus, "PUBLISHED");
  assert.equal(
    hierarchy.rulesJson?.schemaVersion,
    "v2",
    "Demo smoke ICP must persist schema-v2 rules."
  );
  assert.equal(
    hierarchy.rulesJson?.ruleSetId,
    "corpus-06-telestar"
  );

  const companyRows = await all(
    `
      SELECT "id", "name", "canonicalDomain", "country", "status"::text AS "status"
      FROM "V2Company"
      WHERE "organizationId" = $1
        AND "id" = ANY($2::text[])
        AND "deletedAt" IS NULL
      ORDER BY "id"
    `,
    [
      ids.organization,
      [ids.qualifiedCompany, ids.reviewCompany, ids.unqualifiedCompany],
    ]
  );
  assert.equal(companyRows.length, 3, "Expected 3 V2 smoke companies.");
  for (const row of companyRows) {
    assert.equal(row.status, "ACTIVE");
    assert.ok(row.name.includes("V2 Smoke"));
    assert.ok(row.canonicalDomain.endsWith(".example.test"));
  }

  const leadRows = await all(
    `
      SELECT
        la."id",
        la."companyId",
        la."contactId",
        la."assignmentLevel"::text AS "assignmentLevel",
        la."workflowStatus"::text AS "workflowStatus",
        la."latestHardRuleAssessmentId",
        assessment."qualification"::text AS "qualification",
        assessment."fitScore",
        assessment."confidence",
        assessment."scoringSource",
        assessment."scoringVersion",
        assessment."evidenceSnapshotJson",
        assessment."hardGateResultsJson",
        assessment."confidenceBreakdownJson",
        assessment."dataQualityJson"
      FROM "V2LeadAssignment" la
      INNER JOIN "V2HardRuleAssessment" assessment
        ON assessment."id" = la."latestHardRuleAssessmentId"
        AND assessment."organizationId" = la."organizationId"
      WHERE la."organizationId" = $1
        AND la."projectId" = $2
        AND la."icpVersionId" = $3
        AND la."status" = 'ACTIVE'
        AND la."deletedAt" IS NULL
        AND la."companyId" = ANY($4::text[])
      ORDER BY la."companyId"
    `,
    [
      ids.organization,
      ids.project,
      ids.icpVersion,
      [ids.qualifiedCompany, ids.reviewCompany, ids.unqualifiedCompany],
    ]
  );
  assert.equal(leadRows.length, 3, "Expected 3 active V2 smoke LeadAssignments.");

  const qualifications = new Set(leadRows.map((row) => row.qualification));
  assert.deepEqual(
    [...qualifications].sort(),
    ["COMPANY_QUALIFIED_NEEDS_CONTACT", "QUALIFIED", "UNQUALIFIED"].sort()
  );
  const workflowStatuses = new Set(leadRows.map((row) => row.workflowStatus));
  for (const expected of ["NEW", "WORKING", "DISQUALIFIED"]) {
    assert.ok(workflowStatuses.has(expected), `Missing workflow status ${expected}.`);
  }

  const qualified = leadRows.find((row) => row.qualification === "QUALIFIED");
  const companyNeedsContact = leadRows.find(
    (row) => row.qualification === "COMPANY_QUALIFIED_NEEDS_CONTACT"
  );
  const unqualified = leadRows.find((row) => row.qualification === "UNQUALIFIED");
  assert.ok(qualified);
  assert.ok(companyNeedsContact);
  assert.ok(unqualified);
  assert.equal(qualified.latestHardRuleAssessmentId, ids.qualifiedAssessment);
  assert.equal(companyNeedsContact.latestHardRuleAssessmentId, ids.reviewAssessment);
  assert.equal(unqualified.latestHardRuleAssessmentId, ids.unqualifiedAssessment);
  for (const row of leadRows) {
    assert.equal(row.scoringSource, "rules_v2_hard_rules");
    assert.equal(row.scoringVersion, "V2.SCORE-HV0:rules-v2.v1");
    assert.equal(
      row.evidenceSnapshotJson?.rulesSnapshot?.schemaVersion,
      "v2",
      "Rules snapshot should preserve schema-v2 rules."
    );
    assert.ok(
      row.evidenceSnapshotJson?.subScores,
      "Rules-v2 assessment snapshot should include subScores."
    );
    assert.ok(
      row.evidenceSnapshotJson?.dimensionResults,
      "Rules-v2 assessment snapshot should include dimensionResults."
    );
    assert.ok(
      row.evidenceSnapshotJson?.inputSnapshot?.companyEvidence,
      "Rules-v2 assessment snapshot should include company evidence input."
    );
    assert.ok(
      !JSON.stringify(row).includes("UNCERTAIN"),
      "Demo smoke must not persist canonical UNCERTAIN."
    );
  }
  assert.equal(qualified.confidenceBreakdownJson?.confidence, "HIGH");
  assert.ok(
    qualified.dataQualityJson?.reasonCodes?.includes("fit_score_qualified"),
    "Qualified assessment should include fit_score_qualified reason."
  );
  assert.ok(
    companyNeedsContact.dataQualityJson?.requiredEvidenceMissing?.includes(
      "required_persona_title_missing"
    ),
    "Needs-contact assessment should include required missing persona evidence."
  );
  assert.ok(
    companyNeedsContact.dataQualityJson?.missingEvidence?.includes(
      "target_persona_missing_required"
    ),
    "Needs-contact assessment should include missing persona evidence."
  );
  assert.ok(
    companyNeedsContact.dataQualityJson?.reviewFlags?.includes("needs_human_review"),
    "Needs-review assessment should include needs_human_review flag."
  );
  assert.ok(
    unqualified.hardGateResultsJson?.hardDisqualifiersHit?.some(
      (hit) => hit.id === "excluded_country"
    ),
    "Unqualified assessment should include excluded_country hard gate."
  );
  assert.ok(
    unqualified.dataQualityJson?.reasonCodes?.includes("terminal_gate"),
    "Unqualified assessment should include terminal_gate reason."
  );
  assert.ok(
    unqualified.hardGateResultsJson?.hardDisqualifiersHit?.some(
      (hit) => hit.reasonCode === "target_geo_mismatch_explicit"
    ),
    "Unqualified assessment gate should include target_geo_mismatch_explicit reason."
  );

  const review = await one(
    `
      SELECT
        "id",
        "leadAssignmentId",
        "hardRuleAssessmentId",
        "sourceType"::text AS "sourceType",
        "reasonCode"::text AS "reasonCode",
        "priority"::text AS "priority",
        "confidence"::text AS "confidence",
        "status"::text AS "status",
        "metadataJson"
      FROM "V2ManagerReviewItem"
      WHERE "organizationId" = $1
        AND "id" = $2
        AND "deletedAt" IS NULL
    `,
    [ids.organization, ids.reviewItem],
    "V2 smoke ManagerReviewItem is missing."
  );
  assert.equal(review.leadAssignmentId, companyNeedsContact.id);
  assert.equal(review.hardRuleAssessmentId, ids.reviewAssessment);
  assert.equal(review.sourceType, "HARD_RULE_ASSESSMENT");
  assert.equal(review.reasonCode, "MISSING_REQUIRED_EVIDENCE");
  assert.equal(review.status, "OPEN");
  assert.equal(review.metadataJson?.marker, SMOKE_MARKER);

  return {
    marker: SMOKE_MARKER,
    organization: organization.id,
    organizationName: tenantContext.organizationName,
    userEmail: tenantContext.userEmail,
    tenantMode: tenantContext.usesExistingTenant ? "target_existing_user" : "default_smoke_user",
    role: membership.role,
    icpVersion: hierarchy.icpVersionId,
    ruleSetId: hierarchy.rulesJson.ruleSetId,
    schemaVersion: hierarchy.rulesJson.schemaVersion,
    companies: companyRows.length,
    leadAssignments: leadRows.map((row) => ({
      id: row.id,
      companyId: row.companyId,
      qualification: row.qualification,
      workflowStatus: row.workflowStatus,
      latestHardRuleAssessmentId: row.latestHardRuleAssessmentId,
    })),
    managerReviewItem: review.id,
  };
}

async function resolveTenantContext() {
  const targetEmailRaw = process.env.V2_DEMO_SMOKE_TARGET_EMAIL;

  if (targetEmailRaw && targetEmailRaw.trim()) {
    const targetEmail = normalizeEmail(targetEmailRaw);
    const organizationId = normalizeOptional(process.env.V2_DEMO_SMOKE_ORGANIZATION_ID);
    const params = [targetEmail];
    const organizationFilter = organizationId
      ? `AND membership."organizationId" = $${params.push(organizationId)}`
      : "";
    const result = await pool.query(
      `
        SELECT
          app_user."id" AS "userId",
          app_user."emailNormalized",
          membership."id" AS "membershipId",
          membership."organizationId",
          membership."role"::text AS "role",
          org."name" AS "organizationName"
        FROM "V2User" app_user
        INNER JOIN "V2OrganizationMembership" membership
          ON membership."userId" = app_user."id"
          AND membership."status" = 'ACTIVE'
        INNER JOIN "V2Organization" org
          ON org."id" = membership."organizationId"
          AND org."status" = 'ACTIVE'
        WHERE app_user."emailNormalized" = $1
          AND app_user."status" = 'ACTIVE'
          ${organizationFilter}
        ORDER BY membership."createdAt" ASC, membership."id" ASC
      `,
      params
    );

    if (result.rows.length === 0) {
      throw new Error(
        `No active V2 user membership found for V2_DEMO_SMOKE_TARGET_EMAIL=${targetEmail}.`
      );
    }

    if (result.rows.length > 1) {
      throw new Error(
        `Multiple active V2 memberships found for ${targetEmail}. Set V2_DEMO_SMOKE_ORGANIZATION_ID to disambiguate.`
      );
    }

    const row = result.rows[0];

    return {
      usesExistingTenant: true,
      organizationId: row.organizationId,
      organizationName: row.organizationName,
      userId: row.userId,
      userEmail: row.emailNormalized,
      membershipId: row.membershipId,
      role: row.role,
    };
  }

  const defaultEmail = normalizeEmail(
    process.env.V2_DEMO_SMOKE_USER_EMAIL || DEFAULT_USER_EMAIL
  );

  return {
    usesExistingTenant: false,
    organizationId: "v2_demo_smoke_org",
    organizationName: "V2 Smoke Organization (local_dev_smoke)",
    userId: `v2_demo_smoke_user_${hashShort(defaultEmail)}`,
    userEmail: defaultEmail,
    membershipId: `v2_demo_smoke_membership_${hashShort(defaultEmail)}`,
    role: "OWNER",
  };
}

async function one(query, params, message) {
  const rows = await all(query, params);
  assert.ok(rows[0], message);
  return rows[0];
}

async function all(query, params) {
  const result = await pool.query(query, params);
  return result.rows;
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

function normalizeEmail(value) {
  const normalized = String(value ?? "").trim().toLowerCase();

  if (!normalized) {
    throw new Error("Smoke user email normalized to an empty value.");
  }

  return normalized;
}

function normalizeOptional(value) {
  const normalized = String(value ?? "").trim();

  return normalized || null;
}

function hashShort(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
