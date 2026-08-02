import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/auth';
import { scoreInbox } from './scoring';
import {
  WINDOW_24H_MS,
  WINDOW_7D_MS,
  collectInboxCounts,
  collectSuppressionGrowth,
  dnsPostureFrom,
  domainOf,
  effectiveDailySendCount,
  toHealthMetrics,
  type InboxWindowCounts,
  type ScorableAccount,
} from './metrics';
import { emailAccountWhere, getEmailAccountScope, type EmailAccountScope } from './access';
import type { EmailHealthLevelValue } from './types';

/**
 * Read models for the dashboard.
 *
 * Everything here scores live from source rows rather than reading the
 * EmailAccount.healthScore cache, so the table is correct even if the hourly
 * cron has not run — matching the runtime law that the DB records truth.
 */

const ACCOUNT_SELECT = {
  id: true,
  email: true,
  provider: true,
  userId: true,
  isActive: true,
  lastSyncAt: true,
  dailyCap: true,
  dailySendCount: true,
  dailySendDate: true,
  sendPausedAt: true,
  sendPausedById: true,
  sendPauseReason: true,
  healthScore: true,
  healthLevel: true,
  lastHealthCheckAt: true,
  user: { select: { id: true, firstName: true, lastName: true, role: true } },
} as const;

export interface InboxHealthRow {
  id: string;
  email: string;
  provider: string;
  domain: string | null;
  owner: { id: string; firstName: string; lastName: string; role: string } | null;
  isActive: boolean;
  isPaused: boolean;
  pauseReason: string | null;
  lastSyncAt: Date | null;
  dailyCap: number;
  sentToday: number;
  usagePct: number;
  sevenDaySent: number;
  hardBounceRate: number;
  softBounceRate: number;
  replyRate: number;
  spamSignalRate: number;
  healthScore: number;
  healthLevel: EmailHealthLevelValue;
  reasons: string[];
  recommendedActions: string[];
  lastHealthCheckAt: Date | null;
}

export interface InboxHealthFilters {
  healthLevel?: EmailHealthLevelValue;
  userId?: string;
  provider?: string;
  activeOnly?: boolean;
}

