import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { Pool } = require("pg");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();
const SMOKE_MARKER = "local_dev_smoke";
const DEFAULT_USER_EMAIL = "v2.smoke.owner@example.test";

loadEnvFiles([".env.local", ".env", ".env.production"]);
assertLocalDevSeedAllowed();

const { assessIcpRulesV2 } = loadTsModule(
  "lib/v2/scoring/rules/deriveQualification.ts"
);
const { mapRulesV2AssessmentToPersistence, stableHash } = loadTsModule(
  "lib/v2/scoring/runtime/mapIcpAssessmentToPersistence.ts"
);
const { TELESTAR } = loadTsModule(
  "lib/v2/scoring/__fixtures__/icpCorpus/index.ts"
);

let tenantContext;
let ids;
let examples;

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
    qualifiedContact: scoped("contact_qualified"),
    unqualifiedContact: scoped("contact_unqualified"),
    qualifiedIdentifier: scoped("identifier_qualified_email"),
    unqualifiedIdentifier: scoped("identifier_unqualified_email"),
    qualifiedAssessment: scoped("assessment_qualified"),
    reviewAssessment: scoped("assessment_needs_review"),
    unqualifiedAssessment: scoped("assessment_unqualified"),
    reviewItem: scoped("manager_review_item"),
  };
}

function buildExamples() {
  return {
    qualified: {
      companyId: ids.qualifiedCompany,
      contactId: ids.qualifiedContact,
      assessmentId: ids.qualifiedAssessment,
    assignmentLevel: "CONTACT",
    workflowStatus: "NEW",
    company: {
      name: "V2 Smoke Meridian Loyalty Platform",
      domain: "meridian-loyalty.example.test",
      websiteUrl: "https://meridian-loyalty.example.test",
      country: "Singapore",
    },
    contact: {
      fullName: "V2 Smoke Quinn Qualified",
      title: "Chief Revenue Officer",
      email: "quinn@meridian-loyalty.example.test",
      identifierId: ids.qualifiedIdentifier,
    },
    companyEvidence: {
      companyName: "V2 Smoke Meridian Loyalty Platform",
      domain: "meridian-loyalty.example.test",
      country: "Singapore",
      industry: "B2B SaaS loyalty platform",
      employeeCount: 80,
      companyType: "PRODUCT_SAAS",
      websiteStatus: "reachable",
      evidenceText: `${SMOKE_MARKER}; B2B SaaS platform software product with 80 employees and reachable website`,
    },
    personaEvidence: {
      rawTitle: "Chief Revenue Officer",
      email: "quinn@meridian-loyalty.example.test",
    },
    },
    needsReview: {
      companyId: ids.reviewCompany,
      contactId: null,
      assessmentId: ids.reviewAssessment,
    assignmentLevel: "COMPANY",
    workflowStatus: "WORKING",
    company: {
      name: "V2 Smoke Company Only Platform",
      domain: "company-only-platform.example.test",
      websiteUrl: "https://company-only-platform.example.test",
      country: "Singapore",
    },
    companyEvidence: {
      companyName: "V2 Smoke Company Only Platform",
      domain: "company-only-platform.example.test",
      country: "Singapore",
      industry: "B2B SaaS customer platform",
      employeeCount: 80,
      companyType: "PRODUCT_SAAS",
      websiteStatus: "reachable",
      evidenceText: `${SMOKE_MARKER}; company-only pre-rank example; B2B SaaS platform software product with 80 employees and reachable website`,
    },
    personaEvidence: undefined,
    },
    unqualified: {
      companyId: ids.unqualifiedCompany,
      contactId: ids.unqualifiedContact,
      assessmentId: ids.unqualifiedAssessment,
    assignmentLevel: "CONTACT",
    workflowStatus: "DISQUALIFIED",
    company: {
      name: "V2 Smoke Offshore Loyalty Platform",
      domain: "offshore-loyalty.example.test",
      websiteUrl: "https://offshore-loyalty.example.test",
      country: "India",
    },
    contact: {
      fullName: "V2 Smoke Uma Unqualified",
      title: "Chief Revenue Officer",
      email: "uma@offshore-loyalty.example.test",
      identifierId: ids.unqualifiedIdentifier,
    },
    companyEvidence: {
      companyName: "V2 Smoke Offshore Loyalty Platform",
      domain: "offshore-loyalty.example.test",
      country: "India",
      industry: "B2B SaaS loyalty platform",
      employeeCount: 80,
      companyType: "PRODUCT_SAAS",
      websiteStatus: "reachable",
      evidenceText: `${SMOKE_MARKER}; excluded geography example; B2B SaaS platform software product with 80 employees and reachable website`,
    },
    personaEvidence: {
      rawTitle: "Chief Revenue Officer",
      email: "uma@offshore-loyalty.example.test",
    },
    },
  };
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  tenantContext = await resolveTenantContext();
  ids = buildIds(tenantContext);
  examples = buildExamples();
  const result = await seedSmokeData();
  console.log("PASS V2 demo data smoke seed complete");
  console.log(JSON.stringify(result, null, 2));
} finally {
  await pool.end();
}

