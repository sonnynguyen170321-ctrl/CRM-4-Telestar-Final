import { prisma } from '@/lib/prisma';
import { getEvidenceForLead } from '@/lib/research/engine';
import { KIND_LABEL, CLASS_LABEL, type ReplyClass, type ReplyKind } from '@/lib/replies/types';

/**
 * The handoff package an SDR opens when AI hands a prospect over (Phase 8c).
 *
 * Assembled entirely from rows that already exist — lead, account, campaign, sequence, research
 * evidence, outbound messages, the inbound reply, the transition ledger. There is no second
 * conversation store and no handoff table: a package is a *view* of the CRM at handoff time, so it
 * cannot drift from the CRM the way a snapshot would.
 *
 * Read-only. Nothing here writes, and nothing here can reach the prospect.
 */

export interface HandoffMessage {
  direction: 'out' | 'in';
  at: Date;
  subject: string | null;
  body: string | null;
}

export interface HandoffEvidenceItem {
  kind: 'signal' | 'pain' | 'hook';
  summary: string;
  sourceUrl: string | null;
  observedAt: Date;
  confidence: number;
}

export interface HandoffPackage {
  leadId: string;
  prospect: {
    name: string;
    title: string | null;
    email: string;
    company: string | null;
    linkedinUrl: string | null;
    operatingState: string;
    stage: string;
    priority: string;
  };
  account: { id: string; name: string; domain: string | null; industry: string | null } | null;
  campaign: { id: string; name: string; clientName: string | null } | null;
  sequence: {
    id: string;
    name: string;
    currentStep: number | null;
    status: string | null;
    /** When the engine will act next. Computed by `lib/automation/scheduling.ts`, never here. */
    nextActionAt: Date | null;
    pausedReason: string | null;
  } | null;
  /** Why AI contacted them at all — the evidence the outreach was grounded in. */
  whyContacted: HandoffEvidenceItem[];
  /** What was sent, and what came back. Oldest first. */
  thread: HandoffMessage[];
  latestReply: {
    at: Date;
    subject: string | null;
    body: string | null;
    replyClass: ReplyClass | null;
    replyKind: ReplyKind | null;
    classLabel: string | null;
    kindLabel: string | null;
    confidence: number | null;
    source: string | null;
  } | null;
  /** When ownership moved, from the transition ledger — never inferred from an activity. */
  handoffAt: Date | null;
  /** The work order the outreach ran under, when there was one. */
  workOrder: { id: string; type: string; status: string } | null;
  /** Deterministic recommendation. AI prose is a separate, explicitly-requested call. */
  recommendedObjective: string;
  suggestedCallQuestions: string[];
}

/** What a human should be trying to achieve next, by reply kind. Deterministic on purpose. */
const OBJECTIVE_BY_KIND: Record<string, string> = {
  interest: 'Book a 20-minute discovery call while the interest is fresh.',
  question: 'Answer the question precisely, then propose a call to go deeper.',
  pricing: 'Give a credible range, anchor on value, and move to a scoping call.',
  objection: 'Acknowledge the objection, offer proof, and ask what would need to be true.',
  meeting_request: 'Confirm a time today — send a booking link and a calendar hold.',
  referral: 'Thank them, ask for a warm introduction to the named person.',
  unclear: 'Read the reply and decide whether this is a real opportunity.',
};

const QUESTIONS_BY_KIND: Record<string, string[]> = {
  interest: [
    'What made this land for you right now?',
    'How are you handling this today?',
    'Who else would need to be involved?',
  ],
  pricing: [
    'What budget range are you working with?',
    'What would you be comparing this against?',
    'What does the approval process look like?',
  ],
  question: [
    'What prompted the question?',
    'What would a good answer unlock for you?',
    'What is the timeline you are working to?',
  ],
  objection: [
    'What would need to be true for this to work?',
    'Have you tried something similar before?',
    'Who owns that decision?',
  ],
  meeting_request: [
    'What would make the call worth your time?',
    'Who should join from your side?',
    'What should I prepare beforehand?',
  ],
  referral: [
    'Who is the right person, and what do they own?',
    'Would you be comfortable introducing us?',
    'What should I know before I reach out?',
  ],
  unclear: [
    'What did you mean by that?',
    'Is this something worth exploring?',
    'What is the best next step from your side?',
  ],
};

