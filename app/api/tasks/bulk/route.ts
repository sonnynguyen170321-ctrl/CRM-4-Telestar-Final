import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, canAccessUser, canAccessLead } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { advanceSequence } from '@/lib/sequences/engine';
import { parseBody } from '@/lib/validation/core';
import { bulkTaskActionSchema } from '@/lib/validation/schemas';
import { handleApiError } from '@/lib/api/errors';

/** Channels whose completion requires a logged outcome (SKILL.md §21–§22). */
const OUTCOME_REQUIRED_TYPES = ['phone', 'linkedin', 'whatsapp'];

const ACTIVITY_TYPE_BY_TASK_TYPE: Record<string, string> = {
  email: 'email_task_completed',
  phone: 'call_logged',
  linkedin: 'linkedin_touch',
  whatsapp: 'whatsapp_message',
  manual: 'task_completed',
};

type TaskWithLead = Awaited<ReturnType<typeof loadTasks>>[number];

async function loadTasks(taskIds: string[]) {
  return prisma.task.findMany({
    where: { id: { in: taskIds } },
    include: { lead: true },
  });
}

/**
 * Apply one action to many tasks.
 *
 * Each task is checked individually (`canAccessUser` on the owner, or `canAccessLead`
 * on the lead) so an SDR can never bulk-edit another rep's tasks by posting their ids.
 * Tasks that fail a check — or that are already closed — are reported back in
 * `failed[]` instead of failing the whole request.
 */
export async function POST(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const parsed = await parseBody(req, bulkTaskActionSchema, 'Invalid bulk task action');
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  try {
    // Reassignment target must be someone this user manages.
    if (body.action === 'reassign' && body.userId !== user.id) {
      if (!(await canAccessUser(user, body.userId!))) {
        return NextResponse.json({ error: 'Forbidden: cannot assign to that user' }, { status: 403 });
      }
    }

    const tasks = await loadTasks(body.taskIds);
    const failed: { taskId: string; reason: string }[] = [];
    const allowed: TaskWithLead[] = [];

    for (const taskId of body.taskIds) {
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
      allowed.push(task);
    }

    let updated = 0;

    for (const task of allowed) {
      if (body.action === 'complete' || body.action === 'skip') {
        const status = body.action === 'complete' ? 'completed' : 'skipped';

        // A call / LinkedIn / WhatsApp task carries a required outcome. Completing it in
        // bulk is only allowed when the caller supplies one for the whole selection.
        if (status === 'completed' && OUTCOME_REQUIRED_TYPES.includes(task.type) && !body.outcome) {
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
            ...(body.note ? { notes: body.note } : {}),
            ...(body.outcome ? { outcome: body.outcome } : {}),
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
            metadata: { outcome: body.outcome, notes: body.note, taskTitle: task.title, bulk: true },
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

      if (body.action === 'reschedule') {
        const result = await prisma.task.updateMany({
          where: { id: task.id, status: 'pending' },
          data: { dueDate: body.dueDate },
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

      if (body.action === 'reassign') {
        await prisma.task.update({ where: { id: task.id }, data: { userId: body.userId! } });
        updated++;
        continue;
      }

      if (body.action === 'note') {
        await prisma.note.create({
          data: { leadId: task.leadId, content: body.note!, createdById: user.id },
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

    return NextResponse.json({ action: body.action, updated, failed });
  } catch (err) {
    return handleApiError('api/tasks/bulk POST', err);
  }
}
