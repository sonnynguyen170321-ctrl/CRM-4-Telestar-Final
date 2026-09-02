import "server-only";

import { prisma } from "@/lib/server/prisma";
import { addJob } from "../../bullmq/queues";
import { V2_QUEUE_NAMES } from "../../bullmq/queueNames";
import { refreshRunFromChunks } from "../../runtime/runtimeStore";
import { scoreScoringChunk } from "./scoreScoringChunk";
import type { V2ScoreRuntimeDatabase } from "./types";

// R3: BullMQ scoring fan-out. plan -> one chunk job per V2RuntimeChunk -> reduce.
// Pointer-only payloads (ids live in the run config / chunk rows, never in Redis).

export type ScoringPlanJob = { organizationId: string; runId: string };
export type ScoringChunkJob = { organizationId: string; runId: string; chunkIndex: number };
export type ScoringReduceJob = { organizationId: string; runId: string };

/** plan: fan one scoring.chunk job out per QUEUED chunk (jobId = dedupeKey => idempotent). */
export async function processScoringPlanJob(_db: V2ScoreRuntimeDatabase, job: ScoringPlanJob): Promise<{ enqueued: number }> {
  const chunks = await prisma.$queryRawUnsafe<Array<{ chunkIndex: number; dedupeKey: string }>>(
    `SELECT "chunkIndex","dedupeKey" FROM "V2RuntimeChunk"
      WHERE "organizationId"=$1 AND "runId"=$2 AND "status"='QUEUED' ORDER BY "chunkIndex" ASC`,
    job.organizationId,
    job.runId
  );
  for (const c of chunks) {
    await addJob(
      V2_QUEUE_NAMES.scoringChunk,
      "scoring.chunk",
      { organizationId: job.organizationId, runId: job.runId, chunkIndex: c.chunkIndex } satisfies ScoringChunkJob,
      { jobId: c.dedupeKey }
    );
  }
  return { enqueued: chunks.length };
}

/** chunk: score the slice; when the run has no more pending chunks, kick reduce. */
export async function processScoringChunkJob(db: V2ScoreRuntimeDatabase, job: ScoringChunkJob): Promise<void> {
  await scoreScoringChunk(db, { organizationId: job.organizationId, runId: job.runId, chunkIndex: job.chunkIndex, workerId: "bull" });

  const pending = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT COUNT(*)::int AS n FROM "V2RuntimeChunk"
      WHERE "organizationId"=$1 AND "runId"=$2 AND "status" IN ('QUEUED','RUNNING')`,
    job.organizationId,
    job.runId
  );
  if (Number(pending[0]?.n ?? 0) === 0) {
    await addJob(
      V2_QUEUE_NAMES.scoringReduce,
      "scoring.reduce",
      { organizationId: job.organizationId, runId: job.runId } satisfies ScoringReduceJob,
      { jobId: `${job.runId}:reduce` }
    );
  }
}

/** reduce: finalize the run rollup, then re-warm the org's read-model caches so the next
 *  leads-page load reflects the run without paying the cold facet recompute. Best-effort. */
export async function processScoringReduceJob(_db: V2ScoreRuntimeDatabase, job: ScoringReduceJob): Promise<void> {
  await refreshRunFromChunks(job.organizationId, job.runId);
  const { enqueueFacetRebuild } = await import("../../bullmq/facetCache");
  await enqueueFacetRebuild(job.organizationId);
}
