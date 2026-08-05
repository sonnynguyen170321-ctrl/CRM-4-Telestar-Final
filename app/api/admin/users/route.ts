import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole, getVisibleUserIds } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';

/**
 * The People table's data source.
 *
 * Separate from `GET /api/users` on purpose: that route is consumed by Leads,
 * Team View and every assignee picker, returns **active users only**, and must
 * stay cheap. Admin needs deactivated users too (they are exactly the ones
 * holding stranded work) plus per-user open-work counts.
 *
 * Counts come from four `groupBy` calls over the whole visible set — not a
 * per-user query — so the page cost stays flat as the team grows.
 */
export async function GET() {
  const userOrRes = await requireRole('floor_manager');
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    const visibleIds = await getVisibleUserIds(user);
    const scopeWhere = visibleIds ? { id: { in: visibleIds } } : {};

    const users = await prisma.user.findMany({
      where: scopeWhere,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        managerId: true,
        isActive: true,
        timezone: true,
        createdAt: true,
      },
      orderBy: [{ isActive: 'desc' }, { role: 'asc' }, { lastName: 'asc' }],
    });

    const userIds = users.map((u) => u.id);
    const now = new Date();

    const [openLeads, openTasks, memberships, campaigns] = await Promise.all([
      prisma.lead.groupBy({
        by: ['assignedToId'],
        where: {
          assignedToId: { in: userIds },
          archivedAt: null,
          stage: { notIn: ['won', 'lost'] },
        },
        _count: { _all: true },
      }),
      prisma.task.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds }, status: 'pending', dueDate: { lte: now } },
        _count: { _all: true },
      }),
      prisma.campaignSdr.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, campaign: { select: { id: true, name: true } } },
      }),
      prisma.campaign.findMany({
        select: { id: true, name: true, client: { select: { name: true } } },
        orderBy: { name: 'asc' },
      }),
    ]);

    const leadCount = new Map(openLeads.map((r) => [r.assignedToId, r._count._all]));
    const taskCount = new Map(openTasks.map((r) => [r.userId, r._count._all]));
    const campaignsByUser = new Map<string, { id: string; name: string }[]>();
    for (const m of memberships) {
      campaignsByUser.set(m.userId, [...(campaignsByUser.get(m.userId) ?? []), m.campaign]);
    }

    const managerNames = new Map(
      users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()])
    );

    return NextResponse.json(
      {
        users: users.map((u) => ({
          id: u.id,
          email: u.email,
          name: `${u.firstName} ${u.lastName}`.trim(),
          firstName: u.firstName,
          lastName: u.lastName,
          role: u.role,
          managerId: u.managerId,
          managerName: u.managerId ? (managerNames.get(u.managerId) ?? null) : null,
          isActive: u.isActive,
          timezone: u.timezone,
          createdAt: u.createdAt,
          openLeads: leadCount.get(u.id) ?? 0,
          openTasks: taskCount.get(u.id) ?? 0,
          campaigns: campaignsByUser.get(u.id) ?? [],
        })),
        campaigns: campaigns.map((c) => ({
          id: c.id,
          name: c.name,
          clientName: c.client.name,
        })),
        canCreateUsers: user.role === 'director',
      },
      // Pod-scoped: never let a shared or edge cache serve one viewer's scope
      // to another.
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    return handleApiError('api/admin/users GET', err);
  }
}
