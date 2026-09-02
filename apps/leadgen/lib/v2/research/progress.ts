import "server-only";

import { prisma } from "@/lib/server/prisma";
import { resolveUsableProviderChain } from "@telestar/core-search/search/env";
import type { V2JobDatabase } from "@/lib/v2/jobs/types";
import { enqueueResearchBatchJob } from "./runResearchDiscovery";
import { queryResearchRuntimeBridge } from "./researchRuntimeBridge";

export type ResearchProgressPayload = {
  ok: true;
  runId: string;
  status: string;
  kind: string;
  cursor: number;
  totalQueries: number;
  percent: number;
  providerConfigured: boolean;
  runtime: {
    source: "legacy_v2job" | "hybrid";
    runId: string | null;
    status: string | null;
    chunks: { total: number; queued: number; running: number; succeeded: number; failed: number };
    stages: Array<{ stageType: string; status: string; totalUnits: number; processedUnits: number; failedUnits: number }>;
  };
  jobs: { queued: number; running: number; failed: number; succeeded: number };
  candidates: { discovered: number; duplicate: number; promoted: number; dismissed: number; total: number };
  errorMessage: string | null;
  nextAction: { kind: "configure_provider" | "provider_error" | "process" | "review" | "open_leads" | "complete" | "failed"; label: string; detail: string };
};

type RunRow = {
  id: string;
  kind: string;
  status: string;
  queriesJson: unknown;
  queryCursor: number;
  errorMessage: string | null;
  createdByUserId: string | null;
};

type CountRow = { key: string; count: bigint };

export async function getResearchRunProgress(
  organizationId: string,
  runId: string
): Promise<ResearchProgressPayload | null> {
  const runRows = await prisma.$queryRaw<RunRow[]>`
    SELECT "id", "kind"::text AS "kind", "status"::text AS "status", "queriesJson",
      "queryCursor", "errorMessage", "createdByUserId"
    FROM "V2ResearchRun"
    WHERE "organizationId" = ${organizationId} AND "id" = ${runId} AND "deletedAt" IS NULL
    LIMIT 1
  `;
  const run = runRows[0];
  if (!run) return null;

  const [candidateRows, jobRows, runtimeBridge] = await Promise.all([
    prisma.$queryRaw<CountRow[]>`
      SELECT "status"::text AS "key", COUNT(*) AS "count"
      FROM "V2ResearchCandidate"
      WHERE "organizationId" = ${organizationId} AND "runId" = ${runId} AND "deletedAt" IS NULL
      GROUP BY "status"
    `,
    prisma.$queryRaw<CountRow[]>`
      SELECT "status"::text AS "key", COUNT(*) AS "count"
      FROM "V2Job"
      WHERE "organizationId" = ${organizationId}
        AND "sourceType" = 'MANUAL'
        AND "sourceId" = ${runId}
        AND "jobType" IN ('RESEARCH_DISCOVERY', 'RESEARCH_ENRICH')
      GROUP BY "status"
    `,
    queryResearchRuntimeBridge(organizationId, runId),
  ]);

  const candidateCount = (key: string) => Number(candidateRows.find((row) => row.key === key)?.count ?? 0);
  const jobCount = (key: string) => Number(jobRows.find((row) => row.key === key)?.count ?? 0);
  const totalQueries = Array.isArray(run.queriesJson) ? run.queriesJson.length : 0;
  const cursor = Math.max(0, Math.min(Number(run.queryCursor) || 0, totalQueries));
  const providerConfigured = resolveUsableProviderChain(process.env).length > 0;
  const jobs = {
    queued: jobCount("QUEUED") + jobCount("RETRY_SCHEDULED"),
    running: jobCount("RUNNING"),
    failed: jobCount("FAILED"),
    succeeded: jobCount("SUCCEEDED"),
  };
  const candidates = {
    discovered: candidateCount("DISCOVERED"),
    duplicate: candidateCount("DUPLICATE"),
    promoted: candidateCount("PROMOTED"),
    dismissed: candidateCount("DISMISSED"),
    total: candidateRows.reduce((sum, row) => sum + Number(row.count), 0),
  };
  const percent = totalQueries > 0 ? Math.round((cursor / totalQueries) * 100) : 0;

  return {
    ok: true,
    runId,
    status: run.status,
    kind: run.kind,
    cursor,
    totalQueries,
    percent,
    providerConfigured,
    runtime: runtimeBridge
      ? {
          source: "hybrid",
          runId: runtimeBridge.run.id,
          status: runtimeBridge.run.status,
          chunks: runtimeBridge.chunks,
          stages: runtimeBridge.stages.map((stage) => ({
            stageType: stage.stageType,
            status: stage.status,
            totalUnits: stage.totalUnits,
            processedUnits: stage.processedUnits,
            failedUnits: stage.failedUnits,
          })),
        }
      : {
          source: "legacy_v2job",
          runId: null,
          status: null,
          chunks: { total: 0, queued: 0, running: 0, succeeded: 0, failed: 0 },
          stages: [],
        },
    jobs,
    candidates,
    errorMessage: run.errorMessage,
    nextAction: deriveNextAction({ status: run.status, providerConfigured, jobs, candidates, cursor, totalQueries, errorMessage: run.errorMessage }),
  };
}

