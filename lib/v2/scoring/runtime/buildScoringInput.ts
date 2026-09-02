import { z } from "zod";
import {
  mapIntelligenceProfileToScoring,
  type CompanyIntelligenceScoringTrace,
} from "../../company-intelligence/mapIntelligenceProfileToScoring";
import { validateIcpVersionRules, type PersonaEvidence } from "../icpRulesSchema";
import { validateIcpVersionRulesV2 } from "../rules/schema-v2";
import { upgradeV1toV2 } from "../rules/upgradeV1toV2";
import type {
  BuildScoringInputResult,
  ContactIdentifierSnapshot,
  ScoreHv0AssignmentFailure,
  ScoreHv0ScoringInput,
  V2ScoreRuntimeDatabase,
} from "./types";

type RulesValidationResult =
  | { ok: true; rules: ReturnType<typeof validateIcpVersionRulesV2> }
  | { ok: false; failure: ScoreHv0AssignmentFailure };

type LeadAssignmentJoinedRow = {
  leadAssignmentId: string;
  organizationId: string;
  projectId: string;
  icpVersionId: string;
  companyId: string;
  contactId: string | null;
  assignmentLevel: "COMPANY" | "CONTACT";
  workflowStatus: string;
  assignmentStatus: string;
  latestHardRuleAssessmentId: string | null;
  companyName: string;
  companyNameNormalized: string;
  canonicalDomain: string | null;
  websiteUrl: string | null;
  companyCountry: string | null;
  companyIndustry: string | null;
  companyEmployeeCountRange: string | null;
  contactFullName: string | null;
  contactFullNameNormalized: string | null;
  contactTitle: string | null;
  icpVersion: number;
  icpVersionNumber: number;
  icpRulesJson: unknown;
};

type ContactIdentifierRow = {
  type: string;
  normalizedValue: string;
  rawValue: string | null;
  isGeneric: boolean;
  isValid: boolean;
  validityStatus: string;
};

