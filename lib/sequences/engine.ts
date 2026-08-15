import { prisma } from '@/lib/prisma';
import { occupancyKeyFor, releaseOccupancy } from './occupancy';
import { enrollmentStepTaskId } from './identity';
import type { Lead, Sequence, SequenceStep, Task } from '@prisma/client';
import {
  PAUSED_REASON_LABELS,
  normalizePausedReason,
  type PausedReason,
} from '@/lib/automation/types';
import { enqueue } from '@/lib/bullmq/enqueue';
import { ensureJob } from '@/lib/bullmq/ensureJob';
import { JobType } from '@/lib/bullmq/types';

/**
 * Sequence execution engine (SKILL.md §3).
 *
 * Sequences drive the daily task list: enrolling a lead creates the step-1
 * task, completing a sequence task creates the task for the next step, and
 * replies/bounces/stage milestones pause or end the run. All writes are
 * plain single statements — the Neon HTTP driver does not support
 * interactive transactions, so nothing here may use prisma.$transaction.
 */

import { calculateNextActionAt } from '@/lib/automation/scheduling';
import { resolveTimezone } from '@/lib/automation/timezone';
import { buildJitterSeed } from '@/lib/automation/jitter';

const PRIORITY_MAP = { hot: 'high', warm: 'medium', cold: 'low' } as const;

export function computeStepDueDate(
  base: Date,
  step: Pick<SequenceStep, 'delayDays' | 'delayHours' | 'sendWindowStartMinutes' | 'sendWindowEndMinutes'>,
  options?: { timezone?: string | null; seed?: string | null }
): Date {
  const tz = options?.timezone ? resolveTimezone(options.timezone) : 'UTC';
  const sched = calculateNextActionAt({
    baseAt: base,
    delayDays: step.delayDays,
    delayHours: step.delayHours,
    sendWindowStartMinutes: step.sendWindowStartMinutes ?? null,
    sendWindowEndMinutes: step.sendWindowEndMinutes ?? null,
    timezone: tz,
    businessDayPolicy: 'skip_weekends',
    deterministicSeed: options?.seed ?? null,
  });
  return sched.dueAtUtc;
}

/**
 * Create the task for one sequence step and update the lead's nextTaskDue.
 *
 * `options.taskId` lets a caller supply a **deterministic** primary key derived from its own
 * durable identity. Two concurrent finalizers of the same launch then collide on the Task
 * primary key — the database refuses the second — instead of a `findFirst` → `create` pair
 * racing past each other and scheduling the cadence twice. The loser reuses the winner's row.
 * Callers with no such identity omit it and get the usual generated id.
 */
export async function createTaskForStep(
  lead: Pick<Lead, 'id' | 'assignedToId' | 'crmPriorityScore'>,
  sequence: Pick<Sequence, 'id' | 'name'>,
  step: SequenceStep,
  baseDate: Date,
  options?: {
    taskId?: string;
    strictScheduling?: boolean;
    deferScheduling?: boolean;
    expectedEnrollmentId?: string;
  }
): Promise<Task> {
  const leadFull = await prisma.lead.findUnique({
    where: { id: lead.id },
    select: { timezone: true, tenantId: true, assignedTo: { select: { timezone: true } } },
  });

  const tz = resolveTimezone(leadFull?.timezone, leadFull?.assignedTo?.timezone);
  const seed = buildJitterSeed({
    tenantId: leadFull?.tenantId,
    sequenceId: sequence.id,
    sequenceStepId: step.id,
    leadId: lead.id,
  });

  const dueDate = computeStepDueDate(baseDate, step, { timezone: tz, seed });
  const channelLabel = step.channel.charAt(0).toUpperCase() + step.channel.slice(1);

  const task = await createOrReuseTask({
    id: options?.taskId,
    leadId: lead.id,
    userId: lead.assignedToId,
    type: step.channel,
    title: `Step ${step.order}: ${channelLabel} — ${sequence.name}`,
    description: step.instructions ?? null,
    dueDate,
    sequenceId: sequence.id,
    sequenceStep: step.order,
    priority: PRIORITY_MAP[lead.crmPriorityScore],
  });

  // A caller that records durable progress between the row and its schedule asks for the two to
  // be separate; it calls `applyStepScheduling` itself.
  if (!options?.deferScheduling) {
    await applyStepScheduling(task, sequence.id, step, dueDate, {
      strict: options?.strictScheduling,
      expectedEnrollmentId: options?.expectedEnrollmentId,
    });
  }

  return task;
}

