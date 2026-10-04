import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { getLeadWhereScope, type SessionUser } from '@/lib/auth';
import { getLocalDayBoundaries } from '@/lib/dates/timezone';
import { CLASS_LABEL, KIND_LABEL, type ReplyClass, type ReplyKind } from '@/lib/replies/types';

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
  /** Replies from a person (not an out-of-office) since midnight in the viewer's timezone. */
  repliesToday: number;
}

/** Reply classes that are a person answering. Class B (out-of-office, wrong person) is not. */
const HUMAN_REPLY_CLASSES = ['A', 'C', 'D'];

/** Prospects listed per bucket. The counts are exact; only the lists are this long. */
const LIST_LIMIT = 300;

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

/**
 * The board for one viewer.
 *
 * Scope is the CRM's lead scope (`getLeadWhereScope`) — the one the Leads page applies — so a
 * team lead's board and their Leads list describe the same prospects. `focusUserId` narrows a
 * manager's board to one rep (Home's rep picker); it is AND-ed with the scope, so it can only
 * narrow, never reach a rep the viewer cannot see.
 *
 * Every count is exact. The lists under each bucket are capped at `LIST_LIMIT`; the counts were
 * once those lists' lengths, which stopped at 300 for any team larger than that.
 */
export async function buildAiConsole(
  user: SessionUser,
  options: { focusUserId?: string | null; now?: Date } = {}
): Promise<AiConsole> {
  const tenantId = user.tenantId as string;
  const scope: 'own' | 'team' = user.role === 'sdr' ? 'own' : 'team';
  const focusUserId = user.role === 'sdr' ? null : options.focusUserId ?? null;

  const leadScope = (await getLeadWhereScope(user)) as Prisma.LeadWhereInput;
  const unrestricted = Object.keys(leadScope).length === 0 && !focusUserId;
  // The prospects this viewer may see, archived ones left out.
  const visibleLeads: Prisma.LeadWhereInput = {
    AND: [leadScope, { tenantId, archivedAt: null }, ...(focusUserId ? [{ assignedToId: focusUserId }] : [])],
  };
  const boardLeads: Prisma.LeadWhereInput = { AND: [visibleLeads, { operatingState: { not: 'unassigned' } }] };

  const tzOwner = await prisma.user.findFirst({ where: { id: focusUserId ?? user.id, tenantId }, select: { timezone: true } });
  const { start: todayStart } = getLocalDayBoundaries(options.now ?? new Date(), tzOwner?.timezone || 'UTC');

  const leads = await prisma.lead.findMany({
    where: boardLeads,
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
      // The draft cross-cut's rule — any sales reply — so the list and its count agree.
      _count: { select: { inboundMessages: { where: { replyClass: { in: ['C', 'D'] } } } } },
      outboundMessages: {
        where: { status: 'sent' },
        orderBy: { sentAt: 'desc' },
        take: 1,
        select: { sentAt: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: LIST_LIMIT,
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
    if (lead._count.inboundMessages > 0 && lead.operatingState !== 'completed') {
      push('draft_available', p);
    }
  }

  // Approval requests carry a lead id but no relation. A scoped viewer's are found from the other
  // side: the leads named by pending approvals that the viewer can see. That list is as long as the
  // approval queue, not as long as the viewer's book of leads.
  let approvalWhere: Prisma.AgentApprovalRequestWhereInput = { tenantId, status: 'pending' };
  if (!unrestricted) {
    const pendingLeadIds = (
      await prisma.agentApprovalRequest.findMany({
        where: { tenantId, status: 'pending', leadId: { not: null } },
        select: { leadId: true },
        distinct: ['leadId'],
      })
    ).map((row) => row.leadId as string);
    const visibleIds = pendingLeadIds.length
      ? (await prisma.lead.findMany({ where: { AND: [visibleLeads, { id: { in: pendingLeadIds } }] }, select: { id: true } })).map(
          (lead) => lead.id
        )
      : [];
    approvalWhere = { ...approvalWhere, leadId: { in: visibleIds } };
  }
  // Work that names no lead (a campaign batch) is a manager's to see; work on an archived lead is
  // nobody's.
  const leadOrNone = (relation: Prisma.LeadWhereInput) =>
    unrestricted ? { OR: [{ leadId: null }, { lead: relation }] } : { lead: relation };
  const blockedWhere: Prisma.WorkOrderWhereInput = {
    tenantId,
    status: { in: ['paused', 'failed'] },
    ...leadOrNone(visibleLeads),
  };

  const [pendingApprovals, blockedOrders, activities, approvalCount, blockedCount, stateCounts, draftCount, repliesToday] = await Promise.all([
    prisma.agentApprovalRequest.findMany({
      where: approvalWhere,
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: { id: true, capability: true, toolName: true, leadId: true, requiredLevel: true, createdAt: true, status: true },
    }),
    prisma.workOrder.findMany({
      where: blockedWhere,
      orderBy: { updatedAt: 'desc' },
      take: 25,
      select: { id: true, type: true, status: true, pausedReason: true, leadId: true, updatedAt: true },
    }),
    prisma.activity.findMany({
      where: {
        tenantId,
        ...leadOrNone(visibleLeads),
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
    prisma.agentApprovalRequest.count({ where: approvalWhere }),
    prisma.workOrder.count({ where: blockedWhere }),
    prisma.lead.groupBy({ by: ['operatingState'], where: boardLeads, _count: { _all: true } }),
    // A classified sales reply on a prospect not yet completed: a draft can be generated.
    prisma.lead.count({
      where: {
        AND: [
          boardLeads,
          { operatingState: { not: 'completed' } },
          { inboundMessages: { some: { replyClass: { in: ['C', 'D'] } } } },
        ],
      },
    }),
    prisma.inboundMessage.count({
      where: { tenantId, replyClass: { in: HUMAN_REPLY_CLASSES }, date: { gte: todayStart }, lead: visibleLeads },
    }),
  ]);

  // Exact per-bucket counts, from the state every prospect is in — not the length of a capped list.
  const exactCount = new Map<BucketKey, number>();
  for (const row of stateCounts) {
    const key = STATE_BUCKET[row.operatingState];
    if (key) exactCount.set(key, (exactCount.get(key) ?? 0) + row._count._all);
  }
  exactCount.set('draft_available', draftCount);
  exactCount.set('approval_pending', approvalCount);
  exactCount.set('blocked', blockedCount);
  const countOf = (key: BucketKey) => exactCount.get(key) ?? 0;

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

  const buckets: ConsoleBucket[] = (Object.keys(BUCKET_META) as BucketKey[]).map((key) => ({
    key,
    label: BUCKET_META[key].label,
    hint: BUCKET_META[key].hint,
    count: countOf(key),
    prospects: byBucket.get(key) ?? [],
  }));

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
      aiManaged: countOf('ai_managed'),
      humanOwned: countOf('needs_attention') + countOf('human_managed') + countOf('waiting'),
      needsAttention: countOf('needs_attention'),
      blocked: countOf('blocked'),
    },
    repliesToday,
  };
}
