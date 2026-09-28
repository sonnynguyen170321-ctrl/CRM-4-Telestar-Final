import { NextRequest, NextResponse } from 'next/server';
import { prisma, tenantStorage } from '@/lib/prisma';
import { createOutboundMessage, enqueueEmailSendWorkflow } from '@/lib/workflows/email';
import { isAutosendEnabled } from '@/lib/emailSafety';
import { authorizeCronRequest } from '@/lib/cron/auth';

export const dynamic = 'force-dynamic';

const LOCK_STALE_MS = 10 * 60 * 1000;

/**
 * @param tenantScope `{}` for the scheduler's platform-wide run, `{ tenantId }` for a manager's
 * manual run. Both task scans below spread it into their WHERE; without it a director in one
 * tenant triggering this by hand wrote Notification rows for every user on the platform.
 */
async function createDailyNotifications(now: Date, tenantScope: { tenantId?: string }): Promise<number> {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setHours(23, 59, 59, 999);

  let created = 0;

  /**
   * task_overdue — one notification per SDR per day for all their overdue pending tasks.
   *
   * Counted in the database. This used to select every overdue pending task in the tenant — no
   * `take`, every five minutes, 288 times a day — and tally them per user in JS, discarding both
   * columns afterwards. A `take` would have been the wrong fix: it bounds the query by silently
   * undercounting, and the count is the whole content of the notification. `groupBy` is bounded by
   * the number of users instead of the number of tasks, and stays exact.
   */
  const overdueByUser = await prisma.task.groupBy({
    by: ['userId', 'tenantId'],
    where: { status: 'pending', dueDate: { lt: startOfDay }, ...tenantScope },
    _count: { _all: true },
  });

  if (overdueByUser.length > 0) {
    const countByUser = new Map<string, { count: number; tenantId: string }>();
    for (const row of overdueByUser) {
      const cur = countByUser.get(row.userId) ?? { count: 0, tenantId: row.tenantId };
      countByUser.set(row.userId, { count: cur.count + row._count._all, tenantId: row.tenantId });
    }

    const existing = await prisma.notification.findMany({
      where: { type: 'task_overdue', createdAt: { gte: startOfDay } },
      select: { userId: true },
    });
    const alreadyNotified = new Set(existing.map((n) => n.userId));

    for (const [userId, { count, tenantId }] of countByUser.entries()) {
      if (alreadyNotified.has(userId)) continue;
      await prisma.notification.create({
        data: {
          tenantId,
          userId,
          type: 'task_overdue',
          title: 'Overdue Tasks',
          text: `You have ${count} overdue task${count === 1 ? '' : 's'} that need${count === 1 ? 's' : ''} attention.`,
          linkTo: '/',
        },
      });
      created++;
    }
  }

  // sequence_step_due — one notification per SDR per day when they have sequence tasks due today.
  // Counted in the database for the same reason as the overdue tally above.
  const seqDueByUser = await prisma.task.groupBy({
    by: ['userId', 'tenantId'],
    where: {
      status: 'pending',
      sequenceId: { not: null },
      dueDate: { gte: startOfDay, lte: endOfDay },
      ...tenantScope,
    },
    _count: { _all: true },
  });

  if (seqDueByUser.length > 0) {
    const seqCountByUser = new Map<string, { count: number; tenantId: string }>();
    for (const row of seqDueByUser) {
      const cur = seqCountByUser.get(row.userId) ?? { count: 0, tenantId: row.tenantId };
      seqCountByUser.set(row.userId, { count: cur.count + row._count._all, tenantId: row.tenantId });
    }

    const existingSeq = await prisma.notification.findMany({
      where: { type: 'sequence_step_due', createdAt: { gte: startOfDay } },
      select: { userId: true },
    });
    const alreadyNotifiedSeq = new Set(existingSeq.map((n) => n.userId));

    for (const [userId, { count, tenantId }] of seqCountByUser.entries()) {
      if (alreadyNotifiedSeq.has(userId)) continue;
      await prisma.notification.create({
        data: {
          tenantId,
          userId,
          type: 'sequence_step_due',
          title: 'Sequence Steps Due Today',
          text: `You have ${count} sequence step${count === 1 ? '' : 's'} due today.`,
          linkTo: '/',
        },
      });
      created++;
    }
  }

  return created;
}

