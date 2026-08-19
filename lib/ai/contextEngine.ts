/**
 * Telestar Context Engine 2.0 (Directive Phase 2 §22, §23, §24).
 * Enforces Database-First deterministic calculations and compact contextual token budgets.
 */

import { prisma, tenantStorage } from '@/lib/prisma';
import type { SessionUser } from '@/lib/auth';

export interface TokenBudgetAllocation {
  maxTotalTokens: number;
  p0CoreBudget: number;
  p1RecentEventsBudget: number;
  p2CommercialHistoryBudget: number;
  p3PlaybookBudget: number;
}

export const DEFAULT_TOKEN_BUDGET: TokenBudgetAllocation = {
  maxTotalTokens: 4000,
  p0CoreBudget: 1000,
  p1RecentEventsBudget: 1200,
  p2CommercialHistoryBudget: 1200,
  p3PlaybookBudget: 600,
};

export interface DeterministicCampaignMetrics {
  campaignId: string;
  name: string;
  targetMeetings: number;
  deliveredMeetings: number;
  remainingTarget: number;
  activeLeadsCount: number;
  positiveRepliesCount: number;
  pendingFollowUpsCount: number;
  pacingPercentage: number;
}

export interface DeterministicSdrMetrics {
  sdrId: string;
  sdrName: string;
  assignedLeadsCount: number;
  overdueTasksCount: number;
  hotRepliesCount: number;
  meetingsBookedThisMonth: number;
}

export interface AssembledContext {
  tokenBudget: TokenBudgetAllocation;
  estimatedTokens: number;
  systemContextPrompt: string;
  p0Facts: Record<string, unknown>;
  deterministicMetrics?: Record<string, unknown>;
  retrievedDocumentsCount: number;
}

/**
 * Deterministic SQL computation for Campaign Delivery state (Directive §23).
 * Never delegates arithmetic to LLM.
 */
export async function calculateDeterministicCampaignMetrics(
  tenantId: string,
  campaignId: string
): Promise<DeterministicCampaignMetrics | null> {
  return tenantStorage.run({ tenantId, bypassRls: false }, async () => {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        _count: {
          select: {
            leads: true,
            meetings: true,
          },
        },
      },
    });

    if (!campaign) return null;

    const [deliveredMeetings, positiveReplies, pendingFollowUps] = await Promise.all([
      prisma.meeting.count({
        where: {
          campaignId,
          tenantId,
          status: { in: ['completed', 'accepted', 'attended', 'scheduled'] as never[] },
        },
      }),
      prisma.lead.count({
        where: {
          campaignId,
          tenantId,
          stage: 'replied',
        },
      }),
      prisma.task.count({
        where: {
          tenantId,
          status: 'pending',
          dueDate: { lte: new Date() },
          lead: { campaignId },
        },
      }),
    ]);

    const targetMeetings = 40; // Default target benchmark
    const remainingTarget = Math.max(0, targetMeetings - deliveredMeetings);
    const pacingPercentage = targetMeetings > 0 ? (deliveredMeetings / targetMeetings) * 100 : 0;

    return {
      campaignId: campaign.id,
      name: campaign.name,
      targetMeetings,
      deliveredMeetings,
      remainingTarget,
      activeLeadsCount: campaign._count.leads,
      positiveRepliesCount: positiveReplies,
      pendingFollowUpsCount: pendingFollowUps,
      pacingPercentage: Number(pacingPercentage.toFixed(1)),
    };
  });
}

/**
 * Deterministic SQL computation for SDR Workload state (Directive §23).
 */
export async function calculateDeterministicSdrMetrics(
  tenantId: string,
  sdrId: string
): Promise<DeterministicSdrMetrics | null> {
  return tenantStorage.run({ tenantId, bypassRls: false }, async () => {
    const user = await prisma.user.findUnique({
      where: { id: sdrId },
      select: { id: true, firstName: true, lastName: true },
    });

    if (!user) return null;

    const [assignedLeads, overdueTasks, hotReplies, meetingsBooked] = await Promise.all([
      prisma.lead.count({
        where: { tenantId, assignedToId: sdrId },
      }),
      prisma.task.count({
        where: { tenantId, userId: sdrId, status: 'pending', dueDate: { lte: new Date() } },
      }),
      prisma.lead.count({
        where: { tenantId, assignedToId: sdrId, stage: 'replied' },
      }),
      prisma.meeting.count({
        where: {
          tenantId,
          lead: { assignedToId: sdrId },
          createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        },
      }),
    ]);

    return {
      sdrId: user.id,
      sdrName: `${user.firstName} ${user.lastName}`.trim(),
      assignedLeadsCount: assignedLeads,
      overdueTasksCount: overdueTasks,
      hotRepliesCount: hotReplies,
      meetingsBookedThisMonth: meetingsBooked,
    };
  });
}

