import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole, getVisibleUserIds, getVisibleCampaignIds } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { cacheGet, cacheSet, listKey } from '@/lib/cache';
import { handleApiError } from '@/lib/api/errors';

/**
 * "What needs attention right now?" for the Admin Control Center landing page.
 *
 * One endpoint, not six client fetches. The org is small (tens of users, tens of
 * campaigns), so three small table reads plus four in-memory passes beat six
 * aggregate round-trips; only the counts that genuinely need the database
 * (work owned by deactivated users, sequences live under a paused campaign) are
 * issued as `groupBy`.
 */

const CACHE_TTL_SECONDS = 30;
const MAX_ITEMS_PER_CARD = 10;

type Severity = 'error' | 'warn' | 'info';

type CardItem = { id: string; label: string; detail: string; href: string };
type Card = {
  key: string;
  title: string;
  severity: Severity;
  count: number;
  items: CardItem[];
};

export async function GET() {
  const userOrRes = await requireRole('floor_manager');
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    const [visibleUserIds, visibleCampaignIds] = await Promise.all([
      getVisibleUserIds(user),
      getVisibleCampaignIds(user),
    ]);

    const scopeTag = `${visibleUserIds?.length ?? 'all'}:${visibleCampaignIds?.length ?? 'all'}:${user.id}`;
    const cacheKey = listKey(user.tenantId, 'admin-overview', scopeTag);
    const cached = await cacheGet<{ generatedAt: string; cards: Card[] }>(cacheKey);
    if (cached) return NextResponse.json(cached);

    const [users, memberships, campaigns] = await Promise.all([
      prisma.user.findMany({
        where: visibleUserIds ? { id: { in: visibleUserIds } } : {},
        select: {
          id: true,
          firstName: true,
          lastName: true,
          role: true,
          managerId: true,
          isActive: true,
        },
      }),
      prisma.campaignSdr.findMany({ select: { campaignId: true, userId: true } }),
      prisma.campaign.findMany({
        where: visibleCampaignIds ? { id: { in: visibleCampaignIds } } : {},
        select: {
          id: true,
          name: true,
          status: true,
          client: { select: { id: true, name: true, status: true } },
        },
      }),
    ]);

    const activeUserById = new Map(users.filter((u) => u.isActive).map((u) => [u.id, u]));
    const name = (u: { firstName: string; lastName: string }) =>
      `${u.firstName} ${u.lastName}`.trim();

    // ── In-memory cards ─────────────────────────────────────────────────────
    const membersByCampaign = new Map<string, string[]>();
    const campaignsByUser = new Map<string, number>();
    for (const m of memberships) {
      membersByCampaign.set(m.campaignId, [...(membersByCampaign.get(m.campaignId) ?? []), m.userId]);
      campaignsByUser.set(m.userId, (campaignsByUser.get(m.userId) ?? 0) + 1);
    }

    const campaignsWithoutSdr = campaigns.filter((c) => {
      if (c.status !== 'active') return false;
      const members = membersByCampaign.get(c.id) ?? [];
      return !members.some((uid) => {
        const u = activeUserById.get(uid);
        return u && (u.role === 'sdr' || u.role === 'team_lead');
      });
    });

    const usersWithoutManager = users.filter(
      (u) => u.isActive && u.managerId === null && u.role !== 'director'
    );

    const usersWithoutCampaign = users.filter(
      (u) => u.isActive && (u.role === 'sdr' || u.role === 'leadgen') && !campaignsByUser.has(u.id)
    );

    const clientPausedCampaignActive = campaigns.filter(
      (c) => c.status === 'active' && c.client.status !== 'active'
    );

    // ── Aggregate cards ─────────────────────────────────────────────────────
    const inactiveIds = users.filter((u) => !u.isActive).map((u) => u.id);
    const userById = new Map(users.map((u) => [u.id, u]));

    const orphanedWork = inactiveIds.length > 0 ? await countOrphanedWork(inactiveIds) : new Map();

    const pausedCampaignIds = campaigns.filter((c) => c.status === 'paused').map((c) => c.id);
    const liveSequencesUnderPaused =
      pausedCampaignIds.length > 0
        ? await prisma.lead.groupBy({
            by: ['campaignId'],
            where: {
              campaignId: { in: pausedCampaignIds },
              sequenceStatus: 'active',
              archivedAt: null,
            },
            _count: { _all: true },
          })
        : [];
    const campaignById = new Map(campaigns.map((c) => [c.id, c]));

    const cards: Card[] = [
      buildCard({
        key: 'campaigns_without_sdr',
        title: 'Active campaigns with no SDR',
        severity: 'error',
        source: campaignsWithoutSdr,
        toItem: (c) => ({
          id: c.id,
          label: c.name,
          detail: c.client.name,
          href: `/admin/campaigns/${c.id}/members`,
        }),
      }),
      buildCard({
        key: 'orphaned_work',
        title: 'Work owned by deactivated users',
        severity: 'error',
        source: [...orphanedWork.entries()],
        toItem: ([userId, counts]) => {
          const u = userById.get(userId);
          return {
            id: userId,
            label: u ? name(u) : userId,
            detail:
              `${counts.leads} lead(s), ${counts.tasks} task(s), ` +
              `${counts.meetings} meeting(s), ${counts.opportunities} opportunity(ies)`,
            href: `/admin/transfer-work?fromUserId=${userId}`,
          };
        },
      }),
      buildCard({
        key: 'client_paused_campaign_active',
        title: 'Active campaigns under a paused or churned client',
        severity: 'warn',
        source: clientPausedCampaignActive,
        toItem: (c) => ({
          id: c.id,
          label: c.name,
          detail: `${c.client.name} is ${c.client.status}`,
          href: `/admin/clients`,
        }),
      }),
      buildCard({
        key: 'sequences_under_paused_campaign',
        title: 'Paused campaigns with sequences still running',
        severity: 'warn',
        source: liveSequencesUnderPaused,
        toItem: (row) => ({
          id: row.campaignId,
          label: campaignById.get(row.campaignId)?.name ?? row.campaignId,
          detail: `${row._count._all} lead(s) still enrolled`,
          href: `/leads?campaignId=${row.campaignId}`,
        }),
      }),
      buildCard({
        key: 'users_without_manager',
        title: 'Users with no manager',
        severity: 'warn',
        source: usersWithoutManager,
        toItem: (u) => ({
          id: u.id,
          label: name(u),
          detail: u.role.replace('_', ' '),
          href: `/admin/teams`,
        }),
      }),
      buildCard({
        key: 'users_without_campaign',
        title: 'Reps with no campaign assigned',
        severity: 'info',
        source: usersWithoutCampaign,
        toItem: (u) => ({
          id: u.id,
          label: name(u),
          detail: u.role.replace('_', ' '),
          href: `/admin/users?userId=${u.id}`,
        }),
      }),
    ];

    const payload = {
      generatedAt: new Date().toISOString(),
      totals: {
        activeUsers: users.filter((u) => u.isActive).length,
        inactiveUsers: inactiveIds.length,
        activeCampaigns: campaigns.filter((c) => c.status === 'active').length,
        totalCampaigns: campaigns.length,
      },
      cards,
    };

    await cacheSet(cacheKey, payload, CACHE_TTL_SECONDS);
    return NextResponse.json(payload);
  } catch (err) {
    return handleApiError('api/admin/overview GET', err);
  }
}

