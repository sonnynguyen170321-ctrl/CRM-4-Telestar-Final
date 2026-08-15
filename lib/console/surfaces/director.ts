import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/auth';
import { costPerMeeting, getAiSpend } from '@/lib/reporting/aiSpend';
import { getCampaignHealth } from '@/lib/email-health/queries';
import { resolveScope } from './shared';
import { group, money, type ExceptionItem, type RoleSurface } from './types';

/**
 * The Director surface — outcomes, risk and cost (Phase 9).
 *
 * A Director does not manage the floor; they decide where money goes. So this surface answers
 * three questions and refuses the rest: what did the last 30 days produce, which campaigns are
 * failing, and what did AI cost to produce it.
 *
 * No operational noise. No deferral reasons, no mailbox posture, no rep-level task counts — those
 * belong to the Floor Manager and Team Lead surfaces, and duplicating them here is how a Director
 * dashboard becomes something nobody reads.
 */

const WINDOW_DAYS = 30;

export async function buildDirectorSurface(user: SessionUser, now: Date): Promise<RoleSurface> {
  const scope = await resolveScope(user);
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);

  const [worked, replies, positiveReplies, meetings, opportunities, spend, campaigns, blockedCampaigns] =
    await Promise.all([
      // "Worked" is prospects we actually contacted, not prospects on file.
      prisma.lead
        .findMany({
          where: {
            tenantId: scope.tenantId,
            archivedAt: null,
            outboundMessages: { some: { status: 'sent', sentAt: { gte: windowStart } } },
          },
          select: { id: true },
          take: 20_000,
        })
        .then((r) => r.length),
      prisma.inboundMessage.count({
        where: { tenantId: scope.tenantId, date: { gte: windowStart }, leadId: { not: null } },
      }),
      prisma.inboundMessage.count({
        where: { tenantId: scope.tenantId, date: { gte: windowStart }, replyClass: 'C' },
      }),
      prisma.meeting.count({ where: { tenantId: scope.tenantId, createdAt: { gte: windowStart } } }),
      prisma.opportunity.count({ where: { tenantId: scope.tenantId, createdAt: { gte: windowStart } } }),
      getAiSpend(scope.tenantId, windowStart, now),
      getCampaignHealth(user, now),
      prisma.campaign.findMany({
        where: { tenantId: scope.tenantId, status: 'paused' },
        select: { id: true, name: true, status: true, updatedAt: true, client: { select: { name: true } } },
        take: 50,
      }),
    ]);

  const cpm = costPerMeeting(spend.totalUsd, meetings);

  // ─── campaigns at risk ───
  // Two failure modes a Director cares about: money going out with nothing coming back, and a
  // campaign damaging the sending reputation everything else depends on.
  const atRisk: ExceptionItem[] = [];
  for (const campaign of campaigns) {
    if (campaign.sent < 50) continue;
    if (campaign.hardBounceRate >= 0.03) {
      atRisk.push({
        id: `risk-bounce-${campaign.campaignId}`,
        primary: `${campaign.campaignName} · ${campaign.clientName}`,
        secondary: `${(campaign.hardBounceRate * 100).toFixed(1)}% of messages are bouncing. This damages every campaign that shares a domain.`,
        meta: `${campaign.sent} sent this week`,
        ageHours: campaign.hardBounceRate * 1000,
      });
    } else if (campaign.meetingsBooked === 0 && campaign.replyRate < 0.01) {
      atRisk.push({
        id: `risk-dry-${campaign.campaignId}`,
        primary: `${campaign.campaignName} · ${campaign.clientName}`,
        secondary: `${campaign.sent} messages, ${campaign.replies} replies, no meetings. The offer or the audience is wrong.`,
        meta: 'No pipeline produced',
        ageHours: campaign.sent,
      });
    }
  }

  const blocked: ExceptionItem[] = blockedCampaigns.map((c) => ({
    id: `blocked-${c.id}`,
    primary: `${c.name}${c.client?.name ? ` · ${c.client.name}` : ''}`,
    secondary: 'Campaign is not running. Nothing is being sent for this client.',
    meta: 'Paused',
    ageHours: Math.max(0, (now.getTime() - c.updatedAt.getTime()) / 3_600_000),
  }));

  // ─── spend worth questioning ───
  // A campaign is only listed when the money bought nothing: spend with no meeting, or a cost per
  // meeting far above the book average. Healthy spend is a number at the top, not a row here.
  const averageCpm = cpm;
  const spendConcerns: ExceptionItem[] = spend.byCampaign
    .filter((c) => c.usd >= 1)
    .filter((c) => c.meetings === 0 || (averageCpm !== null && c.usd / Math.max(c.meetings, 1) > averageCpm * 2))
    .map((c) => ({
      id: `spend-${c.campaignId}`,
      primary: `${c.campaignName}${c.clientName ? ` · ${c.clientName}` : ''}`,
      secondary:
        c.meetings === 0
          ? `${money(c.usd)} of AI spend, no meetings booked.`
          : `${money(c.usd)} for ${c.meetings} meeting${c.meetings === 1 ? '' : 's'} — ${money(c.usd / c.meetings)} each, well above the ${money(averageCpm ?? 0)} average.`,
      meta: `${c.calls} AI operations`,
      ageHours: c.usd,
    }));

  return {
    key: 'director',
    title: 'Business outcomes',
    focus: `The last ${WINDOW_DAYS} days: what was produced, what it cost, and what is at risk.`,
    scope: 'organisation',
    metrics: [
      { key: 'worked', label: 'Prospects worked', value: String(worked), raw: worked, tone: 'neutral' },
      { key: 'replies', label: 'Replies', value: String(replies), raw: replies, tone: 'neutral', hint: `${positiveReplies} positive` },
      { key: 'meetings', label: 'Meetings', value: String(meetings), raw: meetings, tone: 'ai' },
      { key: 'opportunities', label: 'Opportunities', value: String(opportunities), raw: opportunities, tone: 'ai' },
      { key: 'ai_spend', label: 'AI spend', value: money(spend.totalUsd), raw: spend.totalUsd, tone: 'money', hint: `${spend.totalCalls} operations` },
      {
        key: 'cost_per_meeting',
        label: 'Cost per meeting',
        value: cpm === null ? '—' : money(cpm),
        raw: cpm,
        tone: 'money',
        hint: cpm === null ? 'No meetings in the window' : 'AI cost only',
      },
    ],
    groups: [
      group(
        'campaigns_at_risk', 'Campaigns at risk',
        'Campaigns producing no pipeline, or damaging deliverability for everything else.',
        'critical', 'No campaign is at risk.', atRisk
      ),
      group(
        'blocked_campaigns', 'Campaigns not running',
        'Clients we are currently doing no outbound work for.',
        'critical', 'Every campaign is running.', blocked
      ),
      group(
        'spend_concerns', 'Spend without return',
        'Where AI cost is not converting into meetings.',
        'warning', 'Every campaign with meaningful spend is producing meetings.', spendConcerns
      ),
    ],
    sources: ['Meetings', 'Opportunities', 'Inbound replies', 'AI cost ledger', 'Campaign deliverability'],
  };
}
