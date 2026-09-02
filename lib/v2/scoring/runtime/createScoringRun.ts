import "server-only";

import {
  createRuntimeChunks,
  createRuntimeRun,
  createRuntimeStage,
  finalizeRun,
} from "../../runtime/runtimeStore";
import { resolveLeadAssignmentIds } from "./scoreLeadAssignments";
import { DEFAULT_SCORE_HV0_BATCH_SIZE, type ScoreHv0JobPayload, type V2ScoreRuntimeDatabase } from "./types";

// R2: plan a scoring run. Resolves the selection ONCE and FREEZES it to a concrete
// lead-id list, so the run's chunk boundaries are stable regardless of later inserts.
// Creates the V2RuntimeRun + a scoring.chunk stage + one chunk per batch (mirror only —
// no scoring here). The frozen selection + batchSize are returned so the caller enqueues
// the matching ICP_SCORE job, whose handler marks each chunk as it processes that batch.

export type CreateScoringRunResult = {
  runId: string;
  total: number;
  chunkCount: number;
  batchSize: number;
  frozenSelection: { kind: "lead_assignment_ids"; leadAssignmentIds: string[] };
};

/** ceil(total / size), but 0 when nothing to do. Pure — unit-tested by the smoke. */
export function planChunkCount(total: number, batchSize: number): number {
  if (total <= 0 || batchSize <= 0) return 0;
  return Math.ceil(total / batchSize);
}

export async function createScoringRun(
  db: V2ScoreRuntimeDatabase,
  input: {
    organizationId: string;
    selection: ScoreHv0JobPayload["selection"];
    projectId?: string | null;
    icpVersionId?: string | null;
    batchSize?: number;
    createdByUserId?: string | null;
  }
): Promise<CreateScoringRunResult> {
  const batchSize = input.batchSize && input.batchSize > 0 ? input.batchSize : DEFAULT_SCORE_HV0_BATCH_SIZE;
  const ids = await resolveLeadAssignmentIds(db, { organizationId: input.organizationId, selection: input.selection });
  const total = ids.length;
  const chunkCount = planChunkCount(total, batchSize);
  const frozenSelection = { kind: "lead_assignment_ids" as const, leadAssignmentIds: ids };

  const runId = await createRuntimeRun({
    organizationId: input.organizationId,
    runType: "SCORING",
    projectId: input.projectId ?? null,
    icpVersionId: input.icpVersionId ?? null,
    totalUnits: total,
    createdByUserId: input.createdByUserId ?? null,
    // Freeze the resolved ids onto the run so BullMQ chunk workers can slice
    // deterministically by chunkIndex (R3) without re-resolving. Internal-scale ok;
    // keyset/materialized input is a later-phase concern for very large runs.
    configJson: { batchSize, selectionKind: input.selection.kind, leadAssignmentIds: ids },
  });

  // Empty selection -> nothing to score; finish the run immediately so the UI is honest.
  if (chunkCount === 0) {
    await finalizeRun(input.organizationId, runId, "SUCCEEDED");
    return { runId, total, chunkCount, batchSize, frozenSelection };
  }

  const stageId = await createRuntimeStage({
    organizationId: input.organizationId,
    runId,
    stageType: "scoring.chunk",
    totalUnits: total,
  });

  const chunks = Array.from({ length: chunkCount }, (_, i) => ({
    chunkIndex: i,
    dedupeKey: `${runId}:chunk:${i}`,
    unitCount: Math.min(batchSize, total - i * batchSize),
  }));
  await createRuntimeChunks({
    organizationId: input.organizationId,
    runId,
    stageId,
    chunkType: "scoring.chunk",
    chunks,
  });

  return { runId, total, chunkCount, batchSize, frozenSelection };
}
