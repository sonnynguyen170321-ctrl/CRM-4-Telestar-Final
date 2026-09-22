/**
 * Settling a cadence step on what the provider actually did.
 *
 * `workers/sequence.ts` used to enqueue the send and then, in the next four statements and
 * unconditionally, mark the task `completed`, increment `Lead.emailSentCount` and
 * `AbTestVariant.sentCount`, and call `advanceSequence`. All of it at *enqueue* time, before
 * anything had been asked of the provider.
 *
 * On 2026-09-21 the provider refused 228 messages (`550 5.4.6 Sender Hourly Quota Exceeded`).
 * The CRM had already recorded 228 completed tasks and advanced 228 enrollments to step 2, so
 * it believed 228 first emails had landed and would have sent the follow-ups that reference
 * them. 251 leads carried an `emailSentCount` above zero with no sent row at all.
 *
 * So the step is settled here, from `workers/email.ts`, once the outcome is known:
 *
 * | provider said            | what happens                                                  |
 * |--------------------------|---------------------------------------------------------------|
 * | accepted                 | `finalizeSequenceStep` — task completed, counters, advance     |
 * | refused, definitively    | `releaseSequenceStep` — task reopened, enrollment paused       |
 * | nothing (timeout, drop)  | neither; the row is `reconciliation_required` and the sweep decides |
 *
 * Both are idempotent and compare-and-set: a retry that reaches the same outcome twice settles
 * the step once. Neither throws — a send that already happened must not be undone by a failure
 * to record it, and `workers/email.ts` calls these after the outbound row is final.
 */
import { prisma } from '@/lib/prisma';
import { advanceSequence } from '@/lib/sequences/engine';

/**
 * What a send needs to carry to settle the step it belongs to.
 *
 * Travels in the BullMQ payload rather than being re-derived from the outbound row: the
 * sequence worker knows all of it at enqueue time, and a job that predates this field simply
 * settles nothing, which is the old behaviour minus the false advance.
 */
export type SequenceStepRef = {
  taskId: string;
  leadId: string;
  /** Whose authority the advance acts under — the lead's assignee. */
  actorUserId: string;
  sequenceId: string;
  sequenceStep: number;
  /** The occurrence this step belongs to, so step 2 stays bound to the same enrollment. */
  enrollmentId?: string;
  /** Counted only when a variant was actually on trial for this send. */
  abVariantId?: string | null;
};

/** The provider accepted the message: complete the step and move the cadence on. */
export async function finalizeSequenceStep(ref: SequenceStepRef): Promise<void> {
  try {
    // Compare-and-set on `pending`: a redrive that sends the same outbound twice must not
    // complete the task twice, and must not advance the cadence twice.
    const completed = await prisma.task.updateMany({
      where: { id: ref.taskId, status: 'pending' },
      data: { status: 'completed', completedAt: new Date(), lockedAt: null },
    });
    if (completed.count !== 1) return;

    if (ref.abVariantId) {
      await prisma.abTestVariant.update({
        where: { id: ref.abVariantId },
        data: { sentCount: { increment: 1 } },
      });
    }
    await prisma.lead.update({
      where: { id: ref.leadId },
      data: { emailSentCount: { increment: 1 } },
    });

    await advanceSequence(
      { leadId: ref.leadId, sequenceId: ref.sequenceId, sequenceStep: ref.sequenceStep },
      ref.actorUserId,
      ref.enrollmentId
    );
  } catch (err) {
    // The message is with the prospect either way. Losing the bookkeeping is recoverable —
    // `repairEnrollmentScheduleDrift` re-schedules a stalled step — and throwing here would
    // fail a job whose side effect has already happened.
    console.error(`[stepOutcome] could not finalize step for task ${ref.taskId}:`, err);
  }
}

/**
 * The provider refused, definitively: give the step back and stop the cadence.
 *
 * The task returns to the claimable pool and the enrollment is paused with a reason, so a
 * human decides whether to resend or drop the prospect. Pausing rather than retrying forever
 * is the 2026-09-22 directive: a cadence must never send step 2 referencing a step 1 that was
 * refused. `paused` still occupies the lead (see `lib/sequences/occupancy.ts`), so nothing
 * else can enrol them while the decision is outstanding.
 */
export async function releaseSequenceStep(ref: SequenceStepRef, reason: string): Promise<void> {
  try {
    await prisma.task.updateMany({
      where: { id: ref.taskId, status: 'pending' },
      data: { lockedAt: null },
    });

    await prisma.sequenceEnrollment.updateMany({
      where: {
        ...(ref.enrollmentId ? { id: ref.enrollmentId } : { leadId: ref.leadId, sequenceId: ref.sequenceId }),
        status: 'active',
      },
      data: {
        status: 'paused',
        pausedReason: 'send_failed',
        lastTransitionAt: new Date(),
        nextActionAt: null,
      },
    });

    console.warn(`[stepOutcome] paused the cadence for lead ${ref.leadId}: ${reason}`);
  } catch (err) {
    console.error(`[stepOutcome] could not release step for task ${ref.taskId}:`, err);
  }
}

/**
 * Rebuild a step reference for an outbound row that is being re-driven.
 *
 * A redrive from `workers/maintenance.ts` starts from the stored message, not from the
 * sequence worker, so it has no payload to carry the reference. Without one the message would
 * send and the step would never settle — the same silence this module exists to end, arriving
 * by a different road.
 *
 * Everything needed is already denormalised on the row (`sequenceId`, `sequenceStepOrder`,
 * `leadId`, `abVariantId`); only the task and the occupying enrollment are looked up, and both
 * are matched on the triple that identifies the step. Returns null for a manual send, which
 * has no step to settle.
 */
export async function resolveStepRefForOutbound(msg: {
  leadId: string;
  sequenceId: string | null;
  sequenceStepOrder: number | null;
  abVariantId: string | null;
  tenantId: string;
}): Promise<SequenceStepRef | null> {
  if (!msg.sequenceId || msg.sequenceStepOrder === null) return null;

  const task = await prisma.task.findFirst({
    where: {
      leadId: msg.leadId,
      sequenceId: msg.sequenceId,
      sequenceStep: msg.sequenceStepOrder,
      status: 'pending',
    },
    select: { id: true, lead: { select: { assignedToId: true } } },
    orderBy: { createdAt: 'desc' },
  });
  if (!task) return null;

  const enrollment = await prisma.sequenceEnrollment.findFirst({
    where: { leadId: msg.leadId, sequenceId: msg.sequenceId, status: { in: ['active', 'paused'] } },
    select: { id: true },
  });

  return {
    taskId: task.id,
    leadId: msg.leadId,
    actorUserId: task.lead.assignedToId,
    sequenceId: msg.sequenceId,
    sequenceStep: msg.sequenceStepOrder,
    enrollmentId: enrollment?.id,
    abVariantId: msg.abVariantId,
  };
}
