-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.
ALTER TYPE "ActivityType" ADD VALUE 'booking_link_sent';
ALTER TYPE "ActivityType" ADD VALUE 'meeting_outcome_logged';
ALTER TYPE "ActivityType" ADD VALUE 'meeting_cancelled';
ALTER TYPE "ActivityType" ADD VALUE 'meeting_rescheduled';
-- DropIndex
DROP INDEX "SequenceEnrollment_leadId_sequenceId_key";
-- AlterTable
ALTER TABLE "Account" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);
-- AlterTable
ALTER TABLE "CampaignLeadRequirement" ALTER COLUMN "dueDate" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);
-- AlterTable
ALTER TABLE "Contact" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);
-- AlterTable
ALTER TABLE "EmailAccount" ADD COLUMN     "dailyCap" INTEGER NOT NULL DEFAULT 80,
ADD COLUMN     "signature" TEXT;
-- AlterTable
ALTER TABLE "LeadPoolItem" ALTER COLUMN "qualifiedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "assignedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);
-- AlterTable
ALTER TABLE "LeadgenActivity" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);
-- AlterTable
ALTER TABLE "Opportunity" ALTER COLUMN "expectedCloseDate" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "nextStepAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "closedAt" SET DATA TYPE TIMESTAMP(3);
-- AlterTable
ALTER TABLE "OpportunityActivity" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);
-- CreateIndex
CREATE INDEX "Activity_leadId_type_createdAt_idx" ON "Activity"("leadId", "type", "createdAt");
-- CreateIndex
CREATE INDEX "Activity_tenantId_userId_type_createdAt_idx" ON "Activity"("tenantId", "userId", "type", "createdAt");
-- CreateIndex
CREATE INDEX "Lead_tenantId_stage_idx" ON "Lead"("tenantId", "stage");
-- CreateIndex
CREATE INDEX "Lead_tenantId_assignedToId_idx" ON "Lead"("tenantId", "assignedToId");
-- CreateIndex
CREATE INDEX "Lead_tenantId_crmPriorityScore_idx" ON "Lead"("tenantId", "crmPriorityScore");
-- CreateIndex
CREATE INDEX "Lead_tenantId_email_idx" ON "Lead"("tenantId", "email");
-- CreateIndex
CREATE INDEX "Opportunity_meetingId_idx" ON "Opportunity"("meetingId");
-- CreateIndex
CREATE UNIQUE INDEX "SuppressionEntry_tenantId_email_campaignId_key" ON "SuppressionEntry"("tenantId", "email", "campaignId");
-- CreateIndex
CREATE UNIQUE INDEX "SuppressionEntry_tenantId_domain_campaignId_key" ON "SuppressionEntry"("tenantId", "domain", "campaignId");
-- CreateIndex
CREATE UNIQUE INDEX "SuppressionEntry_tenantId_company_campaignId_key" ON "SuppressionEntry"("tenantId", "company", "campaignId");
-- CreateIndex
CREATE INDEX "Task_leadId_status_idx" ON "Task"("leadId", "status");
-- CreateIndex
CREATE INDEX "Task_type_status_dueDate_idx" ON "Task"("type", "status", "dueDate");
