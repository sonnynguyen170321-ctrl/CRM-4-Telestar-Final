import "server-only";

import { enqueueV2Job } from "../../jobs/enqueueJob";
import type { V2JobDatabase } from "../../jobs/types";

// Sequence scheduler tick (Link D, B11). Finds enrollments that are ACTIVE and due
// (nextStepAt <= now) and enqueues one SEQUENCE_STEP_EXECUTE per enrollment. The
// step handler then decides execute/wait/halt/complete and sets the next nextStepAt.
// Idempotent: the job key carries the current ordinal, so a tick that runs again
// before the job drains re-enqueues the SAME key (no duplicate), while progression
// to the next ordinal yields a fresh job. Tenant-scoped per row (each carries org).
//
// Called by the worker drain route before draining, so a single `npm run v2:worker`
// both advances due sequences and processes the resulting jobs — no extra daemon.

export type TickDueEnrollmentsResult = {
  due: number;
  enqueued: number;
};

const DEFAULT_BATCH = 200;

export async function tickDueEnrollments(
  db: V2JobDatabase,
  options: { limit?: number; organizationId?: string } = {}
): Promise<TickDueEnrollmentsResult> {
  const limit = Math.max(1, Math.min(1000, options.limit ?? DEFAULT_BATCH));

  const due = options.organizationId
    ? await db.$queryRaw<Array<{ id: string; organizationId: string; currentStepOrdinal: number }>>`
        SELECT "id", "organizationId", "currentStepOrdinal"
        FROM "V2SequenceEnrollment"
        WHERE "organizationId" = ${options.organizationId}
          AND "status" = 'ACTIVE'
          AND "deletedAt" IS NULL
          AND "nextStepAt" IS NOT NULL
          AND "nextStepAt" <= CURRENT_TIMESTAMP
        ORDER BY "nextStepAt" ASC
        LIMIT ${limit}`
    : await db.$queryRaw<Array<{ id: string; organizationId: string; currentStepOrdinal: number }>>`
        SELECT "id", "organizationId", "currentStepOrdinal"
        FROM "V2SequenceEnrollment"
        WHERE "status" = 'ACTIVE'
          AND "deletedAt" IS NULL
          AND "nextStepAt" IS NOT NULL
          AND "nextStepAt" <= CURRENT_TIMESTAMP
        ORDER BY "nextStepAt" ASC
        LIMIT ${limit}`;

  let enqueued = 0;
  for (const enrollment of due) {
    const result = await enqueueV2Job(db, {
      organizationId: enrollment.organizationId,
      jobType: "SEQUENCE_STEP_EXECUTE",
      sourceType: "SEQUENCE_ENROLLMENT",
      sourceId: enrollment.id,
      idempotencyKey: `seq-step-exec:${enrollment.id}:${enrollment.currentStepOrdinal}`,
      payload: { schemaVersion: "v2.sequence-step.v1", enrollmentId: enrollment.id },
    });
    if (result.kind === "created") enqueued++;
  }

  return { due: due.length, enqueued };
}
