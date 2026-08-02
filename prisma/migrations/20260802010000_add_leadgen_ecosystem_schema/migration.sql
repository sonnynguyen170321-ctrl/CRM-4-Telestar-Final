-- Leadgen Manager + Internal Lead Database ecosystem (schema)

-- ─── Enums ────────────────────────────────────────────────────────────────

ALTER TYPE "Role" ADD VALUE 'leadgen_manager';

CREATE TYPE "LeadPoolStatus" AS ENUM ('raw', 'imported', 'enriching', 'enriched', 'qa_pending', 'qualified', 'disqualified', 'assigned_to_campaign', 'archived');
CREATE TYPE "LeadQualificationStatus" AS ENUM ('unreviewed', 'qualified', 'disqualified', 'needs_research', 'duplicate', 'invalid_contact', 'invalid_company', 'out_of_icp');
CREATE TYPE "LeadQualityTier" AS ENUM ('a', 'b', 'c', 'd');
CREATE TYPE "LeadSourceType" AS ENUM ('manual', 'csv_import', 'apollo', 'linkedin', 'clay', 'lusha', 'zoominfo', 'client_provided', 'vendor', 'other');
CREATE TYPE "CampaignLeadRequirementStatus" AS ENUM ('open', 'fulfilled', 'paused', 'cancelled');
CREATE TYPE "LeadgenActivityType" AS ENUM ('imported', 'enriched', 'qualified', 'disqualified', 'duplicate_marked', 'assigned_to_campaign', 'assigned_to_sdr', 'exported', 'qa_reviewed', 'returned_by_sdr');

-- ─── ImportBatch / ImportRow: support pool imports ─────────────────────────

ALTER TABLE "ImportBatch" ALTER COLUMN "campaignId" DROP NOT NULL;

ALTER TABLE "ImportBatch" ADD COLUMN "targetType" TEXT NOT NULL DEFAULT 'lead';

ALTER TABLE "ImportBatch" DROP CONSTRAINT "ImportBatch_campaignId_fkey";
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ImportRow" ADD COLUMN "poolItemId" TEXT;

CREATE INDEX "ImportBatch_targetType_idx" ON "ImportBatch"("targetType");
CREATE INDEX "ImportRow_poolItemId_idx" ON "ImportRow"("poolItemId");

-- ─── LeadPoolItem ───────────────────────────────────────────────────────────