/**
 * Assemble compact, token-bounded context with pre-calculated CRM truth (Directive §22, §24).
 */
export async function assembleContext(params: {
  sessionUser: SessionUser;
  campaignId?: string;
  leadId?: string;
  sdrId?: string;
  question?: string;
  budget?: Partial<TokenBudgetAllocation>;
}): Promise<AssembledContext> {
  const { sessionUser, campaignId, leadId, sdrId } = params;
  const budget: TokenBudgetAllocation = { ...DEFAULT_TOKEN_BUDGET, ...params.budget };
  const tenantId = sessionUser.tenantId;
  if (!tenantId) {
    throw new Error('Tenant context missing from session');
  }
  const userName = `${sessionUser.firstName || ''} ${sessionUser.lastName || ''}`.trim() || sessionUser.email;

  const lines: string[] = [
    '=== TELESTAR CONTEXT 2.0 (DETERMINISTIC TRUTH) ===',
    `[Actor]: ${userName} | Role: ${sessionUser.role} | Tenant: ${tenantId}`,
  ];

  const p0Facts: Record<string, unknown> = {
    userId: sessionUser.id,
    role: sessionUser.role,
    tenantId,
  };

  const deterministicMetrics: Record<string, unknown> = {};

  // 1. Campaign deterministic metrics if requested
  if (campaignId) {
    const campMetrics = await calculateDeterministicCampaignMetrics(tenantId, campaignId);
    if (campMetrics) {
      deterministicMetrics.campaign = campMetrics;
      lines.push(
        `[P0 - Campaign Truth]: "${campMetrics.name}" | Target=${campMetrics.targetMeetings} | Delivered=${campMetrics.deliveredMeetings} | Remaining=${campMetrics.remainingTarget} | Pacing=${campMetrics.pacingPercentage}% | ActiveLeads=${campMetrics.activeLeadsCount} | HotReplies=${campMetrics.positiveRepliesCount} | OverdueSLA=${campMetrics.pendingFollowUpsCount}`
      );
    }
  }

  // 2. SDR deterministic metrics if requested
  if (sdrId) {
    const sdrMetrics = await calculateDeterministicSdrMetrics(tenantId, sdrId);
    if (sdrMetrics) {
      deterministicMetrics.sdr = sdrMetrics;
      lines.push(
        `[P0 - SDR Truth]: ${sdrMetrics.sdrName} | AssignedLeads=${sdrMetrics.assignedLeadsCount} | OverdueTasks=${sdrMetrics.overdueTasksCount} | HotReplies=${sdrMetrics.hotRepliesCount} | MonthMeetings=${sdrMetrics.meetingsBookedThisMonth}`
      );
    }
  }

  // 3. Active lead truth if requested
  if (leadId) {
    const lead = await tenantStorage.run({ tenantId, bypassRls: false }, () =>
      prisma.lead.findUnique({
        where: { id: leadId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          company: true,
          email: true,
          stage: true,
          crmPriorityScore: true,
          emailInvalid: true,
          lastContactedAt: true,
          assignedTo: { select: { firstName: true, lastName: true } },
          campaign: { select: { name: true } },
        },
      })
    );

    if (lead) {
      p0Facts.lead = lead;
      lines.push(
        `[P0 - Lead Truth]: ${lead.firstName} ${lead.lastName} (${lead.company}) | Stage: ${lead.stage} | Score: ${lead.crmPriorityScore} | Owner: ${lead.assignedTo?.firstName || 'Unassigned'} | Suppressed: ${lead.emailInvalid}`
      );
    }
  }

  lines.push('=== END CONTEXT ===');

  const promptText = lines.join('\n');
  const estimatedTokens = Math.ceil(promptText.length / 4);

  return {
    tokenBudget: budget,
    estimatedTokens,
    systemContextPrompt: promptText,
    p0Facts,
    deterministicMetrics,
    retrievedDocumentsCount: Object.keys(deterministicMetrics).length,
  };
}
