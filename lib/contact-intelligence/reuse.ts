import type { ContactReuseStatus } from '@prisma/client';

export type ReuseEvaluationResult = {
  reuseStatus: ContactReuseStatus;
  isEligible: boolean;
  reasons: string[];
  cooldownUntil: Date | null;
  restrictedUntil: Date | null;
  requiresReverification: boolean;
  requiresWarmRouting: boolean;
  recommendedOwnerId: string | null;
};

export function evaluateContactReuseEligibility(params: {
  isSuppressed: boolean;
  isArchived: boolean;
  isDataInvalid: boolean;
  dataStatus: string;
  hasActiveOpportunity: boolean;
  activeOpportunityClientId?: string | null;
  isCurrentlyEnrolled: boolean;
  hasRelationshipOwner: boolean;
  relationshipOwnerId?: string | null;
  lastContactedAt?: Date | null;
  lastEnrolledAt?: Date | null;
  targetClientId?: string | null;
  cooldownDays?: number;
  freshnessScore: number;
}): ReuseEvaluationResult {
  const reasons: string[] = [];
  const cooldownDays = params.cooldownDays ?? 45;

  // Gate 1: Suppression & Opt-out
  if (params.isSuppressed || params.isDataInvalid) {
    return {
      reuseStatus: 'do_not_contact',
      isEligible: false,
      reasons: ['Contact is suppressed, unsubscribed, or data is marked invalid.'],
      cooldownUntil: null,
      restrictedUntil: null,
      requiresReverification: false,
      requiresWarmRouting: false,
      recommendedOwnerId: null,
    };
  }

  // Gate 2: Archived
  if (params.isArchived) {
    return {
      reuseStatus: 'archived',
      isEligible: false,
      reasons: ['Contact record is archived in internal database.'],
      cooldownUntil: null,
      restrictedUntil: null,
      requiresReverification: false,
      requiresWarmRouting: false,
      recommendedOwnerId: null,
    };
  }

  // Gate 3: Active Opportunity / Client Lock
  if (params.hasActiveOpportunity) {
    if (params.targetClientId && params.activeOpportunityClientId && params.targetClientId !== params.activeOpportunityClientId) {
      return {
        reuseStatus: 'client_locked',
        isEligible: false,
        reasons: ['Contact is locked in an active opportunity with another client.'],
        cooldownUntil: null,
        restrictedUntil: null,
        requiresReverification: false,
        requiresWarmRouting: false,
        recommendedOwnerId: params.relationshipOwnerId || null,
      };
    }
  }

  // Gate 4: Currently Enrolled / Active Sequence
  if (params.isCurrentlyEnrolled) {
    return {
      reuseStatus: 'cooldown',
      isEligible: false,
      reasons: ['Contact is currently participating in an active campaign outreach.'],
      cooldownUntil: null,
      restrictedUntil: null,
      requiresReverification: false,
      requiresWarmRouting: false,
      recommendedOwnerId: params.relationshipOwnerId || null,
    };
  }

  // Gate 5: Cooldown Gating
  if (params.lastContactedAt) {
    const elapsedDays = (Date.now() - params.lastContactedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (elapsedDays < cooldownDays) {
      const remainingDays = Math.ceil(cooldownDays - elapsedDays);
      const cooldownUntil = new Date(params.lastContactedAt.getTime() + cooldownDays * 24 * 60 * 60 * 1000);
      return {
        reuseStatus: 'cooldown',
        isEligible: false,
        reasons: [`Contact is in campaign cooldown (${remainingDays} days remaining).`],
        cooldownUntil,
        restrictedUntil: null,
        requiresReverification: false,
        requiresWarmRouting: false,
        recommendedOwnerId: params.relationshipOwnerId || null,
      };
    }
  }

  // Gate 6: Data Freshness / Reverification
  if (params.dataStatus === 'needs_refresh' || params.freshnessScore <= 20) {
    reasons.push('Contact data has aged (>90 days without verification). Reverification recommended prior to launch.');
    return {
      reuseStatus: 'reverify_first',
      isEligible: true,
      reasons,
      cooldownUntil: null,
      restrictedUntil: null,
      requiresReverification: true,
      requiresWarmRouting: params.hasRelationshipOwner,
      recommendedOwnerId: params.relationshipOwnerId || null,
    };
  }

  // Gate 7: Relationship Protection
  if (params.hasRelationshipOwner && params.relationshipOwnerId) {
    reasons.push(`Contact has established relationship managed by relationship owner.`);
    return {
      reuseStatus: 'relationship_only',
      isEligible: true,
      reasons,
      cooldownUntil: null,
      restrictedUntil: null,
      requiresReverification: false,
      requiresWarmRouting: true,
      recommendedOwnerId: params.relationshipOwnerId,
    };
  }

  // Gate 8: Ready
  reasons.push('Contact meets all commercial intelligence criteria for campaign enrollment.');
  return {
    reuseStatus: 'ready',
    isEligible: true,
    reasons,
    cooldownUntil: null,
    restrictedUntil: null,
    requiresReverification: false,
    requiresWarmRouting: false,
    recommendedOwnerId: null,
  };
}
