import "server-only";

import { prisma } from "@/lib/server/prisma";
import { refreshRunFromChunks, setChunkStatusByIndex } from "../../runtime/runtimeStore";
import { scoreLeadAssignments } from "./scoreLeadAssignments";
import { SCORE_HV0_JOB_SCHEMA_VERSION, type V2ScoreRuntimeDatabase } from "./types";

// R3: process ONE chunk of a scoring run (a BullMQ scoring.chunk job). Reads the frozen
// id list from the run config, slices by chunkIndex, scores that slice through the same
// deterministic path, and mirrors the chunk + run status. Idempotent: re-running a chunk
// re-scores the same ids (assessments are reused by fingerprint).

type RunConfig = { batchSize: number; leadAssignmentIds: string[] };

export type ScoreChunkResult = { processed: number; total: number; status: "SUCCEEDED" | "FAILED" };

/** Slice the run's frozen ids for a chunk. Pure — unit-tested by the smoke. */
export function sliceChunkIds(ids: string[], chunkIndex: number, batchSize: number): string[] {
  if (batchSize <= 0) return [];
  const start = chunkIndex * batchSize;
  return ids.slice(start, start + batchSize);
}

async function loadRunConfig(organizationId: string, runId: string): Promise<RunConfig | null> {
  const rows = await prisma.$queryRawUnsafe<Array<{ configJson: unknown }>>(
    `SELECT "configJson" FROM "V2RuntimeRun" WHERE "organizationId"=$1 AND "id"=$2 LIMIT 1`,
    organizationId,
    runId
  );
  const cfg = rows[0]?.configJson as Partial<RunConfig> | undefined;
  if (!cfg || !Array.isArray(cfg.leadAssignmentIds)) return null;
  return { batchSize: Number(cfg.batchSize) || 100, leadAssignmentIds: cfg.leadAssignmentIds };
}

export async function scoreScoringChunk(
  db: V2ScoreRuntimeDatabase,
  input: { organizationId: string; runId: string; chunkIndex: number; workerId?: string }
): Promise<ScoreChunkResult> {
  const { organizationId, runId, chunkIndex } = input;
  const config = await loadRunConfig(organizationId, runId);
  if (!config) {
    await setChunkStatusByIndex(organizationId, runId, chunkIndex, "FAILED", { errorCode: "RUN_CONFIG_MISSING" });
    await refreshRunFromChunks(organizationId, runId);
    return { processed: 0, total: 0, status: "FAILED" };
  }

  const slice = sliceChunkIds(config.leadAssignmentIds, chunkIndex, config.batchSize);
  await setChunkStatusByIndex(organizationId, runId, chunkIndex, "RUNNING", { workerId: input.workerId ?? "bull" });

  try {
    if (slice.length > 0) {
      await scoreLeadAssignments(db, {
        organizationId,
        payload: { schemaVersion: SCORE_HV0_JOB_SCHEMA_VERSION, selection: { kind: "lead_assignment_ids", leadAssignmentIds: slice } },
      });
    }
    await setChunkStatusByIndex(organizationId, runId, chunkIndex, "SUCCEEDED", { processedUnits: slice.length });
    const status = await refreshRunFromChunks(organizationId, runId);
    return { processed: slice.length, total: config.leadAssignmentIds.length, status: status === "FAILED" ? "FAILED" : "SUCCEEDED" };
  } catch (error) {
    await setChunkStatusByIndex(organizationId, runId, chunkIndex, "FAILED", {
      errorCode: "CHUNK_SCORE_FAILED",
    });
    await refreshRunFromChunks(organizationId, runId);
    void error;
    return { processed: 0, total: config.leadAssignmentIds.length, status: "FAILED" };
  }
}
