import { createNonRetryableJobError } from "../jobs/errors";
import type { V2JobHandler } from "../jobs/types";
import { toJsonbParam, sanitizeNullableText } from "../persistence/jsonbSanitizer";
import { enqueueIcpScoreJob } from "../scoring/runtime/enqueueScoringJobs";
import { isSearchOverBudget, recordProviderUsage, SEARCH_PROVIDER_KEY } from "./providerBudget";
import { selectReasoningEngine } from "./reasoning-llmEngine";
import { runCompanyResearch } from "@telestar/core-intel/runCompanyResearch";
import { parseCompanyEnrichmentJobPayload } from "./types";

type CompanyRow = {
  id: string;
  name: string;
  canonicalDomain: string | null;
  websiteUrl: string | null;
  country: string | null;
  industry: string | null;
};

type ResearchSnapshotRow = {
  id: string;
  status: string;
  idempotencyKey: string;
};

type IntelligenceProfileRow = {
  id: string;
  profileStatus: string;
  idempotencyKey: string;
};

type LeadAssignmentIdRow = {
  id: string;
};

export const companyEnrichmentJobHandler: V2JobHandler = async (context) => {
  const payload = parseCompanyEnrichmentJobPayload(context.payload);

  if (payload.organizationId !== context.organizationId) {
    throw createNonRetryableJobError(
      "TENANT_MISMATCH",
      "COMPANY_ENRICHMENT payload organizationId did not match the job organization."
    );
  }

  const companyRows = await context.db.$queryRaw<CompanyRow[]>`
    SELECT "id", "name", "canonicalDomain", "websiteUrl", "country", "industry"
    FROM "V2Company"
    WHERE "organizationId" = ${context.organizationId}
      AND "id" = ${payload.companyId}
      AND "status" = 'ACTIVE'
      AND "deletedAt" IS NULL
    LIMIT 1
  `;
  const company = companyRows[0];

  if (!company) {
    throw createNonRetryableJobError(
      "COMPANY_NOT_FOUND",
      "COMPANY_ENRICHMENT payload companyId did not match an active company for this organization."
    );
  }

  await context.updateProgress({ current: 0, total: 3 });

  const snapshotIdempotencyKey = buildResearchSnapshotIdempotencyKey(
    context.organizationId,
    company.id,
    payload.researchVersion
  );
  const profileIdempotencyKey = buildIntelligenceProfileIdempotencyKey(
    context.organizationId,
    company.id,
    payload.researchVersion
  );

  const existingSnapshot = await selectResearchSnapshot(
    context.db,
    snapshotIdempotencyKey
  );
  const existingProfile = await selectIntelligenceProfile(
    context.db,
    profileIdempotencyKey
  );

  let researchSnapshot = existingSnapshot;
  let intelligenceProfile = existingProfile;
  let reused = Boolean(existingSnapshot && existingProfile);

  if (!researchSnapshot || !intelligenceProfile) {
    // AI3: when the org has AI enabled (+ provider key present), enrich with the hybrid
    // rules+LLM engine. The per-call budget/mode/rate gate still runs inside the LLM
    // path; a skip/error degrades to rules-only. undefined => default rules-only hybrid.
    const reasoningEngine = await selectReasoningEngine(context.organizationId);
    // P4: skip web search once the org is over its daily provider budget (degrade to
    // website-only); record the search usage this run consumed.
    const disableSearch = await isSearchOverBudget(context.organizationId);
    const research = await runCompanyResearch({
      companyName: company.name,
      country: company.country,
      industryRaw: company.industry,
      canonicalDomainInput: company.canonicalDomain,
      websiteUrl: company.websiteUrl,
      reasoningEngine,
      disableSearch,
    });
    const searchQueriesRun = Number(research.profile.sourceCoverageJson.searchQueriesRun ?? 0);
    if (searchQueriesRun > 0) {
      await recordProviderUsage(context.organizationId, SEARCH_PROVIDER_KEY, { requests: searchQueriesRun });
    }

    researchSnapshot =
      researchSnapshot ??
      (await insertResearchSnapshot(context.db, {
        organizationId: context.organizationId,
        companyId: company.id,
        canonicalDomain: research.canonicalDomain,
        websiteUrl: research.websiteUrl,
        status: research.status,
        httpStatus: research.httpStatus,
        finalUrl: research.finalUrl,
        redirectChainJson: research.redirectChainJson,
        pagesFetchedJson: research.pagesFetchedJson,
        searchResultsJson: research.searchResultsJson,
        rawTextHash: research.rawTextHash,
        contentHash: research.contentHash,
        errorCode: research.errorCode,
        errorMessage: research.errorMessage,
        researchVersion: payload.researchVersion,
        idempotencyKey: snapshotIdempotencyKey,
      }));

    intelligenceProfile =
      intelligenceProfile ??
      (await insertIntelligenceProfile(context.db, {
        organizationId: context.organizationId,
        companyId: company.id,
        canonicalDomain: research.canonicalDomain,
        sourceResearchSnapshotId: researchSnapshot.id,
        companySummary: research.profile.companySummary,
        factsJson: research.profile.factsJson,
        evidenceItemsJson: research.profile.evidenceItemsJson,
        classificationJson: research.profile.classificationJson,
        sourceCoverageJson: research.profile.sourceCoverageJson,
        riskSignalsJson: research.profile.riskSignalsJson,
        confidenceJson: research.profile.confidenceJson,
        profileStatus: research.profile.profileStatus,
        staleAt: research.profile.staleAt,
        researchVersion: payload.researchVersion,
        idempotencyKey: profileIdempotencyKey,
      }));

    reused = Boolean(existingSnapshot && existingProfile);

    // Denormalize the reasoning category onto the company so the directory can
    // aggregate "top industries" + filter by industry without scanning factsJson.
    // COALESCE keeps a prior value when this run found no category (Invariant 2:
    // descriptive only, never a qualification).
    const industryCategory = deriveIndustryCategory(research.profile.factsJson);
    if (industryCategory) {
      await context.db.$executeRaw`
        UPDATE "V2Company"
        SET "industryCategory" = ${industryCategory}, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${company.id} AND "organizationId" = ${context.organizationId}`;
    }
  }

  await context.updateProgress({ current: 1, total: 3 });

  const leadAssignmentRows = await context.db.$queryRaw<LeadAssignmentIdRow[]>`
    SELECT "id"
    FROM "V2LeadAssignment"
    WHERE "organizationId" = ${context.organizationId}
      AND "companyId" = ${company.id}
      AND "status" = 'ACTIVE'
      AND "deletedAt" IS NULL
    ORDER BY "createdAt" ASC, "id" ASC
  `;
  const leadAssignmentIds = leadAssignmentRows.map((row) => row.id);

  await context.updateProgress({ current: 2, total: 3 });

  const shouldAutoScore = shouldAutoScoreAfterEnrichment(context.job.sourceType, context.job.sourceId);
  const scoreJob =
    shouldAutoScore && leadAssignmentIds.length > 0
      ? await enqueueIcpScoreJob(context.db, {
          organizationId: context.organizationId,
          selection: { kind: "lead_assignment_ids", leadAssignmentIds },
          createdByUserId: context.job.createdByUserId,
          // Forward this enrichment job's source binding onto the score job so
          // the whole pipeline stays claimable in one run scope. When enrichment
          // is ingestion-scoped, the score job is too; otherwise it stays MANUAL.
          ...(context.job.sourceType === "INGESTION_JOB"
            ? {
                source: {
                  sourceType: "INGESTION_JOB" as const,
                  sourceId: context.job.sourceId,
                },
              }
            : {}),
        })
      : null;

  await context.updateProgress({ current: 3, total: 3 });

  return {
    resultSnapshotJson: {
      schemaVersion: "v2.company-enrichment.result.v1",
      companyId: company.id,
      researchSnapshot: {
        id: researchSnapshot.id,
        status: researchSnapshot.status,
        idempotencyKey: researchSnapshot.idempotencyKey,
        reused,
      },
      intelligenceProfile: {
        id: intelligenceProfile.id,
        profileStatus: intelligenceProfile.profileStatus,
        idempotencyKey: intelligenceProfile.idempotencyKey,
        reused,
      },
      leadAssignmentIds,
      scoreJob: scoreJob
        ? {
            result: scoreJob.kind,
            idempotencyKey:
              scoreJob.kind === "conflict"
                ? scoreJob.existingJob.idempotencyKey
                : scoreJob.job.idempotencyKey,
          }
        : null,
    },
    progressCurrent: 3,
    progressTotal: 3,
  };
};

