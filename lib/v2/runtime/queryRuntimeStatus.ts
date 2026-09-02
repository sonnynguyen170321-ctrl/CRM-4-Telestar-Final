import "server-only";

import { prisma } from "@/lib/server/prisma";
import type { RuntimeRun, RuntimeRunStatusView, RuntimeStatus } from "./types";

// Phase R (R1): tenant-scoped runtime status reads for the UI badge (Invariant 5).

type RunRow = {
  id: string; organizationId: string; projectId: string | null; icpVersionId: string | null;
  runType: string; status: string; totalUnits: number; processedUnits: number;
  succeededUnits: number; failedUnits: number; skippedUnits: number;
  startedAt: Date | null; finishedAt: Date | null; createdAt: Date;
};

function toRun(r: RunRow): RuntimeRun {
  return {
    id: r.id, organizationId: r.organizationId, projectId: r.projectId, icpVersionId: r.icpVersionId,
    runType: r.runType, status: r.status as RuntimeStatus,
    totalUnits: Number(r.totalUnits), processedUnits: Number(r.processedUnits),
    succeededUnits: Number(r.succeededUnits), failedUnits: Number(r.failedUnits), skippedUnits: Number(r.skippedUnits),
    startedAt: r.startedAt ? new Date(r.startedAt).toISOString() : null,
    finishedAt: r.finishedAt ? new Date(r.finishedAt).toISOString() : null,
    createdAt: new Date(r.createdAt).toISOString(),
  };
}

const RUN_COLS =
  `"id","organizationId","projectId","icpVersionId","runType","status","totalUnits",` +
  `"processedUnits","succeededUnits","failedUnits","skippedUnits","startedAt","finishedAt","createdAt"`;

async function chunkCounts(organizationId: string, runId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ total: number; queued: number; running: number; succeeded: number; failed: number }>>(
    `SELECT COUNT(*)::int AS "total",
            COUNT(*) FILTER (WHERE "status"='QUEUED')::int AS "queued",
            COUNT(*) FILTER (WHERE "status"='RUNNING')::int AS "running",
            COUNT(*) FILTER (WHERE "status"='SUCCEEDED')::int AS "succeeded",
            COUNT(*) FILTER (WHERE "status"='FAILED')::int AS "failed"
       FROM "V2RuntimeChunk" WHERE "organizationId"=$1 AND "runId"=$2`,
    organizationId,
    runId
  );
  const r = rows[0] ?? { total: 0, queued: 0, running: 0, succeeded: 0, failed: 0 };
  return { total: Number(r.total), queued: Number(r.queued), running: Number(r.running), succeeded: Number(r.succeeded), failed: Number(r.failed) };
}

function view(run: RuntimeRun, chunks: { total: number; queued: number; running: number; succeeded: number; failed: number }): RuntimeRunStatusView {
  const denom = run.totalUnits > 0 ? run.totalUnits : chunks.total;
  const num = run.totalUnits > 0 ? run.processedUnits : chunks.succeeded + chunks.failed;
  return { run, chunks, progressPercent: denom > 0 ? Math.min(100, Math.round((num / denom) * 100)) : 0 };
}

export async function queryRuntimeRun(organizationId: string, runId: string): Promise<RuntimeRunStatusView | null> {
  const rows = await prisma.$queryRawUnsafe<RunRow[]>(
    `SELECT ${RUN_COLS} FROM "V2RuntimeRun" WHERE "organizationId"=$1 AND "id"=$2 LIMIT 1`,
    organizationId,
    runId
  );
  if (!rows[0]) return null;
  const run = toRun(rows[0]);
  return view(run, await chunkCounts(organizationId, runId));
}

/** Latest run of a type (optionally scoped to project+ICP) — drives the page badge. */
export async function queryLatestRuntimeRun(
  organizationId: string,
  runType: string,
  scope?: { projectId?: string | null; icpVersionId?: string | null }
): Promise<RuntimeRunStatusView | null> {
  const where: string[] = [`"organizationId"=$1`, `"runType"=$2`];
  const params: unknown[] = [organizationId, runType];
  if (scope?.projectId) { params.push(scope.projectId); where.push(`"projectId"=$${params.length}`); }
  if (scope?.icpVersionId) { params.push(scope.icpVersionId); where.push(`"icpVersionId"=$${params.length}`); }
  const rows = await prisma.$queryRawUnsafe<RunRow[]>(
    `SELECT ${RUN_COLS} FROM "V2RuntimeRun" WHERE ${where.join(" AND ")} ORDER BY "createdAt" DESC LIMIT 1`,
    ...params
  );
  if (!rows[0]) return null;
  const run = toRun(rows[0]);
  return view(run, await chunkCounts(organizationId, run.id));
}
