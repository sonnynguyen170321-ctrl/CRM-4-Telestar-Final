import type { SequenceEnrollment } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { normalizePausedReason, type PausedReason } from '@/lib/automation/types';
import { rescheduleSequenceTask } from '@/lib/bullmq/rescheduleSequenceTask';
import { computeStepDueDateForLead, createTaskForStep } from './engine';
import { enrollmentStepTaskId } from './identity';
import { occupancyKeyFor } from './occupancy';

/**
 * Occurrence-scoped pause and resume (Phase 8a).
 *
 * Both routes — the single enrollment status route and the bulk action route — call these, so
 * there is one lifecycle state machine rather than two that drift.
 *
 * ## Why lead-scoped pausing is not enough
 *
 * `pauseSequence(leadId)` re-reads `Lead.sequenceId` to decide what to pause. After a caller has
 * already claimed a specific enrollment, that re-read reopens the exact race the claim closed:
 *
 * ```text
 * route claims enrollment A → paused
 * SDR switches the prospect to sequence B
 * route calls pauseSequence(leadId) → reads B → pauses B
 * ```
 *
 * So these take the enrollment, the lead **and** the sequence they mean, and every write is
 * conditioned on all three. Nothing here reads an unconstrained `Lead.sequenceId`.
 */

export type LifecycleRefusal =
  | 'not_active'
  | 'not_paused'
  | 'occupancy_conflict'
  | 'sequence_mismatch'
  /** An execution of this cadence is in flight; the caller should retry rather than duplicate it. */
  | 'execution_in_flight'
  /**
   * A resume prerequisite is gone, so the cadence cannot be made runnable. These are refusals
   * rather than quiet successes: reporting a resume that leaves no current-step task and no job
   * would settle the completion watermark, and the occurrence would then look healthy to every
   * later retry — permanently stuck, undetectably.
   */
  | 'sequence_missing'
  | 'sequence_inactive'
  | 'step_missing'
  | 'lead_missing';

export type LifecycleOutcome =
  /** A paused occurrence was brought back and its bookkeeping completed. */
  | 'resumed'
  /** An earlier resume had been interrupted; this call finished it. */
  | 'repaired'
  /** The occurrence was already fully active — nothing was written. */
  | 'already_active';

export interface LifecycleResult {
  ok: boolean;
  outcome?: LifecycleOutcome;
  refusal?: LifecycleRefusal;
  detail?: string;
}

export interface PauseOccurrenceInput {
  enrollmentId: string;
  leadId: string;
  sequenceId: string;
  reason: PausedReason | string;
  actorUserId: string;
}

/**
 * Pause one enrollment occurrence.
 *
 * The status, the reason and the transition timestamp are one statement, conditioned on the
 * enrollment still being active *and* still belonging to the expected sequence. The reason used
 * to be lost: the route flipped the row to `paused` first, and `pauseSequence` then looked for
 * `status: 'active'` rows to stamp — finding none.
 */
export async function pauseEnrollmentOccurrence(
  input: PauseOccurrenceInput
): Promise<LifecycleResult> {
  const reason = normalizePausedReason(input.reason);
  const now = new Date();

  const claimed = await prisma.sequenceEnrollment.updateMany({
    where: {
      id: input.enrollmentId,
      leadId: input.leadId,
      sequenceId: input.sequenceId,
      status: 'active',
    },
    data: {
      status: 'paused',
      pausedReason: reason,
      lastTransitionAt: now,
      // Occupancy is retained: a paused cadence still holds the lead.
    },
  });

  if (claimed.count !== 1) {
    return {
      ok: false,
      refusal: 'not_active',
      detail: `Enrollment ${input.enrollmentId} is not an active enrollment of sequence ${input.sequenceId}`,
    };
  }

  // Compatibility cache, only while the lead still points at this cadence.
  await prisma.lead.updateMany({
    where: { id: input.leadId, sequenceId: input.sequenceId },
    data: { sequenceStatus: 'paused' },
  });

  // Only this cadence's pending tasks.
  await prisma.task.updateMany({
    where: { leadId: input.leadId, sequenceId: input.sequenceId, status: 'pending' },
    data: { status: 'skipped' },
  });

  await prisma.activity.create({
    data: {
      userId: input.actorUserId,
      leadId: input.leadId,
      sequenceId: input.sequenceId,
      type: 'sequence_deferred',
      description: `Sequence paused (${reason})`,
      metadata: { enrollmentId: input.enrollmentId, sequenceId: input.sequenceId, reason },
    },
  });

  return { ok: true };
}

