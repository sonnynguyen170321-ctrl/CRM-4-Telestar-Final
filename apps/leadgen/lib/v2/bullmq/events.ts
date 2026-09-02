import "server-only";

import { prisma } from "@/lib/server/prisma";
import {
  processResearchDiscoverJob,
  processResearchExtractJob,
  processResearchFetchJob,
  type EnrichmentJob,
} from "../company-intelligence/runtime/enrichmentProcessors";
import type { V2JobDatabase } from "../jobs/types";
import { incrementRunProgress, recordRuntimeHeartbeat } from "../runtime/runtimeStore";
import {
  processScoringChunkJob,
  processScoringPlanJob,
  processScoringReduceJob,
  type ScoringChunkJob,
  type ScoringPlanJob,
  type ScoringReduceJob,
} from "../scoring/runtime/bullScoringProcessors";
import type { V2ScoreRuntimeDatabase } from "../scoring/runtime/types";
import {
  markIngestionStageFailed,
  processIngestionStageJob,
} from "../ingestion/bullIngestionBridge";
import {
  markDurableJobFailed,
  processDurableV2Job,
} from "../jobs/bullDurableBridge";
import {
  ALL_V2_DURABLE_QUEUE_NAMES,
  ALL_V2_INGEST_QUEUE_NAMES,
  V2_QUEUE_NAMES,
} from "./queueNames";

// R3: the BullMQ worker handler registry. The runner (.mjs) creates one Worker per queue
// and dispatches job.data here. Handlers are self-contained (they use the prisma
// singleton + the runtime store), so the runner needs no db wiring. Pointer payloads
// only — ids live in Postgres (run config / chunk rows).

export type ScoringWorkerHandlers = {
  [V2_QUEUE_NAMES.scoringPlan]: (data: ScoringPlanJob) => Promise<unknown>;
  [V2_QUEUE_NAMES.scoringChunk]: (data: ScoringChunkJob) => Promise<unknown>;
  [V2_QUEUE_NAMES.scoringReduce]: (data: ScoringReduceJob) => Promise<unknown>;
};

export function makeScoringWorkerHandlers(): ScoringWorkerHandlers {
  const db = prisma as unknown as V2ScoreRuntimeDatabase;
  return {
    [V2_QUEUE_NAMES.scoringPlan]: (data) => processScoringPlanJob(db, data),
    [V2_QUEUE_NAMES.scoringChunk]: (data) => processScoringChunkJob(db, data),
    [V2_QUEUE_NAMES.scoringReduce]: (data) => processScoringReduceJob(db, data),
  };
}

export type EnrichmentWorkerHandlers = {
  [V2_QUEUE_NAMES.researchDiscover]: (data: EnrichmentJob) => Promise<unknown>;
  [V2_QUEUE_NAMES.researchFetch]: (data: EnrichmentJob) => Promise<unknown>;
  [V2_QUEUE_NAMES.researchExtract]: (data: EnrichmentJob) => Promise<unknown>;
};

export function makeEnrichmentWorkerHandlers(): EnrichmentWorkerHandlers {
  const db = prisma as unknown as V2JobDatabase;
  return {
    [V2_QUEUE_NAMES.researchDiscover]: (data) => processResearchDiscoverJob(db, data),
    [V2_QUEUE_NAMES.researchFetch]: (data) => processResearchFetchJob(db, data),
    [V2_QUEUE_NAMES.researchExtract]: (data) => processResearchExtractJob(db, data),
  };
}

/** Ingestion stage handlers: every `v2.ingest.*` queue shares one bridge handler that
 *  claims+runs the exact V2Job stage (org + ingestionJobId + jobType). */
export function makeIngestionWorkerHandlers(): Record<string, (data: unknown) => Promise<unknown>> {
  const handlers: Record<string, (data: unknown) => Promise<unknown>> = {};
  for (const queueName of ALL_V2_INGEST_QUEUE_NAMES) {
    handlers[queueName] = (data) => processIngestionStageJob(data);
  }
  return handlers;
}

/** Durable-job handlers: outreach sends, sequence steps, exports — one bridge handler that
 *  claims the next due V2Job of the pointer's type (same gates as the DB drain). */
export function makeDurableJobWorkerHandlers(): Record<string, (data: unknown) => Promise<unknown>> {
  const handlers: Record<string, (data: unknown) => Promise<unknown>> = {};
  for (const queueName of ALL_V2_DURABLE_QUEUE_NAMES) {
    handlers[queueName] = (data) => processDurableV2Job(data);
  }
  return handlers;
}

