import { prisma } from '@/lib/prisma';
import { getVisibleUserIds, canAccessUser, canAccessLead } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { getLocalDayBoundaries } from '@/lib/dates/timezone';
import { TaskType, TaskPriority } from '@prisma/client';

export interface GetTasksOptions {
  tab?: 'today' | 'yesterday' | 'overdue' | 'pending' | 'all' | string | null;
  leadId?: string | null;
  scopeUserId?: string | null;
  limit?: number;
}

export async function getTasks(user: SessionUser, options: GetTasksOptions) {
  const { tab, leadId, scopeUserId, limit = 500 } = options;

  const targetIdForTz = (scopeUserId && scopeUserId !== 'all' && user.role !== 'sdr') ? scopeUserId : user.id;
  const userTzRecord = await prisma.user.findUnique({
    where: { id: targetIdForTz },
    select: { timezone: true },
  });
  const tz = userTzRecord?.timezone || 'UTC';

  const { start: todayStart, end: todayEnd, yesterdayStart } = getLocalDayBoundaries(new Date(), tz);

  let dateFilter: Record<string, any> = {};
  if (tab === 'today') {
    dateFilter = { dueDate: { gte: todayStart, lt: todayEnd } };
  } else if (tab === 'yesterday') {
    dateFilter = { dueDate: { gte: yesterdayStart, lt: todayStart } };
  } else if (tab === 'overdue') {
    dateFilter = { dueDate: { lt: todayStart }, status: 'pending' };
  } else if (tab === 'pending') {
    dateFilter = { status: 'pending' };
  }

  // Pod scoping: SDRs see own tasks; TL/FM see their pod/floor; director sees all.
  // Managers may further narrow to one visible userId via ?userId=.
  const visibleIds = await getVisibleUserIds(user);
  let userScope: Record<string, unknown> = visibleIds ? { userId: { in: visibleIds } } : {};
  if (scopeUserId && scopeUserId !== 'all' && user.role !== 'sdr') {
    if (visibleIds && !visibleIds.includes(scopeUserId)) {
      throw new Error('Forbidden');
    }
    userScope = { userId: scopeUserId };
  }

  // When viewing a single lead's tasks (lead slide-over), a TL/FM who can access
  // that lead by account sees ALL its tasks — even those owned by an out-of-pod
  // SDR — so they can work the account. Mirrors the lead detail access check.
  if (leadId && visibleIds) {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { assignedToId: true, campaignId: true },
    });
    if (lead && (await canAccessLead(user, lead))) {
      userScope = {};
    }
  }

  const tasks = await prisma.task.findMany({
    where: {
      ...userScope,
      ...(leadId ? { leadId } : {}),
      ...dateFilter,
    },
    include: {
      lead: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          company: true,
          crmPriorityScore: true,
          stage: true,
          tags: true,
          // Campaign + client power the dashboard task filters.
          campaign: {
            select: { id: true, name: true, client: { select: { id: true, name: true } } },
          },
        },
      },
      user: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: [{ dueDate: 'asc' }],
    take: limit,
  });

  const normalized = tasks.map((t) =>
    t.lead ? { ...t, lead: { ...t.lead, priority: t.lead.crmPriorityScore } } : t
  );
  if (tab === 'overdue') {
    return normalized;
  }
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const sorted = normalized.sort((a, b) => (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1));

  return sorted;
}

export interface CreateTaskParams {
  userId?: string;
  leadId: string;
  type: TaskType;
  title: string;
  description?: string;
  dueDate: Date;
  sequenceId?: string;
  sequenceStep?: number;
  priority?: TaskPriority;
}

export async function createTask(user: SessionUser, body: CreateTaskParams) {
  const targetUserId = body.userId ?? user.id;
  if (targetUserId !== user.id && !(await canAccessUser(user, targetUserId))) {
    throw new Error('Forbidden: cannot create task for this user');
  }

  const lead = await prisma.lead.findUnique({ where: { id: body.leadId }, select: { assignedToId: true, campaignId: true } });
  if (!lead) {
    throw new Error('Lead not found');
  }
  if (!(await canAccessLead(user, lead))) {
    throw new Error('Forbidden: cannot access lead');
  }

  const task = await prisma.task.create({
    data: {
      leadId: body.leadId,
      userId: targetUserId,
      type: body.type,
      title: body.title,
      description: body.description,
      dueDate: body.dueDate,
      sequenceId: body.sequenceId,
      sequenceStep: body.sequenceStep,
      priority: body.priority ?? 'medium',
    },
    include: {
      lead: { select: { id: true, firstName: true, lastName: true, company: true } },
    },
  });

  return task;
}
