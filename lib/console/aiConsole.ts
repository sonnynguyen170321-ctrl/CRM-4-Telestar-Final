import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/auth';
import { computeVisibleUserIds } from '@/lib/podScoping';
import { CLASS_LABEL, KIND_LABEL, type ReplyClass, type ReplyKind } from '@/lib/replies/types';
import { buildOutcomeInsights, type OutcomeInsight } from './outcomeInsight';

/**
 * The operating model, as one readable board (Revenue AI Phase 9).
 *
 * Not a new pipeline — a presentation of rows the CRM already owns (ARCHITECTURE §9). Every bucket
 * below is a query over `Lead.operatingState`, `WorkOrder`, `AgentApprovalRequest` and
 * `InboundMessage`; nothing here computes a number that could disagree with the module that owns it.
 *
 * The question it has to answer in seconds:
 *
 * ```text
 * What is AI doing?   What needs a human?   What happened?   What happens next?
 * ```
 *
 * Scoping is the CRM's: `scopedUserIds` is the same pod/role walk the rest of the app uses, so an
 * SDR sees their own prospects and a manager sees their team's. There is no AI-side role matrix.
 */

export type BucketKey =
  | 'needs_attention'
  | 'ai_managed'
  | 'human_managed'
  | 'waiting'
  | 'reengagement_eligible'
  | 'draft_available'
  | 'approval_pending'
  | 'blocked';

export interface ConsoleProspect {
  leadId: string;
  name: string;
  company: string | null;
  title: string | null;
  operatingState: string;
  stage: string;
  priority: string;
  assignedToId: string | null;
  ownerName: string | null;
  /** Latest classified reply, when there is one. */
  replyClass: ReplyClass | null;
  replyKind: ReplyKind | null;
  replyLabel: string | null;
  classLabel: string | null;
  replyAt: Date | null;
  /** Silence, in days, since the last outbound touch. Null when nothing has been sent. */
  lastTouchAt: Date | null;
}

export interface ConsoleBucket {
  key: BucketKey;
  label: string;
  hint: string;
  count: number;
  prospects: ConsoleProspect[];
}

export interface ConsoleWorkItem {
  id: string;
  kind: 'approval' | 'work_order';
  label: string;
  detail: string;
  leadId: string | null;
  status: string;
  at: Date;
}

export interface AiConsole {
  scope: 'own' | 'team';
  buckets: ConsoleBucket[];
  approvals: ConsoleWorkItem[];
  blocked: ConsoleWorkItem[];
  /** Recent AI/CRM events, newest first — the "what happened" column. */
  timeline: Array<{ at: Date; leadId: string | null; type: string; description: string }>;
  totals: { aiManaged: number; humanOwned: number; needsAttention: number; blocked: number };
  /** Phase 10 demo minimum: outcomes with a proposed playbook change, never an applied one. */
  insights: OutcomeInsight[];
}

const BUCKET_META: Record<BucketKey, { label: string; hint: string }> = {
  needs_attention: { label: 'Needs my attention', hint: 'A prospect replied. AI has stopped.' },
  ai_managed: { label: 'AI managed', hint: 'Research, outreach and follow-up are running.' },
  human_managed: { label: 'Human managed', hint: 'You own the conversation. AI assists on request.' },
  waiting: { label: 'Waiting for prospect', hint: 'You sent something. The clock is running.' },
  reengagement_eligible: { label: 'Re-engagement eligible', hint: 'Gone quiet. AI can propose a follow-up — you decide.' },
  draft_available: { label: 'AI draft available', hint: 'A reply is classified and a draft can be generated.' },
  approval_pending: { label: 'Approval pending', hint: 'AI is waiting on a human decision.' },
  blocked: { label: 'Blocked / failed', hint: 'Work orders that stopped and need a look.' },
};

const STATE_BUCKET: Partial<Record<string, BucketKey>> = {
  human_attention: 'needs_attention',
  ai_managed: 'ai_managed',
  ai_reengagement: 'ai_managed',
  researching: 'ai_managed',
  ready_for_outreach: 'ai_managed',
  human_managed: 'human_managed',
  waiting_for_prospect: 'waiting',
  reengagement_eligible: 'reengagement_eligible',
};

