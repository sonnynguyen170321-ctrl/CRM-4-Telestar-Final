import { prisma } from '@/lib/prisma';
import type { LeadStage, MeetingStatus } from '@prisma/client';
import type { SessionUser } from '@/lib/auth';
import { getManageScope, type ManageScope } from '@/lib/admin/scope';
import { canOwnSdrWork } from '@/lib/admin/orgRules';

/**
 * "What breaks if I remove or deactivate this person?"
 *
 * Every removal path in the Admin Control Center runs this first. Nothing may
 * drop a `CampaignSdr` row or set `isActive: false` without the caller having
 * seen these numbers and chosen what happens to the work.
 *
 * Scope it to a campaign for "remove from this campaign", or leave `campaignId`
 * off for "deactivate this user entirely".
 */

export type ImpactScope = { userId: string; campaignId?: string };

export type SuggestedTarget = {
  id: string;
  name: string;
  role: string;
  /** True when this target is not yet a member of the campaign in question. */
  requiresCampaignAdd: boolean;
};

export type RecommendedAction = 'safe_remove' | 'transfer_work' | 'pause_tasks' | 'blocked';

export type UserImpact = {
  userId: string;
  campaignId: string | null;
  openLeads: number;
  totalLeads: number;
  openTasks: number;
  /** Pending tasks the send cron has claimed. These cannot be moved — see transferWork. */
  lockedTasks: number;
  scheduledMeetings: number;
  openOpportunities: number;
  campaignMemberships: number;
  /** Connected mailboxes still able to send. Deactivating a user does NOT pause these. */
  activeEmailAccounts: number;
  /** Leadgen pool rows pointing at this user. Reported, never transferred in V1. */
  leadPoolItems: number;
  totalOpen: number;
  canRemoveSafely: boolean;
  recommendedAction: RecommendedAction;
  suggestedTargets: SuggestedTarget[];
};

/** Stages that still need someone working them. */
const CLOSED_LEAD_STAGES: LeadStage[] = ['won', 'lost'];
/** A meeting is "live" while it is booked and still in the future. */
const LIVE_MEETING_STATUSES: MeetingStatus[] = ['scheduled', 'link_sent'];

export async function computeUserImpact(
  scope: ImpactScope,
  actor?: SessionUser
): Promise<UserImpact> {
  const { userId, campaignId } = scope;
  const now = new Date();
  const camp = campaignId ? { campaignId } : {};
  // Task has no campaignId column — it reaches a campaign only through its lead.
  const taskCampaignFilter = campaignId ? { lead: { campaignId } } : {};

  const [
    openLeads,
    totalLeads,
    openTasks,
    lockedTasks,
    scheduledMeetings,
    openOpportunities,
    campaignMemberships,
    activeEmailAccounts,
    leadPoolItems,
  ] = await Promise.all([
    prisma.lead.count({
      where: {
        assignedToId: userId,
        archivedAt: null,
        stage: { notIn: CLOSED_LEAD_STAGES },
        ...camp,
      },
    }),
    prisma.lead.count({ where: { assignedToId: userId, archivedAt: null, ...camp } }),
    prisma.task.count({ where: { userId, status: 'pending', ...taskCampaignFilter } }),
    prisma.task.count({
      where: { userId, status: 'pending', lockedAt: { not: null }, ...taskCampaignFilter },
    }),
    prisma.meeting.count({
      where: {
        sdrId: userId,
        status: { in: LIVE_MEETING_STATUSES },
        scheduledAt: { gte: now },
        ...camp,
      },
    }),
    prisma.opportunity.count({ where: { ownerId: userId, status: 'open', ...camp } }),
    prisma.campaignSdr.count({ where: { userId } }),
    prisma.emailAccount.count({ where: { userId, isActive: true, sendPausedAt: null } }),
    prisma.leadPoolItem.count({ where: { assignedSdrId: userId } }),
  ]);

  const totalOpen = openLeads + openTasks + scheduledMeetings + openOpportunities;

  const suggestedTargets = actor
    ? await findSuggestedTargets(actor, userId, campaignId)
    : [];

  return {
    userId,
    campaignId: campaignId ?? null,
    openLeads,
    totalLeads,
    openTasks,
    lockedTasks,
    scheduledMeetings,
    openOpportunities,
    campaignMemberships,
    activeEmailAccounts,
    leadPoolItems,
    totalOpen,
    canRemoveSafely: totalOpen === 0,
    recommendedAction: deriveRecommendedAction({
      totalOpen,
      openLeads,
      scheduledMeetings,
      openOpportunities,
      hasTargets: suggestedTargets.length > 0,
    }),
    suggestedTargets,
  };
}

function deriveRecommendedAction(input: {
  totalOpen: number;
  openLeads: number;
  scheduledMeetings: number;
  openOpportunities: number;
  hasTargets: boolean;
}): RecommendedAction {
  if (input.totalOpen === 0) return 'safe_remove';
  if (input.hasTargets) return 'transfer_work';
  // Tasks alone can be stopped in place. Leads, meetings and opportunities are
  // commitments to a prospect — they need a human owner, so with no valid target
  // the only honest answer is to block and make the admin create or activate one.
  if (input.openLeads === 0 && input.scheduledMeetings === 0 && input.openOpportunities === 0) {
    return 'pause_tasks';
  }
  return 'blocked';
}

/**
 * Active users the actor may hand work to. Leadgen roles are excluded — see
 * `canOwnSdrWork` for why a lead assigned to a leadgen user goes invisible.
 */
async function findSuggestedTargets(
  actor: SessionUser,
  excludeUserId: string,
  campaignId?: string
): Promise<SuggestedTarget[]> {
  const scope = await getManageScope(actor);
  if (scope.kind === 'none') return [];

  const candidates = await prisma.user.findMany({
    where: {
      isActive: true,
      id: { not: excludeUserId, ...scopeUserFilter(scope) },
      role: { in: ['sdr', 'team_lead', 'floor_manager'] },
    },
    select: { id: true, firstName: true, lastName: true, role: true },
    orderBy: [{ role: 'asc' }, { firstName: 'asc' }],
  });

  const memberIds = campaignId
    ? new Set(
        (
          await prisma.campaignSdr.findMany({
            where: { campaignId, userId: { in: candidates.map((c) => c.id) } },
            select: { userId: true },
          })
        ).map((r) => r.userId)
      )
    : new Set<string>();

  return candidates
    .filter((c) => canOwnSdrWork(c.role))
    .map((c) => ({
      id: c.id,
      name: `${c.firstName} ${c.lastName}`.trim(),
      role: c.role,
      requiresCampaignAdd: campaignId ? !memberIds.has(c.id) : false,
    }))
    // Members of the campaign first — they can take the work with no side effects.
    .sort((a, b) => Number(a.requiresCampaignAdd) - Number(b.requiresCampaignAdd));
}

function scopeUserFilter(scope: ManageScope): { in?: string[] } {
  if (scope.kind === 'all') return {};
  if (scope.kind === 'none') return { in: [] };
  return { in: [...scope.userIds] };
}