// First `category.<id>` fact token -> the industry category id (e.g. "logistics").

function shouldAutoScoreAfterEnrichment(sourceType: string, _sourceId: string | null) {
  return sourceType === "INGESTION_JOB" || sourceType === "LEAD_ASSIGNMENT";
}
export function deriveIndustryCategory(facts: string[]): string | null {
  const token = facts.find((f) => f.startsWith("category."));
  const id = token ? token.slice("category.".length).trim() : "";
  return id || null;
}

export function buildResearchSnapshotIdempotencyKey(
  organizationId: string,
  companyId: string,
  researchVersion: number
) {
  return `company-research-snapshot:${organizationId}:${companyId}:${researchVersion}`;
}

export function buildIntelligenceProfileIdempotencyKey(
  organizationId: string,
  companyId: string,
  researchVersion: number
) {
  return `company-intelligence-profile:${organizationId}:${companyId}:${researchVersion}`;
}

type EnrichmentDatabase = Parameters<V2JobHandler>[0]["db"];

export async function selectResearchSnapshot(
  db: EnrichmentDatabase,
  idempotencyKey: string
): Promise<ResearchSnapshotRow | null> {
  const rows = await db.$queryRaw<ResearchSnapshotRow[]>`
    SELECT "id", "status"::text AS "status", "idempotencyKey"
    FROM "V2CompanyResearchSnapshot"
    WHERE "idempotencyKey" = ${idempotencyKey}
    LIMIT 1
  `;

  return rows[0] ?? null;
}

