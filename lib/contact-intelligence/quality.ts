import type { ContactQualityClass, ContactDataStatus, ContactEngagementStatus } from '@prisma/client';

export function resolveContactQualityClass(params: {
  isInvalidOrSuppressed: boolean;
  meetingCompletedCount: number;
  acceptedOpportunityCount: number;
  wonOpportunityCount: number;
  positiveReplyCount: number;
  intrinsicQualityScore: number;
  dataConfidenceScore: number;
  touchCount: number;
  hasVerifiedEmail: boolean;
}): ContactQualityClass {
  if (params.isInvalidOrSuppressed) {
    return 'invalid';
  }

  if (
    params.wonOpportunityCount > 0 ||
    params.acceptedOpportunityCount > 0 ||
    params.meetingCompletedCount > 0 ||
    params.positiveReplyCount >= 2
  ) {
    return 'proven';
  }

  if (
    params.hasVerifiedEmail &&
    params.intrinsicQualityScore >= 55 &&
    params.dataConfidenceScore >= 50
  ) {
    return 'promising';
  }

  if (params.touchCount === 0 && params.hasVerifiedEmail) {
    return 'untested';
  }

  if (
    params.intrinsicQualityScore < 30 ||
    params.dataConfidenceScore < 30 ||
    (params.touchCount >= 6 && params.positiveReplyCount === 0)
  ) {
    return 'weak';
  }

  return 'untested';
}

export function resolveContactDataStatus(params: {
  emailValidation?: string | null;
  hasValidPhone: boolean;
  hasValidLinkedIn: boolean;
  freshnessScore: number;
}): ContactDataStatus {
  const val = (params.emailValidation || '').toLowerCase();
  if (val === 'invalid' || val === 'undeliverable') {
    return 'invalid';
  }

  if (params.freshnessScore <= 20) {
    return 'needs_refresh';
  }

  if (val === 'deliverable' || val === 'valid' || val === 'verified') {
    return 'verified';
  }

  return 'partial';
}

export function resolveContactEngagementStatus(params: {
  touchCount: number;
  replyCount: number;
  positiveReplyCount: number;
  meetingBookedCount: number;
  hasActiveRelationship: boolean;
  isNurture: boolean;
}): ContactEngagementStatus {
  if (params.hasActiveRelationship) {
    return 'relationship';
  }

  if (params.meetingBookedCount > 0) {
    return 'meeting';
  }

  if (params.positiveReplyCount > 0) {
    return 'positive';
  }

  if (params.isNurture) {
    return 'nurture';
  }

  if (params.replyCount > 0) {
    return 'responded';
  }

  if (params.touchCount > 0) {
    return 'no_response';
  }

  return 'never_contacted';
}