export async function buildAiConsole(user: SessionUser): Promise<AiConsole> {
  const tenantId = user.tenantId as string;
  const scope: 'own' | 'team' = user.role === 'sdr' ? 'own' : 'team';

  // The CRM's own pod/role walk — the same one the team surfaces use. An SDR sees their prospects,
  // a Team Lead their pod, a Director everyone. There is no AI-side role matrix.
  const allUsers = await prisma.user.findMany({
    where: { tenantId },
    select: { id: true, role: true, managerId: true },
  });
  // null means "everyone" — a Director is not scoped down to a list.
  const userIds = computeVisibleUserIds(allUsers, user);

  const leads = await prisma.lead.findMany({
    where: {
      tenantId,
      ...(userIds ? { assignedToId: { in: userIds } } : {}),
      archivedAt: null,
      operatingState: { not: 'unassigned' },
    },
    select: {
      id: true, firstName: true, lastName: true, company: true, title: true,
      operatingState: true, stage: true, crmPriorityScore: true, assignedToId: true,
      assignedTo: { select: { firstName: true, lastName: true } },
      inboundMessages: {
        where: { replyClass: { not: null } },
        orderBy: { date: 'desc' },
        take: 1,
        select: { replyClass: true, replyKind: true, date: true },
      },
      outboundMessages: {
        where: { status: 'sent' },
        orderBy: { sentAt: 'desc' },
        take: 1,
        select: { sentAt: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 300,
  });

  const toProspect = (l: (typeof leads)[number]): ConsoleProspect => {
    const reply = l.inboundMessages[0];
    const kind = (reply?.replyKind ?? null) as ReplyKind | null;
    const cls = (reply?.replyClass ?? null) as ReplyClass | null;
    return {
      leadId: l.id,
      name: `${l.firstName} ${l.lastName}`.trim(),
      company: l.company,
      title: l.title,
      operatingState: l.operatingState,
      stage: l.stage,
      priority: l.crmPriorityScore,
      assignedToId: l.assignedToId,
      ownerName: l.assignedTo ? `${l.assignedTo.firstName} ${l.assignedTo.lastName}`.trim() : null,
      replyClass: cls,
      replyKind: kind,
      replyLabel: kind ? KIND_LABEL[kind] ?? null : null,
      classLabel: cls ? CLASS_LABEL[cls] ?? null : null,
      replyAt: reply?.date ?? null,
      lastTouchAt: l.outboundMessages[0]?.sentAt ?? null,
    };
  };

  const byBucket = new Map<BucketKey, ConsoleProspect[]>();
  const push = (key: BucketKey, p: ConsoleProspect) => {
    const list = byBucket.get(key) ?? [];
    list.push(p);
    byBucket.set(key, list);
  };

  for (const lead of leads) {
    const p = toProspect(lead);
    const key = STATE_BUCKET[lead.operatingState];
    if (key) push(key, p);
    // A classified sales reply on a human-owned prospect is a draft waiting to be generated. It is
    // a *cross-cut*, not a state: the same prospect also appears under whoever owns them.
    if ((p.replyClass === 'C' || p.replyClass === 'D') && lead.operatingState !== 'completed') {
      push('draft_available', p);
    }
  }

  const [pendingApprovals, blockedOrders, activities, insights] = await Promise.all([
    prisma.agentApprovalRequest.findMany({
      where: { tenantId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: { id: true, capability: true, toolName: true, leadId: true, requiredLevel: true, createdAt: true, status: true },
    }),
    prisma.workOrder.findMany({
      where: { tenantId, status: { in: ['paused', 'failed'] } },
      orderBy: { updatedAt: 'desc' },
      take: 25,
      select: { id: true, type: true, status: true, pausedReason: true, leadId: true, updatedAt: true },
    }),
    prisma.activity.findMany({
      where: {
        tenantId,
        type: {
          in: [
            'prospect_handed_off', 'prospect_handed_back', 'prospect_reengagement_eligible',
            'prospect_ai_reengagement_started', 'prospect_ai_managed', 'prospect_ready_for_outreach',
            'prospect_research_started', 'sequence_enrolled', 'email_sent', 'email_replied',
            'sequence_deferred', 'sequence_unenrolled',
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: { createdAt: true, leadId: true, type: true, description: true },
    }),
    buildOutcomeInsights(tenantId),
  ]);

  const approvals: ConsoleWorkItem[] = pendingApprovals.map((a) => ({
    id: a.id,
    kind: 'approval',
    label: `${a.capability} — ${a.toolName}`,
    detail: `Needs ${a.requiredLevel} approval`,
    leadId: a.leadId,
    status: a.status,
    at: a.createdAt,
  }));

  const blocked: ConsoleWorkItem[] = blockedOrders.map((o) => ({
    id: o.id,
    kind: 'work_order',
    label: o.type,
    detail: o.pausedReason ? `${o.status} — ${o.pausedReason}` : o.status,
    leadId: o.leadId,
    status: o.status,
    at: o.updatedAt,
  }));

  for (const key of Object.keys(BUCKET_META) as BucketKey[]) {
    if (!byBucket.has(key)) byBucket.set(key, []);
  }
  byBucket.set('approval_pending', byBucket.get('approval_pending') ?? []);

  const buckets: ConsoleBucket[] = (Object.keys(BUCKET_META) as BucketKey[]).map((key) => {
    const prospects = byBucket.get(key) ?? [];
    const count =
      key === 'approval_pending' ? approvals.length : key === 'blocked' ? blocked.length : prospects.length;
    return { key, label: BUCKET_META[key].label, hint: BUCKET_META[key].hint, count, prospects };
  });

  return {
    scope,
    buckets,
    approvals,
    blocked,
    timeline: activities.map((a) => ({
      at: a.createdAt,
      leadId: a.leadId,
      type: a.type,
      description: a.description ?? a.type,
    })),
    totals: {
      aiManaged: (byBucket.get('ai_managed') ?? []).length,
      humanOwned:
        (byBucket.get('needs_attention') ?? []).length +
        (byBucket.get('human_managed') ?? []).length +
        (byBucket.get('waiting') ?? []).length,
      needsAttention: (byBucket.get('needs_attention') ?? []).length,
      blocked: blocked.length,
    },
    insights,
  };
}
