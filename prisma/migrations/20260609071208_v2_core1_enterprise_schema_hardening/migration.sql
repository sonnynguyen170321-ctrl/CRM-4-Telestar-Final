-- CreateEnum
CREATE TYPE "V2LeadAssignmentLevel" AS ENUM ('COMPANY', 'CONTACT');

-- CreateEnum
CREATE TYPE "V2LeadWorkflowStatus" AS ENUM ('NEW', 'ASSIGNED', 'WORKING', 'CONTACTED', 'RESPONDED', 'MEETING_BOOKED', 'MEETING_DONE', 'NURTURE', 'NOT_INTERESTED', 'BOUNCED', 'SUPPRESSED', 'DISQUALIFIED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "V2JobType" AS ENUM ('INGESTION_PARSE', 'INGESTION_NORMALIZE', 'IDENTITY_MATCH', 'LEAD_ASSIGNMENT_UPSERT', 'ICP_SCORE', 'ACTIVITY_APPLY', 'EXPORT_GENERATE', 'AI_INSIGHT_GENERATE', 'EMAIL_SEND', 'SEQUENCE_STEP_EXECUTE');

-- CreateEnum
CREATE TYPE "V2JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'RETRY_SCHEDULED');

-- CreateEnum
CREATE TYPE "V2JobSourceType" AS ENUM ('INGESTION_JOB', 'INGESTION_ROW', 'LEAD_ASSIGNMENT', 'HARD_RULE_ASSESSMENT', 'AI_INSIGHT', 'EXPORT_JOB', 'EMAIL_SEND', 'SEQUENCE_ENROLLMENT', 'MANUAL');

-- CreateEnum
CREATE TYPE "V2SuppressionScopeType" AS ENUM ('ORGANIZATION', 'PROJECT', 'COMPANY', 'CONTACT', 'LEAD_ASSIGNMENT', 'GLOBAL');

-- CreateEnum
CREATE TYPE "V2SuppressionIdentifierType" AS ENUM ('EMAIL', 'DOMAIN', 'PHONE', 'LINKEDIN', 'CONTACT_ID', 'COMPANY_ID');

-- CreateEnum
CREATE TYPE "V2SuppressionType" AS ENUM ('UNSUBSCRIBE', 'BOUNCE', 'BLACKLIST', 'MANUAL', 'TENANT_LEVEL', 'GLOBAL');

-- AlterEnum
ALTER TYPE "V2Qualification" ADD VALUE 'NEEDS_REVIEW';

-- AlterTable
ALTER TABLE "V2Company" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedByUserId" TEXT,
ADD COLUMN     "deletionReason" TEXT;

-- AlterTable
ALTER TABLE "V2Contact" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedByUserId" TEXT,
ADD COLUMN     "deletionReason" TEXT;

-- AlterTable
ALTER TABLE "V2ICPVersion" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedByUserId" TEXT,
ADD COLUMN     "deletionReason" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "V2LeadAssignment" ADD COLUMN     "assignmentLevel" "V2LeadAssignmentLevel" NOT NULL DEFAULT 'COMPANY',
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedByUserId" TEXT,
ADD COLUMN     "deletionReason" TEXT,
ADD COLUMN     "latestHardRuleAssessmentId" TEXT,
ADD COLUMN     "workflowStatus" "V2LeadWorkflowStatus" NOT NULL DEFAULT 'NEW';

-- Backfill assignment level before adding contact/company constraints.
UPDATE "V2LeadAssignment"
SET "assignmentLevel" = 'CONTACT'
WHERE "contactId" IS NOT NULL;

UPDATE "V2LeadAssignment"
SET "assignmentLevel" = 'COMPANY'
WHERE "contactId" IS NULL;

-- Replace pre-CORE1 LeadAssignment uniqueness with assignmentLevel + soft-delete aware indexes.
DROP INDEX IF EXISTS "V2LeadAssignment_org_company_contact_project_icp_key";
DROP INDEX IF EXISTS "V2LeadAssignment_org_company_project_icp_no_contact_key";

ALTER TABLE "V2LeadAssignment"
ADD CONSTRAINT "V2LeadAssignment_assignmentLevel_contact_check"
CHECK (
  ("assignmentLevel" = 'COMPANY' AND "contactId" IS NULL)
  OR
  ("assignmentLevel" = 'CONTACT' AND "contactId" IS NOT NULL)
);

-- CreateTable
CREATE TABLE "V2Job" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobType" "V2JobType" NOT NULL,
    "sourceType" "V2JobSourceType" NOT NULL,
    "sourceId" TEXT,
    "status" "V2JobStatus" NOT NULL DEFAULT 'QUEUED',
    "progressCurrent" INTEGER NOT NULL DEFAULT 0,
    "progressTotal" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "payloadSnapshotJson" JSONB,
    "resultSnapshotJson" JSONB,
    "errorSnapshotJson" JSONB,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "V2Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "V2SuppressionEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scopeType" "V2SuppressionScopeType" NOT NULL,
    "scopeId" TEXT,
    "identifierType" "V2SuppressionIdentifierType" NOT NULL,
    "identifierValueNormalized" TEXT NOT NULL,
    "suppressionType" "V2SuppressionType" NOT NULL,
    "reason" TEXT,
    "source" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,
    "deletionReason" TEXT,

    CONSTRAINT "V2SuppressionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "V2Job_organizationId_status_nextAttemptAt_idx" ON "V2Job"("organizationId", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "V2Job_organizationId_jobType_status_idx" ON "V2Job"("organizationId", "jobType", "status");

-- CreateIndex
CREATE INDEX "V2Job_sourceType_sourceId_idx" ON "V2Job"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "V2Job_createdByUserId_idx" ON "V2Job"("createdByUserId");

-- CreateIndex
CREATE INDEX "V2Job_createdAt_idx" ON "V2Job"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "V2Job_organizationId_idempotencyKey_key" ON "V2Job"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "V2SuppressionEntry_organizationId_identifierType_identifier_idx" ON "V2SuppressionEntry"("organizationId", "identifierType", "identifierValueNormalized", "deletedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "V2SuppressionEntry_organizationId_scopeType_scopeId_idx" ON "V2SuppressionEntry"("organizationId", "scopeType", "scopeId");

-- CreateIndex
CREATE INDEX "V2SuppressionEntry_organizationId_suppressionType_idx" ON "V2SuppressionEntry"("organizationId", "suppressionType");

-- CreateIndex
CREATE INDEX "V2SuppressionEntry_createdByUserId_idx" ON "V2SuppressionEntry"("createdByUserId");

-- CreateIndex
CREATE INDEX "V2SuppressionEntry_createdAt_idx" ON "V2SuppressionEntry"("createdAt");

-- Active suppression entries must be unique for the same tenant/scope/identifier/type.
-- COALESCE keeps nullable scopeId from allowing duplicate active global/org-level rows.
CREATE UNIQUE INDEX "V2SuppressionEntry_active_scope_identifier_type_key"
ON "V2SuppressionEntry"(
  "organizationId",
  "scopeType",
  COALESCE("scopeId", '__NULL__'),
  "identifierType",
  "identifierValueNormalized",
  "suppressionType"
)
WHERE "deletedAt" IS NULL;

-- CreateIndex
CREATE INDEX "V2Company_deletedAt_idx" ON "V2Company"("deletedAt");

-- CreateIndex
CREATE INDEX "V2Company_deletedByUserId_idx" ON "V2Company"("deletedByUserId");

-- CreateIndex
CREATE INDEX "V2Contact_deletedAt_idx" ON "V2Contact"("deletedAt");

-- CreateIndex
CREATE INDEX "V2Contact_deletedByUserId_idx" ON "V2Contact"("deletedByUserId");

-- CreateIndex
CREATE INDEX "V2ICPVersion_organizationId_status_version_idx" ON "V2ICPVersion"("organizationId", "status", "version");

-- CreateIndex
CREATE INDEX "V2ICPVersion_deletedAt_idx" ON "V2ICPVersion"("deletedAt");

-- CreateIndex
CREATE INDEX "V2ICPVersion_deletedByUserId_idx" ON "V2ICPVersion"("deletedByUserId");

-- CreateIndex
CREATE INDEX "V2LeadAssignment_organizationId_workflowStatus_idx" ON "V2LeadAssignment"("organizationId", "workflowStatus");

-- CreateIndex
CREATE INDEX "V2LeadAssignment_organizationId_assignmentLevel_status_idx" ON "V2LeadAssignment"("organizationId", "assignmentLevel", "status");

-- CreateIndex
CREATE INDEX "V2LeadAssignment_latestHardRuleAssessmentId_idx" ON "V2LeadAssignment"("latestHardRuleAssessmentId");

-- CreateIndex
CREATE INDEX "V2LeadAssignment_deletedAt_idx" ON "V2LeadAssignment"("deletedAt");

-- CreateIndex
CREATE INDEX "V2LeadAssignment_deletedByUserId_idx" ON "V2LeadAssignment"("deletedByUserId");

-- Active company-level assignments are unique by tenant, project, ICP version, and company.
CREATE UNIQUE INDEX "V2LeadAssignment_active_company_assignment_key"
ON "V2LeadAssignment"("organizationId", "projectId", "icpVersionId", "companyId")
WHERE "assignmentLevel" = 'COMPANY'
  AND "contactId" IS NULL
  AND "status" = 'ACTIVE'
  AND "deletedAt" IS NULL;

-- Active contact-level assignments are unique by tenant, project, ICP version, company, and contact.
CREATE UNIQUE INDEX "V2LeadAssignment_active_contact_assignment_key"
ON "V2LeadAssignment"("organizationId", "projectId", "icpVersionId", "companyId", "contactId")
WHERE "assignmentLevel" = 'CONTACT'
  AND "contactId" IS NOT NULL
  AND "status" = 'ACTIVE'
  AND "deletedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "V2ICPVersion" ADD CONSTRAINT "V2ICPVersion_deletedByUserId_fkey" FOREIGN KEY ("deletedByUserId") REFERENCES "V2User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2Company" ADD CONSTRAINT "V2Company_deletedByUserId_fkey" FOREIGN KEY ("deletedByUserId") REFERENCES "V2User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2Contact" ADD CONSTRAINT "V2Contact_deletedByUserId_fkey" FOREIGN KEY ("deletedByUserId") REFERENCES "V2User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2LeadAssignment" ADD CONSTRAINT "V2LeadAssignment_latestHardRuleAssessmentId_fkey" FOREIGN KEY ("latestHardRuleAssessmentId") REFERENCES "V2HardRuleAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2LeadAssignment" ADD CONSTRAINT "V2LeadAssignment_deletedByUserId_fkey" FOREIGN KEY ("deletedByUserId") REFERENCES "V2User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2Job" ADD CONSTRAINT "V2Job_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "V2Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2Job" ADD CONSTRAINT "V2Job_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "V2User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2SuppressionEntry" ADD CONSTRAINT "V2SuppressionEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "V2Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2SuppressionEntry" ADD CONSTRAINT "V2SuppressionEntry_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "V2User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2SuppressionEntry" ADD CONSTRAINT "V2SuppressionEntry_deletedByUserId_fkey" FOREIGN KEY ("deletedByUserId") REFERENCES "V2User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
