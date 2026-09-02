import "server-only";

import { prisma } from "@/lib/server/prisma";
import { isBullEnabled } from "../../bullmq/config";
import { V2_QUEUE_NAMES } from "../../bullmq/queueNames";
import { addJob } from "../../bullmq/queues";

// P6: user-initiated retry of a scoring run's FAILED chunks. Clean on the BullMQ path:
// reset FAILED chunks -> QUEUED, put the run back RUNNING, and re-fan via scoring.plan
// (which enqueues one chunk job per QUEUED chunk = exactly the reset failures). The
// db-poll path is intentionally NOT retried here: the R2 runtime hook marks chunkIndex
// relative to the JOB's batch order, so a failed-SUBSET re-enqueue would misalign the
// mirror. Retry therefore requires the bull worker (the env this ships in runs one).
// Org-scoped (Invariant 5); idempotent re-fan (Invariant 6 — plan dedupes per chunk).

export type RetryMode = "bull" | "none" | "unavailable";
export type RetryScoringResult = { mode: RetryMode; reFanned: number };

/** Pure: decide what a retry can do given the failed-chunk count + whether BullMQ is on.
 *  none = nothing failed; unavailable = failures exist but no bull worker to re-fan. */
export function decideRetryMode(input: { failedCount: number; bullEnabled: boolean }): RetryMode {
  if (input.failedCount <= 0) return "none";
  if (!input.bullEnabled) return "unavailable";
  return "bull";
}

export async function retryScoringRunFailures(
  organizationId: string,
  runId: string
): Promise<RetryScoringResult> {
  const failedRows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT COUNT(*)::int AS n FROM "V2RuntimeChunk"
       WHERE "organizationId"=$1 AND "runId"=$2 AND "status"='FAILED'`,
    organizationId,
    runId
  );
  const failedCount = Number(failedRows[0]?.n ?? 0);
  const mode = decideRetryMode({ failedCount, bullEnabled: isBullEnabled() });
  if (mode !== "bull") return { mode, reFanned: 0 };

  // Reset FAILED -> QUEUED (clear the terminal fields; keep attemptCount as the retry
  // ceiling signal so a chunk that keeps dying is still visible as having been tried).
  await prisma.$executeRawUnsafe(
    `UPDATE "V2RuntimeChunk"
       SET "status"='QUEUED',"errorCode"=NULL,"errorJson"=NULL,"finishedAt"=NULL,"updatedAt"=CURRENT_TIMESTAMP
     WHERE "organizationId"=$1 AND "runId"=$2 AND "status"='FAILED'`,
    organizationId,
    runId
  );
  // Run back to RUNNING (clear finishedAt) so the mirror reads in-flight again.
  await prisma.$executeRawUnsafe(
    `UPDATE "V2RuntimeRun"
       SET "status"='RUNNING',"finishedAt"=NULL,"updatedAt"=CURRENT_TIMESTAMP
     WHERE "organizationId"=$1 AND "id"=$2`,
    organizationId,
    runId
  );
  // Re-fan: scoring.plan enqueues one chunk job per QUEUED chunk (= the reset failures).
  // Fresh jobId so a previously-completed plan job doesn't dedupe this retry.
  await addJob(
    V2_QUEUE_NAMES.scoringPlan,
    "scoring.plan",
    { organizationId, runId },
    { jobId: `${runId}:plan:retry:${Date.now()}` }
  );
  return { mode: "bull", reFanned: failedCount };
}
