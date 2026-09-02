import { enqueueV2Job } from "../../jobs/enqueueJob";
import type { EnqueueV2JobResult, V2JobSourceType } from "../../jobs/types";
import { stableHash } from "./mapIcpAssessmentToPersistence";
import {
  SCORE_HV0_JOB_SCHEMA_VERSION,
  type ScoreHv0JobPayload,
  type V2ScoreRuntimeDatabase,
} from "./types";

export async function enqueueIcpScoreJob(
  db: V2ScoreRuntimeDatabase,
  input: {
    organizationId: string;
    selection: ScoreHv0JobPayload["selection"];
    createdByUserId?: string | null;
    batchSize?: number;
    // R2: mirror progress onto this V2RuntimeRun (per-batch chunk status).
    runtimeRunId?: string;
    // Job source binding. Defaults to MANUAL. When this score job is part of an
    // ingestion pipeline, the caller passes { sourceType: "INGESTION_JOB",
    // sourceId: ingestionJobId } so the per-batch run control can claim it
    // (claimNextJob scopes by sourceType='INGESTION_JOB' + sourceId). Without
    // this binding the score job is MANUAL-scoped and unreachable from the
    // ingestion run button — the leak that left every lead unscored.
    source?: { sourceType: V2JobSourceType; sourceId: string | null };
  }
): Promise<EnqueueV2JobResult> {
  const payload: ScoreHv0JobPayload = {
    schemaVersion: SCORE_HV0_JOB_SCHEMA_VERSION,
    selection: normalizeSelection(input.selection),
    ...(input.batchSize ? { options: { batchSize: input.batchSize } } : {}),
    ...(input.runtimeRunId ? { runtimeRunId: input.runtimeRunId } : {}),
  };

  return enqueueV2Job(db, {
    organizationId: input.organizationId,
    jobType: "ICP_SCORE",
    sourceType: input.source?.sourceType ?? "MANUAL",
    sourceId: input.source?.sourceId ?? null,
    idempotencyKey: input.runtimeRunId
      ? buildRuntimeIcpScoreJobIdempotencyKey(input.organizationId, input.runtimeRunId)
      : buildIcpScoreJobIdempotencyKey(input.organizationId, payload.selection),
    payload,
    createdByUserId: input.createdByUserId ?? null,
  });
}


export function buildRuntimeIcpScoreJobIdempotencyKey(
  organizationId: string,
  runtimeRunId: string
) {
  return `icp-score:${organizationId}:runtime-run:${runtimeRunId}`;
}
export function buildIcpScoreJobIdempotencyKey(
  organizationId: string,
  selection: ScoreHv0JobPayload["selection"]
) {
  const normalized = normalizeSelection(selection);

  if (normalized.kind === "lead_assignment_ids") {
    return `icp-score:${organizationId}:lead-ids:${stableHash(
      normalized.leadAssignmentIds
    )}`;
  }

  return `icp-score:${organizationId}:project:${normalized.projectId}:icp:${normalized.icpVersionId}:active`;
}

function normalizeSelection(
  selection: ScoreHv0JobPayload["selection"]
): ScoreHv0JobPayload["selection"] {
  if (selection.kind === "lead_assignment_ids") {
    return {
      kind: "lead_assignment_ids",
      leadAssignmentIds: Array.from(
        new Set(selection.leadAssignmentIds.map((id) => id.trim()).filter(Boolean))
      ).sort(),
    };
  }

  return {
    kind: "project_icp",
    projectId: selection.projectId.trim(),
    icpVersionId: selection.icpVersionId.trim(),
  };
}
