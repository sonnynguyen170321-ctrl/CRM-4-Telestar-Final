import type { Lead, Sequence, SequenceStep, Task } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { applyStepScheduling, computeStepDueDateForLead, createTaskForStep } from './engine';
import { enrollmentIdFromStepTaskId, enrollmentStepTaskId } from './identity';

/**
 * The pending task an enrollment occurrence is currently sitting on, plus the occurrence identity
 * to put in its execution payload (Phase 8a).
 *
 * Run-now used to `findFirst` a pending task for lead+sequence and enqueue `{ taskId }`. Both
 * halves were wrong once two enrollments can share a lead and a sequence: the task found need not
 * belong to the enrollment the operator clicked, and a payload without `expectedEnrollmentId`
 * builds a *different* dedupe key from the delayed job — so it manufactures a second, legacy-shaped
 * execution instead of promoting the original, and the worker then falls back to matching on
 * lead+sequence.
 *
 * So the occurrence's own deterministic task is preferred, and the fallback only claims an
 * occurrence when the task id proves it belongs to this one.
 */
export interface OccurrenceTask {
  task: Task;
  /** Undefined only for a genuinely pre-Phase-8a task, which has no occurrence identity. */
  expectedEnrollmentId?: string;
}

export async function resolveOccurrenceTask(enrollment: {
  id: string;
  leadId: string;
  sequenceId: string;
  currentStep: number;
}): Promise<OccurrenceTask | null> {
  const deterministic = await prisma.task.findUnique({
    where: { id: enrollmentStepTaskId(enrollment.id, enrollment.currentStep) },
  });
  if (deterministic && deterministic.status === 'pending') {
    return { task: deterministic, expectedEnrollmentId: enrollment.id };
  }

  const fallback = await prisma.task.findFirst({
    where: { leadId: enrollment.leadId, sequenceId: enrollment.sequenceId, status: 'pending' },
    orderBy: { sequenceStep: 'asc' },
  });
  if (!fallback) return null;

  const owner = enrollmentIdFromStepTaskId(fallback.id);
  // A deterministic id belonging to a *different* occurrence is somebody else's cadence.
  if (owner && owner !== enrollment.id) return null;

  return { task: fallback, expectedEnrollmentId: owner ?? undefined };
}

/**
 * Create (or reuse) the current-step task for a **known** enrollment occurrence and schedule it
 * strictly.
 *
 * The single place that turns "this exact enrollment needs its step scheduled" into a task and a
 * job, so a caller holding the enrollment row — the maintenance schedule-drift sweep, today —
 * cannot accidentally produce an anonymous task and a legacy-shaped execution.
 *
 * Scheduling is `strict`, so the enrollment compare-and-set runs *before* anything reaches the
 * queue: an occurrence that went terminal or was replaced between the caller's query and this
 * call throws rather than leaving an executable job behind.
 */
export async function ensureOccurrenceStepTask(input: {
  enrollment: { id: string; leadId: string; sequenceId: string; currentStep: number };
  lead: Pick<Lead, 'id' | 'assignedToId' | 'crmPriorityScore'>;
  sequence: Pick<Sequence, 'id' | 'name'>;
  step: SequenceStep;
  baseDate: Date;
}): Promise<string> {
  const { enrollment, step } = input;
  const taskId = enrollmentStepTaskId(enrollment.id, step.order);

  // Deterministic id: a repeated repair pass reuses the row instead of stacking tasks.
  await createTaskForStep(input.lead, input.sequence, step, input.baseDate, {
    taskId,
    expectedEnrollmentId: enrollment.id,
    deferScheduling: true,
  });

  const dueDate = await computeStepDueDateForLead(
    enrollment.leadId,
    enrollment.sequenceId,
    step,
    input.baseDate
  );
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
  if (task.status !== 'pending') {
    await prisma.task.update({
      where: { id: taskId },
      data: { status: 'pending', completedAt: null, lockedAt: null, dueDate },
    });
  }

  await applyStepScheduling({ ...task, dueDate }, enrollment.sequenceId, step, dueDate, {
    strict: true,
    expectedEnrollmentId: enrollment.id,
  });

  return taskId;
}
