import "server-only";

import { prisma } from "@/lib/server/prisma";
import {
  createRuntimeChunks,
  createRuntimeRun,
  createRuntimeStage,
  refreshRunFromChunks,
  setChunkStatusByIndex,
} from "@/lib/v2/runtime/runtimeStore";
import type { RuntimeRunStatusView } from "@/lib/v2/runtime/types";

const RESEARCH_RUNTIME_TYPE = "RESEARCH";

export const RESEARCH_RUNTIME_STAGES = [
  "research.discovery",
  "research.company_enrich",
  "research.people_discover",
  "research.contact_enrich",
  "research.review_ready",
  "research.promote",
] as const;

export type ResearchRuntimeStageType = (typeof RESEARCH_RUNTIME_STAGES)[number];

type RuntimeRunRow = {
  id: string;
  status: string;
  totalUnits: number;
  processedUnits: number;
  succeededUnits: number;
  failedUnits: number;
  skippedUnits: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
};

type RuntimeStageRow = {
  id: string;
  stageType: string;
  status: string;
  totalUnits: number;
  processedUnits: number;
  failedUnits: number;
};

type RuntimeChunkCounts = {
  total: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
};

export type ResearchRuntimeBridgeView = RuntimeRunStatusView & {
  stages: Array<{
    id: string;
    stageType: string;
    status: string;
    totalUnits: number;
    processedUnits: number;
    failedUnits: number;
  }>;
};

export async function planResearchRuntime(input: {
  organizationId: string;
  researchRunId: string;
  projectId: string | null;
  icpVersionId: string | null;
  kind: "COMPANY" | "CONTACT";
  queryCount: number;
  batchSize: number;
  createdByUserId?: string | null;
}): Promise<string> {
  const existing = await queryResearchRuntimeRunId(input.organizationId, input.researchRunId);
  if (existing) return existing;

  const runtimeRunId = await createRuntimeRun({
    organizationId: input.organizationId,
    projectId: input.projectId,
    icpVersionId: input.icpVersionId,
    runType: RESEARCH_RUNTIME_TYPE,
    totalUnits: input.queryCount,
    createdByUserId: input.createdByUserId ?? null,
    configJson: {
      bridge: "v2research",
      researchRunId: input.researchRunId,
      kind: input.kind,
      queryCount: input.queryCount,
      batchSize: input.batchSize,
      stagePlan: RESEARCH_RUNTIME_STAGES,
    },
  });

  const stageIds = new Map<ResearchRuntimeStageType, string>();
  for (const stageType of RESEARCH_RUNTIME_STAGES) {
    const stageId = await createRuntimeStage({
      organizationId: input.organizationId,
      runId: runtimeRunId,
      stageType,
      totalUnits: stageType === "research.discovery" ? input.queryCount : 0,
    });
    stageIds.set(stageType, stageId);
  }

  const discoveryStageId = stageIds.get("research.discovery");
  if (discoveryStageId) {
    await createRuntimeChunks({
      organizationId: input.organizationId,
      runId: runtimeRunId,
      stageId: discoveryStageId,
      chunkType: "research.discovery.batch",
      chunks: buildResearchDiscoveryChunks({
        researchRunId: input.researchRunId,
        queryCount: input.queryCount,
        batchSize: input.batchSize,
      }),
    });
  }

  return runtimeRunId;
}

export function buildResearchDiscoveryChunks(input: {
  researchRunId: string;
  queryCount: number;
  batchSize: number;
}) {
  const batchSize = Math.max(1, input.batchSize);
  const chunks = [];
  for (let cursor = 0; cursor < input.queryCount; cursor += batchSize) {
    const end = Math.min(cursor + batchSize, input.queryCount);
    chunks.push({
      chunkIndex: cursor,
      dedupeKey: `research-runtime:${input.researchRunId}:discovery:${cursor}`,
      cursorStart: String(cursor),
      cursorEnd: String(end),
      unitCount: end - cursor,
    });
  }
  return chunks;
}

