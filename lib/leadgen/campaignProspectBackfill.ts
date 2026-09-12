import type { CampaignProspectStatus, Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';

import { deriveCampaignProspectReadiness } from './campaignProspects';

export type CampaignProspectBackfillConflict = {
  poolItemId: string;
  reason: 'campaign_mismatch' | 'missing_campaign';
  assignedCampaignId: string | null;
  convertedLeadCampaignId: string | null;
};

export type CampaignProspectBackfillReport = {
  tenantId: string;
  scanned: number;
  planned: number;
  inserted: number;
  alreadyPresent: number;
  conflicts: CampaignProspectBackfillConflict[];
};

type BackfillRow = {
  tenantId: string;
  campaignId: string;
  poolItemId: string;
  assignedSdrId: string | null;
  leadId: string | null;
  createdById: string | null;
  assessedIcpVersionId: string | null;
  latestAssessmentId: string | null;
  status: CampaignProspectStatus;
  activatedAt: Date | null;
};

const DEFAULT_BATCH_SIZE = 500;

export async function backfillCampaignProspectsForTenant(params: {
  tenantId: string;
  dryRun?: boolean;
  batchSize?: number;
}): Promise<CampaignProspectBackfillReport> {
  const { tenantId } = params;
  const dryRun = params.dryRun ?? true;
  const batchSize = Math.min(1000, Math.max(1, params.batchSize ?? DEFAULT_BATCH_SIZE));

  // Apply is two-pass so a conflict in a later page cannot leave an earlier page half-written.
  // Operators resolve the complete dry-run report first; only a clean tenant can be mutated.
  if (!dryRun) {
    const preflight = await backfillCampaignProspectsForTenant({
      tenantId,
      dryRun: true,
      batchSize,
    });
    if (preflight.conflicts.length > 0) return preflight;
  }
  const report: CampaignProspectBackfillReport = {
    tenantId,
    scanned: 0,
    planned: 0,
    inserted: 0,
    alreadyPresent: 0,
    conflicts: [],
  };

  let cursor: string | undefined;
  while (true) {
    const items = await prisma.leadPoolItem.findMany({
      where: {
        tenantId,
        OR: [{ assignedCampaignId: { not: null } }, { convertedLeadId: { not: null } }],
      },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        email: true,
        emailValidation: true,
        assignedCampaignId: true,
        assignedSdrId: true,
        assignedById: true,
        assignedAt: true,
        convertedLeadId: true,
        convertedLead: {
          select: { id: true, tenantId: true, campaignId: true, assignedToId: true },
        },
      },
    });
    if (items.length === 0) break;
    cursor = items.at(-1)!.id;
    report.scanned += items.length;

    const campaignIds = [
      ...new Set(
        items
          .flatMap((item) => [item.assignedCampaignId, item.convertedLead?.campaignId])
          .filter((id): id is string => Boolean(id))
      ),
    ];
    const campaigns = await prisma.campaign.findMany({
      where: { tenantId, id: { in: campaignIds } },
      select: { id: true, icpVersionId: true },
    });
    const campaignById = new Map(campaigns.map((campaign) => [campaign.id, campaign]));

    const poolIds = items.map((item) => item.id);
    const versionIds = campaigns
      .map((campaign) => campaign.icpVersionId)
      .filter((id): id is string => Boolean(id));
    const assessments =
      versionIds.length === 0
        ? []
        : await prisma.leadPoolAssessment.findMany({
            where: {
              tenantId,
              poolItemId: { in: poolIds },
              icpVersionId: { in: versionIds },
            },
            orderBy: { createdAt: 'desc' },
            select: { id: true, poolItemId: true, icpVersionId: true },
          });
    const latestAssessmentByPair = new Map<string, (typeof assessments)[number]>();
    for (const assessment of assessments) {
      const key = assessment.poolItemId + ':' + assessment.icpVersionId;
      if (!latestAssessmentByPair.has(key)) latestAssessmentByPair.set(key, assessment);
    }

    const existing = await prisma.campaignProspect.findMany({
      where: { tenantId, poolItemId: { in: poolIds }, campaignId: { in: campaignIds } },
      select: { campaignId: true, poolItemId: true },
    });
    const existingKeys = new Set(
      existing.map((row) => row.campaignId + ':' + row.poolItemId)
    );

    const planned: BackfillRow[] = [];
    for (const item of items) {
      const legacyCampaignId = item.assignedCampaignId;
      const leadCampaignId = item.convertedLead?.campaignId ?? null;
      if (legacyCampaignId && leadCampaignId && legacyCampaignId !== leadCampaignId) {
        report.conflicts.push({
          poolItemId: item.id,
          reason: 'campaign_mismatch',
          assignedCampaignId: legacyCampaignId,
          convertedLeadCampaignId: leadCampaignId,
        });
        continue;
      }

      const campaignId = leadCampaignId ?? legacyCampaignId;
      const campaign = campaignId ? campaignById.get(campaignId) : null;
      if (!campaignId || !campaign) {
        report.conflicts.push({
          poolItemId: item.id,
          reason: 'missing_campaign',
          assignedCampaignId: legacyCampaignId,
          convertedLeadCampaignId: leadCampaignId,
        });
        continue;
      }

      const key = campaignId + ':' + item.id;
      if (existingKeys.has(key)) {
        report.alreadyPresent += 1;
        continue;
      }

      const assessment = campaign.icpVersionId
        ? latestAssessmentByPair.get(item.id + ':' + campaign.icpVersionId) ?? null
        : null;
      planned.push({
        tenantId,
        campaignId,
        poolItemId: item.id,
        assignedSdrId: item.convertedLead?.assignedToId ?? item.assignedSdrId,
        leadId: item.convertedLead?.id ?? null,
        createdById: item.assignedById,
        assessedIcpVersionId: assessment?.icpVersionId ?? null,
        latestAssessmentId: assessment?.id ?? null,
        status: item.convertedLeadId
          ? 'active'
          : deriveCampaignProspectReadiness(item),
        activatedAt: item.convertedLeadId ? item.assignedAt : null,
      });
    }

    report.planned += planned.length;
    if (!dryRun && planned.length > 0) {
      const result = await prisma.campaignProspect.createMany({
        data: planned as Prisma.CampaignProspectCreateManyInput[],
        skipDuplicates: true,
      });
      report.inserted += result.count;
      report.alreadyPresent += planned.length - result.count;
    }
  }

  return report;
}
