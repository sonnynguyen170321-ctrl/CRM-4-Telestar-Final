import { prisma } from '@/lib/prisma';
import type { ContactIntelligence } from '@prisma/client';
import {
  calculateIntrinsicQualityScore,
  calculateDataConfidenceScore,
  calculateEngagementScore,
  calculateRelationshipScore,
  calculateFreshnessScore,
  SCORING_VERSION,
} from './scoring';
import { resolveContactLifecycleState } from './lifecycle';
import {
  resolveContactQualityClass,
  resolveContactDataStatus,
  resolveContactEngagementStatus,
} from './quality';
import { evaluateContactReuseEligibility } from './reuse';
import { buildContactExplainability, type ContactIntelligenceExplainability } from './explainability';

export async function recalculateContactIntelligence(
  contactId: string,
  tenantId: string
): Promise<ContactIntelligence> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    include: {
      leadAssignments: {
        where: { tenantId },
        include: {
          activities: { where: { tenantId } },
          meetings: { where: { tenantId } },
          opportunities: { where: { tenantId } },
        },
      },
      opportunities: { where: { tenantId } },
      evidence: { where: { tenantId } },
      poolItems: { where: { tenantId } },
    },
  });

  if (!contact) {
    throw new Error(`Contact not found: ${contactId}`);
  }

  // Check suppression
  const suppression = await prisma.suppressionEntry.findFirst({
    where: {
      tenantId,
      email: { equals: contact.email, mode: 'insensitive' },
    },
  });
  const isSuppressed = !!suppression;

  // Aggregate metrics across leads & direct objects
  const campaignIds = new Set<string>();
  let touchCount = 0;
  let replyCount = 0;
  let positiveReplyCount = 0;
  let meaningfulReplyCount = 0;
  let meetingBookedCount = 0;
  let meetingCompletedCount = 0;
  let acceptedOpportunityCount = 0;
  let wonOpportunityCount = 0;
  let referralGivenCount = 0;

  let lastContactedAt: Date | null = null;
  let lastRepliedAt: Date | null = null;
  let lastMeetingAt: Date | null = null;
  let lastCommercialAt: Date | null = null;
  let isCurrentlyWorking = false;
  let isCurrentlyEnrolled = false;
  let hasActiveOpportunity = false;
  let isClientControlled = false;
  let activeOpportunityClientId: string | null = null;
  let isArchived = false;

  for (const lead of contact.leadAssignments) {
    if (lead.campaignId) campaignIds.add(lead.campaignId);
    if (lead.archivedAt) isArchived = true;

    if (lead.sequenceStatus === 'active') {
      isCurrentlyWorking = true;
      isCurrentlyEnrolled = true;
    }

    if (lead.lastContactedAt) {
      if (!lastContactedAt || lead.lastContactedAt > lastContactedAt) {
        lastContactedAt = lead.lastContactedAt;
      }
    }

    // Touch counts & activities
    for (const activity of lead.activities) {
      if (['email_sent', 'call_made', 'linkedin_sent', 'whatsapp_sent'].includes(activity.type)) {
        touchCount++;
      } else if (activity.type === 'email_replied') {
        replyCount++;
        meaningfulReplyCount++;
        if (!lastRepliedAt || activity.createdAt > lastRepliedAt) {
          lastRepliedAt = activity.createdAt;
        }
      }
    }

    // Meetings
    for (const meeting of lead.meetings) {
      meetingBookedCount++;
      if (!lastMeetingAt || (meeting.scheduledAt && meeting.scheduledAt > lastMeetingAt)) {
        lastMeetingAt = meeting.scheduledAt || meeting.createdAt;
      }
      if (meeting.status === 'completed' || meeting.outcome === 'qualified_opportunity' || meeting.outcome === 'completed_not_qualified') {
        meetingCompletedCount++;
      }
    }

    // Opportunities
    for (const opp of lead.opportunities) {
      if (opp.status === 'open') {
        hasActiveOpportunity = true;
        activeOpportunityClientId = opp.clientId;
        if (opp.stage === 'pending_client_review' || opp.stage === 'accepted_by_client') {
          isClientControlled = true;
        }
      }
      if (opp.handoffStatus === 'accepted' || opp.stage === 'accepted_by_client') {
        acceptedOpportunityCount++;
      }
      if (opp.status === 'won' || opp.stage === 'won') {
        wonOpportunityCount++;
      }
      if (!lastCommercialAt || opp.createdAt > lastCommercialAt) {
        lastCommercialAt = opp.createdAt;
      }
    }
  }

  // Check direct opportunities
  for (const opp of contact.opportunities) {
    if (opp.status === 'open') {
      hasActiveOpportunity = true;
      activeOpportunityClientId = opp.clientId;
    }
    if (opp.status === 'won') wonOpportunityCount++;
    if (opp.handoffStatus === 'accepted') acceptedOpportunityCount++;
  }

  // Scan evidence ledger facts
  let humanConfirmedCount = 0;
  let lastVerifiedAt: Date | null = contact.updatedAt || null;
  let relationshipOwnerId: string | null = null;
  let hasRelationshipEvidence = false;
  let hasUnsubscribedOrDnc = isSuppressed;

  for (const ev of contact.evidence) {
    if (ev.humanConfirmed) humanConfirmedCount++;
    if (['identity_verified', 'email_verified', 'phone_verified', 'linkedin_verified'].includes(ev.evidenceType)) {
      if (!lastVerifiedAt || ev.observedAt > lastVerifiedAt) {
        lastVerifiedAt = ev.observedAt;
      }
    }
    if (ev.evidenceType === 'positive_reply') {
      positiveReplyCount++;
      meaningfulReplyCount++;
    } else if (ev.evidenceType === 'referral_given') {
      referralGivenCount++;
    } else if (ev.evidenceType === 'relationship_strengthened' || ev.evidenceType === 'relationship_owner_changed') {
      hasRelationshipEvidence = true;
      if (ev.capturedById) {
        relationshipOwnerId = ev.capturedById;
      }
    } else if (['suppressed', 'unsubscribed', 'dnc'].includes(ev.evidenceType)) {
      hasUnsubscribedOrDnc = true;
    }
  }

  // Check leadgen QA qualification
  const isQualified = contact.poolItems.some(
    (item) => item.status === 'qualified' || item.qualification === 'qualified'
  );

  const emailVal = (contact.emailValidation || '').toLowerCase();
  const hasVerifiedEmail = emailVal === 'deliverable' || emailVal === 'valid' || emailVal === 'verified';
  const isDataInvalid = emailVal === 'invalid' || emailVal === 'undeliverable';

  // Last observation date
  const lastObservationDate = lastRepliedAt || lastMeetingAt || lastContactedAt || lastVerifiedAt;

  // Calculate deterministic scores
  const qualityBreakdown = calculateIntrinsicQualityScore(contact);
  const confidenceBreakdown = calculateDataConfidenceScore({
    emailValidation: contact.emailValidation,
    emailScore: contact.emailScore,
    hasPhone: !!contact.phone,
    hasLinkedIn: !!contact.linkedIn,
    humanConfirmedCount,
    lastVerifiedAt,
  });
  const engagementBreakdown = calculateEngagementScore({
    touchCount,
    replyCount,
    meaningfulReplyCount,
    positiveReplyCount,
    meetingBookedCount,
    referralGivenCount,
    hasUnsubscribedOrDnc,
  });
  const relationshipBreakdown = calculateRelationshipScore({
    hasOwner: !!relationshipOwnerId,
    meetingCompletedCount,
    acceptedOpportunityCount,
    wonOpportunityCount,
  });
  const freshnessBreakdown = calculateFreshnessScore(lastObservationDate);

  // Classify states
  const dataStatus = resolveContactDataStatus({
    emailValidation: contact.emailValidation,
    hasValidPhone: !!contact.phone,
    hasValidLinkedIn: !!contact.linkedIn,
    freshnessScore: freshnessBreakdown.score,
  });

  const qualityClass = resolveContactQualityClass({
    isInvalidOrSuppressed: hasUnsubscribedOrDnc || isDataInvalid,
    meetingCompletedCount,
    acceptedOpportunityCount,
    wonOpportunityCount,
    positiveReplyCount,
    intrinsicQualityScore: qualityBreakdown.score,
    dataConfidenceScore: confidenceBreakdown.score,
    touchCount,
    hasVerifiedEmail,
  });

  const engagementStatus = resolveContactEngagementStatus({
    touchCount,
    replyCount,
    positiveReplyCount,
    meetingBookedCount,
    hasActiveRelationship: hasRelationshipEvidence || !!relationshipOwnerId,
    isNurture: false,
  });

  // Evaluate reuse eligibility
  const reuseEvaluation = evaluateContactReuseEligibility({
    isSuppressed: hasUnsubscribedOrDnc,
    isArchived,
    isDataInvalid,
    dataStatus,
    hasActiveOpportunity,
    activeOpportunityClientId,
    isCurrentlyEnrolled,
    hasRelationshipOwner: !!relationshipOwnerId,
    relationshipOwnerId,
    lastContactedAt,
    freshnessScore: freshnessBreakdown.score,
  });

  const lifecycleState = resolveContactLifecycleState({
    isArchived,
    isSuppressed: hasUnsubscribedOrDnc,
    hasActiveOpportunity,
    isClientControlled,
    hasActiveMeeting: meetingBookedCount > 0,
    hasActiveRelationship: hasRelationshipEvidence,
    hasPositiveReply: positiveReplyCount > 0,
    isCurrentlyWorking,
    isNurture: false,
    isQualified,
    isVerified: hasVerifiedEmail,
    freshnessScore: freshnessBreakdown.score,
    lastContactedAt,
    cooldownUntil: reuseEvaluation.cooldownUntil,
  });

  const intelligenceSummary = `${qualityClass.toUpperCase()} contact profile (${lifecycleState}) with intrinsic score ${qualityBreakdown.score}/100 and confidence ${confidenceBreakdown.score}/100.`;

  // Upsert ContactIntelligence record
  return await prisma.contactIntelligence.upsert({
    where: { contactId },
    create: {
      tenantId,
      contactId,
      lifecycleState,
      qualityClass,
      dataStatus,
      engagementStatus,
      reuseStatus: reuseEvaluation.reuseStatus,
      intrinsicQualityScore: qualityBreakdown.score,
      dataConfidenceScore: confidenceBreakdown.score,
      engagementScore: engagementBreakdown.score,
      relationshipScore: relationshipBreakdown.score,
      freshnessScore: freshnessBreakdown.score,
      relationshipOwnerId,
      campaignCount: campaignIds.size,
      touchCount,
      replyCount,
      meaningfulReplyCount,
      positiveReplyCount,
      meetingBookedCount,
      meetingCompletedCount,
      acceptedOpportunityCount,
      wonOpportunityCount,
      referralGivenCount,
      lastVerifiedAt,
      lastContactedAt,
      lastRepliedAt,
      lastMeetingAt,
      lastCommercialAt,
      lastIntelligenceAt: new Date(),
      cooldownUntil: reuseEvaluation.cooldownUntil,
      restrictedUntil: reuseEvaluation.restrictedUntil,
      reuseReason: reuseEvaluation.reasons.join('; '),
      intelligenceSummary,
      scoringVersion: SCORING_VERSION,
      calculatedAt: new Date(),
    },
    update: {
      lifecycleState,
      qualityClass,
      dataStatus,
      engagementStatus,
      reuseStatus: reuseEvaluation.reuseStatus,
      intrinsicQualityScore: qualityBreakdown.score,
      dataConfidenceScore: confidenceBreakdown.score,
      engagementScore: engagementBreakdown.score,
      relationshipScore: relationshipBreakdown.score,
      freshnessScore: freshnessBreakdown.score,
      relationshipOwnerId,
      campaignCount: campaignIds.size,
      touchCount,
      replyCount,
      meaningfulReplyCount,
      positiveReplyCount,
      meetingBookedCount,
      meetingCompletedCount,
      acceptedOpportunityCount,
      wonOpportunityCount,
      referralGivenCount,
      lastVerifiedAt,
      lastContactedAt,
      lastRepliedAt,
      lastMeetingAt,
      lastCommercialAt,
      lastIntelligenceAt: new Date(),
      cooldownUntil: reuseEvaluation.cooldownUntil,
      restrictedUntil: reuseEvaluation.restrictedUntil,
      reuseReason: reuseEvaluation.reasons.join('; '),
      intelligenceSummary,
      scoringVersion: SCORING_VERSION,
      calculatedAt: new Date(),
    },
  });
}

