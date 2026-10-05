import { prisma } from '@/lib/prisma';
import { enqueueImmediate } from '@/lib/bullmq/enqueue';
import { JobType } from '@/lib/bullmq/types';
import { buildIdempotencyKey, OUTBOUND_STATUS } from '@/lib/email/idempotency';

/**
 * Run now, for an automated email step.
 *
 * The button used to move the due date and promote the scheduled job, and the worker then applied
 * the schedule all over again: outside the send window or on a weekend it deferred, wrote the old
 * future date back over the one the click had just set, and the route had already answered
 * "enqueued". To the rep, the button did nothing.
 *
 * A click is a person overriding the schedule, so it is recorded on the task and the worker lets
 * the send window and weekend rule go for the next few minutes. Everything that protects the
 * prospect or the mailbox still holds — suppression, a paused mailbox, the daily and hourly limits.
 *
 * Recorded on the row rather than carried in the job: the job's payload is its identity
 * (lib/bullmq/enqueue.ts), so a flag in it would name a different job and leave the scheduled one
 * to fire a second time at its old due date.
 */

/** A lock older than this belongs to an attempt that ended without settling the step. */
const STALE_LOCK_MS = 10 * 60 * 1000;

/** How long a click stands. Long enough for a busy queue, short enough not to outlive its intent. */
const RUN_NOW_WINDOW_MS = 10 * 60 * 1000;

/** Whether a Run now on this task is still in force. */
export function runNowRequested(requestedAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!requestedAt) return false;
  const age = now.getTime() - requestedAt.getTime();
  return age >= 0 && age <= RUN_NOW_WINDOW_MS;
}

export type RunNowResult = { ok: true } | { ok: false; reason: 'send_in_flight' };

export async function runEmailStepNow(input: {
  taskId: string;
  expectedEnrollmentId?: string;
  tenantId: string;
}): Promise<RunNowResult> {
  const outbound = await prisma.outboundMessage.findUnique({
    where: { idempotencyKey: buildIdempotencyKey({ kind: 'task', taskId: input.taskId }) },
    select: { status: true },
  });
  // The provider may already have this message. Starting another execution could not send it
  // twice — the claim in workers/email.ts prevents that — but it would report a run that cannot
  // happen, and the outcome of the first one is what the rep needs to wait for.
  if (outbound?.status === OUTBOUND_STATUS.SENDING || outbound?.status === OUTBOUND_STATUS.RECONCILIATION_REQUIRED) {
    return { ok: false, reason: 'send_in_flight' };
  }

  // The execution lock is released by whatever settles the step. An attempt that ended any other
  // way leaves it held, and every later execution — this one included — stops at the lock and
  // reports nothing. Releasing a stale one is safe for the same reason as above: one
  // OutboundMessage per task, claimed by exactly one sender.
  await prisma.task.updateMany({
    where: { id: input.taskId, status: 'pending', lockedAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } },
    data: { lockedAt: null },
  });

  const now = new Date();
  await prisma.task.update({ where: { id: input.taskId }, data: { dueDate: now, runNowRequestedAt: now } });

  // The same payload as the scheduled job, occurrence included, so this promotes that job rather
  // than adding a second one beside it.
  await enqueueImmediate(
    JobType.SEQUENCE_EXECUTE_TASK,
    { taskId: input.taskId, expectedEnrollmentId: input.expectedEnrollmentId },
    { tenantId: input.tenantId },
  );
  return { ok: true };
}