async function seedSmokeData() {
  return withTransaction(async (client) => {
    if (!tenantContext.usesExistingTenant) {
      await upsertOrganization(client);
      await upsertUser(client);
      await upsertMembership(client);
    }
    await upsertClientProjectOfferIcp(client);
    await upsertCompaniesAndContacts(client);

    const leadIds = {
      qualified: await upsertLeadAssignment(client, examples.qualified),
      needsReview: await upsertLeadAssignment(client, examples.needsReview),
      unqualified: await upsertLeadAssignment(client, examples.unqualified),
    };

    const assessmentIds = {
      qualified: await upsertAssessment(client, examples.qualified, leadIds.qualified),
      needsReview: await upsertAssessment(
        client,
        examples.needsReview,
        leadIds.needsReview
      ),
      unqualified: await upsertAssessment(
        client,
        examples.unqualified,
        leadIds.unqualified
      ),
    };

    await upsertManagerReviewItem(client, {
      leadAssignmentId: leadIds.needsReview,
      hardRuleAssessmentId: assessmentIds.needsReview,
    });

    return {
      marker: SMOKE_MARKER,
      organization: ids.organization,
      organizationName: tenantContext.organizationName,
      userEmail: tenantContext.userEmail,
      userId: ids.user,
      membershipId: ids.membership,
      role: tenantContext.role,
      tenantMode: tenantContext.usesExistingTenant ? "target_existing_user" : "default_smoke_user",
      clientAccount: ids.clientAccount,
      project: ids.project,
      offer: ids.offer,
      icpProfile: ids.icpProfile,
      icpVersion: ids.icpVersion,
      ruleSetId: TELESTAR.ruleSetId,
      companies: [
        ids.qualifiedCompany,
        ids.reviewCompany,
        ids.unqualifiedCompany,
      ],
      leadAssignments: leadIds,
      assessments: assessmentIds,
      managerReviewItem: ids.reviewItem,
    };
  });
}

async function upsertOrganization(client) {
  await client.query(
    `
      INSERT INTO "V2Organization" ("id", "name", "slug", "status", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("slug") DO UPDATE
      SET "name" = EXCLUDED."name",
          "status" = 'ACTIVE',
          "updatedAt" = CURRENT_TIMESTAMP
    `,
    [ids.organization, "V2 Smoke Organization (local_dev_smoke)", "v2-demo-smoke"]
  );
}

async function upsertUser(client) {
  await client.query(
    `
      INSERT INTO "V2User" ("id", "email", "emailNormalized", "name", "status", "createdAt", "updatedAt")
      VALUES ($1, $2, $2, $3, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("emailNormalized") DO UPDATE
      SET "email" = EXCLUDED."email",
          "name" = EXCLUDED."name",
          "status" = 'ACTIVE',
          "updatedAt" = CURRENT_TIMESTAMP
    `,
    [ids.user, tenantContext.userEmail, "V2 Smoke Owner"]
  );
}

async function upsertMembership(client) {
  await client.query(
    `
      INSERT INTO "V2OrganizationMembership" (
        "id", "organizationId", "userId", "role", "status", "createdAt", "updatedAt"
      )
      VALUES ($1, $2, $3, 'OWNER', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("organizationId", "userId") DO UPDATE
      SET "role" = 'OWNER',
          "status" = 'ACTIVE',
          "updatedAt" = CURRENT_TIMESTAMP
    `,
    [ids.membership, ids.organization, ids.user]
  );
}

