/**
 * A composer send that belongs to a sequence task.
 *
 * A manual email step (no template) is a task for a rep to write and send. The composer used to
 * carry the task id only as an idempotency key: the message went out, the task stayed pending, and
 * the rep then pressed Complete as a second, unrelated action - so the cadence advanced on the
 * click, not on the send. Here the send carries a step reference instead, the same one the
 * automatic path uses, so `finalizeSequenceStep` closes the task and advances the cadence only
 * after the provider confirms, and a definitive refusal settles it the same way (stepOutcome.ts).
 *
 * A step the CRM sends itself is refused: its own job sends it, and a second author for the same
 * message is how a prospect gets two.
 */
import { prisma } from '@/lib/prisma';
import { canAccessLead, canAccessUser } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import type { SequenceStepRef } from './stepOutcome';
import { isAutomaticEmailTask } from './autoSendGuard';

export type ComposerTaskResult =
  | { ok: true; ref: SequenceStepRef | null; sequenceId: string | null; stepOrder: number | null }
  | { ok: false; status: number; error: string; code?: string };

const NO_STEP = { ok: true, ref: null, sequenceId: null, stepOrder: null } as const;

export async function resolveComposerTask(
  user: SessionUser,
  input: { taskId: string; leadId?: string }
): Promise<ComposerTaskResult> {
  const task = await prisma.task.findUnique({ where: { id: input.taskId }, include: { lead: true } });
  // Not a task of this tenant (or not a task at all). The id is also the send's idempotency key, so an
  // id that names nothing here must not be accepted: it could collide with another tenant's send.
  if (!task) return { ok: false, status: 404, error: 'Task not found' };

  if (!(await canAccessUser(user, task.userId)) && !(await canAccessLead(user, task.lead))) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  if (input.leadId && input.leadId !== task.leadId) {
    return { ok: false, status: 400, error: 'This task belongs to a different lead' };
  }
  if (task.type !== 'email' || !task.sequenceId || task.sequenceStep === null) return NO_STEP;

  if (task.status !== 'pending') {
    return { ok: false, status: 409, error: 'This task is already completed or skipped' };
  }
  if (await isAutomaticEmailTask(task)) {
    return {
      ok: false,
      status: 409,
      code: 'auto_send_pending',
      error: 'The CRM sends this step itself - it does not need to be written by hand.',
    };
  }

  const enrollment = await prisma.sequenceEnrollment.findFirst({
    where: { leadId: task.leadId, sequenceId: task.sequenceId, status: { in: ['active', 'paused'] } },
    orderBy: { startedAt: 'desc' },
    select: { id: true, status: true, currentStep: true },
  });
  if (enrollment && (enrollment.status !== 'active' || enrollment.currentStep !== task.sequenceStep)) {
    return { ok: false, status: 409, error: 'The cadence is no longer on this step' };
  }

  return {
    ok: true,
    sequenceId: task.sequenceId,
    stepOrder: task.sequenceStep,
    ref: {
      taskId: task.id,
      leadId: task.leadId,
      // The advance acts under the lead's owner, the same authority the automatic path uses.
      actorUserId: task.lead.assignedToId,
      sequenceId: task.sequenceId,
      sequenceStep: task.sequenceStep,
      enrollmentId: enrollment?.id,
      abVariantId: null,
    },
  };
}