type WorkCounts = { leads: number; tasks: number; meetings: number; opportunities: number };

async function countOrphanedWork(inactiveIds: string[]): Promise<Map<string, WorkCounts>> {
  const now = new Date();
  const [leads, tasks, meetings, opportunities] = await Promise.all([
    prisma.lead.groupBy({
      by: ['assignedToId'],
      where: {
        assignedToId: { in: inactiveIds },
        archivedAt: null,
        stage: { notIn: ['won', 'lost'] },
      },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ['userId'],
      where: { userId: { in: inactiveIds }, status: 'pending' },
      _count: { _all: true },
    }),
    prisma.meeting.groupBy({
      by: ['sdrId'],
      where: {
        sdrId: { in: inactiveIds },
        status: { in: ['scheduled', 'link_sent'] },
        scheduledAt: { gte: now },
      },
      _count: { _all: true },
    }),
    prisma.opportunity.groupBy({
      by: ['ownerId'],
      where: { ownerId: { in: inactiveIds }, status: 'open' },
      _count: { _all: true },
    }),
  ]);

  const out = new Map<string, WorkCounts>();
  const bump = (id: string, field: keyof WorkCounts, n: number) => {
    const cur = out.get(id) ?? { leads: 0, tasks: 0, meetings: 0, opportunities: 0 };
    cur[field] = n;
    out.set(id, cur);
  };

  leads.forEach((r) => bump(r.assignedToId, 'leads', r._count._all));
  tasks.forEach((r) => bump(r.userId, 'tasks', r._count._all));
  meetings.forEach((r) => bump(r.sdrId, 'meetings', r._count._all));
  opportunities.forEach((r) => bump(r.ownerId, 'opportunities', r._count._all));
  return out;
}

function buildCard<T>(input: {
  key: string;
  title: string;
  severity: Severity;
  source: T[];
  toItem: (row: T) => CardItem;
}): Card {
  return {
    key: input.key,
    title: input.title,
    severity: input.severity,
    count: input.source.length,
    items: input.source.slice(0, MAX_ITEMS_PER_CARD).map(input.toItem),
  };
}