async function createOrReuseTask(data: {
  id?: string;
  leadId: string;
  userId: string;
  type: SequenceStep['channel'];
  title: string;
  description: string | null;
  dueDate: Date;
  sequenceId: string;
  sequenceStep: number;
  priority: Task['priority'];
}): Promise<Task> {
  try {
    return await prisma.task.create({ data: { ...data, id: data.id } });
  } catch (err) {
    // A supplied deterministic id that already exists means another finalizer won the race, or
    // this one is being retried. Either way the row is the one to use.
    const isDuplicate =
      data.id && (err as { code?: string })?.code === 'P2002';
    if (!isDuplicate) throw err;
    return prisma.task.findUniqueOrThrow({ where: { id: data.id as string } });
  }
}

/**
 * The scheduling half of creating a step's task: the lead's next-due cache, the enrollment's
 * runtime state, and the delayed execution job.
 *
 * Separated and exported because a crash between the Task row and this work leaves a task
 * nothing will execute, and a resuming caller must be able to re-apply it. Every write here is
 * idempotent — the two updates are last-write-wins with the same computed value, and `enqueue`
 * derives its dedupe key from `(tenantId, jobType, payload)`, so re-enqueuing the same task
 * resolves to the same `JobRun` and the same BullMQ job id rather than a second delivery.
 */
export async function applyStepScheduling(
  task: Task,
  sequenceId: string,
  step: Pick<SequenceStep, 'autoComplete'>,
  dueDate: Date,
  options?: { strict?: boolean; expectedEnrollmentId?: string }
): Promise<void> {
  // An occurrence-scoped caller names the enrollment it means. Without that, this targets
  // "whichever active enrollment matches lead+sequence", which after a human replacement is
  // somebody else's cadence.
  const scheduled = await prisma.sequenceEnrollment.updateMany({
    where: {
      ...(options?.expectedEnrollmentId ? { id: options.expectedEnrollmentId } : {}),
      leadId: task.leadId,
      sequenceId,
      status: 'active',
    },
    data: {
      nextActionAt: dueDate,
      lastEvaluatedAt: new Date(),
    },
  });

  // Strict callers must have updated exactly their own enrollment. Zero means it stopped being
  // the active occupying one while this ran — refuse *before* a job reaches the prospect.
  if (options?.strict && options.expectedEnrollmentId && scheduled.count !== 1) {
    // Thrown *before* the lead's cache is touched: a launch that lost its cadence must not
    // rewrite the replacement's `nextTaskDue` on its way out.
    throw new Error(
      `Refusing to schedule: enrollment ${options.expectedEnrollmentId} is no longer the active enrollment for lead ${task.leadId}`
    );
  }

  await prisma.lead.update({
    where: { id: task.leadId },
    data: { nextTaskDue: dueDate },
  });

  // Schedule delayed execution on the BullMQ SEQUENCE queue for automated email steps. A manual
  // step needs no execution job at all — its absence is not a failure.
  if (task.type !== 'email' || !step.autoComplete) return;

  const delay = Math.max(0, dueDate.getTime() - Date.now());

  // `strict` is for a caller whose own completion depends on the job existing — the AI launch.
  // It uses `ensureJob`, which never rewrites a JobRun that is already running or finished, and
  // it lets the error propagate so the launch stays resumable instead of reporting success with
  // nothing scheduled.
  // A resumed cadence does not come through here: it needs the existing delayed job *moved*
  // rather than a second one added beside it — see `lib/bullmq/rescheduleSequenceTask.ts`.
  if (options?.strict) {
    // The occurrence travels with the job. Without it the worker falls back to matching on
    // lead+sequence, and an old task can execute under a later enrollment.
    await ensureJob(
      JobType.SEQUENCE_EXECUTE_TASK,
      { taskId: task.id, expectedEnrollmentId: options.expectedEnrollmentId },
      { tenantId: task.tenantId, delay }
    );
    return;
  }

  try {
    await enqueue(
      JobType.SEQUENCE_EXECUTE_TASK,
      // The occurrence rides along here too, so step 2 and beyond keep the protection step 1 has.
      { taskId: task.id, expectedEnrollmentId: options?.expectedEnrollmentId },
      { delay, tenantId: task.tenantId },
    );
  } catch (err) {
    console.error(`[applyStepScheduling] Failed to schedule execution for task ${task.id}:`, err);
  }
}