export async function GET(req: NextRequest) {
  // Constant-time secret check, and a manager session reaches only its own tenant. The
  // platform-wide sweep is the scheduler's alone — see lib/cron/auth.ts.
  const authz = await authorizeCronRequest(req);
  if (!authz) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isAutosendEnabled()) {
    return NextResponse.json({ disabled: true, sent: 0 });
  }

  return await tenantStorage.run({ tenantId: 'system', bypassRls: true }, async () => {
    // A manager's manual run touches their own tenant's mailboxes only.
    const tenantScope = authz.scope === 'platform' ? {} : { tenantId: authz.tenantId };
    const activeAccounts = await prisma.emailAccount.findMany({
      where: { isActive: true, ...tenantScope },
      select: { id: true, userId: true },
    });

    const userIds = [...new Set(activeAccounts.map(a => a.userId))];
    const userTenants = userIds.length > 0 ? await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, tenantId: true },
    }) : [];
    const tenantMap = new Map(userTenants.map(u => [u.id, u.tenantId]));

    const result = { sent: 0, skipped: 0, errors: [] as string[] };

    const now = new Date();
    const lockCutoff = new Date(now.getTime() - LOCK_STALE_MS);

    const manualTasks = await prisma.task.findMany({
      where: {
        status: 'pending',
        type: 'email',
        sequenceId: null,
        dueDate: { lte: now },
        // Explicit, not implied: the loop below already drops tasks whose assignee has no active
        // account in scope, but a filter that exists only as a side effect of a later `continue`
        // is one refactor away from not existing.
        ...tenantScope,
        OR: [{ lockedAt: null }, { lockedAt: { lt: lockCutoff } }],
      },
      orderBy: { dueDate: 'asc' },
      take: 10,
      include: {
        lead: {
          include: { assignedTo: { select: { id: true, firstName: true, lastName: true, role: true } } },
        },
      },
    });

    for (const task of manualTasks) {
      try {
        const account = await prisma.emailAccount.findFirst({
          where: { userId: task.lead.assignedToId, isActive: true },
        });
        if (!account) continue;

        const tenantId = tenantMap.get(task.lead.assignedToId);
        if (!tenantId) continue;

        const claimed = await prisma.task.updateMany({
          where: { id: task.id, status: 'pending', lockedAt: task.lockedAt },
          data: { lockedAt: now },
        });
        if (claimed.count !== 1) continue;

        try {
          await tenantStorage.run({ tenantId }, async () => {
            const outbound = await createOutboundMessage({
              source: { kind: 'task', taskId: task.id },
              leadId: task.lead.id,
              accountId: account.id,
              to: task.lead.email,
              subject: task.title,
              body: task.description ?? '',
              tenantId,
            });
            await enqueueEmailSendWorkflow(
              {
                outboundMessageId: outbound.id,
                accountId: account.id,
                to: task.lead.email,
                subject: task.title,
                body: task.description ?? '',
                leadId: task.lead.id,
              },
              tenantId
            );
          });
        } catch (sendErr) {
          console.error(`[sequence-engine] Failed to enqueue email for task ${task.id}:`, sendErr);
          await prisma.task.update({ where: { id: task.id }, data: { lockedAt: null } });
          result.errors.push(task.id);
          continue;
        }

        try {
          await tenantStorage.run({ tenantId }, async () => {
            await prisma.task.update({
              where: { id: task.id },
              data: { status: 'completed', completedAt: new Date() },
            });
          });
          result.sent++;
        } catch (dbErr) {
          console.error(`[sequence-engine] Failed to mark task ${task.id} as completed after sending:`, dbErr);
          result.sent++;
        }
      } catch (err) {
        console.error(`[sequence-engine] Error processing manual task ${task.id}:`, err);
        result.errors.push(task.id);
      }
    }

    let notified = 0;
    try {
      notified = await tenantStorage.run({ tenantId: 'system', bypassRls: true }, async () => {
        return await createDailyNotifications(now, tenantScope);
      });
    } catch (err) {
      console.error('[sequence-engine] daily notifications failed:', err);
    }

    return NextResponse.json({
      processed: (result.sent + result.skipped + result.errors.length + manualTasks.length),
      sent: result.sent,
      skipped: result.skipped,
      errors: result.errors.length,
      notified,
    });
  });
}