export interface ResumeOccurrenceInput {
  enrollmentId: string;
  leadId: string;
  sequenceId: string;
  tenantId: string;
}

/**
 * Is this active row an interrupted resume rather than a healthy cadence?
 *
 * `lastTransitionAt` is only ever written by a status transition, and the only transition *into*
 * `active` is a resume — so on an active row it is the resume's durable identity. `lastEvaluatedAt`
 * is the completion watermark: `finishResume` writes it last, after the task, the schedule and the
 * execution job are all in place. A resume that died part-way therefore leaves
 * `lastEvaluatedAt < lastTransitionAt`, and a cadence that was never paused leaves
 * `lastTransitionAt` null, so a normal active run is never mistaken for one needing repair.
 */
function interruptedResumeAt(row: SequenceEnrollment): Date | null {
  if (row.status !== 'active' || !row.lastTransitionAt) return null;
  if (row.lastEvaluatedAt && row.lastEvaluatedAt >= row.lastTransitionAt) return null;
  return row.lastTransitionAt;
}

/**
 * Resume one enrollment occurrence — idempotently, and convergent after a crash.
 *
 * The paused→active CAS is durable the instant it commits; everything after it (the lead cache,
 * the task, `nextActionAt`, `nextTaskDue`, the execution job) is not. A process that died in
 * between used to be unrecoverable: the row was active, so a retry answered `not_paused` and the
 * route answered `Already active`, while the cadence sat with a skipped task and nothing scheduled.
 *
 * So the CAS establishes a **stable resume identity** — its own `lastTransitionAt` — and every
 * recovery re-derives the *same* intended due time from it. Retrying does not walk the schedule
 * forward, and repeating a finished resume writes nothing at all.
 */
export async function resumeEnrollmentOccurrence(
  input: ResumeOccurrenceInput
): Promise<LifecycleResult> {
  const now = new Date();

  let claimed;
  try {
    claimed = await prisma.sequenceEnrollment.updateMany({
      where: {
        id: input.enrollmentId,
        leadId: input.leadId,
        sequenceId: input.sequenceId,
        status: 'paused',
      },
      data: {
        status: 'active',
        pausedReason: null,
        lastTransitionAt: now,
        occupancyKey: occupancyKeyFor(input.tenantId, input.leadId),
      },
    });
  } catch (err) {
    if ((err as { code?: string })?.code === 'P2002') {
      return {
        ok: false,
        refusal: 'occupancy_conflict',
        detail: 'Another sequence is already running for this lead.',
      };
    }
    throw err;
  }

  if (claimed.count === 1) {
    return finishResume(input, now, 'resumed');
  }

  // Not paused. Before refusing, let the row say whether it is mid-resume — that decision belongs
  // here and not in a route, which can only see a status.
  const row = await prisma.sequenceEnrollment.findUnique({ where: { id: input.enrollmentId } });
  if (
    !row ||
    row.leadId !== input.leadId ||
    row.sequenceId !== input.sequenceId ||
    row.status !== 'active'
  ) {
    return {
      ok: false,
      refusal: 'not_paused',
      detail: `Enrollment ${input.enrollmentId} is not a paused enrollment of sequence ${input.sequenceId}`,
    };
  }

  const resumeAt = interruptedResumeAt(row);
  if (!resumeAt) {
    // A healthy active cadence: no duplicate task, no duplicate schedule, no restart.
    return { ok: true, outcome: 'already_active' };
  }

  // Recovery uses the *original* resume's timestamp, so the repaired schedule is the one the
  // interrupted attempt intended rather than a new one computed from the clock.
  return finishResume(input, resumeAt, 'repaired');
}

/**
 * The bookkeeping half of a resume: lead cache, the occurrence's own task, the schedule, the
 * execution job — then the completion watermark, last.
 *
 * Every write is derived from `resumeAt`, so running this twice produces the same result, and
 * failing part-way leaves the watermark unwritten so the next call finishes the job.
 */
