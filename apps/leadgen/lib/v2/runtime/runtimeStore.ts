import "server-only";

import { prisma } from "@/lib/server/prisma";
import type { RuntimeChunkInput, RuntimeStatus } from "./types";

// Phase R (R1): the runtime mirror writer. Every BullMQ unit of work has a Postgres
// row here so the UI/audit reads truth from Postgres, not Redis (Invariant 5: every
// write is org-scoped). Chunk creation is idempotent on (organizationId, dedupeKey).

function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function createRuntimeRun(input: {
  organizationId: string;
  runType: string;
  projectId?: string | null;
  icpVersionId?: string | null;
  totalUnits?: number;
  priority?: number;
  createdByUserId?: string | null;
  configJson?: unknown;
}): Promise<string> {
  const runId = id("rrun");
  await prisma.$executeRawUnsafe(
    `INSERT INTO "V2RuntimeRun"
       ("id","organizationId","projectId","icpVersionId","runType","status","priority",
        "totalUnits","configJson","createdByUserId","startedAt","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,'RUNNING',$6,$7,$8::jsonb,$9,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    runId,
    input.organizationId,
    input.projectId ?? null,
    input.icpVersionId ?? null,
    input.runType,
    input.priority ?? 0,
    input.totalUnits ?? 0,
    input.configJson != null ? JSON.stringify(input.configJson) : null,
    input.createdByUserId ?? null
  );
  return runId;
}

export async function createRuntimeStage(input: {
  organizationId: string;
  runId: string;
  stageType: string;
  totalUnits?: number;
}): Promise<string> {
  const stageId = id("rstg");
  await prisma.$executeRawUnsafe(
    `INSERT INTO "V2RuntimeStage"
       ("id","organizationId","runId","stageType","status","totalUnits","startedAt","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,'RUNNING',$5,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    stageId,
    input.organizationId,
    input.runId,
    input.stageType,
    input.totalUnits ?? 0
  );
  return stageId;
}

/** Idempotent bulk insert of chunk rows (dedupeKey dedupes re-plans). Returns chunk ids
 *  keyed by dedupeKey (existing rows included, so a re-run reuses them). */
export async function createRuntimeChunks(input: {
  organizationId: string;
  runId: string;
  stageId: string;
  chunkType: string;
  maxAttempts?: number;
  chunks: RuntimeChunkInput[];
}): Promise<Map<string, string>> {
  for (const c of input.chunks) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "V2RuntimeChunk"
         ("id","organizationId","runId","stageId","chunkIndex","chunkType","status","dedupeKey",
          "cursorStart","cursorEnd","unitCount","maxAttempts","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,'QUEUED',$7,$8,$9,$10,$11,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
       ON CONFLICT ("organizationId","dedupeKey") DO NOTHING`,
      id("rchk"),
      input.organizationId,
      input.runId,
      input.stageId,
      c.chunkIndex,
      input.chunkType,
      c.dedupeKey,
      c.cursorStart ?? null,
      c.cursorEnd ?? null,
      c.unitCount,
      input.maxAttempts ?? 3
    );
  }
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; dedupeKey: string }>>(
    `SELECT "id","dedupeKey" FROM "V2RuntimeChunk" WHERE "organizationId"=$1 AND "runId"=$2`,
    input.organizationId,
    input.runId
  );
  return new Map(rows.map((r) => [r.dedupeKey, r.id]));
}

export async function mirrorBullJobId(organizationId: string, chunkId: string, bullJobId: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE "V2RuntimeChunk" SET "bullJobId"=$3,"updatedAt"=CURRENT_TIMESTAMP WHERE "organizationId"=$1 AND "id"=$2`,
    organizationId,
    chunkId,
    bullJobId
  );
}

export async function markChunkRunning(organizationId: string, chunkId: string, workerId: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE "V2RuntimeChunk"
       SET "status"='RUNNING',"workerId"=$3,"attemptCount"="attemptCount"+1,"startedAt"=COALESCE("startedAt",CURRENT_TIMESTAMP),"updatedAt"=CURRENT_TIMESTAMP
     WHERE "organizationId"=$1 AND "id"=$2`,
    organizationId,
    chunkId,
    workerId
  );
}

export async function markChunkSucceeded(organizationId: string, chunkId: string, processedUnits: number): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE "V2RuntimeChunk"
       SET "status"='SUCCEEDED',"processedUnits"=$3,"errorCode"=NULL,"finishedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP
     WHERE "organizationId"=$1 AND "id"=$2`,
    organizationId,
    chunkId,
    processedUnits
  );
}

