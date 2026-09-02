import { createNonRetryableJobError, serializeJobError } from "./errors";
import { v2JobHandlers } from "./handlers";
import { requirePayloadEnvelope } from "./payloadEnvelope";
import { buildNextAttemptAt, DEFAULT_MAX_ATTEMPTS, shouldRetryJob } from "./retryPolicy";
import type {
  ClaimNextJobOptions,
  ProcessJobOptions,
  ProcessJobResult,
  V2JobDatabase,
  V2JobRecord,
} from "./types";
import { claimNextV2Job } from "./claimNextJob";

export async function processNextV2Job(
  db: V2JobDatabase,
  options: ClaimNextJobOptions & ProcessJobOptions = {}
): Promise<ProcessJobResult> {
  const job = await claimNextV2Job(db, options);

  if (!job) {
    return { kind: "no_job" };
  }

  return processV2Job(db, job, options);
}

export async function processV2Job(
  db: V2JobDatabase,
  job: V2JobRecord,
  options: ProcessJobOptions = {}
): Promise<ProcessJobResult> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const signal = options.signal ?? new AbortController().signal;

  try {
    if (job.status !== "RUNNING") {
      throw createNonRetryableJobError(
        "INVALID_JOB_STATE",
        "Only RUNNING jobs can be processed."
      );
    }

    const envelope = requirePayloadEnvelope(job.payloadSnapshotJson);
    const handler = options.handlers?.[job.jobType] ?? v2JobHandlers[job.jobType];

    if (!handler) {
      throw createNonRetryableJobError(
        "UNSUPPORTED_JOB_TYPE",
        `No handler is registered for V2 job type ${job.jobType}.`
      );
    }

    const result = await handler({
      db,
      job,
      organizationId: job.organizationId,
      payload: envelope.payload,
      signal,
      updateProgress: async (progress) => {
        await updateV2JobProgress(db, {
          jobId: job.id,
          organizationId: job.organizationId,
          current: progress.current,
          total: progress.total,
        });
      },
    });

    const succeededRows = await db.$queryRaw<V2JobRecord[]>`
      UPDATE "V2Job"
      SET
        "status" = 'SUCCEEDED',
        "progressCurrent" = ${normalizeProgressCurrent(
          result.progressCurrent ?? job.progressCurrent
        )},
        "progressTotal" = ${normalizeProgressTotal(result.progressTotal)},
        "completedAt" = CURRENT_TIMESTAMP,
        "failedAt" = NULL,
        "resultSnapshotJson" = ${JSON.stringify(result.resultSnapshotJson ?? {})}::jsonb,
        "errorCode" = NULL,
        "errorMessage" = NULL,
        "errorSnapshotJson" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${job.id}
        AND "organizationId" = ${job.organizationId}
        AND "status" = 'RUNNING'
      RETURNING *
    `;

    return { kind: "succeeded", job: succeededRows[0] };
  } catch (error) {
    const serialized = serializeJobError(error, {
      jobId: job.id,
      jobType: job.jobType,
      organizationId: job.organizationId,
    });
    const retryable = serialized.retryable;

    if (shouldRetryJob(job, retryable, maxAttempts)) {
      const retryRows = await db.$queryRaw<V2JobRecord[]>`
        UPDATE "V2Job"
        SET
          "status" = 'RETRY_SCHEDULED',
          "nextAttemptAt" = ${buildNextAttemptAt(job.retryCount)},
          "errorCode" = ${serialized.errorCode},
          "errorMessage" = ${serialized.errorMessage},
          "errorSnapshotJson" = ${JSON.stringify(serialized)}::jsonb,
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${job.id}
          AND "organizationId" = ${job.organizationId}
          AND "status" = 'RUNNING'
        RETURNING *
      `;

      return { kind: "retry_scheduled", job: retryRows[0] };
    }

    const failedRows = await db.$queryRaw<V2JobRecord[]>`
      UPDATE "V2Job"
      SET
        "status" = 'FAILED',
        "failedAt" = CURRENT_TIMESTAMP,
        "errorCode" = ${serialized.errorCode},
        "errorMessage" = ${serialized.errorMessage},
        "errorSnapshotJson" = ${JSON.stringify({
          ...serialized,
          retryable: false,
        })}::jsonb,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${job.id}
        AND "organizationId" = ${job.organizationId}
        AND "status" = 'RUNNING'
      RETURNING *
    `;

    return { kind: "failed", job: failedRows[0] };
  }
}

export async function updateV2JobProgress(
  db: V2JobDatabase,
  input: {
    jobId: string;
    organizationId: string;
    current: number;
    total?: number;
  }
) {
  const current = normalizeProgressCurrent(input.current);
  const total = normalizeProgressTotal(input.total);

  if (total !== null && current > total) {
    throw createNonRetryableJobError(
      "INVALID_PROGRESS",
      "Job progressCurrent cannot exceed progressTotal."
    );
  }

  const rows = await db.$queryRaw<V2JobRecord[]>`
    UPDATE "V2Job"
    SET
      "progressCurrent" = ${current},
      "progressTotal" = ${total},
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${input.jobId}
      AND "organizationId" = ${input.organizationId}
      AND "status" = 'RUNNING'
    RETURNING *
  `;

  return rows[0] ?? null;
}

function normalizeProgressCurrent(value: number) {
  if (!Number.isInteger(value) || value < 0) {
    throw createNonRetryableJobError(
      "INVALID_PROGRESS",
      "Job progressCurrent must be a non-negative integer."
    );
  }

  return value;
}

function normalizeProgressTotal(value: number | undefined) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw createNonRetryableJobError(
      "INVALID_PROGRESS",
      "Job progressTotal must be a non-negative integer."
    );
  }

  return value;
}
