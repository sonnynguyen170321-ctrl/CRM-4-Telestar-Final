-- CreateEnum
CREATE TYPE "V2ResearchStatus" AS ENUM ('SUCCESS', 'NO_WEBSITE', 'OFFLINE', 'BLOCKED', 'TIMEOUT', 'JS_RENDER_REQUIRED', 'PARTIAL', 'INVALID_URL', 'PARKED', 'NOT_RUN');

-- CreateEnum
CREATE TYPE "V2CompanyIntelligenceProfileStatus" AS ENUM ('PLACEHOLDER', 'EXTRACTED', 'PARTIAL', 'FAILED');

-- AlterEnum
ALTER TYPE "V2JobType" ADD VALUE 'COMPANY_ENRICHMENT';

-- CreateTable
CREATE TABLE "V2CompanyResearchSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "canonicalDomain" TEXT,
    "websiteUrl" TEXT,
    "status" "V2ResearchStatus" NOT NULL,
    "httpStatus" INTEGER,
    "finalUrl" TEXT,
    "redirectChainJson" JSONB,
    "pagesFetchedJson" JSONB,
    "searchResultsJson" JSONB,
    "rawTextHash" TEXT,
    "contentHash" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "researchVersion" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "V2CompanyResearchSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "V2CompanyIntelligenceProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "canonicalDomain" TEXT,
    "sourceResearchSnapshotId" TEXT,
    "companySummary" TEXT,
    "factsJson" JSONB,
    "evidenceItemsJson" JSONB,
    "classificationJson" JSONB,
    "sourceCoverageJson" JSONB,
    "riskSignalsJson" JSONB,
    "confidenceJson" JSONB,
    "profileStatus" "V2CompanyIntelligenceProfileStatus" NOT NULL,
    "staleAt" TIMESTAMP(3),
    "researchVersion" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "V2CompanyIntelligenceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "V2CompanyResearchSnapshot_idempotencyKey_key" ON "V2CompanyResearchSnapshot"("idempotencyKey");

-- CreateIndex
CREATE INDEX "V2CompanyResearchSnapshot_organizationId_companyId_createdA_idx" ON "V2CompanyResearchSnapshot"("organizationId", "companyId", "createdAt");

-- CreateIndex
CREATE INDEX "V2CompanyResearchSnapshot_canonicalDomain_idx" ON "V2CompanyResearchSnapshot"("canonicalDomain");

-- CreateIndex
CREATE INDEX "V2CompanyResearchSnapshot_status_idx" ON "V2CompanyResearchSnapshot"("status");

-- CreateIndex
CREATE INDEX "V2CompanyResearchSnapshot_createdAt_idx" ON "V2CompanyResearchSnapshot"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "V2CompanyIntelligenceProfile_idempotencyKey_key" ON "V2CompanyIntelligenceProfile"("idempotencyKey");

-- CreateIndex
CREATE INDEX "V2CompanyIntelligenceProfile_organizationId_companyId_creat_idx" ON "V2CompanyIntelligenceProfile"("organizationId", "companyId", "createdAt");

-- CreateIndex
CREATE INDEX "V2CompanyIntelligenceProfile_canonicalDomain_idx" ON "V2CompanyIntelligenceProfile"("canonicalDomain");

-- CreateIndex
CREATE INDEX "V2CompanyIntelligenceProfile_profileStatus_idx" ON "V2CompanyIntelligenceProfile"("profileStatus");

-- CreateIndex
CREATE INDEX "V2CompanyIntelligenceProfile_staleAt_idx" ON "V2CompanyIntelligenceProfile"("staleAt");

-- CreateIndex
CREATE INDEX "V2CompanyIntelligenceProfile_createdAt_idx" ON "V2CompanyIntelligenceProfile"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "V2CompanyIntelligenceProfile_organizationId_companyId_resea_key" ON "V2CompanyIntelligenceProfile"("organizationId", "companyId", "researchVersion");

-- AddForeignKey
ALTER TABLE "V2CompanyResearchSnapshot" ADD CONSTRAINT "V2CompanyResearchSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "V2Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2CompanyResearchSnapshot" ADD CONSTRAINT "V2CompanyResearchSnapshot_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "V2Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2CompanyIntelligenceProfile" ADD CONSTRAINT "V2CompanyIntelligenceProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "V2Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2CompanyIntelligenceProfile" ADD CONSTRAINT "V2CompanyIntelligenceProfile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "V2Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2CompanyIntelligenceProfile" ADD CONSTRAINT "V2CompanyIntelligenceProfile_sourceResearchSnapshotId_fkey" FOREIGN KEY ("sourceResearchSnapshotId") REFERENCES "V2CompanyResearchSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
