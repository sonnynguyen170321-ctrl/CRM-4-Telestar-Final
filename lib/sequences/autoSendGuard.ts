/**
 * The rules for a person touching a task whose email the CRM sends itself.
 *
 * Completing a sequence task calls `advanceSequence`, which moves the cadence to the next step.
 * For an email step that sends itself that was a way to advance without a send: the rep pressed
 * Complete before the job had run, step 2 was scheduled, and the prospect never got step 1.
 * So Complete on such a task is refused (409 `auto_send_pending`) unless the rep says they sent
 * it outside the CRM, and neither Complete nor Skip may touch a task whose message is already
 * with the mail worker (409 `send_in_flight`) - the worker settles that one.
 *
 * Skip is allowed and cancels the queued job; the compare-and-set on the task is what makes it
 * safe, the job removal only saves a wasted wake-up (a job that fires later finds a skipped task
 * and stops).
 */
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { buildJobDedupeKey } from '@/lib/bullmq/ensureJob';
import { sequenceQueue } from '@/lib/bullmq/queues';
import { JobType } from '@/lib/bullmq/types';
import { buildIdempotencyKey, OUTBOUND_STATUS } from '@/lib/email/idempotency';
import { isAutomaticStep } from './autoSendState';
import { rescheduleSequenceTask } from '@/lib/bullmq/rescheduleSequenceTask';

/** A task lock older than this belongs to an attempt that ended without settling the step. */
export const STALE_LOCK_MS = 10 * 60 * 1000;

export type AutoStepRefusal = {
  status: 409;
  code: 'auto_send_pending' | 'send_in_flight';
  error: string;
};

interface GuardTask {
  id: string;
  type: string;
  status: string;
  tenantId: string;
  leadId: string;
  sequenceId: string | null;
  sequenceStep: number | null;
}

/** True when this task is a sequence email step that the CRM sends itself. */
export async function isAutomaticEmailTask(task: Pick<GuardTask, 'type' | 'sequenceId' | 'sequenceStep'>): Promise<boolean> {
  if (task.type !== 'email' || !task.sequenceId || task.sequenceStep == null) return false;
  const step = await prisma.sequenceStep.findFirst({
    where: { sequenceId: task.sequenceId, order: task.sequenceStep },
    select: { autoComplete: true, templateId: true },
  });
  return isAutomaticStep(step);
}

/** The cutoff before which a task lock is treated as abandoned. */
export function staleLockCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - STALE_LOCK_MS);
}

/**
 * The task's message is with the mail worker (queued, deferred, sending, or being reconciled).
 * `failed` counts: it is retryable, so the worker may still send it, and a rep who then says they
 * sent it elsewhere would double-send. It stops counting once it is permanently failed (the task is
 * then already closed) or cancelled.
 */
async function messageIsLive(taskId: string): Promise<boolean> {
  const outbound = await prisma.outboundMessage.findUnique({
    where: { idempotencyKey: buildIdempotencyKey({ kind: 'task', taskId }) },
    select: { status: true },
  });
  return (
    outbound?.status === OUTBOUND_STATUS.PENDING ||
    outbound?.status === OUTBOUND_STATUS.FAILED ||
    outbound?.status === OUTBOUND_STATUS.SENDING ||
    outbound?.status === OUTBOUND_STATUS.RECONCILIATION_REQUIRED
  );
}

export interface AutoStepVerdict {
  /** The task is a sequence email step the CRM sends itself. */
  automatic: boolean;
  /** Set when the action must be refused. */
  refusal: AutoStepRefusal | null;
}

/**
 * Whether this person may complete or skip this task right now, and whether it is an automatic
 * email step at all. Only ever refuses for a pending task on an automatic email step.
 */
export async function evaluateAutoStep(
  task: GuardTask,
  action: 'complete' | 'skip',
  options: { sentOutsideCrm?: boolean } = {}
): Promise<AutoStepVerdict> {
  if (task.status !== 'pending') return { automatic: false, refusal: null };
  if (!(await isAutomaticEmailTask(task))) return { automatic: false, refusal: null };

  if (action === 'complete' && !options.sentOutsideCrm) {
    return {
      automatic: true,
      refusal: {
        status: 409,
        code: 'auto_send_pending',
        error:
          'The CRM sends this email itself and has not confirmed it yet. Completing it would move the ' +
          'cadence on without a send. If you sent it from outside the CRM, say so to complete it.',
      },
    };
  }

  if (await messageIsLive(task.id)) {
    return {
      automatic: true,
      refusal: {
        status: 409,
        code: 'send_in_flight',
        error: 'This email is already with the mail worker. Wait for it to be sent or to fail.',
      },
    };
  }
  return { automatic: true, refusal: null };
}

/**
 * Take the queued execution job for this task out of the queue. Best effort: the task's own status
 * is the guard, and a job that fires anyway finds a closed task and does nothing. Returns how many
 * jobs were removed; never throws.
 */
export async function cancelAutoSendJob(task: Pick<GuardTask, 'id' | 'leadId' | 'sequenceId' | 'tenantId'>): Promise<number> {
  try {
    if (!task.sequenceId) return 0;
    const enrollments = await prisma.sequenceEnrollment.findMany({
      where: { leadId: task.leadId, sequenceId: task.sequenceId },
      select: { id: true },
    });
    const payloads: Array<Record<string, unknown>> = [
      { taskId: task.id },
      ...enrollments.map((e) => ({ taskId: task.id, expectedEnrollmentId: e.id })),
    ];
    const keys = payloads.map((p) => buildJobDedupeKey(task.tenantId, JobType.SEQUENCE_EXECUTE_TASK, p));
    const runs = await tenantStorage.run({ tenantId: task.tenantId, bypassRls: true }, () =>
      prisma.jobRun.findMany({ where: { dedupeKey: { in: keys } }, select: { id: true, bullJobId: true, status: true } })
    );

    const queue = sequenceQueue();
    let removed = 0;
    for (const run of runs) {
      if (run.status === 'completed' || run.status === 'failed') continue;
      const job = await queue.getJob(run.bullJobId ?? run.id);
      if (!job) continue;
      const state = await job.getState();
      if (state === 'delayed' || state === 'waiting' || state === 'prioritized') {
        await job.remove();
        removed += 1;
      }
    }
    return removed;
  } catch (err) {
    console.warn(`[autoSendGuard] could not remove the queued job for task ${task.id}:`, err);
    return 0;
  }
}

/**
 * Moving an automatic task's due date moves its send with it. Without this the queued job still
 * fires at the old time (or the new date is a lie). Best effort on the queue, like the cancel above.
 */
export async function moveAutoSendJob(
  task: Pick<GuardTask, 'id' | 'leadId' | 'sequenceId' | 'tenantId'>,
  dueDate: Date
): Promise<void> {
  try {
    if (!task.sequenceId) return;
    const enrollment = await prisma.sequenceEnrollment.findFirst({
      where: { leadId: task.leadId, sequenceId: task.sequenceId, status: 'active' },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    });
    if (!enrollment) return;
    await prisma.sequenceEnrollment.updateMany({ where: { id: enrollment.id }, data: { nextActionAt: dueDate } });
    await rescheduleSequenceTask({ taskId: task.id, expectedEnrollmentId: enrollment.id, targetDueAt: dueDate, tenantId: task.tenantId });
  } catch (err) {
    console.warn(`[autoSendGuard] could not move the queued job for task ${task.id}:`, err);
  }
}
