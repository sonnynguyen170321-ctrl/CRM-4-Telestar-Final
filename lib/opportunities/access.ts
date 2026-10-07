import { canAccessLead, getVisibleCampaignIds, type SessionUser } from '@/lib/auth';

export type OpportunityAccessShape = {
  ownerId: string | null;
  createdById: string | null;
  campaignId: string | null;
  lead?: { id: string; assignedToId?: string | null; campaignId?: string | null } | null;
};

export async function canAccessOpportunity(
  viewer: SessionUser,
  opp: OpportunityAccessShape
): Promise<boolean> {
  if (viewer.role === 'director') return true;
  if (opp.ownerId === viewer.id || opp.createdById === viewer.id) return true;
  if (
    opp.lead &&
    (await canAccessLead(viewer, {
      assignedToId: opp.lead.assignedToId ?? null,
      campaignId: opp.lead.campaignId ?? null,
    }))
  ) {
    return true;
  }

  if (!opp.campaignId) return false;
  // A team lead works their pod's pipeline, not every opportunity in a shared campaign (owner,
  // 2026-10-07) — reached above through the owner, the creator or the lead, not the campaign.
  if (viewer.role === 'team_lead') return false;
  const visibleCampaignIds = await getVisibleCampaignIds(viewer);
  if (visibleCampaignIds === null) return true;
  return visibleCampaignIds.includes(opp.campaignId);
}

export function canApproveClientHandoff(viewer: SessionUser): boolean {
  return viewer.role === 'director' || viewer.role === 'floor_manager' || viewer.role === 'team_lead';
}