async function finishResume(
  input: ResumeOccurrenceInput,
  resumeAt: Date,
  outcome: LifecycleOutcome
): Promise<LifecycleResult> {
  const enrollment = await prisma.sequenceEnrollment.findUniqueOrThrow({
    where: { id: input.enrollmentId },
  });

  // Prerequisites first, before any write. A resume that cannot produce a runnable current step
  // must refuse — and refuse *without* the watermark, so the occurrence stays visibly incomplete
  // and a later retry (after the step is restored) still converges.
  const sequence = await prisma.sequence.findUnique({
    where: { id: input.sequenceId },
    include: { steps: { orderBy: { order: 'asc' } } },
  });
  if (!sequence) {
    return {
      ok: false,
      refusal: 'sequence_missing',
      detail: `Sequence ${input.sequenceId} no longer exists; enrollment ${input.enrollmentId} cannot be resumed.`,
    };
  }
  if (!sequence.isActive || sequence.isArchived) {
    // The eligibility engine BLOCKs these permanently, so a restored cadence here would be a task
    // nothing can ever send. Reactivate the sequence, then resume.
    return {
      ok: false,
      refusal: 'sequence_inactive',
      detail: `Sequence ${input.sequenceId} is ${sequence.isArchived ? 'archived' : 'inactive'}; reactivate it before resuming.`,
    };
  }
  const step = sequence.steps.find((s) => s.order === enrollment.currentStep);
  if (!step) {
    return {
      ok: false,
      refusal: 'step_missing',
      detail: `Sequence ${input.sequenceId} has no step ${enrollment.currentStep}; restore the step or unenroll the lead.`,
    };
  }
  const lead = await prisma.lead.findUnique({ where: { id: input.leadId } });
  if (!lead) {
    return {
      ok: false,
      refusal: 'lead_missing',
      detail: `Lead ${input.leadId} no longer exists.`,
    };
  }

  await prisma.lead.updateMany({
    where: { id: input.leadId, sequenceId: input.sequenceId },
    data: { sequenceStatus: 'active', sequenceStep: enrollment.currentStep },
  });

  const taskId = enrollmentStepTaskId(input.enrollmentId, step.order);
  // Deterministic in `resumeAt`: a retry recomputes this exact instant instead of moving it.
  const dueDate = await computeStepDueDateForLead(
    input.leadId,
    input.sequenceId,
    step,
    resumeAt
  );

  const existing = await prisma.task.findUnique({ where: { id: taskId } });
  if (!existing) {
    // The occurrence's own deterministic id, so a repeated repair reuses the row rather than
    // manufacturing a second current-step task.
    await createTaskForStep(lead, sequence, step, resumeAt, {
      taskId,
      expectedEnrollmentId: input.enrollmentId,
      deferScheduling: true,
    });
  }

  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
  if (task.status !== 'completed') {
    await prisma.task.update({
      where: { id: taskId },
      data: { status: 'pending', completedAt: null, lockedAt: null, dueDate },
    });
  }

  await prisma.sequenceEnrollment.updateMany({
    where: { id: input.enrollmentId, status: 'active' },
    data: { nextActionAt: dueDate },
  });
  await prisma.lead.updateMany({
    where: { id: input.leadId, sequenceId: input.sequenceId },
    data: { nextTaskDue: dueDate },
  });

  if (task.type === 'email' && step.autoComplete && task.status !== 'completed') {
    const scheduled = await rescheduleSequenceTask({
      taskId,
      expectedEnrollmentId: input.enrollmentId,
      targetDueAt: dueDate,
      tenantId: input.tenantId,
    });
    if (!scheduled.ok) {
      // Leave the watermark unwritten: the occurrence stays "mid-resume" and the next attempt
      // finishes it, rather than reporting a resume with nothing runnable behind it.
      return { ok: false, refusal: scheduled.refusal, detail: scheduled.detail };
    }
  }

  await settleResume(input.enrollmentId);
  return { ok: true, outcome };
}

/** The completion watermark. Written last, and only once everything above is durable. */
async function settleResume(enrollmentId: string): Promise<void> {
  await prisma.sequenceEnrollment.updateMany({
    where: { id: enrollmentId, status: 'active' },
    data: { lastEvaluatedAt: new Date() },
  });
}