export async function markChunkFailed(organizationId: string, chunkId: string, errorCode: string, errorJson?: unknown): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE "V2RuntimeChunk"
       SET "status"='FAILED',"errorCode"=$3,"errorJson"=$4::jsonb,"finishedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP
     WHERE "organizationId"=$1 AND "id"=$2`,
    organizationId,
    chunkId,
    errorCode,
    errorJson != null ? JSON.stringify(errorJson) : null
  );
}

/** Recompute run counters + terminal status from its chunk rollup. Call after each
 *  chunk finishes (cheap; the run row is the single status the UI polls). */
export async function refreshRunFromChunks(organizationId: string, runId: string): Promise<RuntimeStatus> {
  const rows = await prisma.$queryRawUnsafe<Array<{
    total: number; succeeded: number; failed: number; running: number; queued: number; processed: number;
  }>>(
    `SELECT COUNT(*)::int AS "total",
            COUNT(*) FILTER (WHERE "status"='SUCCEEDED')::int AS "succeeded",
            COUNT(*) FILTER (WHERE "status"='FAILED')::int AS "failed",
            COUNT(*) FILTER (WHERE "status"='RUNNING')::int AS "running",
            COUNT(*) FILTER (WHERE "status"='QUEUED')::int AS "queued",
            COALESCE(SUM("processedUnits"),0)::int AS "processed"
       FROM "V2RuntimeChunk" WHERE "organizationId"=$1 AND "runId"=$2`,
    organizationId,
    runId
  );
  const c = rows[0] ?? { total: 0, succeeded: 0, failed: 0, running: 0, queued: 0, processed: 0 };
  const done = c.succeeded + c.failed;
  const status: RuntimeStatus =
    c.total === 0 ? "QUEUED"
    : done < c.total ? "RUNNING"
    : c.failed === 0 ? "SUCCEEDED"
    : c.succeeded === 0 ? "FAILED"
    : "PARTIAL";
  const finished = done >= c.total && c.total > 0;
  await prisma.$executeRawUnsafe(
    `UPDATE "V2RuntimeRun"
       SET "status"=$3,"processedUnits"=$4,"succeededUnits"=$5,"failedUnits"=$6,
           "finishedAt"=CASE WHEN $7 THEN CURRENT_TIMESTAMP ELSE "finishedAt" END,"updatedAt"=CURRENT_TIMESTAMP
     WHERE "organizationId"=$1 AND "id"=$2`,
    organizationId,
    runId,
    status,
    c.processed,
    c.succeeded,
    c.failed,
    finished
  );
  return status;
}

/** Address a chunk by (runId, chunkIndex) — the scoring handler marks per batch this
 *  way without holding chunk ids. status drives the run rollup. */
export async function setChunkStatusByIndex(
  organizationId: string,
  runId: string,
  chunkIndex: number,
  status: "RUNNING" | "SUCCEEDED" | "FAILED",
  opts?: { processedUnits?: number; workerId?: string; errorCode?: string }
): Promise<void> {
  const running = status === "RUNNING";
  const terminal = status === "SUCCEEDED" || status === "FAILED";
  await prisma.$executeRawUnsafe(
    `UPDATE "V2RuntimeChunk" SET
       "status"=$4,
       "workerId"=COALESCE($5,"workerId"),
       "attemptCount"="attemptCount"+CASE WHEN $6 THEN 1 ELSE 0 END,
       "processedUnits"=COALESCE($7,"processedUnits"),
       "errorCode"=$8,
       "startedAt"=CASE WHEN $6 THEN COALESCE("startedAt",CURRENT_TIMESTAMP) ELSE "startedAt" END,
       "finishedAt"=CASE WHEN $9 THEN CURRENT_TIMESTAMP ELSE "finishedAt" END,
       "updatedAt"=CURRENT_TIMESTAMP
     WHERE "organizationId"=$1 AND "runId"=$2 AND "chunkIndex"=$3`,
    organizationId,
    runId,
    chunkIndex,
    status,
    opts?.workerId ?? null,
    running,
    opts?.processedUnits ?? null,
    opts?.errorCode ?? null,
    terminal
  );
}

/** Force a run's terminal status directly (e.g. an idempotent re-run that reused an
 *  already-completed job, so no worker will drive the chunks). */
export async function finalizeRun(
  organizationId: string,
  runId: string,
  status: "SUCCEEDED" | "FAILED" | "CANCELLED"
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE "V2RuntimeRun"
       SET "status"=$3,"finishedAt"=COALESCE("finishedAt",CURRENT_TIMESTAMP),"updatedAt"=CURRENT_TIMESTAMP
     WHERE "organizationId"=$1 AND "id"=$2`,
    organizationId,
    runId,
    status
  );
}

