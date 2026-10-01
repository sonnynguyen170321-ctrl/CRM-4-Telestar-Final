import { prisma } from '@/lib/prisma';
import { canAccessUser, canAccessLead } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { advanceSequence } from '@/lib/sequences/engine';

/**
 * One action applied to many tasks, for both the HTTP route and the chat assistant.
 *
 * This body used to live inside `app/api/tasks/bulk/route.ts`. It moved here so the agent tools
 * could reach it **without a second implementation**: the per-task rules below encode five things
 * that must not be re-derived — the per-task access check, the `status: 'pending'` compare-and-set
 * that makes double-completion impossible, the outcome requirement on call channels, the
 * `lastContactedAt` write, and the deliberate *absence* of an Activity for reschedule and reassign.
 * A second copy would drift, and the drift would be silent.
 *
 * The alternative — having the tool call its own HTTP route — is not merely worse, it cannot work.
 * `getSessionUser` reads the request cookie and is request-scoped, there is no server-side base URL
 * threaded through `lib/ai/`, and the same tools run from BullMQ workers where no request exists.
 * Making it work would mean inventing a service credential, which is a path that bypasses
 * `canAccessUser` / `canAccessLead` by construction.
 */

/** Channels whose completion requires a logged outcome (SKILL.md §21–§22). */
const OUTCOME_REQUIRED_TYPES = ['phone', 'linkedin', 'whatsapp'];

const ACTIVITY_TYPE_BY_TASK_TYPE: Record<string, string> = {
  email: 'email_task_completed',
  phone: 'call_logged',
  linkedin: 'linkedin_touch',
  whatsapp: 'whatsapp_message',
  manual: 'task_completed',
};

/**
 * Who is asking.
 *
 * The only behavioural difference is the cadence guard below, and it exists because a human
 * completing a cadence step has seen the prospect, the thread and the step; a model acting on
 * "mark my overdue tasks done" has seen a sentence.
 */
export type BulkActorKind = 'human' | 'agent';

export interface BulkTaskActionInput {
  action: 'complete' | 'skip' | 'reschedule' | 'reassign' | 'note';
  taskIds: string[];
  dueDate?: Date;
  userId?: string;
  note?: string | null;
  outcome?: string | null;
}

export interface BulkTaskActionResult {
  updated: number;
  failed: { taskId: string; reason: string }[];
  /**
   * Set when the *reassignment target* failed `canAccessUser`. The caller decides the shape of the
   * refusal: the route answers 403, the tool answers prose. Nothing is mutated when this is set.
   */
  refusedTarget?: string;
}

async function loadTasks(taskIds: string[]) {
  return prisma.task.findMany({
    where: { id: { in: taskIds } },
    include: { lead: true },
  });
}

type TaskWithLead = Awaited<ReturnType<typeof loadTasks>>[number];

/**
 * Apply one action to many tasks.
 *
 * Each task is checked individually (`canAccessUser` on the owner, or `canAccessLead` on the lead)
 * so a caller can never bulk-edit another rep's tasks by naming their ids. Tasks that fail a check,
 * or that are already closed, are reported in `failed[]` rather than failing the whole call.
 */
