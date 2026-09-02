import "server-only";

import { isBullEnabled } from "../../bullmq/config";
import { V2_QUEUE_NAMES } from "../../bullmq/queueNames";
import { addJob } from "../../bullmq/queues";
import { finalizeRun } from "../../runtime/runtimeStore";
import type { CreateScoringRunResult } from "./createScoringRun";
import { enqueueIcpScoreJob } from "./enqueueScoringJobs";
import type { V2ScoreRuntimeDatabase } from "./types";

// R3: one place that decides HOW a planned scoring run executes.
//   - BullMQ enabled + live scoring worker -> enqueue a scoring.plan job.
//   - BullMQ disabled/unhealthy/failing     -> enqueue the ICP_SCORE V2Job fallback.
// Either way the UI polls the same V2RuntimeRun mirror.

export type ScoringExecutionMode = "bull" | "db" | "empty";
export type ScoringExecutionReason =
  | "bull_worker_healthy"
  | "bull_worker_unhealthy"
  | "bull_enqueue_failed"
  | "bull_disabled"
  | "empty_run";

export type ScoringExecutionResult = {
  mode: ScoringExecutionMode;
  reason: ScoringExecutionReason;
  workerHealthy: boolean;
  jobCreated: boolean;
  jobId: string | null;
  bullJobId: string | null;
};

export async function enqueueScoringExecution(
  db: V2ScoreRuntimeDatabase,
  input: { organizationId: string; run: CreateScoringRunResult; createdByUserId?: string | null }
): Promise<ScoringExecutionResult> {
  const { organizationId, run } = input;
  if (run.total === 0) {
    return { mode: "empty", reason: "empty_run", workerHealthy: false, jobCreated: false, jobId: null, bullJobId: null };
  }

  if (isBullEnabled()) {
    const workerHealthy = await queryScoringWorkerHealthy(db);
    if (workerHealthy) {
      try {
        const bullJobId = `${run.runId}:plan`;
        await addJob(
          V2_QUEUE_NAMES.scoringPlan,
          "scoring.plan",
          { organizationId, runId: run.runId },
          { jobId: bullJobId }
        );
        return { mode: "bull", reason: "bull_worker_healthy", workerHealthy, jobCreated: true, jobId: null, bullJobId };
      } catch {
        return enqueueDbFallback(db, input, "bull_enqueue_failed", workerHealthy);
      }
    }
    return enqueueDbFallback(db, input, "bull_worker_unhealthy", workerHealthy);
  }

  return enqueueDbFallback(db, input, "bull_disabled", false);
}

async function enqueueDbFallback(
  db: V2ScoreRuntimeDatabase,
  input: { organizationId: string; run: CreateScoringRunResult; createdByUserId?: string | null },
  reason: ScoringExecutionReason,
  workerHealthy: boolean
): Promise<ScoringExecutionResult> {
  const { organizationId, run } = input;
  const enqueued = await enqueueIcpScoreJob(db, {
    organizationId,
    selection: run.frozenSelection,
    batchSize: run.batchSize,
    runtimeRunId: run.runId,
    createdByUserId: input.createdByUserId ?? null,
  });
  // With runtimeRunId this should normally be created; if an idempotent edge reuses an
  // existing job, finalize so the UI does not hang on a run nobody will advance.
  if (enqueued.kind !== "created") {
    await finalizeRun(organizationId, run.runId, "SUCCEEDED");
  }
  return {
    mode: "db",
    reason,
    workerHealthy,
    jobCreated: enqueued.kind === "created",
    jobId: enqueued.kind === "conflict" ? enqueued.existingJob.id : enqueued.job.id,
    bullJobId: null,
  };
}

async function queryScoringWorkerHealthy(db: V2ScoreRuntimeDatabase): Promise<boolean> {
  const raw = db as unknown as {
    $queryRawUnsafe?: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
  };
  if (!raw.$queryRawUnsafe) return false;
  try {
    const rows = await raw.$queryRawUnsafe<Array<{ healthy: boolean }>>(
      `SELECT EXISTS (
         SELECT 1
           FROM "V2RuntimeWorkerHeartbeat"
          WHERE "status" = 'ONLINE'
            AND "queueName" IN ($1, $2)
            AND "lastBeatAt" >= (CURRENT_TIMESTAMP - INTERVAL '90 seconds')
       ) AS "healthy"`,
      "v2.scoring",
      V2_QUEUE_NAMES.scoringPlan
    );
    return Boolean(rows[0]?.healthy);
  } catch {
    return false;
  }
}