/** Recompute a step's due date the same way `createTaskForStep` did, for a resumed finalizer. */
export async function computeStepDueDateForLead(
  leadId: string,
  sequenceId: string,
  step: SequenceStep,
  baseDate: Date
): Promise<Date> {
  const leadFull = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { timezone: true, tenantId: true, assignedTo: { select: { timezone: true } } },
  });
  const tz = resolveTimezone(leadFull?.timezone, leadFull?.assignedTo?.timezone);
  const seed = buildJitterSeed({
    tenantId: leadFull?.tenantId,
    sequenceId,
    sequenceStepId: step.id,
    leadId,
  });
  return computeStepDueDate(baseDate, step, { timezone: tz, seed });
}

/**
 * Advance a lead to the next sequence step after a sequence task completes.
 * Unenrolls + notifies when the final step is done; otherwise increments
 * sequenceStep and creates the next task (due relative to now).
 */
export async function advanceSequence(
  task: Pick<Task, 'leadId' | 'sequenceId' | 'sequenceStep'>,
  actorUserId: string,
  /**
   * The enrollment occurrence this cadence belongs to (Phase 8a).
   *
   * Carried through so the *next* step's task and delayed job stay bound to the same occurrence.
   * Without it the protection would end at step 1 and step 2 would go back to matching on
   * lead+sequence, which is what lets an old job execute under a later enrollment.
   */
  expectedEnrollmentId?: string
): Promise<void> {
  if (!task.sequenceId || task.sequenceStep === null || task.sequenceStep === undefined) return;

  // With an occurrence id the caller names *which* cadence completed a step. Correlating on
  // lead+sequence here would let a stale execution belonging to enrollment A advance — or
  // terminalize — enrollment B, which is the replacement race the payload identity exists to close.
  if (expectedEnrollmentId) {
    return advanceOccurrence(
      { ...task, sequenceId: task.sequenceId, sequenceStep: task.sequenceStep },
      actorUserId,
      expectedEnrollmentId
    );
  }

  const lead = await prisma.lead.findUnique({
    where: { id: task.leadId },
    select: {
      id: true, sequenceId: true, sequenceStep: true, sequenceStatus: true,
      assignedToId: true, firstName: true, lastName: true, crmPriorityScore: true,
    },
  });
  if (!lead || lead.sequenceId !== task.sequenceId) return;

  const sequence = await prisma.sequence.findUnique({
    where: { id: task.sequenceId },
    include: { steps: { orderBy: { order: 'asc' } } },
  });
  if (!sequence) return;

  const totalSteps = sequence.steps.length;
  const nextStepOrder = (lead.sequenceStep ?? task.sequenceStep) + 1;

  // Don't queue further work while paused (reply/bounce); resume re-creates it
  if (lead.sequenceStatus === 'paused') return;

  if (nextStepOrder > totalSteps) {
    // All steps done — unenroll and notify
    await prisma.lead.update({
      where: { id: lead.id },
      data: { sequenceId: null, sequenceStep: null, sequenceStatus: null },
    });
    await prisma.sequenceEnrollment.updateMany({
      where: { leadId: lead.id, sequenceId: task.sequenceId, status: { in: ['active', 'paused'] } },
      // Occupancy released in the same statement as the terminal status: a crash between the two
      // would leave the lead occupied by a finished cadence and un-enrollable forever.
      data: { status: 'completed', completedAt: new Date(), ...releaseOccupancy() },
    });
    await prisma.activity.create({
      data: {
        userId: actorUserId,
        leadId: lead.id,
        type: 'sequence_completed',
        description: `Completed all ${totalSteps} steps of "${sequence.name}"`,
        metadata: { sequenceName: sequence.name, totalSteps },
      },
    });
    if (lead.assignedToId) {
      await prisma.notification.create({
        data: {
          userId: lead.assignedToId,
          type: 'sequence_completed',
          title: 'Sequence Completed',
          text: `${lead.firstName} ${lead.lastName} completed all ${totalSteps} steps in "${sequence.name}".`,
          linkTo: `/leads/${lead.id}`,
        },
      });
    }
    return;
  }

  await prisma.lead.update({
    where: { id: lead.id, sequenceStep: lead.sequenceStep },
    data: { sequenceStep: nextStepOrder },
  });

  await prisma.sequenceEnrollment.updateMany({
    where: { leadId: lead.id, sequenceId: task.sequenceId, status: 'active' },
    data: { currentStep: nextStepOrder },
  });

  const nextStep = sequence.steps.find((s) => s.order === nextStepOrder);
  if (nextStep) {
    await createTaskForStep(lead, sequence, nextStep, new Date());
  }
}

