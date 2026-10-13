/**
 * Convert email steps that have a template to send themselves.
 *
 * The owner's decision (2026-10): an email step with a template is sent by the CRM, not typed
 * again by a rep. Steps created before that decision were saved with `autoComplete = false`, so
 * every one of their tasks sits in someone's list waiting for a click that sends nothing.
 *
 * This is the one-off that fixes the data, and it is built so it can be read before it is run:
 *
 *  - **Dry run by default.** `planAutoSendConversion` writes nothing. It lists, per step, how many
 *    tasks are pending, how many enrollments sit on it, and whether the sequence has a mailbox to
 *    send from - the three numbers that say what flipping the switch would do.
 *  - **Never a burst.** Flipping a step does not send its overdue tasks. Each pending task is
 *    given a new due time at the next send window (the same scheduling the engine uses), plus a
 *    deterministic offset spread over `spreadMinutes`, so hundreds of overdue steps do not become
 *    hundreds of sends in one minute. The worker still applies windows, mailbox caps and the
 *    suppression gate when each one fires.
 *  - **Idempotent.** A step already converted is not listed again, and a task that already has a
 *    live execution job is not scheduled again. A run that stopped half-way is finished by running
 *    it again.
 *
 * Runs inside a tenant context (scripts/lib/tenantContext.ts) *and* names the tenant in every query.
 * The context alone is not enough: a script runs with `bypassRls`, under which `lib/prisma.ts` adds
 * no tenant filter to reads, so a plan built from the context alone would list every tenant's steps
 * under each tenant's name and `--apply` would convert them all.
 */
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import type { SequenceStep } from '@prisma/client';
import { buildJobDedupeKey } from '@/lib/bullmq/ensureJob';
import { JobType } from '@/lib/bullmq/types';
import { rescheduleSequenceTask } from '@/lib/bullmq/rescheduleSequenceTask';
import { deterministicOffset, buildJitterSeed } from '@/lib/automation/jitter';
import { computeStepDueDateForLead } from './engine';
import { sequenceSenderGap } from './sender';

export const DEFAULT_SPREAD_MINUTES = 240;

export type MailboxState = 'ok' | 'none_chosen' | 'all_disconnected';

export interface AutoSendCandidate {
  stepId: string;
  sequenceId: string;
  sequenceName: string;
  sequenceActive: boolean;
  stepOrder: number;
  templateId: string;
  /** The step is switched to manual today; applying turns auto-send on. */
  willConvert: boolean;
  pendingTasks: number;
  /** Pending tasks with no execution job behind them (what applying would schedule). */
  unscheduledTasks: number;
  activeEnrollments: number;
  mailbox: MailboxState;
}

export interface AutoSendApplyResult {
  convertedSteps: number;
  rescheduled: number;
  skipped: Array<{ taskId: string; reason: string }>;
}

interface PendingTaskRow {
  id: string;
  leadId: string;
  dueDate: Date;
  lockedAt: Date | null;
}

async function pendingTasksForStep(tenantId: string, sequenceId: string, order: number): Promise<PendingTaskRow[]> {
  return prisma.task.findMany({
    where: { tenantId, sequenceId, sequenceStep: order, type: 'email', status: 'pending' },
    select: { id: true, leadId: true, dueDate: true, lockedAt: true },
  });
}

async function activeEnrollmentFor(tenantId: string, leadId: string, sequenceId: string, order: number) {
  return prisma.sequenceEnrollment.findFirst({
    where: { tenantId, leadId, sequenceId, currentStep: order, status: 'active' },
    orderBy: { startedAt: 'desc' },
    select: { id: true },
  });
}

/** True when the task has no execution job that could still run. */
async function lacksLiveJob(tenantId: string, taskId: string, enrollmentId: string | undefined): Promise<boolean> {
  const dedupeKey = buildJobDedupeKey(tenantId, JobType.SEQUENCE_EXECUTE_TASK, {
    taskId,
    expectedEnrollmentId: enrollmentId,
  });
  const run = await tenantStorage.run({ tenantId, bypassRls: true }, () =>
    prisma.jobRun.findUnique({ where: { dedupeKey }, select: { status: true } })
  );
  // Only a job that can still run counts; a completed or failed one will not send this task again.
  return !run || run.status === 'completed' || run.status === 'failed';
}

