import type {
  ContactLifecycleState,
  ContactQualityClass,
  ContactDataStatus,
  ContactEngagementStatus,
  ContactReuseStatus,
  RelationshipStrength,
  RelationshipType,
  ContactEvidenceType,
  EvidenceSourceType,
  EvidenceOwnershipScope,
  EvidenceReuseScope,
} from '@prisma/client';

export type ContactScoreBreakdown = {
  score: number;
  factors: {
    label: string;
    impact: number;
    description: string;
  }[];
};

export type ContactIntelligenceCalculationResult = {
  lifecycleState: ContactLifecycleState;
  qualityClass: ContactQualityClass;
  dataStatus: ContactDataStatus;
  engagementStatus: ContactEngagementStatus;
  reuseStatus: ContactReuseStatus;

  intrinsicQualityScore: number;
  dataConfidenceScore: number;
  engagementScore: number;
  relationshipScore: number;
  freshnessScore: number;

  relationshipOwnerId: string | null;
  relationshipStrength: RelationshipStrength | null;
  relationshipType: RelationshipType | null;
  relationshipSince: Date | null;
  lastMeaningfulAt: Date | null;
  nextRelationshipAt: Date | null;

  campaignCount: number;
  touchCount: number;
  replyCount: number;
  meaningfulReplyCount: number;
  positiveReplyCount: number;
  meetingBookedCount: number;
  meetingCompletedCount: number;
  acceptedOpportunityCount: number;
  wonOpportunityCount: number;
  referralGivenCount: number;

  preferredChannel: string | null;
  lastVerifiedAt: Date | null;
  lastContactedAt: Date | null;
  lastRepliedAt: Date | null;
  lastMeetingAt: Date | null;
  lastCommercialAt: Date | null;
  lastIntelligenceAt: Date | null;

  cooldownUntil: Date | null;
  restrictedUntil: Date | null;
  reuseReason: string | null;

  relationshipSummary: string | null;
  commercialSummary: string | null;
  intelligenceSummary: string | null;

  scoringVersion: string;
  calculatedAt: Date;

  explainability?: {
    qualityBreakdown: ContactScoreBreakdown;
    confidenceBreakdown: ContactScoreBreakdown;
    engagementBreakdown: ContactScoreBreakdown;
    relationshipBreakdown: ContactScoreBreakdown;
    freshnessBreakdown: ContactScoreBreakdown;
    reuseEligibilityReasons: string[];
  };
};

export type CreateEvidenceInput = {
  tenantId: string;
  contactId: string;
  evidenceType: ContactEvidenceType;
  key: string;
  valueJson?: Record<string, unknown> | null;
  summary?: string | null;
  sourceType: EvidenceSourceType;
  sourceId?: string | null;
  sourceModel?: string | null;
  clientId?: string | null;
  campaignId?: string | null;
  leadId?: string | null;
  meetingId?: string | null;
  opportunityId?: string | null;
  activityId?: string | null;
  capturedById?: string | null;
  confidence?: number | null;
  humanConfirmed?: boolean;
  aiGenerated?: boolean;
  ownershipScope?: EvidenceOwnershipScope;
  reuseScope?: EvidenceReuseScope;
  observedAt?: Date;
  validFrom?: Date | null;
  validUntil?: Date | null;
  supersedesId?: string | null;
};
