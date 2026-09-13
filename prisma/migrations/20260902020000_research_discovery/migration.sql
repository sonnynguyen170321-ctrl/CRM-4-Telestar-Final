-- CreateEnum
CREATE TYPE "ResearchRunKind" AS ENUM ('company', 'contact');

-- CreateEnum
CREATE TYPE "ResearchRunStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "ResearchCandidateStatus" AS ENUM ('discovered', 'duplicate', 'promoted', 'dismissed');

-- CreateEnum
CREATE TYPE "CompanyCrawlStatus" AS ENUM ('success', 'no_website', 'offline', 'blocked', 'timeout', 'js_render_required', 'partial', 'invalid_url', 'parked', 'not_run');

-- CreateEnum
CREATE TYPE "CompanyIntelligenceProfileStatus" AS ENUM ('placeholder', 'extracted', 'partial', 'failed');

-- CreateTable
CREATE TABLE "ResearchRun" (
    "id" TEXT NOT NULL,
    "kind" "ResearchRunKind" NOT NULL,
    "status" "ResearchRunStatus" NOT NULL DEFAULT 'queued',
    "icpVersionId" TEXT,
    "campaignId" TEXT,
    "queriesJson" JSONB NOT NULL,
    "paramsJson" JSONB,
    "queryCursor" INTEGER NOT NULL DEFAULT 0,
    "discoveredCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "ResearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchCandidate" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "kind" "ResearchRunKind" NOT NULL,
    "status" "ResearchCandidateStatus" NOT NULL DEFAULT 'discovered',
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "linkedinUrl" TEXT,
    "title" TEXT,
    "companyName" TEXT,
    "location" TEXT,
    "sourceJson" JSONB NOT NULL,
    "matchHintsJson" JSONB NOT NULL,
    "dedupeFingerprint" TEXT NOT NULL,
    "fitScore" INTEGER,
    "fitReason" TEXT,
    "fitSource" TEXT,
    "emailGuess" TEXT,
    "emailStatus" TEXT,
    "phone" TEXT,
    "insightJson" JSONB,
    "enrichedAt" TIMESTAMP(3),
    "promotedAccountId" TEXT,
    "promotedContactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "ResearchCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchProspect" (
    "id" TEXT NOT NULL,
    "kind" "ResearchRunKind" NOT NULL,
    "dedupeFingerprint" TEXT NOT NULL,
    "domain" TEXT,
    "linkedinUrl" TEXT,
    "displayName" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "timesSeen" INTEGER NOT NULL DEFAULT 1,
    "lastRunId" TEXT,
    "promotedAccountId" TEXT,
    "promotedContactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "ResearchProspect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchEvidence" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "candidateId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "provider" TEXT,
    "sourceUrl" TEXT,
    "sourceTitle" TEXT,
    "sourceSnippet" TEXT,
    "query" TEXT,
    "confidence" INTEGER,
    "evidenceJson" JSONB,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "ResearchEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchFieldObservation" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "evidenceId" TEXT,
    "fieldName" TEXT NOT NULL,
    "valueText" TEXT,
    "valueJson" JSONB,
    "confidence" INTEGER,
    "sourceKind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "ResearchFieldObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchProviderAttempt" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "candidateId" TEXT,
    "stage" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requestJson" JSONB,
    "responseJson" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "ResearchProviderAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyResearchSnapshot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "canonicalDomain" TEXT,
    "websiteUrl" TEXT,
    "status" "CompanyCrawlStatus" NOT NULL,
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
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "CompanyResearchSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyIntelligenceProfile" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "canonicalDomain" TEXT,
    "sourceResearchSnapshotId" TEXT,
    "companySummary" TEXT,
    "factsJson" JSONB,
    "evidenceItemsJson" JSONB,
    "classificationJson" JSONB,
    "sourceCoverageJson" JSONB,
    "riskSignalsJson" JSONB,
    "confidenceJson" JSONB,
    "industryCategory" TEXT,
    "profileStatus" "CompanyIntelligenceProfileStatus" NOT NULL,
    "staleAt" TIMESTAMP(3),
    "researchVersion" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "CompanyIntelligenceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResearchRun_tenantId_idx" ON "ResearchRun"("tenantId");

-- CreateIndex
CREATE INDEX "ResearchRun_tenantId_status_idx" ON "ResearchRun"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ResearchRun_tenantId_createdAt_idx" ON "ResearchRun"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchRun_id_tenantId_key" ON "ResearchRun"("id", "tenantId");

-- CreateIndex
CREATE INDEX "ResearchCandidate_tenantId_idx" ON "ResearchCandidate"("tenantId");

-- CreateIndex
CREATE INDEX "ResearchCandidate_tenantId_dedupeFingerprint_idx" ON "ResearchCandidate"("tenantId", "dedupeFingerprint");

-- CreateIndex
CREATE INDEX "ResearchCandidate_tenantId_runId_status_idx" ON "ResearchCandidate"("tenantId", "runId", "status");

-- CreateIndex
CREATE INDEX "ResearchCandidate_tenantId_runId_fitScore_idx" ON "ResearchCandidate"("tenantId", "runId", "fitScore");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchCandidate_id_tenantId_key" ON "ResearchCandidate"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchCandidate_tenantId_runId_dedupeFingerprint_key" ON "ResearchCandidate"("tenantId", "runId", "dedupeFingerprint");

-- CreateIndex
CREATE INDEX "ResearchProspect_tenantId_domain_idx" ON "ResearchProspect"("tenantId", "domain");

-- CreateIndex
CREATE INDEX "ResearchProspect_tenantId_lastSeenAt_idx" ON "ResearchProspect"("tenantId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchProspect_id_tenantId_key" ON "ResearchProspect"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchProspect_tenantId_dedupeFingerprint_key" ON "ResearchProspect"("tenantId", "dedupeFingerprint");

-- CreateIndex
CREATE INDEX "ResearchEvidence_tenantId_runId_createdAt_idx" ON "ResearchEvidence"("tenantId", "runId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchEvidence_tenantId_candidateId_createdAt_idx" ON "ResearchEvidence"("tenantId", "candidateId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchEvidence_id_tenantId_key" ON "ResearchEvidence"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchEvidence_tenantId_idempotencyKey_key" ON "ResearchEvidence"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ResearchFieldObservation_tenantId_candidateId_fieldName_idx" ON "ResearchFieldObservation"("tenantId", "candidateId", "fieldName");

-- CreateIndex
CREATE INDEX "ResearchFieldObservation_tenantId_evidenceId_idx" ON "ResearchFieldObservation"("tenantId", "evidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchFieldObservation_id_tenantId_key" ON "ResearchFieldObservation"("id", "tenantId");

-- CreateIndex
CREATE INDEX "ResearchProviderAttempt_tenantId_runId_stage_createdAt_idx" ON "ResearchProviderAttempt"("tenantId", "runId", "stage", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchProviderAttempt_tenantId_provider_status_createdAt_idx" ON "ResearchProviderAttempt"("tenantId", "provider", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchProviderAttempt_id_tenantId_key" ON "ResearchProviderAttempt"("id", "tenantId");

-- CreateIndex
CREATE INDEX "CompanyResearchSnapshot_tenantId_accountId_createdAt_idx" ON "CompanyResearchSnapshot"("tenantId", "accountId", "createdAt");

-- CreateIndex
CREATE INDEX "CompanyResearchSnapshot_tenantId_canonicalDomain_idx" ON "CompanyResearchSnapshot"("tenantId", "canonicalDomain");

-- CreateIndex
CREATE INDEX "CompanyResearchSnapshot_status_idx" ON "CompanyResearchSnapshot"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyResearchSnapshot_id_tenantId_key" ON "CompanyResearchSnapshot"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyResearchSnapshot_tenantId_idempotencyKey_key" ON "CompanyResearchSnapshot"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "CompanyIntelligenceProfile_tenantId_accountId_createdAt_idx" ON "CompanyIntelligenceProfile"("tenantId", "accountId", "createdAt");

-- CreateIndex
CREATE INDEX "CompanyIntelligenceProfile_tenantId_industryCategory_idx" ON "CompanyIntelligenceProfile"("tenantId", "industryCategory");

-- CreateIndex
CREATE INDEX "CompanyIntelligenceProfile_profileStatus_idx" ON "CompanyIntelligenceProfile"("profileStatus");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyIntelligenceProfile_id_tenantId_key" ON "CompanyIntelligenceProfile"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyIntelligenceProfile_tenantId_idempotencyKey_key" ON "CompanyIntelligenceProfile"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyIntelligenceProfile_tenantId_accountId_researchVersi_key" ON "CompanyIntelligenceProfile"("tenantId", "accountId", "researchVersion");

-- AddForeignKey
ALTER TABLE "ResearchRun" ADD CONSTRAINT "ResearchRun_icpVersionId_tenantId_fkey" FOREIGN KEY ("icpVersionId", "tenantId") REFERENCES "IcpVersion"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRun" ADD CONSTRAINT "ResearchRun_campaignId_tenantId_fkey" FOREIGN KEY ("campaignId", "tenantId") REFERENCES "Campaign"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRun" ADD CONSTRAINT "ResearchRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRun" ADD CONSTRAINT "ResearchRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchCandidate" ADD CONSTRAINT "ResearchCandidate_runId_tenantId_fkey" FOREIGN KEY ("runId", "tenantId") REFERENCES "ResearchRun"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchCandidate" ADD CONSTRAINT "ResearchCandidate_promotedAccountId_tenantId_fkey" FOREIGN KEY ("promotedAccountId", "tenantId") REFERENCES "Account"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchCandidate" ADD CONSTRAINT "ResearchCandidate_promotedContactId_tenantId_fkey" FOREIGN KEY ("promotedContactId", "tenantId") REFERENCES "Contact"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchCandidate" ADD CONSTRAINT "ResearchCandidate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchProspect" ADD CONSTRAINT "ResearchProspect_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchEvidence" ADD CONSTRAINT "ResearchEvidence_runId_tenantId_fkey" FOREIGN KEY ("runId", "tenantId") REFERENCES "ResearchRun"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchEvidence" ADD CONSTRAINT "ResearchEvidence_candidateId_tenantId_fkey" FOREIGN KEY ("candidateId", "tenantId") REFERENCES "ResearchCandidate"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchEvidence" ADD CONSTRAINT "ResearchEvidence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchFieldObservation" ADD CONSTRAINT "ResearchFieldObservation_candidateId_tenantId_fkey" FOREIGN KEY ("candidateId", "tenantId") REFERENCES "ResearchCandidate"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchFieldObservation" ADD CONSTRAINT "ResearchFieldObservation_evidenceId_tenantId_fkey" FOREIGN KEY ("evidenceId", "tenantId") REFERENCES "ResearchEvidence"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchFieldObservation" ADD CONSTRAINT "ResearchFieldObservation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchProviderAttempt" ADD CONSTRAINT "ResearchProviderAttempt_runId_tenantId_fkey" FOREIGN KEY ("runId", "tenantId") REFERENCES "ResearchRun"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchProviderAttempt" ADD CONSTRAINT "ResearchProviderAttempt_candidateId_tenantId_fkey" FOREIGN KEY ("candidateId", "tenantId") REFERENCES "ResearchCandidate"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchProviderAttempt" ADD CONSTRAINT "ResearchProviderAttempt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyResearchSnapshot" ADD CONSTRAINT "CompanyResearchSnapshot_accountId_tenantId_fkey" FOREIGN KEY ("accountId", "tenantId") REFERENCES "Account"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyResearchSnapshot" ADD CONSTRAINT "CompanyResearchSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyIntelligenceProfile" ADD CONSTRAINT "CompanyIntelligenceProfile_accountId_tenantId_fkey" FOREIGN KEY ("accountId", "tenantId") REFERENCES "Account"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyIntelligenceProfile" ADD CONSTRAINT "CompanyIntelligenceProfile_sourceResearchSnapshotId_tenant_fkey" FOREIGN KEY ("sourceResearchSnapshotId", "tenantId") REFERENCES "CompanyResearchSnapshot"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyIntelligenceProfile" ADD CONSTRAINT "CompanyIntelligenceProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

