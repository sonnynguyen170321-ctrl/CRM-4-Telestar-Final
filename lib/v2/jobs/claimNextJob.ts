import { serializeJobError } from "./errors";
import { buildNextAttemptAt, DEFAULT_MAX_ATTEMPTS, DEFAULT_STALE_AFTER_MS, shouldRetryJob } from "./retryPolicy";
import type {
  ClaimNextJobOptions,
  ReclaimStaleJobsOptions,
  ReclaimStaleJobsResult,
  V2JobDatabase,
  V2JobRecord,
  V2JobType,
} from "./types";

export async function claimNextV2Job(
  db: V2JobDatabase,
  options: ClaimNextJobOptions = {}
) {
  return db.$transaction(async (tx) => {
    const candidates = await selectDueJobForUpdate(tx, options);
    const candidate = candidates[0];

    if (!candidate) {
      return null;
    }

    const claimedRows = await tx.$queryRaw<V2JobRecord[]>`
      UPDATE "V2Job"
      SET
        "status" = 'RUNNING',
        "retryCount" = "retryCount" + 1,
        "startedAt" = COALESCE("startedAt", CURRENT_TIMESTAMP),
        "failedAt" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${candidate.id}
        AND "organizationId" = ${candidate.organizationId}
        AND (
          "status" = 'QUEUED'
          OR ("status" = 'RETRY_SCHEDULED' AND "nextAttemptAt" <= CURRENT_TIMESTAMP)
        )
      RETURNING *
    `;

    return claimedRows[0] ?? null;
  });
}

export async function reclaimStaleV2Jobs(
  db: V2JobDatabase,
  options: ReclaimStaleJobsOptions = {}
): Promise<ReclaimStaleJobsResult> {
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const staleBefore = new Date(Date.now() - staleAfterMs);
  const staleJobs = await selectStaleRunningJobs(db, staleBefore, options);
  let retryScheduled = 0;
  let failed = 0;

  for (const job of staleJobs) {
    const serialized = serializeJobError(
      new Error("V2 job was running longer than the stale threshold."),
      {
        staleBefore,
        attemptsStarted: job.retryCount,
      }
    );

    if (shouldRetryJob(job, true, maxAttempts)) {
      await db.$queryRaw<V2JobRecord[]>`
        UPDATE "V2Job"
        SET
          "status" = 'RETRY_SCHEDULED',
          "nextAttemptAt" = ${buildNextAttemptAt(job.retryCount)},
          "errorCode" = 'STALE_RUNNING_JOB',
          "errorMessage" = ${serialized.errorMessage},
          "errorSnapshotJson" = ${JSON.stringify({
            ...serialized,
            errorCode: "STALE_RUNNING_JOB",
          })}::jsonb,
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${job.id}
          AND "organizationId" = ${job.organizationId}
          AND "status" = 'RUNNING'
        RETURNING *
      `;
      retryScheduled += 1;
      continue;
    }

    await db.$queryRaw<V2JobRecord[]>`
      UPDATE "V2Job"
      SET
        "status" = 'FAILED',
        "failedAt" = CURRENT_TIMESTAMP,
        "errorCode" = 'STALE_RUNNING_JOB',
        "errorMessage" = ${serialized.errorMessage},
        "errorSnapshotJson" = ${JSON.stringify({
          ...serialized,
          errorCode: "STALE_RUNNING_JOB",
          retryable: false,
        })}::jsonb,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${job.id}
        AND "organizationId" = ${job.organizationId}
        AND "status" = 'RUNNING'
      RETURNING *
    `;
    failed += 1;
  }

  return { scanned: staleJobs.length, retryScheduled, failed };
}

