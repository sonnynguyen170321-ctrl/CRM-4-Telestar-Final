import { prisma } from '@/lib/prisma';

import { resolveCampaignIcp, type IcpNotScoredReason } from './scorePoolItem';

/**
 * Read-only: which campaigns have no usable ICP, and what a rescore would do to their leads.
 *
 * Since 2026-10-10 a campaign without an ICP is not scored (no company-default fallback). Leads on
 * such a campaign that were scored under the old fallback keep their verdict until a rescore with
 * `onlyUnscored: false` clears it. This is the list the owner reads before that deploy: nothing here
 * writes. Runs through the tenant-scoped client, so call it inside `tenantStorage.run`.
 */
export type CampaignWithoutIcp = {
  campaignId: string;
  name: string;
  status: string;
  reason: IcpNotScoredReason;
  /** Active (not archived) leads on the campaign. */
  leads: number;
  /** Of those, leads that carry an ICP verdict today and would flip to NOT SCORED on a rescore. */
  withVerdict: number;
  /** Live campaign prospects (pool side), and how many carry an assessment pointer a pool rescore clears. */
  prospects: number;
  prospectsWithVerdict: number;
};

/** Ids of the tenant's campaigns that currently have no usable ICP (profile unpublished or none). */
export async function campaignIdsWithoutIcp(tenantId: string): Promise<string[]> {
  const campaigns = await prisma.campaign.findMany({ where: { tenantId }, select: { id: true } });
  const out: string[] = [];
  for (const campaign of campaigns) {
    if (!(await resolveCampaignIcp(tenantId, campaign.id)).ok) out.push(campaign.id);
  }
  return out;
}

export async function listCampaignsWithoutIcp(tenantId: string): Promise<CampaignWithoutIcp[]> {
  const campaigns = await prisma.campaign.findMany({
    where: { tenantId },
    select: { id: true, name: true, status: true },
    orderBy: { name: 'asc' },
  });

  const out: CampaignWithoutIcp[] = [];
  for (const campaign of campaigns) {
    const resolution = await resolveCampaignIcp(tenantId, campaign.id);
    if (resolution.ok) continue;
    const base = { tenantId, campaignId: campaign.id, archivedAt: null };
    const prospectBase = { tenantId, campaignId: campaign.id, status: { not: 'removed' as const } };
    const [leads, withVerdict, prospects, prospectsWithVerdict] = await Promise.all([
      prisma.lead.count({ where: base }),
      prisma.lead.count({
        where: { ...base, OR: [{ latestIcpAssessmentId: { not: null } }, { icpQualification: { not: null } }] },
      }),
      prisma.campaignProspect.count({ where: prospectBase }),
      prisma.campaignProspect.count({
        where: { ...prospectBase, OR: [{ latestAssessmentId: { not: null } }, { assessedIcpVersionId: { not: null } }] },
      }),
    ]);
    out.push({ campaignId: campaign.id, name: campaign.name, status: campaign.status, reason: resolution.reason, leads, withVerdict, prospects, prospectsWithVerdict });
  }
  return out;
}
