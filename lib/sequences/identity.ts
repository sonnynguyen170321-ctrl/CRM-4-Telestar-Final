/**
 * Deterministic identities for one enrollment occurrence (Phase 8a).
 *
 * A leaf module on purpose: workers and the engine need these ids, and importing them from
 * `enrollment.ts` would drag `lib/auth` — and through it `next-auth` — into the worker bundle.
 */

/** The enrollment a given launch intends to create. */
export function launchEnrollmentIdFor(launchId: string): string {
  return `seqlaunch-${launchId}-enrollment`;
}

/** The task for one step of one enrollment occurrence. */
export function enrollmentStepTaskId(enrollmentId: string, order: number): string {
  return `sequence-enrollment-${enrollmentId}-step${order}`;
}

const STEP_TASK_ID = /^sequence-enrollment-(.+)-step(\d+)$/;

/**
 * Recover the occurrence a task belongs to from its own primary key.
 *
 * A producer that holds only a task — run-now on a task id, the maintenance repair sweep — still
 * has to put `expectedEnrollmentId` in the execution payload, or the worker falls back to
 * "whichever enrollment matches lead+sequence" and an old task can run under a later cadence.
 * Parsing the deterministic id is not a guess: the id was *derived* from the enrollment, so a
 * match is proof of ownership rather than correlation.
 *
 * Returns null for a task created before Phase 8a (a generated cuid), which genuinely has no
 * occurrence identity to carry.
 */
export function enrollmentIdFromStepTaskId(taskId: string): string | null {
  const match = STEP_TASK_ID.exec(taskId);
  return match ? match[1] : null;
}

/** The `sequence_enrolled` activity for one occurrence. */
export function enrollmentActivityId(enrollmentId: string): string {
  return `sequence-enrollment-${enrollmentId}-activity`;
}