/** Readmodel refresh: re-warm the org's filter-independent cache keys (lead facets,
 *  enrollment options, campaign options, company filters/aggregates, and context options)
 *  after scoring/ingestion runs, so the first page
 *  load after a big run doesn't pay the cold recompute. Best-effort by design. */
export function makeReadmodelRefreshHandlers(): Record<string, (data: unknown) => Promise<unknown>> {
  return {
    [V2_QUEUE_NAMES.readmodelRefresh]: async (data: unknown) => {
      const payload = (data ?? {}) as { organizationId?: string };
      const organizationId = payload.organizationId;
      if (!organizationId) return { ok: false, reason: "missing organizationId" };

      const [
        { fetchLeadWorkspaceFilterOptions, getLeadContextOptions },
        { queryEnrollmentOptions },
        { queryCampaigns },
        { queryCompanyDirectoryFilterOptions },
        { queryCompanyDirectoryAggregates },
        { setFacetCache, FACET_CACHE_KEYS },
      ] = await Promise.all([
        import("../crm/queryLeadWorkspace"),
        import("../outreach/sequences/queryEnrollment"),
        import("../outreach/campaigns/queryCampaigns"),
        import("../company-intelligence/readModel"),
        import("../company-intelligence/companyDirectoryAggregates"),
        import("./facetCache"),
      ]);

      const [facets, enroll, campaigns, companyFilters, companyAggregates, contextOptions] = await Promise.all([
        fetchLeadWorkspaceFilterOptions({ organizationId }),
        queryEnrollmentOptions(organizationId),
        queryCampaigns(organizationId),
        queryCompanyDirectoryFilterOptions(organizationId),
        queryCompanyDirectoryAggregates(organizationId),
        getLeadContextOptions({ organizationId }),
      ]);
      await Promise.all([
        setFacetCache(FACET_CACHE_KEYS.leadFacets(organizationId), facets),
        setFacetCache(FACET_CACHE_KEYS.enrollOptions(organizationId), enroll),
        setFacetCache(FACET_CACHE_KEYS.campaignOptions(organizationId), campaigns),
        setFacetCache(FACET_CACHE_KEYS.companyFilterOptions(organizationId), companyFilters),
        setFacetCache(FACET_CACHE_KEYS.companyAggregates(organizationId), companyAggregates),
        setFacetCache(FACET_CACHE_KEYS.contextOptions(organizationId), contextOptions),
      ]);
      return { ok: true };
    },
  };
}

/** All BullMQ runtime handlers (scoring fan-out + enrichment pipeline + ingestion stages +
 *  durable outreach/export jobs + readmodel refresh). */
export function makeRuntimeWorkerHandlers(): Record<string, (data: never) => Promise<unknown>> {
  return {
    ...makeScoringWorkerHandlers(),
    ...makeEnrichmentWorkerHandlers(),
    ...makeIngestionWorkerHandlers(),
    ...makeDurableJobWorkerHandlers(),
    ...makeReadmodelRefreshHandlers(),
  } as Record<string, (data: never) => Promise<unknown>>;
}

/** Worker `failed` hook: when a research stage exhausts its retries for a company that
 *  belongs to a tracked ENRICHMENT run, count it as a failed unit so the run still
 *  reaches 100% (PARTIAL) instead of hanging below total forever. One terminal failure
 *  per company (it dies at exactly one stage), so this counts each failed company once. */
export async function handleJobFailure(
  queueName: string,
  data: unknown,
  attemptsMade: number,
  maxAttempts: number
): Promise<void> {
  if (attemptsMade < maxAttempts) return;

  // Ingestion stages: on terminal BullMQ failure, force the stage V2Job FAILED so it
  // never sits RETRY_SCHEDULED with no trigger left to re-run it (the pipeline stops
  // cleanly and the ingestion detail UI shows the failed stage).
  if (queueName.startsWith("v2.ingest.")) {
    await markIngestionStageFailed(data);
    return;
  }

  // Durable outreach/export jobs: force the specific V2Job FAILED so a send/export never
  // sits pending forever after Bull retries are exhausted.
  if (queueName.startsWith("v2.outreach.") || queueName.startsWith("v2.export.")) {
    await markDurableJobFailed(data);
    return;
  }

  if (!queueName.startsWith("v2.research.")) return;
  const d = data as { organizationId?: string; runtimeRunId?: string | null };
  if (!d?.organizationId || !d?.runtimeRunId) return;
  await incrementRunProgress(d.organizationId, d.runtimeRunId, { failed: 1 });
}

export { recordRuntimeHeartbeat };
