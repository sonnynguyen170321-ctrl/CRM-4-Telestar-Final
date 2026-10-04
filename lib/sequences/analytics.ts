import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getLeadWhereScope, type SessionUser } from '@/lib/auth';
import { getLocalDayBoundaries } from '@/lib/dates/timezone';

import { REAL_SEND, getDailySends, getSequencePerformance } from './performance';

/**
 * Sequence dashboards: the per-sequence drill-down, the overview cards and the team report.
 *
 * Rebuilt 2026-10-04 on the rows that record what happened. The previous version counted sends
 * from `email_sent` activities filtered on `metadata.sequenceId` — which no writer sets, so every
 * sequence showed 0 sends, 0 replies and 0 bounces on production — counted bounces from an
 * unenroll reason nothing writes, counted "active" from the lead's single sequence pointer (wrong
 * once a lead runs several sequences), and scoped sends and replies on two different axes.
 *
 * Now, everywhere:
 *   - sends: `OutboundMessage.sentAt`, real sends only (`REAL_SEND`, no dry runs);
 *   - replies / bounces: the message's `repliedAt` / `bouncedAt`, so a reply is counted once per
 *     email answered, not once per stage change;
 *   - enrollments: `SequenceEnrollment.status`;
 *   - scope: one axis, the viewer's leads (`getLeadWhereScope`), for every number;
 *   - "today": midnight in the viewer's timezone; "week" / "month": the last 7 / 30 days.
 */

export interface SequenceAnalytics {
  totalEnrolled: number;
  activeEnrolled: number;
  completedCount: number;
  totalSends: number;
  uniqueReplies: number;
  bounceCount: number;
  /** Over emails sent; null when nothing was sent (a rate of nothing is not 0%). */
  replyRate: number | null;
  bounceRate: number | null;
  sendsByDay: { date: string; count: number }[];
  topTemplates: { id: string; name: string; sent: number; replies: number; rate: number }[];
  /** `step` is null for emails from steps that no longer exist. */
  stepBreakdown: { step: number | null; channel: string; sent: number; replies: number }[];
}

export interface TemplateAnalytics {
  id: string;
  name: string;
  channel: string;
  totalSent: number;
  totalReplies: number;
  replyRate: number;
  variants: { version: string; sent: number; replies: number; rate: number }[];
}

/** What a viewer may count: their leads (`getLeadWhereScope`), archived leads left out. */
async function viewerScope(user: SessionUser): Promise<{ tenantId: string; leads: Prisma.LeadWhereInput; timezone: string }> {
  if (!user.tenantId) throw new Error('sequence analytics need a tenant');
  const [scope, viewer] = await Promise.all([
    getLeadWhereScope(user),
    prisma.user.findUnique({ where: { id: user.id }, select: { timezone: true } }),
  ]);
  // AND, so an extra condition can never widen what the viewer may see.
  return {
    tenantId: user.tenantId,
    leads: { AND: [scope as Prisma.LeadWhereInput, { archivedAt: null }] },
    timezone: viewer?.timezone || 'UTC',
  };
}

/**
 * One sequence for one viewer: all time, plus the last 30 days of sends. Scoped like the list it
 * is opened from, so the drill-down and the list beside it describe the same leads. Null when the
 * sequence is not in this tenant.
 */
export async function getSequenceAnalytics(
  sequenceId: string,
  user: SessionUser,
  now: Date = new Date()
): Promise<SequenceAnalytics | null> {
  const { tenantId, leads, timezone } = await viewerScope(user);
  const [performance, sendsByDay] = await Promise.all([
    getSequencePerformance({ tenantId, sequenceId, window: 'all', leadWhere: leads, now }),
    getDailySends({ tenantId, sequenceId, leadWhere: leads, timezone, now }),
  ]);
  if (!performance) return null;
  const { enrollments, totals, steps } = performance;
  return {
    totalEnrolled: enrollments.total,
    activeEnrolled: enrollments.active,
    completedCount: enrollments.completed,
    totalSends: totals.sent,
    uniqueReplies: totals.replied,
    bounceCount: totals.bounced,
    replyRate: totals.replyRate,
    bounceRate: totals.bounceRate,
    sendsByDay,
    topTemplates: [],
    stepBreakdown: steps.map((step) => ({
      step: step.order,
      channel: step.channel ?? 'email',
      sent: step.sent,
      replies: step.replied,
    })),
  };
}

