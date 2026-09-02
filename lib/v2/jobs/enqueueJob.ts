import { parsePayloadEnvelope, createPayloadEnvelope } from "./payloadEnvelope";
import { isBullEnabled } from "../bullmq/config";
import { V2_DURABLE_QUEUE_BY_JOB_TYPE, V2_INGEST_QUEUE_BY_JOB_TYPE } from "../bullmq/queueNames";
import type { EnqueueV2JobInput, EnqueueV2JobResult, V2JobDatabase, V2JobRecord } from "./types";

/**
 * Mirror a newly-created ingestion-sourced V2Job onto its BullMQ queue so a Redis worker
 * picks it up immediately (vs waiting for a DB poll). Best-effort: the V2Job row is the
 * source of truth, so a Redis hiccup here is logged, not thrown — the DB-drain / reaper
 * fallback still advances the job. Only fires when bull is enabled and the job type is an
 * ingestion stage; outreach/export jobs keep the DB-drain path untouched.
 */
async function mirrorIngestionJobToBull(job: V2JobRecord): Promise<void> {
  if (!isBullEnabled()) return;
  if (job.sourceType !== "INGESTION_JOB" || !job.sourceId) return;
  const queueName = V2_INGEST_QUEUE_BY_JOB_TYPE[job.jobType];
  if (!queueName) return;
  try {
    const { addJob } = await import("../bullmq/queues");
    await addJob(
      queueName,
      job.jobType,
      {
        organizationId: job.organizationId,
        ingestionJobId: job.sourceId,
        jobType: job.jobType,
      },
      { jobId: job.idempotencyKey }
    );
  } catch (error) {
    console.error(
      "INGESTION_BULL_ENQUEUE_FAILED",
      job.jobType,
      job.id,
      error instanceof Error ? error.message : error
    );
  }
}

/**
 * Mirror non-ingestion durable jobs (EMAIL_SEND / SEQUENCE_STEP_EXECUTE / EXPORT_GENERATE)
 * onto their BullMQ queue for instant pickup. Same best-effort contract as the ingestion
 * mirror: the V2Job row is the source of truth; a Redis failure here is logged and the
 * DB-drain / reaper fallback still advances the job.
 */
async function mirrorDurableJobToBull(job: V2JobRecord): Promise<void> {
  if (!isBullEnabled()) return;
  if (job.sourceType === "INGESTION_JOB") return; // handled by the ingestion mirror
  const queueName = V2_DURABLE_QUEUE_BY_JOB_TYPE[job.jobType];
  if (!queueName) return;
  try {
    const { addJob } = await import("../bullmq/queues");
    await addJob(
      queueName,
      job.jobType,
      {
        organizationId: job.organizationId,
        v2JobId: job.id,
        jobType: job.jobType,
      },
      { jobId: job.idempotencyKey }
    );
  } catch (error) {
    console.error(
      "DURABLE_BULL_ENQUEUE_FAILED",
      job.jobType,
      job.id,
      error instanceof Error ? error.message : error
    );
  }
}

export async function enqueueV2Job(
  db: V2JobDatabase,
  input: EnqueueV2JobInput
): Promise<EnqueueV2JobResult> {
  const existingRows = await db.$queryRaw<V2JobRecord[]>`
    SELECT *
    FROM "V2Job"
    WHERE "organizationId" = ${input.organizationId}
      AND "idempotencyKey" = ${input.idempotencyKey}
    LIMIT 1
  `;
  const envelope = createPayloadEnvelope(input.payload);

  if (existingRows[0]) {
    const parsed = parsePayloadEnvelope(existingRows[0].payloadSnapshotJson);

    if (!parsed.ok) {
      return {
        kind: "conflict",
        code: "MALFORMED_EXISTING_PAYLOAD",
        existingJob: existingRows[0],
      };
    }

    if (parsed.envelope.meta.payloadHash !== envelope.meta.payloadHash) {
      return {
        kind: "conflict",
        code: "PAYLOAD_MISMATCH",
        existingJob: existingRows[0],
      };
    }

    return { kind: "existing", job: existingRows[0] };
  }

  const createdRows = await db.$queryRaw<V2JobRecord[]>`
    INSERT INTO "V2Job" (
      "id",
      "organizationId",
      "jobType",
      "sourceType",
      "sourceId",
      "status",
      "progressCurrent",
      "retryCount",
      "idempotencyKey",
      "payloadSnapshotJson",
      "createdByUserId",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${createJobId()},
      ${input.organizationId},
      ${input.jobType}::"V2JobType",
      ${input.sourceType}::"V2JobSourceType",
      ${input.sourceId ?? null},
      'QUEUED',
      0,
      0,
      ${input.idempotencyKey},
      ${JSON.stringify(envelope)}::jsonb,
      ${input.createdByUserId ?? null},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    RETURNING *
  `;

  await mirrorIngestionJobToBull(createdRows[0]);
  await mirrorDurableJobToBull(createdRows[0]);

  return { kind: "created", job: createdRows[0] };
}

function createJobId() {
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