async function upsertClientProjectOfferIcp(client) {
  await client.query(
    `
      INSERT INTO "V2ClientAccount" (
        "id", "organizationId", "name", "description", "status", "createdAt", "updatedAt"
      )
      VALUES ($1, $2, $3, $4, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("organizationId", "name") DO UPDATE
      SET "description" = EXCLUDED."description",
          "status" = 'ACTIVE',
          "updatedAt" = CURRENT_TIMESTAMP
    `,
    [
      ids.clientAccount,
      ids.organization,
      "V2 Smoke Client Account",
      SMOKE_MARKER,
    ]
  );
  await client.query(
    `
      INSERT INTO "V2Project" (
        "id", "organizationId", "clientAccountId", "name", "description", "status", "createdAt", "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("organizationId", "clientAccountId", "name") DO UPDATE
      SET "description" = EXCLUDED."description",
          "status" = 'ACTIVE',
          "updatedAt" = CURRENT_TIMESTAMP
    `,
    [
      ids.project,
      ids.organization,
      ids.clientAccount,
      "V2 Smoke Project",
      SMOKE_MARKER,
    ]
  );
  await client.query(
    `
      INSERT INTO "V2Offer" (
        "id", "organizationId", "projectId", "name", "description", "status", "createdAt", "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("organizationId", "projectId", "name") DO UPDATE
      SET "description" = EXCLUDED."description",
          "status" = 'ACTIVE',
          "updatedAt" = CURRENT_TIMESTAMP
    `,
    [
      ids.offer,
      ids.organization,
      ids.project,
      "V2 Smoke SDR Offer",
      SMOKE_MARKER,
    ]
  );
  await client.query(
    `
      INSERT INTO "V2ICPProfile" (
        "id", "organizationId", "offerId", "name", "description", "status", "createdAt", "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("id") DO UPDATE
      SET "name" = EXCLUDED."name",
          "description" = EXCLUDED."description",
          "status" = 'ACTIVE',
          "updatedAt" = CURRENT_TIMESTAMP
    `,
    [
      ids.icpProfile,
      ids.organization,
      ids.offer,
      "V2 Smoke TeleStar SaaS Outbound ICP",
      SMOKE_MARKER,
    ]
  );
  await client.query(
    `
      INSERT INTO "V2ICPVersion" (
        "id", "organizationId", "icpProfileId", "versionNumber", "status", "rulesJson",
        "publishedAt", "publishedByUserId", "version", "deletedAt", "deletedByUserId",
        "deletionReason", "createdAt", "updatedAt"
      )
      VALUES (
        $1, $2, $3, 1, 'PUBLISHED', $4::jsonb,
        CURRENT_TIMESTAMP, $5, 1, NULL, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("organizationId", "icpProfileId", "versionNumber") DO UPDATE
      SET "status" = 'PUBLISHED',
          "rulesJson" = EXCLUDED."rulesJson",
          "publishedAt" = COALESCE("V2ICPVersion"."publishedAt", CURRENT_TIMESTAMP),
          "publishedByUserId" = EXCLUDED."publishedByUserId",
          "deletedAt" = NULL,
          "deletedByUserId" = NULL,
          "deletionReason" = NULL,
          "updatedAt" = CURRENT_TIMESTAMP
    `,
    [
      ids.icpVersion,
      ids.organization,
      ids.icpProfile,
      JSON.stringify(TELESTAR),
      ids.user,
    ]
  );
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
    const rows = await pool.query(
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

    if (rows.rows.length === 0) {
      throw new Error(
        `No active V2 user membership found for V2_DEMO_SMOKE_TARGET_EMAIL=${targetEmail}. Confirm the self-hosted V2 user is provisioned with npm run v2:signup.`
      );
    }

    if (rows.rows.length > 1) {
      throw new Error(
        `Multiple active V2 memberships found for ${targetEmail}. Set V2_DEMO_SMOKE_ORGANIZATION_ID to disambiguate.`
      );
    }

    const row = rows.rows[0];

    if (!["OWNER", "ADMIN", "MANAGER"].includes(row.role)) {
      throw new Error(
        `Target user ${targetEmail} has role ${row.role}. Browser acceptance for /v2/reviews requires OWNER, ADMIN, or MANAGER.`
      );
    }

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

async function upsertCompaniesAndContacts(client) {
  for (const example of Object.values(examples)) {
    await upsertCompany(client, example.companyId, example.company);

    if (example.contact) {
      await upsertContact(client, example.contactId, example.contact);
      await upsertContactIdentifier(client, example.contactId, example.contact);
    }
  }
}

async function upsertCompany(client, id, company) {
  await client.query(
    `
      INSERT INTO "V2Company" (
        "id", "organizationId", "name", "nameNormalized", "canonicalDomain",
        "websiteUrl", "country", "status", "deletedAt", "deletedByUserId",
        "deletionReason", "createdAt", "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', NULL, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("organizationId", "canonicalDomain") DO UPDATE
      SET "name" = EXCLUDED."name",
          "nameNormalized" = EXCLUDED."nameNormalized",
          "websiteUrl" = EXCLUDED."websiteUrl",
          "country" = EXCLUDED."country",
          "status" = 'ACTIVE',
          "deletedAt" = NULL,
          "deletedByUserId" = NULL,
          "deletionReason" = NULL,
          "updatedAt" = CURRENT_TIMESTAMP
    `,
    [
      id,
      ids.organization,
      company.name,
      normalizeName(company.name),
      company.domain,
      company.websiteUrl,
      company.country,
    ]
  );
}

async function upsertContact(client, id, contact) {
  await client.query(
    `
      INSERT INTO "V2Contact" (
        "id", "organizationId", "fullName", "fullNameNormalized", "firstName",
        "lastName", "title", "status", "deletedAt", "deletedByUserId",
        "deletionReason", "createdAt", "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', NULL, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("id") DO UPDATE
      SET "fullName" = EXCLUDED."fullName",
          "fullNameNormalized" = EXCLUDED."fullNameNormalized",
          "firstName" = EXCLUDED."firstName",
          "lastName" = EXCLUDED."lastName",
          "title" = EXCLUDED."title",
          "status" = 'ACTIVE',
          "deletedAt" = NULL,
          "deletedByUserId" = NULL,
          "deletionReason" = NULL,
          "updatedAt" = CURRENT_TIMESTAMP
    `,
    [
      id,
      ids.organization,
      contact.fullName,
      normalizeName(contact.fullName),
      contact.fullName.split(/\s+/)[2] ?? null,
      contact.fullName.split(/\s+/)[3] ?? null,
      contact.title,
    ]
  );
}

async function upsertContactIdentifier(client, contactId, contact) {
  await client.query(
    `
      INSERT INTO "V2ContactIdentifier" (
        "id", "organizationId", "contactId", "type", "normalizedValue", "rawValue",
        "isGeneric", "isValid", "validityStatus", "source", "lastValidatedAt",
        "createdAt", "updatedAt"
      )
      VALUES (
        $1, $2, $3, 'EMAIL', $4, $4,
        false, true, 'VALID', $5, CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("id") DO UPDATE
      SET "contactId" = EXCLUDED."contactId",
          "normalizedValue" = EXCLUDED."normalizedValue",
          "rawValue" = EXCLUDED."rawValue",
          "isGeneric" = false,
          "isValid" = true,
          "validityStatus" = 'VALID',
          "source" = EXCLUDED."source",
          "lastValidatedAt" = CURRENT_TIMESTAMP,
          "updatedAt" = CURRENT_TIMESTAMP
    `,
    [
      contact.identifierId,
      ids.organization,
      contactId,
      normalizeEmail(contact.email),
      SMOKE_MARKER,
    ]
  );
}

async function upsertLeadAssignment(client, example) {
  const existing = await client.query(
    `
      SELECT "id"
      FROM "V2LeadAssignment"
      WHERE "organizationId" = $1
        AND "projectId" = $2
        AND "icpVersionId" = $3
        AND "companyId" = $4
        AND "assignmentLevel" = $5::"V2LeadAssignmentLevel"
        AND (
          ("contactId" IS NULL AND $6::text IS NULL)
          OR "contactId" = $6
        )
        AND "status" = 'ACTIVE'
        AND "deletedAt" IS NULL
      ORDER BY "createdAt" ASC, "id" ASC
      LIMIT 1
    `,
    [
      ids.organization,
      ids.project,
      ids.icpVersion,
      example.companyId,
      example.assignmentLevel,
      example.contactId,
    ]
  );
  const id =
    existing.rows[0]?.id ??
    `v2_demo_smoke_lead_${example.assignmentLevel.toLowerCase()}_${hashShort(
      `${example.companyId}:${example.contactId ?? "none"}`
    )}`;

  if (existing.rows[0]) {
    await client.query(
      `
        UPDATE "V2LeadAssignment"
        SET "workflowStatus" = $1::"V2LeadWorkflowStatus",
            "status" = 'ACTIVE',
            "deletedAt" = NULL,
            "deletedByUserId" = NULL,
            "deletionReason" = NULL,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = $2
          AND "organizationId" = $3
      `,
      [example.workflowStatus, id, ids.organization]
    );

    return id;
  }

  await client.query(
    `
      INSERT INTO "V2LeadAssignment" (
        "id", "organizationId", "companyId", "contactId", "projectId", "icpVersionId",
        "assignmentLevel", "workflowStatus", "status", "deletedAt", "deletedByUserId",
        "deletionReason", "createdAt", "updatedAt"
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        $7::"V2LeadAssignmentLevel", $8::"V2LeadWorkflowStatus", 'ACTIVE',
        NULL, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `,
    [
      id,
      ids.organization,
      example.companyId,
      example.contactId,
      ids.project,
      ids.icpVersion,
      example.assignmentLevel,
      example.workflowStatus,
    ]
  );

  return id;
}

async function upsertAssessment(client, example, leadAssignmentId) {
  const rawEvidence = {
    company: example.companyEvidence,
    ...(example.personaEvidence ? { contact: example.personaEvidence } : {}),
  };
  const assessment = assessIcpRulesV2(rawEvidence, TELESTAR);
  const scoringInput = await buildScoringInputSnapshot(client, example, leadAssignmentId);
  const persistence = mapRulesV2AssessmentToPersistence({ scoringInput, assessment });
  assertExpectedQualification(example.assessmentId, persistence.qualification);

  await client.query(
    `
      INSERT INTO "V2HardRuleAssessment" (
        "id", "organizationId", "leadAssignmentId", "icpVersionId", "fitScore", "confidence",
        "qualification", "companyType", "reason", "oneSentenceCompanySummary",
        "evidenceSnapshotJson", "hardGateResultsJson", "confidenceBreakdownJson",
        "dataQualityJson", "inputFingerprint", "icpRulesHash", "scoringSource",
        "scoringVersion", "previousAssessmentId", "createdAt"
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7::"V2Qualification", $8, $9, $10,
        $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15, $16, $17, $18,
        NULL, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("id") DO UPDATE
      SET "leadAssignmentId" = EXCLUDED."leadAssignmentId",
          "icpVersionId" = EXCLUDED."icpVersionId",
          "fitScore" = EXCLUDED."fitScore",
          "confidence" = EXCLUDED."confidence",
          "qualification" = EXCLUDED."qualification",
          "companyType" = EXCLUDED."companyType",
          "reason" = EXCLUDED."reason",
          "oneSentenceCompanySummary" = EXCLUDED."oneSentenceCompanySummary",
          "evidenceSnapshotJson" = EXCLUDED."evidenceSnapshotJson",
          "hardGateResultsJson" = EXCLUDED."hardGateResultsJson",
          "confidenceBreakdownJson" = EXCLUDED."confidenceBreakdownJson",
          "dataQualityJson" = EXCLUDED."dataQualityJson",
          "inputFingerprint" = EXCLUDED."inputFingerprint",
          "icpRulesHash" = EXCLUDED."icpRulesHash",
          "scoringSource" = EXCLUDED."scoringSource",
          "scoringVersion" = EXCLUDED."scoringVersion"
    `,
    [
      example.assessmentId,
      persistence.organizationId,
      persistence.leadAssignmentId,
      persistence.icpVersionId,
      persistence.fitScore,
      persistence.confidenceDecimal,
      persistence.qualification,
      persistence.companyType,
      persistence.reason,
      persistence.oneSentenceCompanySummary,
      JSON.stringify(persistence.evidenceSnapshotJson),
      JSON.stringify(persistence.hardGateResultsJson),
      JSON.stringify(persistence.confidenceBreakdownJson),
      JSON.stringify(persistence.dataQualityJson),
      `${SMOKE_MARKER}:${persistence.inputFingerprint}`,
      persistence.icpRulesHash,
      persistence.scoringSource,
      persistence.scoringVersion,
    ]
  );
  await client.query(
    `
      UPDATE "V2LeadAssignment"
      SET "latestHardRuleAssessmentId" = $1,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = $2
        AND "organizationId" = $3
    `,
    [example.assessmentId, leadAssignmentId, ids.organization]
  );

  return example.assessmentId;
}

async function buildScoringInputSnapshot(client, example, leadAssignmentId) {
  const contactIdentifiers = example.contactId
    ? await client.query(
        `
          SELECT "type"::text AS "type", "normalizedValue", "rawValue",
            "isGeneric", "isValid", "validityStatus"::text AS "validityStatus"
          FROM "V2ContactIdentifier"
          WHERE "organizationId" = $1
            AND "contactId" = $2
          ORDER BY "createdAt" ASC, "id" ASC
        `,
        [ids.organization, example.contactId]
      )
    : { rows: [] };

  return {
    leadAssignment: {
      id: leadAssignmentId,
      organizationId: ids.organization,
      projectId: ids.project,
      icpVersionId: ids.icpVersion,
      companyId: example.companyId,
      contactId: example.contactId,
      assignmentLevel: example.assignmentLevel,
      workflowStatus: example.workflowStatus,
      status: "ACTIVE",
      latestHardRuleAssessmentId: null,
    },
    company: {
      id: example.companyId,
      name: example.company.name,
      nameNormalized: normalizeName(example.company.name),
      canonicalDomain: example.company.domain,
      websiteUrl: example.company.websiteUrl,
      country: example.company.country,
    },
    contact: example.contact
      ? {
          id: example.contactId,
          fullName: example.contact.fullName,
          fullNameNormalized: normalizeName(example.contact.fullName),
          title: example.contact.title,
        }
      : null,
    contactIdentifiers: contactIdentifiers.rows,
      icpVersion: {
      id: ids.icpVersion,
      version: 1,
      versionNumber: 1,
      status: "PUBLISHED",
      rulesJson: TELESTAR,
    },
    companyEvidence: example.companyEvidence,
    personaEvidence: example.personaEvidence,
    icpRules: TELESTAR,
  };
}

async function upsertManagerReviewItem(
  client,
  { leadAssignmentId, hardRuleAssessmentId }
) {
  const sourceFingerprint = stableHash(
    `rules-v2|org:${ids.organization}|source:HARD_RULE_ASSESSMENT|assessment:${hardRuleAssessmentId}|reason:MISSING_REQUIRED_EVIDENCE`
  );

  await client.query(
    `
      INSERT INTO "V2ManagerReviewItem" (
        "id", "organizationId", "leadAssignmentId", "hardRuleAssessmentId",
        "projectId", "companyId", "contactId", "icpVersionId", "sourceType",
        "sourceId", "sourceRefJson", "sourceFingerprint", "reasonCode",
        "reasonDetail", "suggestedAction", "priority", "confidence",
        "candidateSummariesJson", "metadataJson", "status", "assignedToUserId",
        "createdByUserId", "createdAt", "updatedAt"
      )
      VALUES (
        $1, $2, $3, $4,
        $5, $6, NULL, $7, 'HARD_RULE_ASSESSMENT',
        $4, $8::jsonb, $9, 'MISSING_REQUIRED_EVIDENCE',
        $10, $11, 'HIGH', 'HIGH',
        $12::jsonb, $13::jsonb, 'OPEN', $14,
        $14, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("id") DO UPDATE
      SET "leadAssignmentId" = EXCLUDED."leadAssignmentId",
          "hardRuleAssessmentId" = EXCLUDED."hardRuleAssessmentId",
          "projectId" = EXCLUDED."projectId",
          "companyId" = EXCLUDED."companyId",
          "contactId" = NULL,
          "icpVersionId" = EXCLUDED."icpVersionId",
          "sourceType" = EXCLUDED."sourceType",
          "sourceId" = EXCLUDED."sourceId",
          "sourceRefJson" = EXCLUDED."sourceRefJson",
          "sourceFingerprint" = EXCLUDED."sourceFingerprint",
          "reasonCode" = EXCLUDED."reasonCode",
          "reasonDetail" = EXCLUDED."reasonDetail",
          "suggestedAction" = EXCLUDED."suggestedAction",
          "priority" = EXCLUDED."priority",
          "confidence" = EXCLUDED."confidence",
          "candidateSummariesJson" = EXCLUDED."candidateSummariesJson",
          "metadataJson" = EXCLUDED."metadataJson",
          "status" = 'OPEN',
          "assignedToUserId" = EXCLUDED."assignedToUserId",
          "createdByUserId" = EXCLUDED."createdByUserId",
          "resolvedByUserId" = NULL,
          "resolutionType" = NULL,
          "resolutionNote" = NULL,
          "resolutionMetadataJson" = NULL,
          "resolvedAt" = NULL,
          "archivedAt" = NULL,
          "deletedAt" = NULL,
          "updatedAt" = CURRENT_TIMESTAMP
    `,
    [
      ids.reviewItem,
      ids.organization,
      leadAssignmentId,
      hardRuleAssessmentId,
      ids.project,
      ids.reviewCompany,
      ids.icpVersion,
      JSON.stringify({
        marker: SMOKE_MARKER,
        sourceType: "HARD_RULE_ASSESSMENT",
        hardRuleAssessmentId,
        leadAssignmentId,
      }),
      sourceFingerprint,
      "Company appears to fit account criteria, but persona evidence is missing for final qualification.",
      "Review missing persona evidence before treating this as a contact-ready lead.",
      JSON.stringify([
        {
          label: "Missing persona",
          detail: "No contact/title is linked to the company-level assignment.",
        },
      ]),
      JSON.stringify({ marker: SMOKE_MARKER }),
      ids.user,
    ]
  );
}

function assertExpectedQualification(assessmentId, qualification) {
  const expected = {
    [ids.qualifiedAssessment]: "QUALIFIED",
    // Company-level demo lead (no contact): current scoring lands this in the 4th canonical
    // state COMPANY_QUALIFIED_NEEDS_CONTACT (company fit, persona/contact evidence missing),
    // not NEEDS_REVIEW. Expectation updated to match real scoring output after the P1.S0B
    // 4th-state work (migration 20260614034215). Qualification is computed by the real runtime.
    [ids.reviewAssessment]: "COMPANY_QUALIFIED_NEEDS_CONTACT",
    [ids.unqualifiedAssessment]: "UNQUALIFIED",
  }[assessmentId];

  if (qualification !== expected) {
    throw new Error(
      `Expected ${assessmentId} qualification ${expected}, got ${qualification}`
    );
  }
}

async function withTransaction(callback) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function assertLocalDevSeedAllowed() {
  if (process.env.V2_DEMO_SMOKE_ALLOW !== SMOKE_MARKER) {
    throw new Error(
      `Refusing to seed V2 demo smoke data. Set V2_DEMO_SMOKE_ALLOW=${SMOKE_MARKER} for local/dev only.`
    );
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed V2 demo smoke data with NODE_ENV=production.");
  }

  if (process.env.VERCEL_ENV === "production") {
    throw new Error("Refusing to seed V2 demo smoke data with VERCEL_ENV=production.");
  }

  const databaseUrl = process.env.DATABASE_URL ?? "";

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const normalizedUrl = databaseUrl.toLowerCase();
  const productionLike =
    /(^|[._:/@-])(prod|production)([._:/@-]|$)/.test(normalizedUrl) ||
    normalizedUrl.includes("vercel-storage.com");

  if (productionLike) {
    throw new Error(
      "Refusing to seed V2 demo smoke data because DATABASE_URL looks production-like."
    );
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

function normalizeName(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

function hashShort(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
