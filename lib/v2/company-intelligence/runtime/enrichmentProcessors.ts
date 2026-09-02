import "server-only";

import { prisma } from "@/lib/server/prisma";
import { V2_QUEUE_NAMES } from "../../bullmq/queueNames";
import { addJob } from "../../bullmq/queues";
import type { V2JobDatabase } from "../../jobs/types";
import { incrementRunProgress } from "../../runtime/runtimeStore";
import { createScoringRun } from "../../scoring/runtime/createScoringRun";
import { enqueueScoringExecution } from "../../scoring/runtime/enqueueScoringExecution";
import {
  buildIntelligenceProfileIdempotencyKey,
  buildResearchSnapshotIdempotencyKey,
  deriveIndustryCategory,
  insertIntelligenceProfile,
  insertResearchSnapshot,
  selectIntelligenceProfile,
} from "../companyEnrichmentHandler";
import { isSearchOverBudget, recordProviderUsage, SEARCH_PROVIDER_KEY } from "../providerBudget";
import { selectReasoningEngine } from "../reasoning/llmEngine";
import {
  compileCompanyResearchResult,
  fetchCompanyMaterial,
  type CompanyResearchMaterial,
  type CompanyResearchResult,
} from "../runCompanyResearch";

// P4 split: the BullMQ enrichment pipeline â€” research.discover -> research.fetch ->
// research.extract. Each stage is a small, separately-retryable job with pointer-only
// payloads; the fetched material is checkpointed in V2CompanyResearchStaging between
// fetch and extract. Reuses the fetch/compile seams + the handler's persist helpers, so
// the output is identical to the single-job db path (Invariant 5: every read/write is
// org-scoped; Invariant 6: idempotent by research-version keys).

export type EnrichmentJob = {
  organizationId: string;
  companyId: string;
  researchVersion: number;
  createdByUserId?: string | null;
  // When this enrichment is part of a tracked batch, the V2RuntimeRun(ENRICHMENT) id â€”
  // each finished company bumps its progress so the UI shows exact X/N + completion.
  runtimeRunId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
};

type CompanyRow = { id: string; name: string; canonicalDomain: string | null; websiteUrl: string | null; country: string | null; industry: string | null };

async function loadCompany(organizationId: string, companyId: string): Promise<CompanyRow | null> {
  const rows = await prisma.$queryRawUnsafe<CompanyRow[]>(
    `SELECT "id","name","canonicalDomain","websiteUrl","country","industry" FROM "V2Company"
      WHERE "organizationId"=$1 AND "id"=$2 AND "status"='ACTIVE' AND "deletedAt" IS NULL LIMIT 1`,
    organizationId,
    companyId
  );
  return rows[0] ?? null;
}

function jobKey(job: EnrichmentJob, stage: string): string {
  return `enrich_${job.organizationId}_${job.companyId}_${job.researchVersion}_${stage}`;
}

/** discover: validate company + cache check. If a profile for this research version
 *  already exists, skip straight to scoring; otherwise hand off to fetch. */
export async function processResearchDiscoverJob(_db: V2JobDatabase, job: EnrichmentJob): Promise<void> {
  const company = await loadCompany(job.organizationId, job.companyId);
  if (!company) return;
  const existing = await selectIntelligenceProfile(
    prisma as unknown as V2JobDatabase,
    buildIntelligenceProfileIdempotencyKey(job.organizationId, job.companyId, job.researchVersion)
  );
  if (existing) {
    await finishEnrichedCompany(job);
    return;
  }
  await addJob(V2_QUEUE_NAMES.researchFetch, "research.fetch", { ...job }, { jobId: jobKey(job, "fetch") });
}

/** fetch: crawl + search (budget-gated), checkpoint the raw material, hand off to
 *  extract. No website => persist the empty result + scoring straight away. */
export async function processResearchFetchJob(db: V2JobDatabase, job: EnrichmentJob): Promise<void> {
  const company = await loadCompany(job.organizationId, job.companyId);
  if (!company) return;

  const disableSearch = await isSearchOverBudget(job.organizationId);
  const fetched = await fetchCompanyMaterial({
    companyName: company.name,
    country: company.country,
    canonicalDomainInput: company.canonicalDomain,
    websiteUrl: company.websiteUrl,
    disableSearch,
  });

  if (!fetched.ok) {
    await persistResearchResult(db, job, company, fetched.result);
    await finishEnrichedCompany(job);
    return;
  }

  const queries = fetched.material.search.queryCount;
  if (queries > 0) await recordProviderUsage(job.organizationId, SEARCH_PROVIDER_KEY, { requests: queries });

  await upsertStaging(job, fetched.material);
  await addJob(V2_QUEUE_NAMES.researchExtract, "research.extract", { ...job }, { jobId: jobKey(job, "extract") });
}

/** extract: compile the checkpointed material (runs the reasoning engine), persist the
 *  snapshot + profile, drop the checkpoint, hand off to scoring. */