export async function ensureResearchRunHasQueuedBatch(organizationId: string, runId: string) {
  const progress = await getResearchRunProgress(organizationId, runId);
  if (!progress || progress.status === "SUCCEEDED" || progress.cursor >= progress.totalQueries) return progress;
  if (progress.jobs.queued > 0 || progress.jobs.running > 0) return progress;

  const rows = await prisma.$queryRaw<Array<{ createdByUserId: string | null }>>`
    SELECT "createdByUserId"
    FROM "V2ResearchRun"
    WHERE "organizationId" = ${organizationId} AND "id" = ${runId} AND "deletedAt" IS NULL
    LIMIT 1
  `;
  await enqueueResearchBatchJob(prisma as unknown as V2JobDatabase, {
    organizationId,
    runId,
    cursor: progress.cursor,
    createdByUserId: rows[0]?.createdByUserId ?? null,
  });
  return getResearchRunProgress(organizationId, runId);
}

function deriveNextAction(input: {
  status: string;
  providerConfigured: boolean;
  jobs: ResearchProgressPayload["jobs"];
  candidates: ResearchProgressPayload["candidates"];
  cursor: number;
  totalQueries: number;
  errorMessage: string | null;
}): ResearchProgressPayload["nextAction"] {
  if (!input.providerConfigured) {
    return { kind: "configure_provider", label: "Configure provider", detail: "Add an EXA, Brave, or Serper key before live prospect discovery." };
  }
  // Keys are present but every provider rejected the queries (dead key / no credits / rate limit).
  // The run finished with no candidates AND a recorded provider error — surface it, don't fake "complete".
  if (input.errorMessage && input.candidates.total === 0 && input.jobs.queued === 0 && input.jobs.running === 0) {
    return { kind: "provider_error", label: "Search provider rejected", detail: input.errorMessage };
  }
  if (input.status === "FAILED" || input.jobs.failed > 0) {
    return { kind: "failed", label: "Inspect failed run", detail: "A discovery batch failed. Review the error, then retry processing." };
  }
  if (input.jobs.running > 0 || input.jobs.queued > 0 || input.cursor < input.totalQueries) {
    return { kind: "process", label: "Process next batch", detail: "Drain this run only; other research runs stay untouched." };
  }
  if (input.candidates.discovered + input.candidates.duplicate > 0) {
    return { kind: "review", label: "Review candidates", detail: "Promote good-fit prospects or dismiss noisy matches." };
  }
  if (input.candidates.promoted > 0) {
    return { kind: "open_leads", label: "Open leads", detail: "Promoted prospects are now in the lead workspace." };
  }
  return { kind: "complete", label: "Run complete", detail: "No reviewable candidates remain for this run." };
}
