import type { SessionUser } from '@/lib/auth';
import { getVisibleCampaignIds } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export class ResearchCampaignUnavailableError extends Error {
  constructor() {
    super('research_campaign_unavailable');
    this.name = 'ResearchCampaignUnavailableError';
  }
}

function visibleCampaignWhere(actor: SessionUser, tenantId: string) {
  return getVisibleCampaignIds(actor).then((visibleIds) => ({
    tenantId,
    status: 'active' as const,
    ...(visibleIds === null ? {} : { id: { in: visibleIds } }),
  }));
}

export async function listResearchCampaigns(actor: SessionUser, tenantId: string) {
  if (actor.tenantId !== tenantId) throw new ResearchCampaignUnavailableError();
  return prisma.campaign.findMany({
    where: await visibleCampaignWhere(actor, tenantId),
    orderBy: { name: 'asc' },
    take: 200,
    select: {
      id: true,
      name: true,
      client: { select: { name: true } },
    },
  });
}

export async function requireResearchCampaign(
  actor: SessionUser,
  tenantId: string,
  campaignId: string,
) {
  if (actor.tenantId !== tenantId) throw new ResearchCampaignUnavailableError();
  const campaign = await prisma.campaign.findFirst({
    where: {
      ...(await visibleCampaignWhere(actor, tenantId)),
      id: campaignId,
    },
    select: { id: true, name: true },
  });
  if (!campaign) throw new ResearchCampaignUnavailableError();
  return campaign;
}