CREATE TABLE "LeadPoolItem" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "contactId" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "fullName" TEXT,
    "company" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "linkedIn" TEXT,
    "website" TEXT,
    "country" TEXT,
    "industry" TEXT,
    "status" "LeadPoolStatus" NOT NULL DEFAULT 'raw',
    "qualification" "LeadQualificationStatus" NOT NULL DEFAULT 'unreviewed',
    "qualityTier" "LeadQualityTier",
    "sourceType" "LeadSourceType" NOT NULL DEFAULT 'csv_import',
    "sourceName" TEXT,
    "importBatchId" TEXT,
    "icpFitScore" INTEGER,
    "dataQualityScore" INTEGER,
    "emailValidation" TEXT,
    "emailScore" INTEGER,
    "duplicateKey" TEXT,
    "duplicateOfId" TEXT,
    "qualifiedById" TEXT,
    "qualifiedAt" TIMESTAMPTZ,
    "disqualifiedReason" TEXT,
    "qaNotes" TEXT,
    "assignedCampaignId" TEXT,
    "assignedSdrId" TEXT,
    "convertedLeadId" TEXT,
    "assignedAt" TIMESTAMPTZ,
    "assignedById" TEXT,
    "tags" TEXT[],
    "rawPayload" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "LeadPoolItem_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "LeadPoolItem" ADD CONSTRAINT "LeadPoolItem_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LeadPoolItem" ADD CONSTRAINT "LeadPoolItem_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LeadPoolItem" ADD CONSTRAINT "LeadPoolItem_importBatchId_fkey"
  FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LeadPoolItem" ADD CONSTRAINT "LeadPoolItem_duplicateOfId_fkey"
  FOREIGN KEY ("duplicateOfId") REFERENCES "LeadPoolItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LeadPoolItem" ADD CONSTRAINT "LeadPoolItem_qualifiedById_fkey"
  FOREIGN KEY ("qualifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LeadPoolItem" ADD CONSTRAINT "LeadPoolItem_assignedCampaignId_fkey"
  FOREIGN KEY ("assignedCampaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LeadPoolItem" ADD CONSTRAINT "LeadPoolItem_assignedSdrId_fkey"
  FOREIGN KEY ("assignedSdrId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LeadPoolItem" ADD CONSTRAINT "LeadPoolItem_convertedLeadId_fkey"
  FOREIGN KEY ("convertedLeadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LeadPoolItem" ADD CONSTRAINT "LeadPoolItem_assignedById_fkey"
  FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LeadPoolItem" ADD CONSTRAINT "LeadPoolItem_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_poolItemId_fkey"
  FOREIGN KEY ("poolItemId") REFERENCES "LeadPoolItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "LeadPoolItem_tenantId_idx" ON "LeadPoolItem"("tenantId");
CREATE INDEX "LeadPoolItem_status_idx" ON "LeadPoolItem"("status");
CREATE INDEX "LeadPoolItem_qualification_idx" ON "LeadPoolItem"("qualification");
CREATE INDEX "LeadPoolItem_sourceType_idx" ON "LeadPoolItem"("sourceType");
CREATE INDEX "LeadPoolItem_assignedCampaignId_idx" ON "LeadPoolItem"("assignedCampaignId");
CREATE INDEX "LeadPoolItem_assignedSdrId_idx" ON "LeadPoolItem"("assignedSdrId");
CREATE INDEX "LeadPoolItem_tenantId_email_idx" ON "LeadPoolItem"("tenantId", "email");
CREATE INDEX "LeadPoolItem_tenantId_duplicateKey_idx" ON "LeadPoolItem"("tenantId", "duplicateKey");

-- ─── CampaignLeadRequirement ────────────────────────────────────────────────

CREATE TABLE "CampaignLeadRequirement" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "requiredCount" INTEGER NOT NULL,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "acceptedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "targetTitles" TEXT[],
    "targetCountries" TEXT[],
    "targetIndustries" TEXT[],
    "companySizeMin" INTEGER,
    "companySizeMax" INTEGER,
    "requiredFields" TEXT[],
    "notes" TEXT,
    "status" "CampaignLeadRequirementStatus" NOT NULL DEFAULT 'open',
    "dueDate" TIMESTAMPTZ,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "CampaignLeadRequirement_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CampaignLeadRequirement" ADD CONSTRAINT "CampaignLeadRequirement_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignLeadRequirement" ADD CONSTRAINT "CampaignLeadRequirement_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CampaignLeadRequirement" ADD CONSTRAINT "CampaignLeadRequirement_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "CampaignLeadRequirement_campaignId_idx" ON "CampaignLeadRequirement"("campaignId");
CREATE INDEX "CampaignLeadRequirement_status_idx" ON "CampaignLeadRequirement"("status");
CREATE INDEX "CampaignLeadRequirement_tenantId_idx" ON "CampaignLeadRequirement"("tenantId");

-- ─── LeadgenActivity ────────────────────────────────────────────────────────

CREATE TABLE "LeadgenActivity" (
    "id" TEXT NOT NULL,
    "poolItemId" TEXT,
    "userId" TEXT NOT NULL,
    "type" "LeadgenActivityType" NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "LeadgenActivity_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "LeadgenActivity" ADD CONSTRAINT "LeadgenActivity_poolItemId_fkey"
  FOREIGN KEY ("poolItemId") REFERENCES "LeadPoolItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LeadgenActivity" ADD CONSTRAINT "LeadgenActivity_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeadgenActivity" ADD CONSTRAINT "LeadgenActivity_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "LeadgenActivity_poolItemId_idx" ON "LeadgenActivity"("poolItemId");
CREATE INDEX "LeadgenActivity_userId_idx" ON "LeadgenActivity"("userId");
CREATE INDEX "LeadgenActivity_type_idx" ON "LeadgenActivity"("type");
CREATE INDEX "LeadgenActivity_tenantId_idx" ON "LeadgenActivity"("tenantId");