export async function buildScoringInput(
  db: V2ScoreRuntimeDatabase,
  input: {
    organizationId: string;
    leadAssignmentId: string;
  }
): Promise<BuildScoringInputResult> {
  const rows = await db.$queryRaw<LeadAssignmentJoinedRow[]>`
    SELECT
      la."id" AS "leadAssignmentId",
      la."organizationId",
      la."projectId",
      la."icpVersionId",
      la."companyId",
      la."contactId",
      la."assignmentLevel"::text AS "assignmentLevel",
      la."workflowStatus"::text AS "workflowStatus",
      la."status"::text AS "assignmentStatus",
      la."latestHardRuleAssessmentId",
      company."name" AS "companyName",
      company."nameNormalized" AS "companyNameNormalized",
      company."canonicalDomain",
      company."websiteUrl",
      company."country" AS "companyCountry",
      company."industry" AS "companyIndustry",
      company."employeeCountRange" AS "companyEmployeeCountRange",
      contact."fullName" AS "contactFullName",
      contact."fullNameNormalized" AS "contactFullNameNormalized",
      contact."title" AS "contactTitle",
      icp."version" AS "icpVersion",
      icp."versionNumber" AS "icpVersionNumber",
      icp."rulesJson" AS "icpRulesJson"
    FROM "V2LeadAssignment" la
    INNER JOIN "V2Company" company
      ON company."id" = la."companyId"
      AND company."organizationId" = la."organizationId"
      AND company."status" = 'ACTIVE'
      AND company."deletedAt" IS NULL
    INNER JOIN "V2ICPVersion" icp
      ON icp."id" = la."icpVersionId"
      AND icp."organizationId" = la."organizationId"
      AND icp."status" = 'PUBLISHED'
      AND icp."deletedAt" IS NULL
    LEFT JOIN "V2Contact" contact
      ON contact."id" = la."contactId"
      AND contact."organizationId" = la."organizationId"
      AND contact."status" = 'ACTIVE'
      AND contact."deletedAt" IS NULL
    WHERE la."id" = ${input.leadAssignmentId}
      AND la."organizationId" = ${input.organizationId}
      AND la."status" = 'ACTIVE'
      AND la."deletedAt" IS NULL
    LIMIT 1
  `;
  const row = rows[0];

  if (!row) {
    return {
      ok: false,
      failure: {
        leadAssignmentId: input.leadAssignmentId,
        code: "LEAD_ASSIGNMENT_NOT_ELIGIBLE",
        message:
          "LeadAssignment was not active, was soft-deleted, crossed tenant boundary, or lacked active published company/ICP context.",
      },
    };
  }

  if (row.assignmentLevel === "CONTACT" && !row.contactId) {
    return {
      ok: false,
      failure: {
        leadAssignmentId: input.leadAssignmentId,
        code: "CONTACT_ASSIGNMENT_MISSING_CONTACT",
        message: "Contact-level LeadAssignment had no contactId.",
      },
    };
  }

  if (row.assignmentLevel === "CONTACT" && row.contactId && !row.contactFullName) {
    return {
      ok: false,
      failure: {
        leadAssignmentId: input.leadAssignmentId,
        code: "CONTACT_ASSIGNMENT_MISSING_CONTACT",
        message: "Contact-level LeadAssignment contact was missing or inactive.",
      },
    };
  }

  const parsedRules = validateRules(row.icpRulesJson, row.leadAssignmentId);

  if (!parsedRules.ok) {
    return parsedRules;
  }

  const contactIdentifiers = row.contactId
    ? await loadContactIdentifiers(db, {
        organizationId: input.organizationId,
        contactId: row.contactId,
      })
    : [];
  const personaEvidence = buildPersonaEvidence(row);
  const intelligence = await loadIntelligenceEvidence(db, {
    organizationId: input.organizationId,
    companyId: row.companyId,
  });

  const scoringInput: ScoreHv0ScoringInput = {
    leadAssignment: {
      id: row.leadAssignmentId,
      organizationId: row.organizationId,
      projectId: row.projectId,
      icpVersionId: row.icpVersionId,
      companyId: row.companyId,
      contactId: row.contactId,
      assignmentLevel: row.assignmentLevel,
      workflowStatus: row.workflowStatus,
      status: row.assignmentStatus,
      latestHardRuleAssessmentId: row.latestHardRuleAssessmentId,
    },
    company: {
      id: row.companyId,
      name: row.companyName,
      nameNormalized: row.companyNameNormalized,
      canonicalDomain: row.canonicalDomain,
      websiteUrl: row.websiteUrl,
      country: row.companyCountry,
    },
    contact: row.contactId
      ? {
          id: row.contactId,
          fullName: row.contactFullName ?? "",
          fullNameNormalized: row.contactFullNameNormalized,
          title: row.contactTitle,
        }
      : null,
    contactIdentifiers,
    icpVersion: {
      id: row.icpVersionId,
      version: row.icpVersion,
      versionNumber: row.icpVersionNumber,
      status: "PUBLISHED",
      rulesJson: row.icpRulesJson,
    },
    companyEvidence: {
      companyName: row.companyName,
      website: row.websiteUrl ?? undefined,
      canonicalDomain: row.canonicalDomain ?? undefined,
      personaEvidence,
      ...intelligence.companyEvidence,
      // Uploaded company facts as the fallback AFTER the enrichment spread: enrichment wins when it
      // has a value, but an un-enriched (freshly uploaded) company still gets its industry/size/country
      // scored instead of reading "unknown" — the measured fit-74->86 qualification unlock.
      country: firstNonEmpty(intelligence.companyEvidence.country, row.companyCountry),
      industry: firstNonEmpty(intelligence.companyEvidence.industry, row.companyIndustry),
      employeeRange: firstNonEmpty(intelligence.companyEvidence.employeeRange, row.companyEmployeeCountRange),
    },
    intelligenceTrace: intelligence.trace,
    personaEvidence,
    icpRules: parsedRules.rules,
  };

  return { ok: true, input: scoringInput };
}

async function loadContactIdentifiers(
  db: V2ScoreRuntimeDatabase,
  input: { organizationId: string; contactId: string }
): Promise<ContactIdentifierSnapshot[]> {
  const rows = await db.$queryRaw<ContactIdentifierRow[]>`
    SELECT
      "type"::text AS "type",
      "normalizedValue",
      "rawValue",
      "isGeneric",
      "isValid",
      "validityStatus"::text AS "validityStatus"
    FROM "V2ContactIdentifier"
    WHERE "organizationId" = ${input.organizationId}
      AND "contactId" = ${input.contactId}
    ORDER BY "createdAt" ASC, "id" ASC
  `;

  return rows.map((row) => ({
    type: row.type,
    normalizedValue: row.normalizedValue,
    rawValue: row.rawValue,
    isGeneric: row.isGeneric,
    isValid: row.isValid,
    validityStatus: row.validityStatus,
  }));
}

