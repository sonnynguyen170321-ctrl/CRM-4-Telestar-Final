import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/auth';
import { evaluateContactReuseEligibility } from './reuse';

export interface RelationshipGuardCheckResult {
  allowed: boolean;
  code?: 'suppressed' | 'client_locked' | 'cooldown' | 'relationship_owner_mismatch' | 'invalid_data';
  reason?: string;
  relationshipOwnerId?: string | null;
  relationshipOwnerName?: string | null;
}

/**
 * Validates whether a lead/contact is eligible for automated sequence enrollment or reassignment.
 * Protects champion relationships from being blasted by cold cadences or unauthorized reps.
 */
export async function checkContactRelationshipGuard(params: {
  leadId: string;
  user: SessionUser;
  targetCampaignId?: string;
  isManagerOverride?: boolean;
}): Promise<RelationshipGuardCheckResult> {
  const { leadId, user, targetCampaignId, isManagerOverride = false } = params;

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      tenantId: true,
      campaignId: true,
      contactId: true,
      campaign: { select: { clientId: true } },
      contact: {
        include: {
          intelligence: {
            include: {
              relationshipOwner: { select: { id: true, firstName: true, lastName: true } },
            },
          },
          opportunities: {
            where: { tenantId: user.tenantId! },
            select: { clientId: true, status: true },
          },
        },
      },
    },
  });

  if (!lead || !lead.contact) {
    return { allowed: true };
  }

  const contact = lead.contact;
  const intel = contact.intelligence;
  if (!intel) {
    return { allowed: true };
  }

  const activeOpp = contact.opportunities.find((o) => o.status === 'open');
  const targetClientId = targetCampaignId
    ? (await prisma.campaign.findUnique({ where: { id: targetCampaignId }, select: { clientId: true } }))?.clientId
    : lead.campaign.clientId;

  const evalResult = evaluateContactReuseEligibility({
    isSuppressed: intel.lifecycleState === 'suppressed',
    isArchived: false,
    isDataInvalid: intel.dataStatus === 'invalid',
    dataStatus: intel.dataStatus,
    hasActiveOpportunity: !!activeOpp,
    activeOpportunityClientId: activeOpp?.clientId,
    targetClientId,
    isCurrentlyEnrolled: false,
    hasRelationshipOwner: !!intel.relationshipOwnerId,
    relationshipOwnerId: intel.relationshipOwnerId,
    lastContactedAt: intel.lastContactedAt,
    freshnessScore: intel.freshnessScore ?? 100,
  });

  if (evalResult.reuseStatus === 'do_not_contact') {
    return {
      allowed: false,
      code: 'suppressed',
      reason: 'Contact is marked as Do Not Contact / Unsubscribed.',
    };
  }

  if (evalResult.reuseStatus === 'client_locked' && !isManagerOverride) {
    return {
      allowed: false,
      code: 'client_locked',
      reason: 'Contact is locked in an active deal with another client.',
    };
  }

  if (evalResult.reuseStatus === 'cooldown' && !isManagerOverride) {
    return {
      allowed: false,
      code: 'cooldown',
      reason: 'Contact is currently under outreach cooldown.',
    };
  }

  // Relationship Owner Guard: If contact has a dedicated owner and user is a different SDR
  if (
    intel.relationshipOwnerId &&
    intel.relationshipOwnerId !== user.id &&
    user.role === 'sdr' &&
    !isManagerOverride
  ) {
    const ownerName = intel.relationshipOwner
      ? `${intel.relationshipOwner.firstName} ${intel.relationshipOwner.lastName}`.trim()
      : 'another SDR';
    return {
      allowed: false,
      code: 'relationship_owner_mismatch',
      reason: `This contact is managed by relationship owner ${ownerName}. Re-route or request manager clearance.`,
      relationshipOwnerId: intel.relationshipOwnerId,
      relationshipOwnerName: ownerName,
    };
  }

  return {
    allowed: true,
    relationshipOwnerId: intel.relationshipOwnerId,
  };
}