/**
 * Advance the **exact** enrollment occurrence that completed a step.
 *
 * Every state write names the enrollment by primary key and is conditioned on it still being the
 * active, occupying cadence sitting on the step just completed. If that compare-and-set matches
 * nothing, this stops entirely: no lead cache write, no next task, no next job. A stale execution
 * therefore cannot advance, complete, or clear the cache of the cadence that replaced it.
 */
async function advanceOccurrence(
  task: { leadId: string; sequenceId: string; sequenceStep: number },
  actorUserId: string,
  expectedEnrollmentId: string
): Promise<void> {
  const completedStep = task.sequenceStep;

  const lead = await prisma.lead.findUnique({
    where: { id: task.leadId },
    select: {
      id: true, tenantId: true, sequenceId: true, sequenceStep: true,
      assignedToId: true, firstName: true, lastName: true, crmPriorityScore: true,
    },
  });
  if (!lead) return;

  const enrollment = await prisma.sequenceEnrollment.findUnique({
    where: { id: expectedEnrollmentId },
  });
  const owns =
    enrollment &&
    enrollment.leadId === task.leadId &&
    enrollment.sequenceId === task.sequenceId &&
    enrollment.status === 'active' &&
    enrollment.currentStep === completedStep &&
    enrollment.occupancyKey === occupancyKeyFor(lead.tenantId, task.leadId);
  if (!owns) return;

  const sequence = await prisma.sequence.findUnique({
    where: { id: task.sequenceId },
    include: { steps: { orderBy: { order: 'asc' } } },
  });
  if (!sequence) return;

  const totalSteps = sequence.steps.length;
  const nextStepOrder = completedStep + 1;

  if (nextStepOrder > totalSteps) {
    // Terminalize this occurrence only. The lead-and-sequence form used by the legacy path would
    // complete a replacement enrollment that happens to share both.
    const finished = await prisma.sequenceEnrollment.updateMany({
      where: {
        id: expectedEnrollmentId,
        leadId: task.leadId,
        sequenceId: task.sequenceId,
        status: 'active',
        currentStep: completedStep,
      },
      data: { status: 'completed', completedAt: new Date(), ...releaseOccupancy() },
    });
    if (finished.count !== 1) return;

    // Conditional on the cache still pointing at this cadence, so a lead already switched to a
    // replacement keeps its own sequence fields.
    await prisma.lead.updateMany({
      where: { id: lead.id, sequenceId: task.sequenceId },
      data: { sequenceId: null, sequenceStep: null, sequenceStatus: null },
    });
    await prisma.activity.create({
      data: {
        userId: actorUserId,
        leadId: lead.id,
        type: 'sequence_completed',
        description: `Completed all ${totalSteps} steps of "${sequence.name}"`,
        metadata: { sequenceName: sequence.name, totalSteps, enrollmentId: expectedEnrollmentId },
      },
    });
    if (lead.assignedToId) {
      await prisma.notification.create({
        data: {
          userId: lead.assignedToId,
          type: 'sequence_completed',
          title: 'Sequence Completed',
          text: `${lead.firstName} ${lead.lastName} completed all ${totalSteps} steps in "${sequence.name}".`,
          linkTo: `/leads/${lead.id}`,
        },
      });
    }
    return;
  }

  const advanced = await prisma.sequenceEnrollment.updateMany({
    where: {
      id: expectedEnrollmentId,
      leadId: task.leadId,
      sequenceId: task.sequenceId,
      status: 'active',
      currentStep: completedStep,
    },
    data: { currentStep: nextStepOrder },
  });
  if (advanced.count !== 1) return;

  await prisma.lead.updateMany({
    where: { id: lead.id, sequenceId: task.sequenceId },
    data: { sequenceStep: nextStepOrder },
  });

  const nextStep = sequence.steps.find((s) => s.order === nextStepOrder);
  if (!nextStep) return;

  // The next step stays bound to the same occurrence, so its task id and its delayed job carry
  // the identity too — otherwise the protection would end after step 1.
  await createTaskForStep(lead, sequence, nextStep, new Date(), {
    taskId: enrollmentStepTaskId(expectedEnrollmentId, nextStep.order),
    expectedEnrollmentId,
  });
}

