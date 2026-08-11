import { prisma } from '@/lib/prisma';
import { getLeadWhereScope, type SessionUser } from '@/lib/auth';
import { scoreLead } from './scoring';

/**
 * Deterministic lead prioritization (Phase 8a).
 *
 * This module is the **authority on rank**, and it holds no AI dependency at all — not an
 * import, not a provider call. `lib/leads/` is core CRM: an SDR must be able to ask what to work
 * on next while every model provider is down. The AI refinement that explains a bounded top
 * slice lives in `lib/research/leadRefinement.ts`, on the other side of that line, and it can
 * only ever *annotate* what this function ranked.
 *
 * `scoreLead` from `lib/leads/scoring.ts` is the canonical scorer. Nothing else produces
 * `score`, and no explanation may overwrite one.
 */

/** Default number of ranked leads returned when a caller does not say. */
export const DEFAULT_PRIORITIZATION_LIMIT = 50;

export interface RankedLead {
  leadId: string;
  firstName: string;
  lastName: string;
  company: string;
  title: string | null;
  /** Deterministic, from `scoreLead`. */
  score: number;
  label: 'hot' | 'warm' | 'cold';
  rank: number;
  /** `scoreLead`'s own recommendation — always present, with or without AI. */
  deterministicRecommendation: string;
  insights: string[];
}

export interface RankLeadsInput {
  tenantId: string;
  campaignId?: string | null;
  limit?: number;
}

/**
 * Rank the caller's leads.
 *
 * Candidate selection goes through `getLeadWhereScope`, the CRM's own scoping — object
 * authorization is not reproduced here. Ties break on lead id so the order is stable across
 * runs rather than following database order.
 */
export async function rankLeads(user: SessionUser, input: RankLeadsInput): Promise<RankedLead[]> {
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_PRIORITIZATION_LIMIT, 200));

  const scope = await getLeadWhereScope(user);
  const leads = await prisma.lead.findMany({
    where: {
      ...scope,
      tenantId: input.tenantId,
      ...(input.campaignId ? { campaignId: input.campaignId } : {}),
      stage: { notIn: ['won', 'lost'] },
    },
    include: {
      activities: { select: { type: true, createdAt: true }, take: 20, orderBy: { createdAt: 'desc' } },
      tasks: { select: { status: true, dueDate: true }, take: 20 },
    },
    take: 500,
    orderBy: { createdAt: 'desc' },
  });

  return leads
    .map((lead) => {
      const result = scoreLead({
        id: lead.id,
        firstName: lead.firstName,
        lastName: lead.lastName,
        company: lead.company,
        title: lead.title,
        email: lead.email,
        phone: lead.phone,
        linkedIn: lead.linkedIn,
        whatsApp: lead.whatsApp,
        stage: lead.stage,
        crmPriorityScore: lead.crmPriorityScore,
        source: lead.source,
        tags: lead.tags,
        lastContactedAt: lead.lastContactedAt?.toISOString() ?? null,
        createdAt: lead.createdAt.toISOString(),
        sequenceId: lead.sequenceId,
        activities: lead.activities.map((a) => ({ type: a.type, createdAt: a.createdAt.toISOString() })),
        tasks: lead.tasks.map((t) => ({ status: t.status, dueDate: t.dueDate.toISOString() })),
      });

      return {
        leadId: lead.id,
        firstName: lead.firstName,
        lastName: lead.lastName,
        company: lead.company,
        title: lead.title,
        score: result.score,
        label: result.label,
        rank: 0,
        deterministicRecommendation: result.recommendation,
        insights: result.insights,
      };
    })
    .sort((a, b) => b.score - a.score || a.leadId.localeCompare(b.leadId))
    .slice(0, limit)
    .map((lead, index) => ({ ...lead, rank: index + 1 }));
}
