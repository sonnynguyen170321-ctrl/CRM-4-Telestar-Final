import { prisma } from '@/lib/prisma';

/**
 * Outcome → evidence → observation → **proposed** playbook change (Phase 10, demo minimum).
 *
 * The learning loop, stopped one step short of learning:
 *
 * ```text
 * an outcome that actually happened
 *   → the message and the evidence behind it
 *     → an observation about what the message did
 *       → a suggested playbook change
 *         → status: proposed, manager approval required
 * ```
 *
 * **Nothing here modifies a playbook.** `CampaignPlaybookVersion` is immutable once approved and
 * activation is a human action; a proposal is text a manager reads. That boundary is the entire
 * point of shipping the loop this way — an agent that rewrites the rules it runs under has no
 * meaningful approval step left (invariant: observation → recommendation → human approval → a new
 * playbook *version*).
 *
 * It is also deliberately deterministic. A model-written "insight" would be the least verifiable
 * thing on the screen at the exact moment a viewer is deciding whether to trust the system.
 */

export interface OutcomeInsight {
  leadId: string;
  prospectName: string;
  company: string | null;
  /** What happened, in the CRM's own words. */
  outcome: string;
  /** The message that earned it, and the reply it earned. */
  supportingEvidence: string[];
  /** What the pattern appears to be. */
  observation: string;
  /** What a manager is being asked to consider. */
  suggestedChange: string;
  /** Always `proposed`. There is no path from here to an active playbook without a human. */
  status: 'proposed';
  approvalRequired: 'manager';
  at: Date;
}

/** Words that mark a personalization angle, so the observation can name what was used. */
const ANGLE_HINTS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(cost|spend|budget|margin|price)\b/i, label: 'operational-cost framing' },
  { pattern: /\b(hiring|headcount|recruit|staffing)\b/i, label: 'hiring-signal framing' },
  { pattern: /\b(expansion|new (site|facility|warehouse|route)|opened)\b/i, label: 'expansion framing' },
  { pattern: /\b(delay|late|on[- ]time|backlog|bottleneck)\b/i, label: 'service-reliability framing' },
  { pattern: /\b(compliance|regulat|audit)\b/i, label: 'compliance framing' },
];

function detectAngle(text: string): string {
  return ANGLE_HINTS.find((h) => h.pattern.test(text))?.label ?? 'account-specific personalization';
}

export async function buildOutcomeInsights(
  tenantId: string,
  limit = 5
): Promise<OutcomeInsight[]> {
  // Positive outcomes only: a class C reply is the CRM saying a prospect engaged. Learning from
  // anything weaker would be learning from noise.
  const replies = await prisma.inboundMessage.findMany({
    where: { tenantId, replyClass: 'C', leadId: { not: null } },
    orderBy: { date: 'desc' },
    take: limit,
    select: {
      leadId: true, subject: true, body: true, date: true, replyKind: true,
      lead: { select: { firstName: true, lastName: true, company: true, accountId: true } },
    },
  });

  const insights: OutcomeInsight[] = [];

  for (const reply of replies) {
    if (!reply.leadId || !reply.lead) continue;

    const originating = await prisma.outboundMessage.findFirst({
      where: { tenantId, leadId: reply.leadId, status: 'sent', sentAt: { lte: reply.date } },
      orderBy: { sentAt: 'desc' },
      select: { subject: true, body: true, sentAt: true },
    });

    const pains = reply.lead.accountId
      ? await prisma.accountPainHypothesis.findMany({
          where: { tenantId, accountId: reply.lead.accountId },
          orderBy: { observedAt: 'desc' },
          take: 2,
          select: { hypothesis: true, sourceUrl: true },
        })
      : [];

    const angle = detectAngle(`${originating?.subject ?? ''} ${originating?.body ?? ''}`);
    const industry = reply.lead.company ? `accounts like ${reply.lead.company}` : 'similar accounts';

    insights.push({
      leadId: reply.leadId,
      prospectName: `${reply.lead.firstName} ${reply.lead.lastName}`.trim(),
      company: reply.lead.company,
      outcome: 'Positive reply',
      supportingEvidence: [
        originating?.body
          ? `Message sent: "${originating.body.slice(0, 180).trim()}…"`
          : 'Originating message not on file.',
        `Prospect response: "${(reply.body ?? '').slice(0, 180).trim()}…"`,
        ...pains.map((p) => `Research evidence: ${p.hypothesis}`),
      ],
      observation: `${angle.charAt(0).toUpperCase()}${angle.slice(1)} generated engagement.`,
      suggestedChange: `Use ${angle} more often for ${industry}.`,
      status: 'proposed',
      approvalRequired: 'manager',
      at: reply.date,
    });
  }

  return insights;
}