export async function selectIntelligenceProfile(
  db: EnrichmentDatabase,
  idempotencyKey: string
): Promise<IntelligenceProfileRow | null> {
  const rows = await db.$queryRaw<IntelligenceProfileRow[]>`
    SELECT "id", "profileStatus"::text AS "profileStatus", "idempotencyKey"
    FROM "V2CompanyIntelligenceProfile"
    WHERE "idempotencyKey" = ${idempotencyKey}
    LIMIT 1
  `;

  return rows[0] ?? null;
}

export async function insertResearchSnapshot(
  db: EnrichmentDatabase,
  input: {
    organizationId: string;
    companyId: string;
    canonicalDomain: string | null;
    websiteUrl: string | null;
    status: string;
    httpStatus: number | null;
    finalUrl: string | null;
    redirectChainJson: unknown;
    pagesFetchedJson: unknown;
    searchResultsJson: unknown;
    rawTextHash: string | null;
    contentHash: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    researchVersion: number;
    idempotencyKey: string;
  }
): Promise<ResearchSnapshotRow> {
  const insertedRows = await db.$queryRaw<ResearchSnapshotRow[]>`
    INSERT INTO "V2CompanyResearchSnapshot" (
      "id",
      "organizationId",
      "companyId",
      "canonicalDomain",
      "websiteUrl",
      "status",
      "httpStatus",
      "finalUrl",
      "redirectChainJson",
      "pagesFetchedJson",
      "searchResultsJson",
      "rawTextHash",
      "contentHash",
      "errorCode",
      "errorMessage",
      "researchVersion",
      "idempotencyKey",
      "createdAt"
    )
    VALUES (
      ${createResearchSnapshotId()},
      ${input.organizationId},
      ${input.companyId},
      ${input.canonicalDomain},
      ${input.websiteUrl},
      ${input.status}::"V2ResearchStatus",
      ${input.httpStatus},
      ${sanitizeNullableText(input.finalUrl)},
      ${toJsonbParam(input.redirectChainJson)}::jsonb,
      ${toJsonbParam(input.pagesFetchedJson)}::jsonb,
      ${toJsonbParam(input.searchResultsJson)}::jsonb,
      ${input.rawTextHash},
      ${input.contentHash},
      ${input.errorCode},
      ${sanitizeNullableText(input.errorMessage)},
      ${input.researchVersion},
      ${input.idempotencyKey},
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("idempotencyKey") DO NOTHING
    RETURNING "id", "status"::text AS "status", "idempotencyKey"
  `;

  return (
    insertedRows[0] ?? (await mustSelectResearchSnapshot(db, input.idempotencyKey))
  );
}

