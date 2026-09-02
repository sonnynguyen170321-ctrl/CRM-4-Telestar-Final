import "server-only";

import { prisma } from "@/lib/server/prisma";
import { processNextV2Job } from "./processJob";
import type { V2JobDatabase, V2JobType } from "./types";

// BullMQ <-> V2Job bridge for NON-ingestion durable jobs (EMAIL_SEND,
// SEQUENCE_STEP_EXECUTE, EXPORT_GENERATE). Mirrors the proven ingestion bridge contract:
// `enqueueV2Job` publishes a pointer per created row; the worker claims the next due job
// of that type in the org and runs it through the SAME `processNextV2Job` path the DB
// drain uses — so every gate (suppression before send, retry policy, idempotency) is the
// handler's, unchanged. One Redis message exists per created V2Job, and each message
// processes *a* due job of that type (work-conserving); the pending re-check below makes
// a message retry while its own job is still outstanding, so nothing is dropped.

export type DurableJobPointer = {
  organizationId: string;
  v2JobId: string;
  jobType: V2JobType;
};

function isDurablePointer(value: unknown): value is DurableJobPointer {
  if (!value || typeof value !== "object") return false;
  const pointer = value as Record<string, unknown>;
  return (
    typeof pointer.organizationId === "string" &&
    typeof pointer.v2JobId === "string" &&
    typeof pointer.jobType === "string"
  );
}

/** Worker entry for v2.outreach.send / v2.outreach.sequence / v2.export.generate. */
export async function processDurableV2Job(
  data: unknown
): Promise<{ ok: true; kind: string; jobType: string }> {
  if (!isDurablePointer(data)) {
    // Non-retryable shape error: a malformed pointer can never succeed on retry.
    throw new Error("Durable job pointer payload was invalid.");
  }
  const pointer = data;
  const db = prisma as unknown as V2JobDatabase;

  const result = await processNextV2Job(db, {
    organizationId: pointer.organizationId,
    jobType: pointer.jobType,
  });

  if (result.kind === "retry_scheduled") {
    // The handler asked for a retry (e.g. a send window / cap). Throw so BullMQ re-runs
    // with backoff; the claim re-checks nextAttemptAt.
    throw new Error(`Durable job ${pointer.jobType} retry scheduled (${pointer.v2JobId}).`);
  }

  if (result.kind === "no_job") {
    // Nothing claimable right now. If THIS message's own job is still pending (e.g.
    // RETRY_SCHEDULED in the future, or claimed by a peer that later failed), throw so
    // BullMQ retries later instead of dropping the trigger.
    const pending = await isJobStillPending(db, pointer);
    if (pending) {
      throw new Error(`Durable job ${pointer.jobType} not ready (${pointer.v2JobId}).`);
    }
  }

  return { ok: true, kind: result.kind, jobType: pointer.jobType };
}

async function isJobStillPending(db: V2JobDatabase, pointer: DurableJobPointer): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM "V2Job"
      WHERE "id" = ${pointer.v2JobId}
        AND "organizationId" = ${pointer.organizationId}
        AND "status" IN ('QUEUED', 'RUNNING', 'RETRY_SCHEDULED')
    ) AS "exists"
  `;
  return rows[0]?.exists === true;
}

/**
 * Worker `failed`-hook safety net: after BullMQ attempts are exhausted, force THIS job
 * terminal (FAILED) if it is still pending, so a send/export never sits RETRY_SCHEDULED
 * forever with no trigger left. The DB reaper remains a second safety net.
 */
export async function markDurableJobFailed(data: unknown): Promise<void> {
  if (!isDurablePointer(data)) return;
  const pointer = data;
  const db = prisma as unknown as V2JobDatabase;
  await db.$queryRaw`
    UPDATE "V2Job"
    SET
      "status" = 'FAILED',
      "failedAt" = CURRENT_TIMESTAMP,
      "errorCode" = COALESCE("errorCode", 'BULL_ATTEMPTS_EXHAUSTED'),
      "errorMessage" = COALESCE("errorMessage", 'Durable job exhausted BullMQ retries.'),
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${pointer.v2JobId}
      AND "organizationId" = ${pointer.organizationId}
      AND "status" IN ('QUEUED', 'RUNNING', 'RETRY_SCHEDULED')
  `;
}