type IntelligenceProfileRow = {
  id: string;
  researchVersion: number;
  factsJson: unknown;
  sourceCoverageJson: unknown;
  profileStatus: string;
  confidenceJson: unknown;
};

async function loadIntelligenceEvidence(
  db: V2ScoreRuntimeDatabase,
  input: { organizationId: string; companyId: string }
): Promise<{
  companyEvidence: Record<string, unknown>;
  trace: CompanyIntelligenceScoringTrace | null;
}> {
  const rows = await db.$queryRaw<IntelligenceProfileRow[]>`
    SELECT
      "factsJson",
      "sourceCoverageJson",
      "id",
      "researchVersion",
      "confidenceJson",
      "profileStatus"::text AS "profileStatus"
    FROM "V2CompanyIntelligenceProfile"
    WHERE "organizationId" = ${input.organizationId}
      AND "companyId" = ${input.companyId}
      AND "profileStatus" IN ('EXTRACTED', 'PARTIAL', 'FAILED')
      AND "staleAt" IS NOT NULL
      AND "staleAt" > CURRENT_TIMESTAMP
    ORDER BY "createdAt" DESC, "id" DESC
    LIMIT 1
  `;
  const row = rows[0];

  if (!row) {
    return { companyEvidence: {}, trace: null };
  }

  return mapIntelligenceProfileToScoring({
    profileId: row.id,
    researchVersion: row.researchVersion,
    factsJson: row.factsJson,
    sourceCoverageJson: row.sourceCoverageJson,
    profileStatus: row.profileStatus,
    confidenceJson: row.confidenceJson,
  });
}

function validateRules(
  rulesJson: unknown,
  leadAssignmentId: string
): RulesValidationResult {
  try {
    // Single scoring path: everything runs through the graduated v2 engine. v2 rules validate
    // as-is; legacy v1 rules are lifted to v2 (upgradeV1toV2) so there is no coarse fallback and
    // no "authored-v2-but-scored-v1" split. Re-scoring a previously-v1 lead now writes a new
    // assessment under the v2 scoringVersion (Inv 4/6).
    if (isRulesV2Candidate(rulesJson)) {
      return { ok: true, rules: validateIcpVersionRulesV2(rulesJson) };
    }

    return { ok: true, rules: validateIcpVersionRulesV2(upgradeV1toV2(validateIcpVersionRules(rulesJson))) };
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? error.issues.map((issue) => issue.message).join("; ")
        : error instanceof Error
          ? error.message
          : "ICPVersion rulesJson was invalid.";

    return {
      ok: false,
      failure: {
        leadAssignmentId,
        code: "ICP_VERSION_RULES_INVALID",
        message,
      },
    };
  }
}

function isRulesV2Candidate(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "schemaVersion" in value &&
    (value as { schemaVersion?: unknown }).schemaVersion === "v2"
  );
}

/** First value that is a non-empty string, else undefined. Tolerant of `unknown` (intelligence evidence). */
function firstNonEmpty(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v;
  }
  return undefined;
}

function buildPersonaEvidence(row: LeadAssignmentJoinedRow): PersonaEvidence | undefined {
  if (!row.contactTitle) {
    return undefined;
  }

  return {
    title: row.contactTitle,
    rawTitle: row.contactTitle,
    seniorityTier: inferSeniorityTier(row.contactTitle),
    titleKeywords: row.contactTitle
      .split(/\s+/)
      .map((part) => part.trim())
      .filter(Boolean),
  };
}

function inferSeniorityTier(
  title: string
): NonNullable<PersonaEvidence["seniorityTier"]> {
  const normalized = title.toLowerCase();

  if (
    /\b(ceo|chief|founder|co-founder|president|coo|cto|cio|cmo|cro|cfo|ciso)\b/.test(
      normalized
    )
  ) {
    return "C_LEVEL";
  }

  if (/\b(vp|vice president|svp|evp)\b/.test(normalized)) {
    return "VP_LEVEL";
  }

  if (/\b(director|head of|country manager|regional director)\b/.test(normalized)) {
    return "DIRECTOR";
  }

  if (/\b(manager|team lead)\b/.test(normalized)) {
    return "MANAGER";
  }

  if (/\b(engineer|specialist|executive|associate|assistant|representative|coordinator|analyst)\b/.test(normalized)) {
    return "IC";
  }

  return "UNKNOWN";
}
