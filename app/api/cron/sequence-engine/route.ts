import { NextRequest, NextResponse } from 'next/server';
import { prisma, tenantStorage } from '@/lib/prisma';
import { isAutosendEnabled } from '@/lib/emailSafety';
import { authorizeCronRequest } from '@/lib/cron/auth';
import { recordCronHeartbeat } from '@/lib/ops/cronHeartbeat';

export const dynamic = 'force-dynamic';


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

/**
 * The daily "tasks due" and "sequence steps due" notifications, and this cron's heartbeat.
 *
 * It used to also email every due manual task of type `email` (no sequence) to the lead, using the
 * task title as the subject and its description as the body. A manual task is the rep's own to-do —
 * "Chase John, said not interested" — and `email` is the default type in both task forms, so the
 * prospect received the rep's private note, or a blank email, as soon as the task fell due. Removed
 * (pre-launch audit, 2026-10-05): manual tasks only remind the rep; sequence steps send through
 * the sequence worker. The notifications and heartbeat now run whether or not autosend is on.
 */
export async function GET(req: NextRequest) {
  // Constant-time secret check, and a manager session reaches only its own tenant. The
  // platform-wide sweep is the scheduler's alone — see lib/cron/auth.ts.
  const authz = await authorizeCronRequest(req);
  if (!authz) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return await tenantStorage.run({ tenantId: 'system', bypassRls: true }, async () => {
    const tenantScope = authz.scope === 'platform' ? {} : { tenantId: authz.tenantId };

    let notified = 0;
    try {
      notified = await createDailyNotifications(new Date(), tenantScope);
    } catch (err) {
      console.error('[sequence-engine] daily notifications failed:', err);
    }

    // Leave a trace that this cron ran. Without one, `queue-staleness-check` has no name to hang a
    // recurrence budget on, so this cron silently stopping was undetectable by anything.
    await recordCronHeartbeat('sequence-engine', 'system');

    // `disabled` reports the autosend flag (deep-smoke reads it); this route itself never sends.
    return NextResponse.json({ disabled: !isAutosendEnabled(), sent: 0, notified });
  });
}