/** What converting would do. Writes nothing. */
export async function planAutoSendConversion(tenantId: string): Promise<AutoSendCandidate[]> {
  const steps = await prisma.sequenceStep.findMany({
    where: { tenantId, channel: 'email', templateId: { not: null }, sequence: { isArchived: false } },
    include: { sequence: { select: { id: true, name: true, isActive: true, tenantId: true } } },
    orderBy: [{ sequenceId: 'asc' }, { order: 'asc' }],
  });

  const out: AutoSendCandidate[] = [];
  const gapBySequence = new Map<string, MailboxState>();

  for (const step of steps) {
    const pending = await pendingTasksForStep(tenantId, step.sequenceId, step.order);
    let unscheduled = 0;
    for (const task of pending) {
      const enrollment = await activeEnrollmentFor(tenantId, task.leadId, step.sequenceId, step.order);
      if (enrollment && (await lacksLiveJob(tenantId, task.id, enrollment.id))) unscheduled += 1;
    }

    const willConvert = !step.autoComplete;
    // An already-automatic step is only worth listing when it has tasks nothing will pick up.
    if (!willConvert && unscheduled === 0) continue;

    if (!gapBySequence.has(step.sequenceId)) {
      const gap = await sequenceSenderGap(tenantId, step.sequenceId);
      gapBySequence.set(step.sequenceId, gap ?? 'ok');
    }

    const activeEnrollments = await prisma.sequenceEnrollment.count({
      where: { tenantId, sequenceId: step.sequenceId, currentStep: step.order, status: 'active' },
    });

    out.push({
      stepId: step.id,
      sequenceId: step.sequenceId,
      sequenceName: step.sequence.name,
      sequenceActive: step.sequence.isActive,
      stepOrder: step.order,
      templateId: step.templateId as string,
      willConvert,
      pendingTasks: pending.length,
      unscheduledTasks: unscheduled,
      activeEnrollments,
      mailbox: gapBySequence.get(step.sequenceId) ?? 'ok',
    });
  }
  return out;
}

/**
 * When a pending task should now go out. A task still in the future keeps its date; an overdue one
 * goes to the next send window, then is spread by its lead's deterministic offset.
 */
async function targetDueFor(
  step: SequenceStep,
  tenantId: string,
  task: PendingTaskRow,
  now: Date,
  spreadMinutes: number
): Promise<Date> {
  if (task.dueDate.getTime() > now.getTime()) return task.dueDate;
  // Zero delay: "as soon as the window allows", not "a step-delay from now".
  const next = await computeStepDueDateForLead(task.leadId, step.sequenceId, { ...step, delayDays: 0, delayHours: 0 }, now);
  const seed = buildJitterSeed({ tenantId, sequenceId: step.sequenceId, sequenceStepId: step.id, leadId: task.leadId });
  return new Date(next.getTime() + deterministicOffset(`spread:${seed}`, Math.max(1, spreadMinutes)) * 60_000);
}

/** Convert the planned steps and schedule their pending tasks. */
export async function applyAutoSendConversion(
  candidates: AutoSendCandidate[],
  options: { tenantId: string; now?: Date; spreadMinutes?: number }
): Promise<AutoSendApplyResult> {
  const now = options.now ?? new Date();
  const spread = options.spreadMinutes ?? DEFAULT_SPREAD_MINUTES;
  const result: AutoSendApplyResult = { convertedSteps: 0, rescheduled: 0, skipped: [] };

  for (const candidate of candidates) {
    const step = await prisma.sequenceStep.findFirst({ where: { id: candidate.stepId, tenantId: options.tenantId } });
    if (!step || !step.templateId) continue;

    if (!step.autoComplete) {
      const flipped = await prisma.sequenceStep.updateMany({
        where: { id: step.id, tenantId: options.tenantId, autoComplete: false },
        data: { autoComplete: true },
      });
      result.convertedSteps += flipped.count;
    }

    for (const task of await pendingTasksForStep(options.tenantId, step.sequenceId, step.order)) {
      if (task.lockedAt) {
        result.skipped.push({ taskId: task.id, reason: 'already being sent' });
        continue;
      }
      const enrollment = await activeEnrollmentFor(options.tenantId, task.leadId, step.sequenceId, step.order);
      if (!enrollment) {
        result.skipped.push({ taskId: task.id, reason: 'no active enrollment on this step' });
        continue;
      }
      if (!(await lacksLiveJob(options.tenantId, task.id, enrollment.id))) continue;

      const target = await targetDueFor(step, options.tenantId, task, now, spread);
      const moved = await prisma.task.updateMany({
        where: { id: task.id, tenantId: options.tenantId, status: 'pending', lockedAt: null },
        data: { dueDate: target },
      });
      if (moved.count !== 1) {
        result.skipped.push({ taskId: task.id, reason: 'changed while converting' });
        continue;
      }
      await prisma.sequenceEnrollment.updateMany({
        where: { id: enrollment.id, status: 'active' },
        data: { nextActionAt: target },
      });
      await prisma.lead.updateMany({
        where: { id: task.leadId, sequenceId: step.sequenceId },
        data: { nextTaskDue: target },
      });

      const scheduled = await rescheduleSequenceTask({
        taskId: task.id,
        expectedEnrollmentId: enrollment.id,
        targetDueAt: target,
        tenantId: options.tenantId,
      });
      if (scheduled.ok) result.rescheduled += 1;
      else result.skipped.push({ taskId: task.id, reason: scheduled.detail ?? scheduled.refusal ?? 'could not schedule' });
    }
  }
  return result;
}