/**
 * @deprecated Use `PausedReason` from `@/lib/automation/types`. Retained only so callers
 * that still import this name keep compiling; it is the same type.
 */
export type PauseReason = PausedReason;

/**
 * What a pause attempt actually did.
 *
 * `pauseSequence` used to return void, so a caller could not tell "I paused a running cadence"
 * from "there was nothing to pause". That mattered once handoff started calling it: a reply
 * from a prospect with no active sequence is still a real handoff, so `no_sequence` must not
 * read as failure — while a genuine database error must still surface rather than be inferred
 * from a missing side effect.
 */
export type PauseOutcome =
  /** An active run was paused. */
  | 'paused'
  /** There was a sequence, but no active enrollment to pause — already paused or finished. */
  | 'already_paused_or_stopped'
  /** The lead is not in a sequence at all. Not an error. */
  | 'no_sequence';

/**
 * Pause a lead's sequence run: mark paused, skip its pending sequence tasks,
 * log an activity. Callers create the reason-specific notification/task.
 *
 * Throws on a database failure. Callers must not treat an absent side effect as an error —
 * that is what the returned outcome is for.
 */
export async function pauseSequence(
  leadId: string,
  reason: PausedReason | string,
  actorUserId: string
): Promise<PauseOutcome> {
  // Single write site for pausedReason, so a legacy caller or an in-flight BullMQ job
  // carrying the old payload shape still lands on a token the UI can render.
  const pausedReason = normalizePausedReason(reason);

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, sequenceId: true, firstName: true, lastName: true },
  });
  if (!lead?.sequenceId) return 'no_sequence';

  await prisma.lead.update({
    where: { id: leadId },
    data: { sequenceStatus: 'paused' },
  });

  // The enrollment is authoritative for execution state, so its update count — not the lead
  // cache — is what says whether a running cadence was actually stopped.
  const pausedEnrollments = await prisma.sequenceEnrollment.updateMany({
    where: { leadId, sequenceId: lead.sequenceId, status: 'active' },
    data: {
      status: 'paused',
      pausedReason,
      lastTransitionAt: new Date(),
    },
  });

  await prisma.task.updateMany({
    where: { leadId, sequenceId: lead.sequenceId, status: 'pending' },
    data: { status: 'skipped' },
  });

  const sequence = await prisma.sequence.findUnique({
    where: { id: lead.sequenceId },
    select: { name: true },
  });

  // No dedicated "paused" ActivityType in the enum — record it as a sequence_unenrolled
  // activity with `paused: true` in metadata so the feed/analytics can distinguish it.
  await prisma.activity.create({
    data: {
      userId: actorUserId,
      leadId,
      type: 'sequence_unenrolled',
      description: `Sequence "${sequence?.name ?? lead.sequenceId}" paused — ${PAUSED_REASON_LABELS[pausedReason]}`,
      metadata: { sequenceId: lead.sequenceId, reason: pausedReason, paused: true },
    },
  });

  return pausedEnrollments.count > 0 ? 'paused' : 'already_paused_or_stopped';
}

