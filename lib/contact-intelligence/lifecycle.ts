import type { ContactLifecycleState } from '@prisma/client';

export function resolveContactLifecycleState(params: {
  isArchived: boolean;
  isSuppressed: boolean;
  hasActiveOpportunity: boolean;
  isClientControlled: boolean;
  hasActiveMeeting: boolean;
  hasActiveRelationship: boolean;
  hasPositiveReply: boolean;
  isCurrentlyWorking: boolean;
  isNurture: boolean;
  isQualified: boolean;
  isVerified: boolean;
  freshnessScore: number;
  lastContactedAt: Date | null;
  cooldownUntil: Date | null;
}): ContactLifecycleState {
  if (params.isArchived) {
    return 'archived';
  }

  if (params.isSuppressed) {
    return 'suppressed';
  }

  if (params.isClientControlled) {
    return 'client_controlled';
  }

  if (params.hasActiveOpportunity) {
    return 'opportunity';
  }

  if (params.hasActiveMeeting) {
    return 'meeting';
  }

  if (params.hasActiveRelationship) {
    return 'relationship';
  }

  if (params.hasPositiveReply) {
    return 'responsive';
  }

  if (params.isCurrentlyWorking) {
    return 'working';
  }

  if (params.isNurture) {
    if (params.cooldownUntil && params.cooldownUntil <= new Date()) {
      return 'reactivatable';
    }
    return 'nurture';
  }

  if (params.freshnessScore <= 15 && params.lastContactedAt) {
    return 'stale';
  }

  if (params.isQualified && params.isVerified) {
    return 'ready';
  }

  if (params.isQualified) {
    return 'qualified';
  }

  if (params.isVerified) {
    return 'verified';
  }

  return 'discovered';
}