export async function markResearchDiscoveryChunk(
  organizationId: string,
  researchRunId: string,
  cursor: number,
  status: "RUNNING" | "SUCCEEDED" | "FAILED",
  opts?: { processedUnits?: number; errorCode?: string }
): Promise<void> {
  const runtimeRunId = await queryResearchRuntimeRunId(organizationId, researchRunId);
  if (!runtimeRunId) return;
  await setChunkStatusByIndex(organizationId, runtimeRunId, cursor, status, opts);
  await refreshRunFromChunks(organizationId, runtimeRunId);
}

export async function queryResearchRuntimeBridge(
  organizationId: string,
  researchRunId: string
): Promise<ResearchRuntimeBridgeView | null> {
  const runRows = await prisma.$queryRaw<RuntimeRunRow[]>`
    SELECT "id", "status", "totalUnits", "processedUnits", "succeededUnits", "failedUnits",
      "skippedUnits", "startedAt", "finishedAt", "createdAt"
    FROM "V2RuntimeRun"
    WHERE "organizationId" = ${organizationId}
      AND "runType" = ${RESEARCH_RUNTIME_TYPE}
      AND "configJson"->>'researchRunId' = ${researchRunId}
    ORDER BY "createdAt" DESC
    LIMIT 1
  `;
  const run = runRows[0];
  if (!run) return null;

  const [chunkRows, stageRows] = await Promise.all([
    prisma.$queryRaw<RuntimeChunkCounts[]>`
      SELECT COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE "status"='QUEUED')::int AS "queued",
        COUNT(*) FILTER (WHERE "status"='RUNNING')::int AS "running",
        COUNT(*) FILTER (WHERE "status"='SUCCEEDED')::int AS "succeeded",
        COUNT(*) FILTER (WHERE "status"='FAILED')::int AS "failed"
      FROM "V2RuntimeChunk"
      WHERE "organizationId" = ${organizationId} AND "runId" = ${run.id}
    `,
    prisma.$queryRaw<RuntimeStageRow[]>`
      SELECT "id", "stageType", "status", "totalUnits", "processedUnits", "failedUnits"
      FROM "V2RuntimeStage"
      WHERE "organizationId" = ${organizationId} AND "runId" = ${run.id}
      ORDER BY "createdAt" ASC
    `,
  ]);

  const chunks = chunkRows[0] ?? { total: 0, queued: 0, running: 0, succeeded: 0, failed: 0 };
  const denom = Number(run.totalUnits) > 0 ? Number(run.totalUnits) : Number(chunks.total);
  const num = Number(run.totalUnits) > 0 ? Number(run.processedUnits) : Number(chunks.succeeded) + Number(chunks.failed);

  return {
    run: {
      id: run.id,
      organizationId,
      projectId: null,
      icpVersionId: null,
      runType: RESEARCH_RUNTIME_TYPE,
      status: run.status as RuntimeRunStatusView["run"]["status"],
      totalUnits: Number(run.totalUnits),
      processedUnits: Number(run.processedUnits),
      succeededUnits: Number(run.succeededUnits),
      failedUnits: Number(run.failedUnits),
      skippedUnits: Number(run.skippedUnits),
      startedAt: run.startedAt ? new Date(run.startedAt).toISOString() : null,
      finishedAt: run.finishedAt ? new Date(run.finishedAt).toISOString() : null,
      createdAt: new Date(run.createdAt).toISOString(),
    },
    chunks: {
      total: Number(chunks.total),
      queued: Number(chunks.queued),
      running: Number(chunks.running),
      succeeded: Number(chunks.succeeded),
      failed: Number(chunks.failed),
    },
    progressPercent: denom > 0 ? Math.min(100, Math.round((num / denom) * 100)) : 0,
    stages: stageRows.map((stage) => ({
      id: stage.id,
      stageType: stage.stageType,
      status: stage.status,
      totalUnits: Number(stage.totalUnits),
      processedUnits: Number(stage.processedUnits),
      failedUnits: Number(stage.failedUnits),
    })),
  };
}

async function queryResearchRuntimeRunId(organizationId: string, researchRunId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "V2RuntimeRun"
    WHERE "organizationId" = ${organizationId}
      AND "runType" = ${RESEARCH_RUNTIME_TYPE}
      AND "configJson"->>'researchRunId' = ${researchRunId}
    ORDER BY "createdAt" DESC
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}