/**
 * Set-based pause for the admin "pause open tasks" removal mode.
 *
 * All three statements are required. Skipping the tasks alone would just let the
 * engine regenerate them on the next advance, so the lead and the enrollment have
 * to be paused too — the same three writes `pauseSequence` does for one lead.
 *
 * Locked tasks are left alone: the send cron has claimed them and is mid-flight.
 * The count of those is returned so the caller can tell the admin to re-run.
 *
 * `reason` here is the admin's free-text justification and lands on `Task.outcome`. The
 * enrollment's `pausedReason` is `manual` regardless: an operator removing a campaign member
 * is a manual pause whatever they typed in the box. Leaving it null — as this did until the
 * vocabularies were collapsed — made bulk-paused runs the only ones the lead panel could not
 * explain.
 */
export async function pauseSequencesBulk(
  leadIds: string[],
  actorUserId: string,
  reason: string
): Promise<{ pausedLeads: number; skippedTasks: number; lockedTasks: number }> {
  if (leadIds.length === 0) return { pausedLeads: 0, skippedTasks: 0, lockedTasks: 0 };

  const CHUNK = 500;
  let pausedLeads = 0;
  let skippedTasks = 0;
  let lockedTasks = 0;

  for (let i = 0; i < leadIds.length; i += CHUNK) {
    const chunk = leadIds.slice(i, i + CHUNK);

    lockedTasks += await prisma.task.count({
      where: { leadId: { in: chunk }, status: 'pending', lockedAt: { not: null } },
    });

    const leads = await prisma.lead.updateMany({
      where: { id: { in: chunk }, sequenceStatus: 'active' },
      data: { sequenceStatus: 'paused' },
    });
    pausedLeads += leads.count;

    const tasks = await prisma.task.updateMany({
      where: { leadId: { in: chunk }, status: 'pending', lockedAt: null },
      data: { status: 'skipped', outcome: reason },
    });
    skippedTasks += tasks.count;

    await prisma.sequenceEnrollment.updateMany({
      where: { leadId: { in: chunk }, status: 'active' },
      data: { status: 'paused', pausedReason: 'manual', lastTransitionAt: new Date() },
    });
  }

  await prisma.activity.create({
    data: {
      userId: actorUserId,
      type: 'sequence_unenrolled',
      description: `Bulk pause — ${leadIds.length} lead(s): ${reason}`,
      metadata: { kind: 'admin_bulk_pause', leadCount: leadIds.length, reason, paused: true },
    },
  });

  return { pausedLeads, skippedTasks, lockedTasks };
}

/**
 * Fully unenroll a lead (stage milestones, manual unenroll, sequence switch):
 * clear enrollment fields and skip any pending sequence tasks.
 */
export async function unenrollLead(leadId: string, sequenceId: string): Promise<void> {
  await prisma.lead.update({
    where: { id: leadId },
    data: { sequenceId: null, sequenceStep: null, sequenceStatus: null },
  });
  await prisma.task.updateMany({
    where: { leadId, sequenceId, status: 'pending' },
    data: { status: 'skipped' },
  });
  await prisma.sequenceEnrollment.updateMany({
    where: { leadId, sequenceId, status: { in: ['active', 'paused'] } },
    data: { status: 'unenrolled', completedAt: new Date(), ...releaseOccupancy() },
  });
}
