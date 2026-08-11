-- CreateEnum
CREATE TYPE "ResearchStatus" AS ENUM ('pending', 'completed', 'failed');

-- CreateTable
CREATE TABLE "AccountResearchCache" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "status" "ResearchStatus" NOT NULL DEFAULT 'pending',
    "claimedBy" TEXT,
    "claimToken" TEXT,
    "claimedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountResearchCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactResearchCache" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" "ResearchStatus" NOT NULL DEFAULT 'pending',
    "claimedBy" TEXT,
    "claimToken" TEXT,
    "claimedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactResearchCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanySignal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "cacheId" TEXT,
    "accountResearchRunId" TEXT,
    "workOrderId" TEXT,
    "aiCallId" TEXT,
    "signalType" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceType" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "rawMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanySignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountPainHypothesis" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "cacheId" TEXT,
    "accountResearchRunId" TEXT,
    "workOrderId" TEXT,
    "aiCallId" TEXT,
    "painType" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "evidenceSummary" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceType" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountPainHypothesis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalizationHook" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT,
    "accountId" TEXT,
    "leadId" TEXT,
    "cacheId" TEXT,
    "contactResearchRunId" TEXT,
    "workOrderId" TEXT,
    "aiCallId" TEXT,
    "hookType" TEXT NOT NULL,
    "angle" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceType" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalizationHook_pkey" PRIMARY KEY ("id")
);

-- Unique & Index Constraints
CREATE UNIQUE INDEX "AccountResearchCache_accountId_key" ON "AccountResearchCache"("accountId");
CREATE UNIQUE INDEX "AccountResearchCache_tenantId_accountId_key" ON "AccountResearchCache"("tenantId", "accountId");
CREATE INDEX "AccountResearchCache_tenantId_idx" ON "AccountResearchCache"("tenantId");
CREATE INDEX "AccountResearchCache_tenantId_status_expiresAt_idx" ON "AccountResearchCache"("tenantId", "status", "expiresAt");

CREATE UNIQUE INDEX "ContactResearchCache_contactId_key" ON "ContactResearchCache"("contactId");
CREATE UNIQUE INDEX "ContactResearchCache_tenantId_contactId_key" ON "ContactResearchCache"("tenantId", "contactId");
CREATE INDEX "ContactResearchCache_tenantId_idx" ON "ContactResearchCache"("tenantId");
CREATE INDEX "ContactResearchCache_tenantId_status_expiresAt_idx" ON "ContactResearchCache"("tenantId", "status", "expiresAt");

CREATE INDEX "CompanySignal_tenantId_idx" ON "CompanySignal"("tenantId");
CREATE INDEX "CompanySignal_tenantId_accountId_idx" ON "CompanySignal"("tenantId", "accountId");
CREATE INDEX "CompanySignal_tenantId_accountResearchRunId_idx" ON "CompanySignal"("tenantId", "accountResearchRunId");
CREATE INDEX "CompanySignal_tenantId_signalType_idx" ON "CompanySignal"("tenantId", "signalType");

CREATE INDEX "AccountPainHypothesis_tenantId_idx" ON "AccountPainHypothesis"("tenantId");
CREATE INDEX "AccountPainHypothesis_tenantId_accountId_idx" ON "AccountPainHypothesis"("tenantId", "accountId");
CREATE INDEX "AccountPainHypothesis_tenantId_accountResearchRunId_idx" ON "AccountPainHypothesis"("tenantId", "accountResearchRunId");

CREATE INDEX "PersonalizationHook_tenantId_idx" ON "PersonalizationHook"("tenantId");
CREATE INDEX "PersonalizationHook_tenantId_contactId_idx" ON "PersonalizationHook"("tenantId", "contactId");
CREATE INDEX "PersonalizationHook_tenantId_accountId_idx" ON "PersonalizationHook"("tenantId", "accountId");
CREATE INDEX "PersonalizationHook_tenantId_leadId_idx" ON "PersonalizationHook"("tenantId", "leadId");
CREATE INDEX "PersonalizationHook_tenantId_contactResearchRunId_idx" ON "PersonalizationHook"("tenantId", "contactResearchRunId");

-- Check Constraints
ALTER TABLE "CompanySignal" ADD CONSTRAINT "company_signal_confidence_check" CHECK ("confidence" >= 0.0 AND "confidence" <= 1.0);
ALTER TABLE "AccountPainHypothesis" ADD CONSTRAINT "pain_hypothesis_confidence_check" CHECK ("confidence" >= 0.0 AND "confidence" <= 1.0);
ALTER TABLE "PersonalizationHook" ADD CONSTRAINT "personalization_hook_confidence_check" CHECK ("confidence" >= 0.0 AND "confidence" <= 1.0);
ALTER TABLE "PersonalizationHook" ADD CONSTRAINT "personalization_hook_scope_check" CHECK ("contactId" IS NOT NULL OR "accountId" IS NOT NULL OR "leadId" IS NOT NULL);

-- Foreign Key Constraints
ALTER TABLE "AccountResearchCache" ADD CONSTRAINT "AccountResearchCache_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountResearchCache" ADD CONSTRAINT "AccountResearchCache_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactResearchCache" ADD CONSTRAINT "ContactResearchCache_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactResearchCache" ADD CONSTRAINT "ContactResearchCache_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanySignal" ADD CONSTRAINT "CompanySignal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanySignal" ADD CONSTRAINT "CompanySignal_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanySignal" ADD CONSTRAINT "CompanySignal_cacheId_fkey" FOREIGN KEY ("cacheId") REFERENCES "AccountResearchCache"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompanySignal" ADD CONSTRAINT "CompanySignal_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompanySignal" ADD CONSTRAINT "CompanySignal_aiCallId_fkey" FOREIGN KEY ("aiCallId") REFERENCES "AiCall"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AccountPainHypothesis" ADD CONSTRAINT "AccountPainHypothesis_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountPainHypothesis" ADD CONSTRAINT "AccountPainHypothesis_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountPainHypothesis" ADD CONSTRAINT "AccountPainHypothesis_cacheId_fkey" FOREIGN KEY ("cacheId") REFERENCES "AccountResearchCache"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AccountPainHypothesis" ADD CONSTRAINT "AccountPainHypothesis_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AccountPainHypothesis" ADD CONSTRAINT "AccountPainHypothesis_aiCallId_fkey" FOREIGN KEY ("aiCallId") REFERENCES "AiCall"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PersonalizationHook" ADD CONSTRAINT "PersonalizationHook_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonalizationHook" ADD CONSTRAINT "PersonalizationHook_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonalizationHook" ADD CONSTRAINT "PersonalizationHook_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonalizationHook" ADD CONSTRAINT "PersonalizationHook_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonalizationHook" ADD CONSTRAINT "PersonalizationHook_cacheId_fkey" FOREIGN KEY ("cacheId") REFERENCES "ContactResearchCache"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PersonalizationHook" ADD CONSTRAINT "PersonalizationHook_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PersonalizationHook" ADD CONSTRAINT "PersonalizationHook_aiCallId_fkey" FOREIGN KEY ("aiCallId") REFERENCES "AiCall"("id") ON DELETE SET NULL ON UPDATE CASCADE;