function round(value: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

/**
 * Scored inbox rows for the viewer's scope.
 *
 * Two grouped count passes (7d and today) plus one account read — never a query
 * per inbox.
 */
export async function getInboxHealthRows(
  user: SessionUser,
  filters: InboxHealthFilters = {},
  now: Date = new Date()
): Promise<{ rows: InboxHealthRow[]; scope: EmailAccountScope }> {
  const scope = await getEmailAccountScope(user);

  const accounts = await prisma.emailAccount.findMany({
    where: {
      ...emailAccountWhere(scope),
      ...(filters.activeOnly ? { isActive: true } : {}),
      ...(filters.userId ? { userId: filters.userId } : {}),
      ...(filters.provider ? { provider: filters.provider as never } : {}),
    },
    select: ACCOUNT_SELECT,
    orderBy: { email: 'asc' },
  });

  if (accounts.length === 0) return { rows: [], scope };

  const accountIds = accounts.map((a) => a.id);
  const sevenDayStart = new Date(now.getTime() - WINDOW_7D_MS);

  const [counts, domainRows] = await Promise.all([
    collectInboxCounts(accountIds, sevenDayStart, now),
    prisma.emailDomainHealth.findMany(),
  ]);
  const domainByName = new Map(domainRows.map((d) => [d.domain, d]));

  const rows: InboxHealthRow[] = accounts.map((account) => {
    const c: InboxWindowCounts = counts.get(account.id) ?? {
      sentCount: 0, failedCount: 0, hardBounceCount: 0, softBounceCount: 0,
      replyCount: 0, spamSignalCount: 0, trashSignalCount: 0,
    };
    const domain = domainOf(account.email);
    const dnsStatus = dnsPostureFrom(domainByName.get(domain ?? ''));
    const metrics = toHealthMetrics(account as ScorableAccount, c, dnsStatus, now);
    const scored = scoreInbox(metrics, now);
    const sentToday = effectiveDailySendCount(account as ScorableAccount, now);

    return {
      id: account.id,
      email: account.email,
      provider: account.provider,
      domain,
      owner: account.user,
      isActive: account.isActive,
      isPaused: account.sendPausedAt !== null,
      pauseReason: account.sendPauseReason,
      lastSyncAt: account.lastSyncAt,
      dailyCap: account.dailyCap,
      sentToday,
      usagePct: account.dailyCap > 0 ? round((sentToday / account.dailyCap) * 100, 1) : 0,
      sevenDaySent: c.sentCount,
      hardBounceRate: round(scored.rates.hardBounceRate),
      softBounceRate: round(scored.rates.softBounceRate),
      replyRate: round(scored.rates.replyRate),
      spamSignalRate: round(scored.rates.spamSignalRate),
      healthScore: scored.score,
      healthLevel: scored.level,
      reasons: scored.reasons,
      recommendedActions: scored.recommendedActions,
      lastHealthCheckAt: account.lastHealthCheckAt,
    };
  });

  const filtered = filters.healthLevel
    ? rows.filter((r) => r.healthLevel === filters.healthLevel)
    : rows;

  return { rows: filtered, scope };
}

export interface OverviewPayload {
  totals: {
    inboxes: number;
    active: number;
    paused: number;
    healthy: number;
    watch: number;
    atRisk: number;
    critical: number;
  };
  today: { sent: number; capacity: number; usagePct: number };
  sevenDay: {
    sent: number;
    hardBounceRate: number;
    softBounceRate: number;
    replyRate: number;
    spamSignalRate: number;
    suppressionGrowth: number;
  };
  openAlerts: { total: number; critical: number; warning: number; info: number };
}

export async function getOverview(user: SessionUser, now: Date = new Date()): Promise<OverviewPayload> {
  const { rows, scope } = await getInboxHealthRows(user, {}, now);

  const sevenDayStart = new Date(now.getTime() - WINDOW_7D_MS);
  const [suppression, alertGroups] = await Promise.all([
    collectSuppressionGrowth(sevenDayStart, now),
    prisma.emailHealthAlert.groupBy({
      by: ['severity'],
      where: {
        status: 'open',
        ...(scope.userIds === null ? {} : { account: { userId: { in: scope.userIds } } }),
      },
      _count: { _all: true },
    }),
  ]);

  const bySeverity = new Map(alertGroups.map((g) => [g.severity, g._count._all]));

  // Re-derive aggregate rates from raw counts rather than averaging per-inbox
  // rates: a mailbox that sent 3 messages must not weigh the same as one that
  // sent 3000.
  const totalSent = rows.reduce((sum, r) => sum + r.sevenDaySent, 0);
  const weighted = (pick: (r: InboxHealthRow) => number): number => {
    if (totalSent === 0) return 0;
    return round(rows.reduce((sum, r) => sum + pick(r) * r.sevenDaySent, 0) / totalSent);
  };

  const sentToday = rows.reduce((sum, r) => sum + r.sentToday, 0);
  const capacity = rows.reduce((sum, r) => sum + (r.isActive ? r.dailyCap : 0), 0);

  return {
    totals: {
      inboxes: rows.length,
      active: rows.filter((r) => r.isActive).length,
      paused: rows.filter((r) => r.isPaused).length,
      healthy: rows.filter((r) => r.healthLevel === 'healthy').length,
      watch: rows.filter((r) => r.healthLevel === 'watch').length,
      atRisk: rows.filter((r) => r.healthLevel === 'at_risk').length,
      critical: rows.filter((r) => r.healthLevel === 'critical').length,
    },
    today: {
      sent: sentToday,
      capacity,
      usagePct: capacity > 0 ? round((sentToday / capacity) * 100, 1) : 0,
    },
    sevenDay: {
      sent: totalSent,
      hardBounceRate: weighted((r) => r.hardBounceRate),
      softBounceRate: weighted((r) => r.softBounceRate),
      replyRate: weighted((r) => r.replyRate),
      spamSignalRate: weighted((r) => r.spamSignalRate),
      suppressionGrowth: suppression.total,
    },
    openAlerts: {
      total: alertGroups.reduce((sum, g) => sum + g._count._all, 0),
      critical: bySeverity.get('critical') ?? 0,
      warning: bySeverity.get('warning') ?? 0,
      info: bySeverity.get('info') ?? 0,
    },
  };
}

export interface CampaignHealthRow {
  campaignId: string;
  campaignName: string;
  clientId: string;
  clientName: string;
  sent: number;
  hardBounces: number;
  softBounces: number;
  replies: number;
  hardBounceRate: number;
  replyRate: number;
  suppressionGrowth: number;
  meetingsBooked: number;
}

/**
 * Campaign-level deliverability, joined through Lead → Campaign → Client.
 *
 * Grouped by campaignId in a single pass over OutboundMessage rather than per
 * campaign.
 */
export async function getCampaignHealth(
  user: SessionUser,
  now: Date = new Date()
): Promise<CampaignHealthRow[]> {
  const scope = await getEmailAccountScope(user);
  const windowStart = new Date(now.getTime() - WINDOW_7D_MS);

  const accountFilter = scope.userIds === null ? {} : { account: { userId: { in: scope.userIds } } };

  const messages = await prisma.outboundMessage.findMany({
    where: {
      sentAt: { gte: windowStart, lte: now },
      ...accountFilter,
    },
    select: {
      status: true,
      bounceType: true,
      repliedAt: true,
      lead: {
        select: {
          campaignId: true,
          campaign: { select: { id: true, name: true, clientId: true, client: { select: { id: true, name: true } } } },
        },
      },
    },
  });

  const byCampaign = new Map<string, CampaignHealthRow>();

  for (const msg of messages) {
    const campaign = msg.lead?.campaign;
    if (!campaign) continue;

    let row = byCampaign.get(campaign.id);
    if (!row) {
      row = {
        campaignId: campaign.id,
        campaignName: campaign.name,
        clientId: campaign.clientId,
        clientName: campaign.client?.name ?? 'Unknown client',
        sent: 0, hardBounces: 0, softBounces: 0, replies: 0,
        hardBounceRate: 0, replyRate: 0, suppressionGrowth: 0, meetingsBooked: 0,
      };
      byCampaign.set(campaign.id, row);
    }

    if (msg.status === 'sent' || msg.status === 'bounced') row.sent++;
    if (msg.status === 'bounced') {
      if (msg.bounceType === 'soft') row.softBounces++;
      else row.hardBounces++;
    }
    if (msg.repliedAt) row.replies++;
  }

  const campaignIds = [...byCampaign.keys()];
  if (campaignIds.length > 0) {
    const [suppression, meetings] = await Promise.all([
      prisma.suppressionEntry.groupBy({
        by: ['campaignId'],
        where: { campaignId: { in: campaignIds }, createdAt: { gte: windowStart, lte: now } },
        _count: { _all: true },
      }),
      prisma.meeting.groupBy({
        by: ['campaignId'],
        where: { campaignId: { in: campaignIds }, createdAt: { gte: windowStart, lte: now } },
        _count: { _all: true },
      }),
    ]);

    for (const s of suppression) {
      if (s.campaignId) {
        const row = byCampaign.get(s.campaignId);
        if (row) row.suppressionGrowth = s._count._all;
      }
    }
    for (const m of meetings) {
      if (m.campaignId) {
        const row = byCampaign.get(m.campaignId);
        if (row) row.meetingsBooked = m._count._all;
      }
    }
  }

  return [...byCampaign.values()]
    .map((row) => ({
      ...row,
      hardBounceRate: row.sent > 0 ? round(row.hardBounces / row.sent) : 0,
      replyRate: row.sent > 0 ? round(row.replies / row.sent) : 0,
    }))
    .sort((a, b) => b.hardBounceRate - a.hardBounceRate);
}

export { WINDOW_24H_MS, WINDOW_7D_MS };
