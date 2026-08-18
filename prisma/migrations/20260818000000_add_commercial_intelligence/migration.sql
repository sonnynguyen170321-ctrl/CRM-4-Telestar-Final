-- CreateEnum
CREATE TYPE "ContactLifecycleState" AS ENUM (
    'discovered',
    'verified',
    'qualified',
    'ready',
    'working',
    'engaged',
    'responsive',
    'relationship',
    'meeting',
    'opportunity',
    'client_controlled',
    'nurture',
    'reactivatable',
    'stale',
    'suppressed',
    'archived'
);

-- CreateEnum
CREATE TYPE "ContactQualityClass" AS ENUM (
    'proven',
    'promising',
    'untested',
    'weak',
    'invalid'
);

-- CreateEnum
CREATE TYPE "ContactDataStatus" AS ENUM (
    'verified',
    'partial',
    'needs_refresh',
    'invalid'
);

-- CreateEnum
CREATE TYPE "ContactEngagementStatus" AS ENUM (
    'never_contacted',
    'no_response',
    'responded',
    'positive',
    'meeting',
    'relationship',
    'nurture'
);

-- CreateEnum
CREATE TYPE "ContactReuseStatus" AS ENUM (
    'ready',
    'reverify_first',
    'cooldown',
    'relationship_only',
    'client_locked',
    'conflict_review',
    'do_not_contact',
    'archived'
);

-- CreateEnum
CREATE TYPE "RelationshipStrength" AS ENUM (
    'weak',
    'normal',
    'strong',
    'champion'
);

-- CreateEnum
CREATE TYPE "RelationshipType" AS ENUM (
    'standard',
    'champion',
    'connector',
    'blocker',
    'referrer'
);

-- CreateEnum
CREATE TYPE "ContactEvidenceType" AS ENUM (
    'identity_verified',
    'employment_verified',
    'employment_changed',
    'email_verified',
    'email_invalid',
    'phone_verified',
    'linkedin_verified',
    'icp_match',
    'icp_mismatch',
    'contacted',
    'no_response',
    'reply',
    'positive_reply',
    'negative_reply',
    'not_now',
    'not_interested',
    'wrong_person',
    'referral_given',
    'competitor_mentioned',
    'topic_interest',
    'pain_point',
    'technology_used',
    'vendor_used',
    'timing_signal',
    'budget_signal',
    'authority_signal',
    'meeting_booked',
    'meeting_completed',
    'meeting_no_show',
    'opportunity_created',
    'client_accepted',
    'client_rejected',
    'opportunity_won',
    'opportunity_lost',
    'opportunity_nurture',
    'relationship_strengthened',
    'relationship_weakened',
    'relationship_owner_changed',
    'job_change',
    'promotion',
    'suppressed',
    'unsubscribed',
    'dnc'
);

-- CreateEnum
CREATE TYPE "EvidenceSourceType" AS ENUM (
    'leadgen',
    'sdr_manual',
    'prospect_message',
    'email',
    'call',
    'linkedin',
    'whatsapp',
    'meeting',
    'opportunity',
    'client_feedback',
    'import',
    'vendor_enrichment',
    'system',
    'ai_extraction'
);

-- CreateEnum
CREATE TYPE "EvidenceOwnershipScope" AS ENUM (
    'telestar',
    'client',
    'shared'
);

-- CreateEnum
CREATE TYPE "EvidenceReuseScope" AS ENUM (
    'internal_only',
    'same_client_only',
    'cross_campaign_allowed',
    'restricted'
);