export async function getContactIntelligenceWithExplainability(
  contactId: string,
  tenantId: string
): Promise<{ intelligence: ContactIntelligence | null; explainability: ContactIntelligenceExplainability | null }> {
  const intelligence = await prisma.contactIntelligence.findUnique({
    where: { contactId },
    include: {
      contact: true,
    },
  });

  if (!intelligence || !intelligence.contact || intelligence.tenantId !== tenantId) {
    return { intelligence: null, explainability: null };
  }

  const contact = intelligence.contact;
  const qualityBreakdown = calculateIntrinsicQualityScore(contact);
  const confidenceBreakdown = calculateDataConfidenceScore({
    emailValidation: contact.emailValidation,
    emailScore: contact.emailScore,
    hasPhone: !!contact.phone,
    hasLinkedIn: !!contact.linkedIn,
    humanConfirmedCount: 0,
    lastVerifiedAt: intelligence.lastVerifiedAt,
  });
  const engagementBreakdown = calculateEngagementScore({
    touchCount: intelligence.touchCount,
    replyCount: intelligence.replyCount,
    meaningfulReplyCount: intelligence.meaningfulReplyCount,
    positiveReplyCount: intelligence.positiveReplyCount,
    meetingBookedCount: intelligence.meetingBookedCount,
    referralGivenCount: intelligence.referralGivenCount,
    hasUnsubscribedOrDnc: intelligence.lifecycleState === 'suppressed',
  });
  const relationshipBreakdown = calculateRelationshipScore({
    hasOwner: !!intelligence.relationshipOwnerId,
    relationshipStrength: intelligence.relationshipStrength,
    relationshipType: intelligence.relationshipType,
    meetingCompletedCount: intelligence.meetingCompletedCount,
    acceptedOpportunityCount: intelligence.acceptedOpportunityCount,
    wonOpportunityCount: intelligence.wonOpportunityCount,
  });
  const freshnessBreakdown = calculateFreshnessScore(
    intelligence.lastRepliedAt || intelligence.lastMeetingAt || intelligence.lastContactedAt || intelligence.lastVerifiedAt
  );

  const explainability = buildContactExplainability({
    qualityBreakdown,
    confidenceBreakdown,
    engagementBreakdown,
    relationshipBreakdown,
    freshnessBreakdown,
    reuseReasons: intelligence.reuseReason ? intelligence.reuseReason.split('; ') : [],
    qualityClass: intelligence.qualityClass,
    reuseStatus: intelligence.reuseStatus,
  });

  return { intelligence, explainability };
}