async function mustSelectResearchSnapshot(
  db: EnrichmentDatabase,
  idempotencyKey: string
): Promise<ResearchSnapshotRow> {
  const row = await selectResearchSnapshot(db, idempotencyKey);

  if (!row) {
    throw createNonRetryableJobError(
      "RESEARCH_SNAPSHOT_INSERT_RACE",
      "Failed to insert or locate V2CompanyResearchSnapshot row."
    );
  }

  return row;
}

export async function insertIntelligenceProfile(
  db: EnrichmentDatabase,
  input: {
    organizationId: string;
    companyId: string;
    canonicalDomain: string | null;
    sourceResearchSnapshotId: string;
    companySummary: string | null;
    factsJson: unknown;
    evidenceItemsJson: unknown;
    classificationJson: unknown;
    sourceCoverageJson: unknown;
    riskSignalsJson: unknown;
    confidenceJson: unknown;
    profileStatus: string;
    staleAt: Date;
    researchVersion: number;
    idempotencyKey: string;
  }
): Promise<IntelligenceProfileRow> {
  const insertedRows = await db.$queryRaw<IntelligenceProfileRow[]>`
    INSERT INTO "V2CompanyIntelligenceProfile" (
      "id",
      "organizationId",
      "companyId",
      "canonicalDomain",
      "sourceResearchSnapshotId",
      "companySummary",
      "factsJson",
      "evidenceItemsJson",
      "classificationJson",
      "sourceCoverageJson",
      "riskSignalsJson",
      "confidenceJson",
      "profileStatus",
      "staleAt",
      "researchVersion",
      "idempotencyKey",
      "createdAt"
    )
    VALUES (
      ${createIntelligenceProfileId()},
      ${input.organizationId},
      ${input.companyId},
      ${input.canonicalDomain},
      ${input.sourceResearchSnapshotId},
      ${sanitizeNullableText(input.companySummary)},
      ${toJsonbParam(input.factsJson)}::jsonb,
      ${toJsonbParam(input.evidenceItemsJson)}::jsonb,
      ${toJsonbParam(input.classificationJson)}::jsonb,
      ${toJsonbParam(input.sourceCoverageJson)}::jsonb,
      ${toJsonbParam(input.riskSignalsJson)}::jsonb,
      ${toJsonbParam(input.confidenceJson)}::jsonb,
      ${input.profileStatus}::"V2CompanyIntelligenceProfileStatus",
      ${input.staleAt},
      ${input.researchVersion},
      ${input.idempotencyKey},
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("idempotencyKey") DO NOTHING
    RETURNING "id", "profileStatus"::text AS "profileStatus", "idempotencyKey"
  `;

  return (
    insertedRows[0] ?? (await mustSelectIntelligenceProfile(db, input.idempotencyKey))
  );
}

async function mustSelectIntelligenceProfile(
  db: EnrichmentDatabase,
  idempotencyKey: string
): Promise<IntelligenceProfileRow> {
  const row = await selectIntelligenceProfile(db, idempotencyKey);

  if (!row) {
    throw createNonRetryableJobError(
      "INTELLIGENCE_PROFILE_INSERT_RACE",
      "Failed to insert or locate V2CompanyIntelligenceProfile row."
    );
  }

  return row;
}

function createResearchSnapshotId() {
  return `crsnap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function createIntelligenceProfileId() {
  return `cprof_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