-- CreateTable
CREATE TABLE "ContactIntelligence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "lifecycleState" "ContactLifecycleState" NOT NULL DEFAULT 'discovered',
    "qualityClass" "ContactQualityClass" NOT NULL DEFAULT 'untested',
    "dataStatus" "ContactDataStatus" NOT NULL DEFAULT 'partial',
    "engagementStatus" "ContactEngagementStatus" NOT NULL DEFAULT 'never_contacted',
    "reuseStatus" "ContactReuseStatus" NOT NULL DEFAULT 'ready',
    "intrinsicQualityScore" INTEGER,
    "dataConfidenceScore" INTEGER,
    "engagementScore" INTEGER,
    "relationshipScore" INTEGER,
    "freshnessScore" INTEGER,
    "relationshipOwnerId" TEXT,
    "relationshipStrength" "RelationshipStrength",
    "relationshipType" "RelationshipType",
    "relationshipSince" TIMESTAMP(3),
    "lastMeaningfulAt" TIMESTAMP(3),
    "nextRelationshipAt" TIMESTAMP(3),
    "campaignCount" INTEGER NOT NULL DEFAULT 0,
    "touchCount" INTEGER NOT NULL DEFAULT 0,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "meaningfulReplyCount" INTEGER NOT NULL DEFAULT 0,
    "positiveReplyCount" INTEGER NOT NULL DEFAULT 0,
    "meetingBookedCount" INTEGER NOT NULL DEFAULT 0,
    "meetingCompletedCount" INTEGER NOT NULL DEFAULT 0,
    "acceptedOpportunityCount" INTEGER NOT NULL DEFAULT 0,
    "wonOpportunityCount" INTEGER NOT NULL DEFAULT 0,
    "referralGivenCount" INTEGER NOT NULL DEFAULT 0,
    "preferredChannel" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastContactedAt" TIMESTAMP(3),
    "lastRepliedAt" TIMESTAMP(3),
    "lastMeetingAt" TIMESTAMP(3),
    "lastCommercialAt" TIMESTAMP(3),
    "lastIntelligenceAt" TIMESTAMP(3),
    "cooldownUntil" TIMESTAMP(3),
    "restrictedUntil" TIMESTAMP(3),
    "reuseReason" TEXT,
    "relationshipSummary" TEXT,
    "commercialSummary" TEXT,
    "intelligenceSummary" TEXT,
    "scoringVersion" TEXT,
    "calculatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactIntelligence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactEvidence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "evidenceType" "ContactEvidenceType" NOT NULL,
    "key" TEXT NOT NULL,
    "valueJson" JSONB,
    "summary" TEXT,
    "sourceType" "EvidenceSourceType" NOT NULL,
    "sourceId" TEXT,
    "sourceModel" TEXT,
    "clientId" TEXT,
    "campaignId" TEXT,
    "leadId" TEXT,
    "meetingId" TEXT,
    "opportunityId" TEXT,
    "activityId" TEXT,
    "capturedById" TEXT,
    "confidence" INTEGER,
    "humanConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "ownershipScope" "EvidenceOwnershipScope" NOT NULL DEFAULT 'telestar',
    "reuseScope" "EvidenceReuseScope" NOT NULL DEFAULT 'cross_campaign_allowed',
    "observedAt" TIMESTAMP(3) NOT NULL,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContactIntelligence_contactId_key" ON "ContactIntelligence"("contactId");

-- CreateIndex
CREATE INDEX "ContactIntelligence_tenantId_idx" ON "ContactIntelligence"("tenantId");
CREATE INDEX "ContactIntelligence_lifecycleState_idx" ON "ContactIntelligence"("lifecycleState");
CREATE INDEX "ContactIntelligence_qualityClass_idx" ON "ContactIntelligence"("qualityClass");
CREATE INDEX "ContactIntelligence_reuseStatus_idx" ON "ContactIntelligence"("reuseStatus");
CREATE INDEX "ContactIntelligence_relationshipOwnerId_idx" ON "ContactIntelligence"("relationshipOwnerId");
CREATE INDEX "ContactIntelligence_lastVerifiedAt_idx" ON "ContactIntelligence"("lastVerifiedAt");
CREATE INDEX "ContactIntelligence_tenantId_qualityClass_idx" ON "ContactIntelligence"("tenantId", "qualityClass");
CREATE INDEX "ContactIntelligence_tenantId_reuseStatus_idx" ON "ContactIntelligence"("tenantId", "reuseStatus");

-- CreateIndex
CREATE INDEX "ContactEvidence_tenantId_contactId_idx" ON "ContactEvidence"("tenantId", "contactId");
CREATE INDEX "ContactEvidence_evidenceType_idx" ON "ContactEvidence"("evidenceType");
CREATE INDEX "ContactEvidence_campaignId_idx" ON "ContactEvidence"("campaignId");
CREATE INDEX "ContactEvidence_observedAt_idx" ON "ContactEvidence"("observedAt");
CREATE INDEX "ContactEvidence_tenantId_observedAt_idx" ON "ContactEvidence"("tenantId", "observedAt");

-- AddForeignKey
ALTER TABLE "ContactIntelligence" ADD CONSTRAINT "ContactIntelligence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactIntelligence" ADD CONSTRAINT "ContactIntelligence_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactIntelligence" ADD CONSTRAINT "ContactIntelligence_relationshipOwnerId_fkey" FOREIGN KEY ("relationshipOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEvidence" ADD CONSTRAINT "ContactEvidence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEvidence" ADD CONSTRAINT "ContactEvidence_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEvidence" ADD CONSTRAINT "ContactEvidence_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEvidence" ADD CONSTRAINT "ContactEvidence_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEvidence" ADD CONSTRAINT "ContactEvidence_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEvidence" ADD CONSTRAINT "ContactEvidence_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEvidence" ADD CONSTRAINT "ContactEvidence_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEvidence" ADD CONSTRAINT "ContactEvidence_capturedById_fkey" FOREIGN KEY ("capturedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEvidence" ADD CONSTRAINT "ContactEvidence_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "ContactEvidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
