import "server-only";

import { enqueueV2Job } from "@/lib/v2/jobs/enqueueJob";
import type { EnqueueV2JobResult, V2JobDatabase, V2JobSourceType } from "@/lib/v2/jobs/types";

import {
  ACTIVITY_APPLY_JOB_SCHEMA_VERSION,
  buildActivityApplyJobIdempotencyKey,
  type ActivityApplyJobPayload,
  type ActivityApplyRow,
} from "./applyActivityRows";

export type EnqueueActivityApplyInput = {
  organizationId: string;
  rows: ActivityApplyRow[];
  ingestionJobId?: string | null;
  createdByUserId?: string | null;
  // Job source binding. Defaults to MANUAL. Pass { sourceType: "INGESTION_JOB",
  // sourceId: ingestionJobId } when triggered from a recap ingestion pipeline so
  // the per-batch run control can claim this job (§4d job-chaining contract).
  source?: { sourceType: V2JobSourceType; sourceId: string | null };
};

export async function enqueueActivityApplyJob(
  db: V2JobDatabase,
  input: EnqueueActivityApplyInput
): Promise<EnqueueV2JobResult> {
  if (!input.organizationId) {
    throw new Error("enqueueActivityApplyJob: organizationId is required.");
  }
  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    throw new Error("enqueueActivityApplyJob: rows must be a non-empty array.");
  }

  const payload: ActivityApplyJobPayload = {
    schemaVersion: ACTIVITY_APPLY_JOB_SCHEMA_VERSION,
    organizationId: input.organizationId,
    rows: input.rows,
    ingestionJobId: input.ingestionJobId ?? null,
    createdByUserId: input.createdByUserId ?? null,
  };

  return enqueueV2Job(db, {
    organizationId: input.organizationId,
    jobType: "ACTIVITY_APPLY",
    sourceType: input.source?.sourceType ?? "MANUAL",
    sourceId: input.source?.sourceId ?? null,
    idempotencyKey: buildActivityApplyJobIdempotencyKey(
      input.organizationId,
      input.rows
    ),
    payload,
    createdByUserId: input.createdByUserId ?? null,
  });
}