export async function applyBulkTaskAction(
  user: SessionUser,
  input: BulkTaskActionInput,
  actor: BulkActorKind
): Promise<BulkTaskActionResult> {
  /**
   * Refuse rather than return nothing.
   *
   * `lib/prisma.ts` answers `[]` to any `findMany` that runs in production with no tenant context,
   * which is the right default for a read but a trap here: `loadTasks` would come back empty, every
   * id would be reported `Not found`, and the caller would see a tidy, confident, completely wrong
   * result. That silent-success shape is the defect class this repository keeps paying for, so this
   * function will not run without a tenant.
   */
  if (!user.tenantId) {
    throw new Error('applyBulkTaskAction refused: no tenant context on the session user');
  }

  // The reassignment target is checked once, before anything is written.
  if (input.action === 'reassign' && input.userId !== user.id) {
    if (!(await canAccessUser(user, input.userId!))) {
      return { updated: 0, failed: [], refusedTarget: input.userId };
    }
  }

  const tasks = await loadTasks(input.taskIds);
  const failed: { taskId: string; reason: string }[] = [];
  const allowed: TaskWithLead[] = [];

  for (const taskId of input.taskIds) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) {
      failed.push({ taskId, reason: 'Not found' });
      continue;
    }
    const canAccess =
      (await canAccessUser(user, task.userId)) || (await canAccessLead(user, task.lead));
    if (!canAccess) {
      failed.push({ taskId, reason: 'Forbidden' });
      continue;
    }

    /**
     * The agent does not complete a task that belongs to a live cadence.
     *
     * Completing calls `advanceSequence` below, which creates the next step's task and — for an
     * `autoComplete` email step — enqueues a delayed BullMQ send job. So one sentence to the
     * assistant ("mark all my overdue tasks done") would hand N prospect emails to a worker with no
     * human between the sentence and the send, and every Activity would carry the SDR's own user id,
     * leaving nobody able to tell afterwards whether the rep or the model did it.
     *
     * The gate is on `sequenceId`, not on the verb, because that column is what actually decides
     * reach: `advanceSequence` returns immediately when it is null. A verb-based rule would refuse
     * "mark my three manual reminders done" — the most common and most harmless request there is.
     *
     * This is deliberately not an `AutonomyMode`. It is a floor no stored policy can raise, in the
     * spirit of `CAPABILITY_CEILING` but applied to the object rather than the capability: a
     * director who sets `task_complete: 'auto'` still cannot get cadence advancement out of chat.
     */
    if (actor === 'agent' && input.action === 'complete' && task.sequenceId !== null) {
      failed.push({
        taskId,
        reason:
          'This task is a step in a live sequence — completing it advances the cadence and can send ' +
          'mail, so it has to be completed from the task list by a person.',
      });
      continue;
    }

    allowed.push(task);
  }

  let updated = 0;

  for (const task of allowed) {
    if (input.action === 'complete' || input.action === 'skip') {
      const status = input.action === 'complete' ? 'completed' : 'skipped';

      // A call / LinkedIn / WhatsApp task carries a required outcome. Completing it in
      // bulk is only allowed when the caller supplies one for the whole selection.
      if (status === 'completed' && OUTCOME_REQUIRED_TYPES.includes(task.type) && !input.outcome) {
        failed.push({
          taskId: task.id,
          reason: `${task.type} tasks need an outcome — complete them individually or pick a shared outcome`,
        });
        continue;
      }

      const result = await prisma.task.updateMany({
        where: { id: task.id, status: 'pending' },
        data: {
          status,
          completedAt: status === 'completed' ? new Date() : null,
          ...(input.note ? { notes: input.note } : {}),
          ...(input.outcome ? { outcome: input.outcome } : {}),
        },
      });
      if (result.count === 0) {
        failed.push({ taskId: task.id, reason: 'Already completed or skipped' });
        continue;
      }

      await prisma.activity.create({
        data: {
          userId: user.id,
          leadId: task.leadId,
          type: (status === 'skipped'
            ? 'task_skipped'
            : ACTIVITY_TYPE_BY_TASK_TYPE[task.type]) as never,
          channel: task.type !== 'manual' ? (task.type as never) : null,
          description:
            status === 'skipped'
              ? `Skipped task (bulk): "${task.title}"`
              : `Completed ${task.type} task (bulk): "${task.title}"`,
          metadata: { outcome: input.outcome, notes: input.note, taskTitle: task.title, bulk: true },
        },
      });

      if (['email', 'phone', 'linkedin', 'whatsapp'].includes(task.type)) {
        await prisma.lead.update({
          where: { id: task.leadId },
          data: { lastContactedAt: new Date() },
        });
      }

      if (status === 'completed') {
        await advanceSequence(task, user.id);
      }

      updated++;
      continue;
    }

    if (input.action === 'reschedule') {
      const result = await prisma.task.updateMany({
        where: { id: task.id, status: 'pending' },
        data: { dueDate: input.dueDate },
      });
      if (result.count === 0) {
        failed.push({ taskId: task.id, reason: 'Only pending tasks can be rescheduled' });
        continue;
      }
      // No Activity here: `ActivityType` has no reschedule/reassign member, and the
      // Prisma audit extension already records the update in `AuditLog`. Inventing an
      // activity type would corrupt the leaderboard, which counts outreach activities.
      updated++;
      continue;
    }

    if (input.action === 'reassign') {
      await prisma.task.update({ where: { id: task.id }, data: { userId: input.userId! } });
      updated++;
      continue;
    }

    if (input.action === 'note') {
      await prisma.note.create({
        data: { leadId: task.leadId, content: input.note!, createdById: user.id },
      });
      await prisma.activity.create({
        data: {
          userId: user.id,
          leadId: task.leadId,
          type: 'note_added' as never,
          description: `Note added from task (bulk): "${task.title}"`,
          metadata: { taskTitle: task.title, bulk: true },
        },
      });
      updated++;
    }
  }

  return { updated, failed };
}