async function selectDueJobForUpdate(
  db: V2JobDatabase,
  options: ClaimNextJobOptions
) {
  if (options.organizationId && options.jobId) {
    return db.$queryRaw<V2JobRecord[]>`
      SELECT *
      FROM "V2Job"
      WHERE "organizationId" = ${options.organizationId}
        AND "id" = ${options.jobId}
        AND ("status" = 'QUEUED' OR ("status" = 'RETRY_SCHEDULED' AND "nextAttemptAt" <= CURRENT_TIMESTAMP))
      ORDER BY "nextAttemptAt" NULLS FIRST, "createdAt", "id"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;
  }

  if (options.organizationId && options.sourceType && options.sourceId && options.jobType) {
    return db.$queryRaw<V2JobRecord[]>`
      SELECT *
      FROM "V2Job"
      WHERE "organizationId" = ${options.organizationId}
        AND "sourceType" = ${options.sourceType}::"V2JobSourceType"
        AND "sourceId" = ${options.sourceId}
        AND "jobType" = ${options.jobType}::"V2JobType"
        AND ("status" = 'QUEUED' OR ("status" = 'RETRY_SCHEDULED' AND "nextAttemptAt" <= CURRENT_TIMESTAMP))
      ORDER BY "nextAttemptAt" NULLS FIRST, "createdAt", "id"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;
  }

  if (options.organizationId && options.sourceType && options.sourceId) {
    return db.$queryRaw<V2JobRecord[]>`
      SELECT *
      FROM "V2Job"
      WHERE "organizationId" = ${options.organizationId}
        AND "sourceType" = ${options.sourceType}::"V2JobSourceType"
        AND "sourceId" = ${options.sourceId}
        AND ("status" = 'QUEUED' OR ("status" = 'RETRY_SCHEDULED' AND "nextAttemptAt" <= CURRENT_TIMESTAMP))
      ORDER BY "nextAttemptAt" NULLS FIRST, "createdAt", "id"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;
  }
  if (options.organizationId && options.ingestionJobId && options.jobType) {
    return db.$queryRaw<V2JobRecord[]>`
      SELECT *
      FROM "V2Job"
      WHERE "organizationId" = ${options.organizationId}
        AND "sourceType" = 'INGESTION_JOB'
        AND "sourceId" = ${options.ingestionJobId}
        AND "jobType" = ${options.jobType}::"V2JobType"
        AND ("status" = 'QUEUED' OR ("status" = 'RETRY_SCHEDULED' AND "nextAttemptAt" <= CURRENT_TIMESTAMP))
      ORDER BY "nextAttemptAt" NULLS FIRST, "createdAt", "id"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;
  }

  if (options.organizationId && options.ingestionJobId) {
    return db.$queryRaw<V2JobRecord[]>`
      SELECT *
      FROM "V2Job"
      WHERE "organizationId" = ${options.organizationId}
        AND "sourceType" = 'INGESTION_JOB'
        AND "sourceId" = ${options.ingestionJobId}
        AND ("status" = 'QUEUED' OR ("status" = 'RETRY_SCHEDULED' AND "nextAttemptAt" <= CURRENT_TIMESTAMP))
      ORDER BY "nextAttemptAt" NULLS FIRST, "createdAt", "id"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;
  }

  if (options.organizationId && options.jobType) {
    return db.$queryRaw<V2JobRecord[]>`
      SELECT *
      FROM "V2Job"
      WHERE "organizationId" = ${options.organizationId}
        AND "jobType" = ${options.jobType}::"V2JobType"
        AND ("status" = 'QUEUED' OR ("status" = 'RETRY_SCHEDULED' AND "nextAttemptAt" <= CURRENT_TIMESTAMP))
      ORDER BY "nextAttemptAt" NULLS FIRST, "createdAt", "id"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;
  }

  if (options.organizationId) {
    return db.$queryRaw<V2JobRecord[]>`
      SELECT *
      FROM "V2Job"
      WHERE "organizationId" = ${options.organizationId}
        AND ("status" = 'QUEUED' OR ("status" = 'RETRY_SCHEDULED' AND "nextAttemptAt" <= CURRENT_TIMESTAMP))
      ORDER BY "nextAttemptAt" NULLS FIRST, "createdAt", "id"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;
  }

  if (options.jobType) {
    return db.$queryRaw<V2JobRecord[]>`
      SELECT *
      FROM "V2Job"
      WHERE "jobType" = ${options.jobType}::"V2JobType"
        AND ("status" = 'QUEUED' OR ("status" = 'RETRY_SCHEDULED' AND "nextAttemptAt" <= CURRENT_TIMESTAMP))
      ORDER BY "nextAttemptAt" NULLS FIRST, "createdAt", "id"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;
  }

  return db.$queryRaw<V2JobRecord[]>`
    SELECT *
    FROM "V2Job"
    WHERE "status" = 'QUEUED'
      OR ("status" = 'RETRY_SCHEDULED' AND "nextAttemptAt" <= CURRENT_TIMESTAMP)
    ORDER BY "nextAttemptAt" NULLS FIRST, "createdAt", "id"
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  `;
}

async function selectStaleRunningJobs(
  db: V2JobDatabase,
  staleBefore: Date,
  options: { organizationId?: string; jobType?: V2JobType }
) {
  if (options.organizationId && options.jobType) {
    return db.$queryRaw<V2JobRecord[]>`
      SELECT *
      FROM "V2Job"
      WHERE "organizationId" = ${options.organizationId}
        AND "jobType" = ${options.jobType}::"V2JobType"
        AND "status" = 'RUNNING'
        AND ("startedAt" <= ${staleBefore} OR ("startedAt" IS NULL AND "updatedAt" <= ${staleBefore}))
      ORDER BY "updatedAt", "id"
    `;
  }

  if (options.organizationId) {
    return db.$queryRaw<V2JobRecord[]>`
      SELECT *
      FROM "V2Job"
      WHERE "organizationId" = ${options.organizationId}
        AND "status" = 'RUNNING'
        AND ("startedAt" <= ${staleBefore} OR ("startedAt" IS NULL AND "updatedAt" <= ${staleBefore}))
      ORDER BY "updatedAt", "id"
    `;
  }

  if (options.jobType) {
    return db.$queryRaw<V2JobRecord[]>`
      SELECT *
      FROM "V2Job"
      WHERE "jobType" = ${options.jobType}::"V2JobType"
        AND "status" = 'RUNNING'
        AND ("startedAt" <= ${staleBefore} OR ("startedAt" IS NULL AND "updatedAt" <= ${staleBefore}))
      ORDER BY "updatedAt", "id"
    `;
  }

  return db.$queryRaw<V2JobRecord[]>`
    SELECT *
    FROM "V2Job"
    WHERE "status" = 'RUNNING'
      AND ("startedAt" <= ${staleBefore} OR ("startedAt" IS NULL AND "updatedAt" <= ${staleBefore}))
    ORDER BY "updatedAt", "id"
  `;
}