export async function processResearchExtractJob(db: V2JobDatabase, job: EnrichmentJob): Promise<void> {
  const company = await loadCompany(job.organizationId, job.companyId);
  if (!company) return;
  const material = await readStaging(job);
  if (!material) return;

  const reasoningEngine = await selectReasoningEngine(job.organizationId);
  const result = await compileCompanyResearchResult(
    {
      companyName: company.name,
      country: company.country,
      industryRaw: company.industry,
      canonicalDomainInput: company.canonicalDomain,
      websiteUrl: company.websiteUrl,
      reasoningEngine,
    },
    material
  );

  await persistResearchResult(db, job, company, result);
  await deleteStaging(job);
  await finishEnrichedCompany(job);
}

// ---- shared persistence + handoff (mirrors the single-job handler) ----
async function persistResearchResult(db: V2JobDatabase, job: EnrichmentJob, company: CompanyRow, research: CompanyResearchResult): Promise<void> {
  const snapshotKey = buildResearchSnapshotIdempotencyKey(job.organizationId, company.id, job.researchVersion);
  const profileKey = buildIntelligenceProfileIdempotencyKey(job.organizationId, company.id, job.researchVersion);

  const snapshot = await insertResearchSnapshot(db, {
    organizationId: job.organizationId,
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
    researchVersion: job.researchVersion,
    idempotencyKey: snapshotKey,
  });

  await insertIntelligenceProfile(db, {
    organizationId: job.organizationId,
    companyId: company.id,
    canonicalDomain: research.canonicalDomain,
    sourceResearchSnapshotId: snapshot.id,
    companySummary: research.profile.companySummary,
    factsJson: research.profile.factsJson,
    evidenceItemsJson: research.profile.evidenceItemsJson,
    classificationJson: research.profile.classificationJson,
    sourceCoverageJson: research.profile.sourceCoverageJson,
    riskSignalsJson: research.profile.riskSignalsJson,
    confidenceJson: research.profile.confidenceJson,
    profileStatus: research.profile.profileStatus,
    staleAt: research.profile.staleAt,
    researchVersion: job.researchVersion,
    idempotencyKey: profileKey,
  });

  const industryCategory = deriveIndustryCategory(research.profile.factsJson);
  if (industryCategory) {
    await prisma.$executeRawUnsafe(
      `UPDATE "V2Company" SET "industryCategory"=$3,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "organizationId"=$2`,
      company.id,
      job.organizationId,
      industryCategory
    );
  }
}

/** A company enrichment reached a terminal profile. Batch progress always advances; scoring only follows explicit ingestion/lead-scoped pipelines. */
async function finishEnrichedCompany(job: EnrichmentJob): Promise<void> {
  if (job.runtimeRunId) {
    await incrementRunProgress(job.organizationId, job.runtimeRunId, { succeeded: 1 });
  }

  if (!shouldAutoScoreAfterEnrichment(job.sourceType ?? "MANUAL")) return;

  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT "id" FROM "V2LeadAssignment"
      WHERE "organizationId"=$1 AND "companyId"=$2 AND "status"='ACTIVE' AND "deletedAt" IS NULL
      ORDER BY "createdAt" ASC, "id" ASC`,
    job.organizationId,
    job.companyId
  );
  const leadAssignmentIds = rows.map((r) => r.id);
  if (leadAssignmentIds.length === 0) return;
  const db = prisma as unknown as V2JobDatabase;
  const run = await createScoringRun(db, {
    organizationId: job.organizationId,
    selection: { kind: "lead_assignment_ids", leadAssignmentIds },
    createdByUserId: job.createdByUserId ?? null,
  });
  await enqueueScoringExecution(db, { organizationId: job.organizationId, run, createdByUserId: job.createdByUserId ?? null });
}

function shouldAutoScoreAfterEnrichment(sourceType: string | null | undefined): boolean {
  return sourceType === "INGESTION_JOB" || sourceType === "LEAD_ASSIGNMENT";
}
// ---- staging checkpoint (fetch -> extract) ----
async function upsertStaging(job: EnrichmentJob, material: CompanyResearchMaterial): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "V2CompanyResearchStaging" ("id","organizationId","companyId","researchVersion","materialJson","createdAt")
     VALUES ($1,$2,$3,$4,$5::jsonb,CURRENT_TIMESTAMP)
     ON CONFLICT ("organizationId","companyId","researchVersion") DO UPDATE SET "materialJson"=EXCLUDED."materialJson","createdAt"=CURRENT_TIMESTAMP`,
    `crstg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    job.organizationId,
    job.companyId,
    job.researchVersion,
    JSON.stringify(material)
  );
}

async function readStaging(job: EnrichmentJob): Promise<CompanyResearchMaterial | null> {
  const rows = await prisma.$queryRawUnsafe<Array<{ materialJson: unknown }>>(
    `SELECT "materialJson" FROM "V2CompanyResearchStaging" WHERE "organizationId"=$1 AND "companyId"=$2 AND "researchVersion"=$3 LIMIT 1`,
    job.organizationId,
    job.companyId,
    job.researchVersion
  );
  return (rows[0]?.materialJson as CompanyResearchMaterial | undefined) ?? null;
}

async function deleteStaging(job: EnrichmentJob): Promise<void> {
  await prisma.$executeRawUnsafe(
    `DELETE FROM "V2CompanyResearchStaging" WHERE "organizationId"=$1 AND "companyId"=$2 AND "researchVersion"=$3`,
    job.organizationId,
    job.companyId,
    job.researchVersion
  );
}
