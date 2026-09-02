-- CreateEnum
CREATE TYPE "V2ManagerReviewStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'SNOOZED', 'RESOLVED', 'DISMISSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "V2ManagerReviewPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "V2ManagerReviewConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "V2ManagerReviewSourceType" AS ENUM ('HARD_RULE_ASSESSMENT', 'MANUAL_SDR_REQUEST', 'WORKFLOW_CONFLICT', 'INGESTION_ROW', 'IDENTITY_MATCH', 'ACTIVITY_RECAP_ROW', 'AI_SUGGESTION', 'FEEDBACK_EXAMPLE');

-- CreateEnum
CREATE TYPE "V2ManagerReviewReasonCode" AS ENUM ('SCORING_NEEDS_REVIEW', 'MISSING_REQUIRED_EVIDENCE', 'LOW_CONFIDENCE_HARD_DISQUALIFIER', 'WEAK_COMPANY_ONLY_EVIDENCE', 'SDR_REQUESTED_REVIEW', 'WORKFLOW_STATUS_CONFLICT', 'NO_MATCH_FROM_RECAP', 'MULTIPLE_COMPANY_CANDIDATES', 'MULTIPLE_CONTACT_CANDIDATES', 'GENERIC_EMAIL_ONLY', 'FUZZY_NAME_ONLY', 'NO_PROJECT_CONTEXT', 'POSSIBLE_DUPLICATE_ACTIVITY', 'STATUS_CHANGE_SUGGESTED', 'STALE_ACTIVITY_DATE', 'COMPANY_DOMAIN_CONFLICT', 'AI_DISAGREEMENT');

-- CreateEnum
CREATE TYPE "V2ManagerReviewResolutionType" AS ENUM ('APPROVE_CONFIRM', 'REJECT_DISMISS', 'REQUEST_CHANGES', 'LINK_EXISTING', 'CREATE_MISSING_ENTITY_LATER', 'NO_ACTION_NON_ACTIONABLE', 'CONVERT_TO_FEEDBACK_LATER', 'UPDATE_WORKFLOW_STATUS_LATER');

-- CreateTable
CREATE TABLE "V2ManagerReviewItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadAssignmentId" TEXT,
    "hardRuleAssessmentId" TEXT,
    "projectId" TEXT,
    "companyId" TEXT,
    "contactId" TEXT,
    "icpVersionId" TEXT,
    "sourceType" "V2ManagerReviewSourceType" NOT NULL,
    "sourceId" TEXT,
    "sourceRefJson" JSONB,
    "sourceFingerprint" TEXT NOT NULL,
    "reasonCode" "V2ManagerReviewReasonCode" NOT NULL,
    "reasonDetail" TEXT,
    "suggestedAction" TEXT,
    "priority" "V2ManagerReviewPriority" NOT NULL DEFAULT 'NORMAL',
    "confidence" "V2ManagerReviewConfidence" NOT NULL DEFAULT 'UNKNOWN',
    "candidateSummariesJson" JSONB,
    "metadataJson" JSONB,
    "status" "V2ManagerReviewStatus" NOT NULL DEFAULT 'OPEN',
    "assignedToUserId" TEXT,
    "createdByUserId" TEXT,
    "resolvedByUserId" TEXT,
    "resolutionType" "V2ManagerReviewResolutionType",
    "resolutionNote" TEXT,
    "resolutionMetadataJson" JSONB,
    "dueAt" TIMESTAMP(3),
    "snoozedUntil" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "V2ManagerReviewItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "V2ManagerReviewItem_organizationId_status_priority_idx" ON "V2ManagerReviewItem"("organizationId", "status", "priority");

-- CreateIndex
CREATE INDEX "V2ManagerReviewItem_organizationId_leadAssignmentId_status_idx" ON "V2ManagerReviewItem"("organizationId", "leadAssignmentId", "status");

-- CreateIndex
CREATE INDEX "V2ManagerReviewItem_organizationId_sourceType_createdAt_idx" ON "V2ManagerReviewItem"("organizationId", "sourceType", "createdAt");

-- CreateIndex
CREATE INDEX "V2ManagerReviewItem_organizationId_assignedToUserId_status_idx" ON "V2ManagerReviewItem"("organizationId", "assignedToUserId", "status");

-- CreateIndex
CREATE INDEX "V2ManagerReviewItem_organizationId_hardRuleAssessmentId_idx" ON "V2ManagerReviewItem"("organizationId", "hardRuleAssessmentId");

-- CreateIndex
CREATE INDEX "V2ManagerReviewItem_organizationId_createdAt_idx" ON "V2ManagerReviewItem"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "V2ManagerReviewItem_deletedAt_idx" ON "V2ManagerReviewItem"("deletedAt");

-- ManualPartialUniqueIndex
-- Prisma schema cannot express this active-only uniqueness cleanly.
CREATE UNIQUE INDEX "V2ManagerReviewItem_active_sourceFingerprint_key"
ON "V2ManagerReviewItem"("organizationId", "sourceFingerprint")
WHERE "deletedAt" IS NULL
  AND "status" IN ('OPEN', 'IN_PROGRESS', 'SNOOZED');

-- ManualForeignKeys
-- The Prisma model intentionally uses scalar id fields only. Do not add Prisma
-- relation fields or back-relations to existing V2 models for MR1.
ALTER TABLE "V2ManagerReviewItem" ADD CONSTRAINT "V2ManagerReviewItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "V2Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "V2ManagerReviewItem" ADD CONSTRAINT "V2ManagerReviewItem_leadAssignmentId_fkey" FOREIGN KEY ("leadAssignmentId") REFERENCES "V2LeadAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "V2ManagerReviewItem" ADD CONSTRAINT "V2ManagerReviewItem_hardRuleAssessmentId_fkey" FOREIGN KEY ("hardRuleAssessmentId") REFERENCES "V2HardRuleAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "V2ManagerReviewItem" ADD CONSTRAINT "V2ManagerReviewItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "V2Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "V2ManagerReviewItem" ADD CONSTRAINT "V2ManagerReviewItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "V2Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "V2ManagerReviewItem" ADD CONSTRAINT "V2ManagerReviewItem_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "V2Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "V2ManagerReviewItem" ADD CONSTRAINT "V2ManagerReviewItem_icpVersionId_fkey" FOREIGN KEY ("icpVersionId") REFERENCES "V2ICPVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "V2ManagerReviewItem" ADD CONSTRAINT "V2ManagerReviewItem_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "V2User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "V2ManagerReviewItem" ADD CONSTRAINT "V2ManagerReviewItem_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "V2User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "V2ManagerReviewItem" ADD CONSTRAINT "V2ManagerReviewItem_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "V2User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
