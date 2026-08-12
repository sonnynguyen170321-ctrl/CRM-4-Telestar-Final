import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/auth';
import { getCampaignHealth, getOverview } from '@/lib/email-health/queries';
import { loadOverdueTasks, resolveScope } from './shared';
import { group, hoursSince, pct, type ExceptionItem, type RoleSurface } from './types';

/**
 * The Floor Manager surface — execution capacity, and why it is not being met (Phase 9).
 *
 * The question this role actually asks is "we expected 610 sends and got 432 — why". Every part
 * of that answer already exists: the automation engine records a deferral with its reason on the
 * lead timeline, email health owns mailbox posture, and `OutboundMessage` owns what was actually
 * sent. This surface joins them. It computes no deliverability metric of its own — `getOverview`
 * and `getCampaignHealth` are the owners, and a second calculation here would be a number that
 * can disagree with the Email Health page.
 */

/** Deferral reason → what a manager should read. Anything unmapped falls through as-is. */
const DEFERRAL_LABEL: Record<string, string> = {
  outside_send_window: 'Outside the campaign send window',
  daily_quota_exhausted: 'Daily sending quota reached',
  inbox_health_critical: 'Mailbox health too poor to send',
  mailbox_paused: 'Mailbox paused',
  mailbox_inactive: 'Mailbox disconnected',
  recipient_suppressed: 'Recipient suppressed',
  no_connected_mailbox: 'Rep has no mailbox connected',
  missing_template: 'Step has no template',
  lead_email_missing: 'No email address on the prospect',
  lead_email_invalid: 'Email address not valid',
  health_cap_reduced: 'Sending cap reduced for mailbox health',
};

const WINDOW_HOURS = 24;

