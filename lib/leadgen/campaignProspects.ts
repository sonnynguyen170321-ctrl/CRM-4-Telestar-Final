import type { CampaignProspect, CampaignProspectStatus } from '@prisma/client';

import type { SessionUser } from '@/lib/auth';
import { normalizeEmail } from '@/lib/leads/normalize';
import { prisma } from '@/lib/prisma';

import { canAssignToRep } from './assignableReps';

const INVALID_EMAIL_STATES = new Set(['invalid', 'undeliverable', 'bounced']);

export class CampaignProspectRemovedError extends Error {
  constructor() {
    super('campaign_prospect_removed_requires_explicit_reopen');
    this.name = 'CampaignProspectRemovedError';
  }
}

export function deriveCampaignProspectReadiness(input: {
  email: string | null;
  emailValidation: string | null;
}): CampaignProspectStatus {
  const email = normalizeEmail(input.email);
  const hasEmailShape = Boolean(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  const validation = input.emailValidation?.trim().toLowerCase() ?? null;
  if (!hasEmailShape || (validation && INVALID_EMAIL_STATES.has(validation))) return 'needs_contact';
  return 'ready';
}

async function currentAssessment(input: {
  tenantId: string;
  poolItemId: string;
  campaignIcpVersionId: string | null;
}) {
  if (!input.campaignIcpVersionId) return null;
  return prisma.leadPoolAssessment.findFirst({
    where: {
      tenantId: input.tenantId,
      poolItemId: input.poolItemId,
      icpVersionId: input.campaignIcpVersionId,
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, icpVersionId: true },
  });
}

/**
 * Idempotently adds one reusable pool identity to one campaign.
 *
 * The unique (tenant, campaign, pool item) key is the retry boundary. Removed memberships are
 * deliberately not reopened here: reactivation is a separate manager decision with its own audit.
 * Existing assessment snapshots survive campaign ICP changes until a rescore supplies an assessment
 * for the new version; the mismatch is the explicit stale/Review signal.
 */
export async function ensureCampaignProspect(params: {
  tenantId: string;
  campaignId: string;
  poolItemId: string;
  assignedSdrId?: string | null;
  actor: SessionUser;
}): Promise<CampaignProspect> {
  const { tenantId, campaignId, poolItemId, actor } = params;
  if (actor.tenantId !== tenantId) throw new Error('campaign_prospect_actor_tenant_mismatch');

  const [campaign, item, existing] = await Promise.all([
    prisma.campaign.findFirst({
      where: { id: campaignId, tenantId },
      select: { id: true, icpVersionId: true },
    }),
    prisma.leadPoolItem.findFirst({
      where: { id: poolItemId, tenantId },
      select: { id: true, email: true, emailValidation: true },
    }),
    prisma.campaignProspect.findUnique({
      where: { tenantId_campaignId_poolItemId: { tenantId, campaignId, poolItemId } },
    }),
  ]);

  if (!campaign) throw new Error('campaign_not_found');
  if (!item) throw new Error('pool_item_not_found');
  if (existing?.status === 'removed') throw new CampaignProspectRemovedError();

  const assignedSdrId = params.assignedSdrId ?? existing?.assignedSdrId ?? null;
  if (assignedSdrId && !(await canAssignToRep(actor, assignedSdrId, campaignId))) {
    throw new Error('campaign_prospect_assignee_forbidden');
  }

  const assessment = await currentAssessment({
    tenantId,
    poolItemId,
    campaignIcpVersionId: campaign.icpVersionId,
  });
  const nextStatus =
    existing?.status === 'active' || existing?.status === 'completed'
      ? existing.status
      : deriveCampaignProspectReadiness(item);

  const assessmentPatch = assessment
    ? {
        assessedIcpVersionId: assessment.icpVersionId,
        latestAssessmentId: assessment.id,
      }
    : existing
      ? {
          assessedIcpVersionId: existing.assessedIcpVersionId,
          latestAssessmentId: existing.latestAssessmentId,
        }
      : {
          assessedIcpVersionId: null,
          latestAssessmentId: null,
        };

  if (existing) {
    const unchanged =
      existing.assignedSdrId === assignedSdrId &&
      existing.status === nextStatus &&
      existing.assessedIcpVersionId === assessmentPatch.assessedIcpVersionId &&
      existing.latestAssessmentId === assessmentPatch.latestAssessmentId;
    if (unchanged) return existing;

    return prisma.campaignProspect.update({
      where: { tenantId_campaignId_poolItemId: { tenantId, campaignId, poolItemId } },
      data: {
        assignedSdrId,
        status: nextStatus,
        ...assessmentPatch,
      },
    });
  }

  try {
    return await prisma.campaignProspect.create({
      data: {
        tenantId,
        campaignId,
        poolItemId,
        assignedSdrId,
        createdById: actor.id,
        status: nextStatus,
        ...assessmentPatch,
      },
    });
  } catch (error) {
    if ((error as { code?: string } | null)?.code !== 'P2002') throw error;
    const raced = await prisma.campaignProspect.findUnique({
      where: { tenantId_campaignId_poolItemId: { tenantId, campaignId, poolItemId } },
    });
    if (!raced) throw error;
    if (raced.status === 'removed') throw new CampaignProspectRemovedError();
    // Converge a create race onto the requested assignee/assessment instead of returning the
    // other writer's partial state. The second pass takes the existing-update branch.
    return ensureCampaignProspect(params);
  }
}
