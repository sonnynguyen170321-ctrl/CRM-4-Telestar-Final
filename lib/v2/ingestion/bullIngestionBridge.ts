import "server-only";

import { prisma } from "@/lib/server/prisma";
import { processNextV2Job } from "../jobs/processJob";
import type { V2JobDatabase, V2JobType } from "../jobs/types";

// BullMQ <-> V2Job bridge for the ingestion pipeline. When V2_BULL_ENABLED, every
// ingestion-sourced stage (parse -> normalize -> identity -> lead-upsert -> activity,
// plus the enrich/score triggers) is mirrored onto a Redis queue by `enqueueV2Job`.
// The worker runs THIS handler with the pointer payload; it claims the exact stage
// V2Job (org + ingestionJobId + jobType) and runs it through the proven `processV2Job`
// path. The handler that succeeds enqueues the next stage -> next queue. The V2Job row
// stays the durable record (progress / retry / result snapshots); BullMQ only supplies
// instant, ordered pickup. This is why "finish each step, don't skip steps" holds: a
// stage's success is the only thing that enqueues the next, exactly as on the DB path.

export type IngestionStagePointer = {
  organizationId: string;
  ingestionJobId: string;
  jobType: V2JobType;
};

const PENDING_STATUSES = ["QUEUED", "RUNNING", "RETRY_SCHEDULED"] as const;

function isStagePointer(value: unknown): value is IngestionStagePointer {
  if (!value || typeof value !== "object") return false;
  const pointer = value as Record<string, unknown>;
  return (
    typeof pointer.organizationId === "string" &&
    typeof pointer.ingestionJobId === "string" &&
    typeof pointer.jobType === "string"
  );
}

/**
 * Worker entry for every `v2.ingest.*` queue. Resolves when the stage reached a terminal
 * state (or was already handled); throws to make BullMQ retry while the stage is still
 * pending — so a missed/early pickup never silently skips a step.
 */
export async function processIngestionStageJob(
  data: unknown
): Promise<{ ok: true; kind: string; jobType: string }> {
  if (!isStagePointer(data)) {
    // Non-retryable shape error: a malformed pointer can never succeed on retry.
    throw new Error("Ingestion stage pointer payload was invalid.");
  }
  const pointer = data;
  const db = prisma as unknown as V2JobDatabase;

  const result = await processNextV2Job(db, {
    organizationId: pointer.organizationId,
    ingestionJobId: pointer.ingestionJobId,
    jobType: pointer.jobType,
  });

  if (result.kind === "retry_scheduled") {
    // The handler asked to retry (e.g. NORMALIZE waiting on PARSE). Throw so BullMQ
    // re-runs with backoff; the next attempt re-claims once nextAttemptAt is due.
    throw new Error(
      `Ingestion stage ${pointer.jobType} retry scheduled for ${pointer.ingestionJobId}.`
    );
  }

  if (result.kind === "no_job") {
    // Nothing claimable now: either already terminal (done) or claimed by a peer / not
    // yet due. If a non-terminal stage job still exists, throw so we re-check later
    // rather than dropping the step.
    const pending = await hasPendingStageJob(db, pointer);
    if (pending) {
      throw new Error(
        `Ingestion stage ${pointer.jobType} not ready for ${pointer.ingestionJobId}.`
      );
    }
  }

  // Pipeline-final stages change what the leads workbench shows (new leads / activities /
  // scores) — re-warm the org's read-model caches so the next page load is hot. Best-effort.
  if (
    result.kind === "succeeded" &&
    (pointer.jobType === "LEAD_ASSIGNMENT_UPSERT" ||
      pointer.jobType === "ACTIVITY_APPLY" ||
      pointer.jobType === "ICP_SCORE")
  ) {
    const { enqueueFacetRebuild } = await import("../bullmq/facetCache");
    await enqueueFacetRebuild(pointer.organizationId);
  }

  return { ok: true, kind: result.kind, jobType: pointer.jobType };
}

async function hasPendingStageJob(
  db: V2JobDatabase,
  pointer: IngestionStagePointer
): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM "V2Job"
      WHERE "organizationId" = ${pointer.organizationId}
        AND "sourceType" = 'INGESTION_JOB'
        AND "sourceId" = ${pointer.ingestionJobId}
        AND "jobType" = ${pointer.jobType}::"V2JobType"
        AND "status" = ANY(${PENDING_STATUSES as unknown as string[]}::"V2JobStatus"[])
    ) AS "exists"
  `;
  return rows[0]?.exists === true;
}

/**
 * Safety net invoked from the worker `failed` hook once BullMQ attempts are exhausted:
 * force the stage V2Job terminal (FAILED) so the pipeline stops cleanly instead of a
 * stage sitting RETRY_SCHEDULED forever with no trigger left to re-run it.
 */
export async function markIngestionStageFailed(data: unknown): Promise<void> {
  if (!isStagePointer(data)) return;
  const pointer = data;
  const db = prisma as unknown as V2JobDatabase;
  await db.$queryRaw`
    UPDATE "V2Job"
    SET
      "status" = 'FAILED',
      "failedAt" = CURRENT_TIMESTAMP,
      "errorCode" = COALESCE("errorCode", 'BULL_ATTEMPTS_EXHAUSTED'),
      "errorMessage" = COALESCE("errorMessage", 'Ingestion stage exhausted BullMQ retries.'),
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "organizationId" = ${pointer.organizationId}
      AND "sourceType" = 'INGESTION_JOB'
      AND "sourceId" = ${pointer.ingestionJobId}
      AND "jobType" = ${pointer.jobType}::"V2JobType"
      AND "status" IN ('QUEUED', 'RUNNING', 'RETRY_SCHEDULED')
  `;
}