export async function buildFloorManagerSurface(user: SessionUser, now: Date): Promise<RoleSurface> {
  const scope = await resolveScope(user);
  const windowStart = new Date(now.getTime() - WINDOW_HOURS * 3_600_000);

  const [overview, campaigns, deferrals, actualSends, expectedSends, blockedWork, overdue] =
    await Promise.all([
      getOverview(user, now),
      getCampaignHealth(user, now),
      // The automation engine already writes why it held a send back. This reads that, it does
      // not re-derive it.
      prisma.activity.findMany({
        where: { tenantId: scope.tenantId, type: 'sequence_deferred', createdAt: { gte: windowStart } },
        select: { metadata: true, leadId: true, createdAt: true },
        take: 1000,
      }),
      prisma.outboundMessage.count({
        where: { tenantId: scope.tenantId, status: 'sent', sentAt: { gte: windowStart } },
      }),
      // What the cadence intended to send in the window: automated steps that came due in it.
      prisma.task.count({
        where: {
          lead: { tenantId: scope.tenantId, archivedAt: null },
          type: 'email',
          sequenceId: { not: null },
          dueDate: { gte: windowStart, lte: now },
        },
      }),
      prisma.workOrder.findMany({
        where: { tenantId: scope.tenantId, status: { in: ['paused', 'failed'] } },
        orderBy: { updatedAt: 'desc' },
        take: 50,
        select: { id: true, type: true, status: true, pausedReason: true, leadId: true, updatedAt: true },
      }),
      loadOverdueTasks(scope, now),
    ]);

  // ─── why volume is short ───
  const byReason = new Map<string, number>();
  for (const row of deferrals) {
    const meta = (row.metadata ?? {}) as { reason?: unknown };
    const reason = typeof meta.reason === 'string' ? meta.reason : 'unspecified';
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
  }
  const shortfall = Math.max(0, expectedSends - actualSends);
  const variance: ExceptionItem[] = [...byReason.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({
      id: `deferral-${reason}`,
      primary: DEFERRAL_LABEL[reason] ?? reason.replace(/_/g, ' '),
      secondary: `${count} send${count === 1 ? '' : 's'} held back in the last ${WINDOW_HOURS} hours.`,
      meta: `${pct(count, deferrals.length)} of everything held back`,
      ageHours: count,
    }));

  // ─── mailboxes restricting the floor ───
  const mailboxRestrictions: ExceptionItem[] = [];
  if (overview.totals.critical > 0) {
    mailboxRestrictions.push({
      id: 'mailbox-critical',
      primary: `${overview.totals.critical} mailbox${overview.totals.critical === 1 ? '' : 'es'} in critical health`,
      secondary: 'Sending from these is being held back automatically.',
      meta: 'Email health',
      href: '/email-health',
      ageHours: overview.totals.critical,
    });
  }
  if (overview.totals.atRisk > 0) {
    mailboxRestrictions.push({
      id: 'mailbox-at-risk',
      primary: `${overview.totals.atRisk} mailbox${overview.totals.atRisk === 1 ? '' : 'es'} at risk`,
      secondary: 'Bounce or spam signals are above the safe range.',
      meta: 'Email health',
      href: '/email-health',
      ageHours: overview.totals.atRisk,
    });
  }
  if (overview.totals.paused > 0) {
    mailboxRestrictions.push({
      id: 'mailbox-paused',
      primary: `${overview.totals.paused} mailbox${overview.totals.paused === 1 ? '' : 'es'} paused`,
      secondary: 'Nothing sends from a paused mailbox until someone resumes it.',
      meta: 'Email health',
      href: '/email-health',
      ageHours: overview.totals.paused,
    });
  }
  if (overview.today.capacity > 0 && overview.today.usagePct >= 90) {
    mailboxRestrictions.push({
      id: 'capacity-ceiling',
      primary: `Daily capacity ${overview.today.usagePct}% used`,
      secondary: `${overview.today.sent} of ${overview.today.capacity} today. Further sends will defer to tomorrow.`,
      meta: 'Email health',
      href: '/email-health',
      ageHours: overview.today.usagePct,
    });
  }

  // ─── campaigns whose numbers are wrong ───
  const campaignRisk: ExceptionItem[] = campaigns
    .filter((c) => c.sent > 0 && (c.hardBounceRate >= 0.03 || (c.sent >= 50 && c.replyRate < 0.01)))
    .map((c) => ({
      id: `campaign-${c.campaignId}`,
      primary: `${c.campaignName} · ${c.clientName}`,
      secondary:
        c.hardBounceRate >= 0.03
          ? `Bounce rate ${(c.hardBounceRate * 100).toFixed(1)}% on ${c.sent} sends — list quality or mailbox reputation.`
          : `${c.sent} sends, ${c.replies} replies. The messaging is not landing.`,
      meta: `${c.meetingsBooked} meeting${c.meetingsBooked === 1 ? '' : 's'} booked this week`,
      href: '/email-health',
      ageHours: c.hardBounceRate * 1000,
    }));

  // ─── execution that stopped ───
  const blocked: ExceptionItem[] = blockedWork.map((w) => ({
    id: `blocked-${w.id}`,
    primary: 'Automated work stopped',
    secondary: w.pausedReason
      ? `Held for review: ${w.pausedReason.replace(/_/g, ' ')}.`
      : 'Stopped and needs someone to look at it.',
    meta: w.status === 'failed' ? 'Could not complete' : 'Paused',
    leadId: w.leadId,
    href: w.leadId ? `/ai?prospect=${w.leadId}` : '/ai',
    ageHours: hoursSince(w.updatedAt, now),
  }));

  // ─── workload imbalance ───
  const loads = [...overdue.byOwner.values()].sort((a, b) => b.count - a.count);
  const median = loads.length ? loads[Math.floor(loads.length / 2)].count : 0;
  const imbalance: ExceptionItem[] = loads
    // Twice the pod median, and at least five items — otherwise a floor where everyone has one
    // overdue task reports an "imbalance" that is a rounding artefact.
    .filter((l) => l.count >= 5 && l.count >= Math.max(2 * median, 5))
    .map((l) => ({
      id: `load-${l.name}`,
      primary: l.name,
      secondary: `${l.count} overdue items against a floor median of ${median}.`,
      meta: 'Consider redistributing',
      ownerName: l.name,
      ageHours: l.count,
    }));

  return {
    key: 'floor_manager',
    title: 'Campaign execution',
    focus: 'What the floor was supposed to send, what it actually sent, and what stopped it.',
    scope: 'floor',
    metrics: [
      { key: 'expected', label: 'Expected sends', value: String(expectedSends), raw: expectedSends, tone: 'neutral', hint: `Cadence steps due in ${WINDOW_HOURS}h` },
      { key: 'actual', label: 'Actually sent', value: String(actualSends), raw: actualSends, tone: actualSends >= expectedSends ? 'ai' : 'attention' },
      { key: 'shortfall', label: 'Shortfall', value: String(shortfall), raw: shortfall, tone: shortfall > 0 ? 'risk' : 'neutral', hint: shortfall > 0 ? 'Explained below' : 'Nothing missing' },
      { key: 'held_back', label: 'Held back', value: String(deferrals.length), raw: deferrals.length, tone: 'waiting', hint: 'Deferred, not lost' },
      { key: 'mailboxes', label: 'Mailboxes restricted', value: String(overview.totals.critical + overview.totals.atRisk + overview.totals.paused), raw: overview.totals.critical + overview.totals.atRisk + overview.totals.paused, tone: 'risk' },
    ],
    groups: [
      group(
        'variance', 'Why volume is short',
        'Every send the engine held back, and the reason it gave at the time.',
        shortfall > 0 ? 'critical' : 'info',
        'Nothing was held back in the last day.', variance
      ),
      group(
        'mailbox_restrictions', 'Sending restrictions in force',
        'Mailbox health and capacity limits currently reducing what the floor can send.',
        'warning', 'No mailbox is restricting the floor.', mailboxRestrictions
      ),
      group(
        'campaign_risk', 'Campaigns at risk',
        'Bounce rates or reply rates outside the range a campaign should be running at.',
        'critical', 'Every campaign is inside its expected range.', campaignRisk
      ),
      group(
        'blocked', 'Automation stopped',
        'Automated work that halted and is waiting on a person.',
        'warning', 'No automated work is stuck.', blocked
      ),
      group(
        'imbalance', 'Workload imbalance',
        'Reps carrying far more overdue work than the floor median.',
        'info', 'Workload is evenly spread.', imbalance
      ),
    ],
    sources: ['Email health', 'Campaign deliverability', 'Automation deferral log', 'Outbound message log'],
  };
}