/** Atomically bump a run's completion counters (one call per finished unit) and flip the
 *  run terminal once processed >= total. Used by the enrichment batch (no chunks): each
 *  company that finishes increments by one; the run is SUCCEEDED when all land (PARTIAL
 *  if any failed). */
export async function incrementRunProgress(
  organizationId: string,
  runId: string,
  delta: { succeeded?: number; failed?: number }
): Promise<void> {
  const succeeded = Math.max(0, delta.succeeded ?? 0);
  const failed = Math.max(0, delta.failed ?? 0);
  if (succeeded + failed === 0) return;
  await prisma.$executeRawUnsafe(
    `UPDATE "V2RuntimeRun" SET
       "processedUnits" = "processedUnits" + $3,
       "succeededUnits" = "succeededUnits" + $4,
       "failedUnits" = "failedUnits" + $5,
       "status" = CASE
         WHEN "totalUnits" > 0 AND "processedUnits" + $3 >= "totalUnits"
           THEN (CASE WHEN "failedUnits" + $5 > 0 THEN 'PARTIAL' ELSE 'SUCCEEDED' END)
         ELSE 'RUNNING' END,
       "finishedAt" = CASE
         WHEN "totalUnits" > 0 AND "processedUnits" + $3 >= "totalUnits" THEN CURRENT_TIMESTAMP
         ELSE "finishedAt" END,
       "updatedAt" = CURRENT_TIMESTAMP
     WHERE "organizationId" = $1 AND "id" = $2`,
    organizationId,
    runId,
    succeeded + failed,
    succeeded,
    failed
  );
}

export async function recordRuntimeHeartbeat(input: {
  workerId: string;
  queueName: string;
  status?: string;
  organizationId?: string | null;
  host?: string | null;
  pid?: number | null;
  currentJobId?: string | null;
}): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "V2RuntimeWorkerHeartbeat"
       ("id","workerId","organizationId","queueName","status","host","pid","currentJobId","lastBeatAt","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
     ON CONFLICT ("workerId") DO UPDATE SET
       "queueName"=EXCLUDED."queueName","status"=EXCLUDED."status","host"=EXCLUDED."host",
       "pid"=EXCLUDED."pid","currentJobId"=EXCLUDED."currentJobId","lastBeatAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP`,
    id("rwhb"),
    input.workerId,
    input.organizationId ?? null,
    input.queueName,
    input.status ?? "ONLINE",
    input.host ?? null,
    input.pid ?? null,
    input.currentJobId ?? null
  );
}