export async function buildHandoffPackage(
  tenantId: string,
  leadId: string
): Promise<HandoffPackage | null> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      account: { select: { id: true, name: true, domain: true, industry: true } },
      campaign: { select: { id: true, name: true, client: { select: { name: true } } } },
      sequence: { select: { id: true, name: true } },
    },
  });
  if (!lead || lead.tenantId !== tenantId) return null;

  const [evidence, outbound, inbound, transition, workOrder, enrollment] = await Promise.all([
    getEvidenceForLead(tenantId, leadId),
    prisma.outboundMessage.findMany({
      where: { tenantId, leadId },
      orderBy: { createdAt: 'asc' },
      select: { subject: true, body: true, sentAt: true, createdAt: true },
      take: 20,
    }),
    prisma.inboundMessage.findMany({
      where: { tenantId, leadId },
      orderBy: { date: 'asc' },
      take: 20,
    }),
    prisma.prospectTransition.findFirst({
      where: { tenantId, leadId, toState: 'human_attention' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.workOrder.findFirst({
      where: { tenantId, leadId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, type: true, status: true },
    }),
    prisma.sequenceEnrollment.findFirst({
      where: { tenantId, leadId, status: { in: ['active', 'paused'] } },
      orderBy: { startedAt: 'desc' },
      // `nextActionAt` and `pausedReason` come from the enrollment because the enrollment is the
      // authoritative execution lifecycle (ARCHITECTURE §4). The workspace shows "what happens
      // next" from this value rather than composing a plausible-looking time of its own.
      select: { currentStep: true, status: true, nextActionAt: true, pausedReason: true },
    }),
  ]);

  const whyContacted: HandoffEvidenceItem[] = [
    ...evidence.companySignals.map((s) => ({
      kind: 'signal' as const,
      summary: s.summary,
      sourceUrl: s.sourceUrl ?? null,
      observedAt: s.observedAt,
      confidence: s.confidence,
    })),
    ...evidence.accountPainHypotheses.map((p) => ({
      kind: 'pain' as const,
      summary: p.hypothesis,
      sourceUrl: p.sourceUrl ?? null,
      observedAt: p.observedAt,
      confidence: p.confidence,
    })),
    ...evidence.personalizationHooks.map((h) => ({
      kind: 'hook' as const,
      summary: h.angle,
      sourceUrl: h.sourceUrl ?? null,
      observedAt: h.observedAt,
      confidence: h.confidence,
    })),
  ];

  const thread: HandoffMessage[] = [
    ...outbound.map((m) => ({
      direction: 'out' as const,
      at: m.sentAt ?? m.createdAt,
      subject: m.subject,
      body: m.body,
    })),
    ...inbound.map((m) => ({
      direction: 'in' as const,
      at: m.date,
      subject: m.subject,
      body: m.body,
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  // The classified reply, not merely the newest message: an out-of-office arriving after a pricing
  // question must not become the thing the SDR is asked to answer.
  const classified = [...inbound].reverse().find((m) => m.replyClass === 'C' || m.replyClass === 'D');
  const newest = classified ?? [...inbound].reverse().find((m) => m.isReply) ?? null;
  const kind = (newest?.replyKind ?? null) as ReplyKind | null;

  return {
    leadId,
    prospect: {
      name: `${lead.firstName} ${lead.lastName}`.trim(),
      title: lead.title,
      email: lead.email,
      company: lead.company,
      linkedinUrl: lead.linkedIn,
      operatingState: lead.operatingState,
      stage: lead.stage,
      priority: lead.crmPriorityScore,
    },
    account: lead.account
      ? { id: lead.account.id, name: lead.account.name, domain: lead.account.domain, industry: lead.account.industry }
      : null,
    campaign: lead.campaign
      ? { id: lead.campaign.id, name: lead.campaign.name, clientName: lead.campaign.client?.name ?? null }
      : null,
    sequence: lead.sequence
      ? {
          id: lead.sequence.id,
          name: lead.sequence.name,
          currentStep: enrollment?.currentStep ?? null,
          status: enrollment?.status ?? null,
          nextActionAt: enrollment?.nextActionAt ?? null,
          pausedReason: enrollment?.pausedReason ?? null,
        }
      : null,
    whyContacted,
    thread,
    latestReply: newest
      ? {
          at: newest.date,
          subject: newest.subject,
          body: newest.body,
          replyClass: (newest.replyClass ?? null) as ReplyClass | null,
          replyKind: kind,
          classLabel: newest.replyClass ? CLASS_LABEL[newest.replyClass as ReplyClass] ?? null : null,
          kindLabel: kind ? KIND_LABEL[kind] ?? null : null,
          confidence: newest.replyConfidence,
          source: newest.classificationSource,
        }
      : null,
    handoffAt: transition?.createdAt ?? null,
    workOrder,
    recommendedObjective: OBJECTIVE_BY_KIND[kind ?? 'unclear'] ?? OBJECTIVE_BY_KIND.unclear,
    suggestedCallQuestions: QUESTIONS_BY_KIND[kind ?? 'unclear'] ?? QUESTIONS_BY_KIND.unclear,
  };
}