export async function getTemplateAnalytics(templateId: string): Promise<TemplateAnalytics | null> {
  const template = await prisma.template.findUnique({
    where: { id: templateId },
    include: { abVariants: true },
  });
  if (!template) return null;

  const totalSent = template.abVariants.reduce((sum, v) => sum + v.sentCount, 0);
  const totalReplies = template.abVariants.reduce((sum, v) => sum + v.replyCount, 0);

  return {
    id: template.id,
    name: template.name,
    channel: template.channel,
    totalSent,
    totalReplies,
    replyRate: totalSent > 0 ? Math.round((totalReplies / totalSent) * 10000) / 100 : 0,
    variants: template.abVariants.map(v => ({
      version: v.version,
      sent: v.sentCount,
      replies: v.replyCount,
      rate: v.sentCount > 0 ? Math.round((v.replyCount / v.sentCount) * 10000) / 100 : 0,
    })),
  };
}

export interface ScopedSequenceStats {
  /** Active (non-archived) leads the viewer can see. */
  totalLeads: number;
  /** Running cadences on those leads — a lead in two sequences counts twice. */
  activeEnrollments: number;
  todaySends: number;
  weekSends: number;
  monthSends: number;
  todayReplies: number;
  weekReplies: number;
  /** Emails that bounced in the last 30 days. */
  totalBounces: number;
  /** Sequences with at least one enrollment in scope, most active first. */
  sequences: { id: string; name: string; activeLeads: number; _count: { leads: number } }[];
}

const DAY_MS = 86_400_000;

/**
 * Sequence performance across what the viewer can see: a rep their own leads, a team lead their
 * pod and its campaigns, a director everything. Used by the overview cards, Team View and the
 * Leadgen report alike, so the same viewer gets the same numbers on every page.
 */
export async function getScopedSequenceStats(user: SessionUser, now: Date = new Date()): Promise<ScopedSequenceStats> {
  const { tenantId, leads: activeLeads, timezone } = await viewerScope(user);
  const { start: todayStart } = getLocalDayBoundaries(now, timezone);
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const monthAgo = new Date(now.getTime() - 30 * DAY_MS);
  // Replies and bounces are counted by when they happened, but only on messages sent in the last
  // 90 days — a reply to a three-month-old email is vanishingly rare, and the bound keeps the
  // count on the (tenant, sequence, sentAt) index instead of scanning every message ever sent.
  const replyHorizon = new Date(now.getTime() - 90 * DAY_MS);

  const messages = (condition: Prisma.OutboundMessageWhereInput) =>
    prisma.outboundMessage.count({
      where: { AND: [REAL_SEND, { tenantId, sequenceId: { not: null }, lead: activeLeads }, condition] },
    });

  const [totalLeads, activeEnrollments, todaySends, weekSends, monthSends, todayReplies, weekReplies, totalBounces, byStatus] =
    await Promise.all([
      prisma.lead.count({ where: { AND: [activeLeads, { tenantId }] } }),
      prisma.sequenceEnrollment.count({
        where: { tenantId, status: 'active', lead: activeLeads, sequence: { isArchived: false } },
      }),
      messages({ sentAt: { gte: todayStart } }),
      messages({ sentAt: { gte: weekAgo } }),
      messages({ sentAt: { gte: monthAgo } }),
      messages({ repliedAt: { gte: todayStart }, sentAt: { gte: replyHorizon } }),
      messages({ repliedAt: { gte: weekAgo }, sentAt: { gte: replyHorizon } }),
      messages({ bouncedAt: { gte: monthAgo }, sentAt: { gte: replyHorizon } }),
      prisma.sequenceEnrollment.groupBy({
        by: ['sequenceId', 'status'],
        where: { tenantId, lead: activeLeads },
        _count: { _all: true },
      }),
    ]);

  const perSequence = new Map<string, { enrolled: number; active: number }>();
  for (const row of byStatus) {
    const entry = perSequence.get(row.sequenceId) ?? { enrolled: 0, active: 0 };
    entry.enrolled += row._count._all;
    if (row.status === 'active') entry.active += row._count._all;
    perSequence.set(row.sequenceId, entry);
  }
  const named = perSequence.size
    ? await prisma.sequence.findMany({
        where: { tenantId, id: { in: [...perSequence.keys()] }, isArchived: false },
        select: { id: true, name: true },
      })
    : [];
  const sequences = named
    .map((sequence) => {
      const counts = perSequence.get(sequence.id)!;
      return { id: sequence.id, name: sequence.name, activeLeads: counts.active, _count: { leads: counts.enrolled } };
    })
    .sort((a, b) => b.activeLeads - a.activeLeads || b._count.leads - a._count.leads || a.name.localeCompare(b.name));

  return {
    totalLeads,
    activeEnrollments,
    todaySends,
    weekSends,
    monthSends,
    todayReplies,
    weekReplies,
    totalBounces,
    sequences,
  };
}
