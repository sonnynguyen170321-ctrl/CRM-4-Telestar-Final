-- Email Health P2 — health models, enums and EmailAccount control fields.
--
-- EmailHealthSnapshot is history only: live dashboard tables recompute from
-- OutboundMessage/InboundMessage so the UI can never render a stale rollup.
-- EmailAccount.healthScore/healthLevel are a denormalised cache written by the
-- hourly cron purely so list views can sort and filter without aggregating.
--
-- As with 20260802050000, this deliberately excludes the unrelated TIMESTAMP(3)
-- drift that `migrate diff` reports on CampaignLeadRequirement / LeadPoolItem /
-- LeadgenActivity. That drift predates this work.

-- CreateEnum
CREATE TYPE "EmailHealthLevel" AS ENUM ('healthy', 'watch', 'at_risk', 'critical', 'paused');
CREATE TYPE "EmailHealthAlertSeverity" AS ENUM ('info', 'warning', 'critical');
CREATE TYPE "EmailHealthAlertStatus" AS ENUM ('open', 'acknowledged', 'resolved', 'ignored');
CREATE TYPE "DnsCheckStatus" AS ENUM ('unknown', 'pass', 'fail', 'warning', 'manual_verified');

-- AlterTable: EmailAccount health cache + manager pause controls
ALTER TABLE "EmailAccount" ADD COLUMN     "healthLevel" "EmailHealthLevel",
ADD COLUMN     "healthScore" INTEGER,
ADD COLUMN     "lastHealthCheckAt" TIMESTAMP(3),
ADD COLUMN     "sendPauseReason" TEXT,
ADD COLUMN     "sendPausedAt" TIMESTAMP(3),
ADD COLUMN     "sendPausedById" TEXT;

-- CreateTable
CREATE TABLE "EmailHealthSnapshot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "domain" TEXT,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "hardBounceCount" INTEGER NOT NULL DEFAULT 0,
    "softBounceCount" INTEGER NOT NULL DEFAULT 0,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "spamSignalCount" INTEGER NOT NULL DEFAULT 0,
    "trashSignalCount" INTEGER NOT NULL DEFAULT 0,
    "suppressionCount" INTEGER NOT NULL DEFAULT 0,
    "dailyCap" INTEGER,
    "dailySendCount" INTEGER,
    "lastSyncAt" TIMESTAMP(3),
    "healthScore" INTEGER NOT NULL,
    "healthLevel" "EmailHealthLevel" NOT NULL,
    "reasons" TEXT[],
    "recommendations" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "EmailHealthSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDomainHealth" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "provider" TEXT,
    "spfStatus" "DnsCheckStatus" NOT NULL DEFAULT 'unknown',
    "dkimStatus" "DnsCheckStatus" NOT NULL DEFAULT 'unknown',
    "dmarcStatus" "DnsCheckStatus" NOT NULL DEFAULT 'unknown',
    "mxStatus" "DnsCheckStatus" NOT NULL DEFAULT 'unknown',
    "dnsNotes" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "activeInboxCount" INTEGER NOT NULL DEFAULT 0,
    "sevenDaySent" INTEGER NOT NULL DEFAULT 0,
    "sevenDayBounceRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sevenDayReplyRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "healthScore" INTEGER NOT NULL DEFAULT 100,
    "healthLevel" "EmailHealthLevel" NOT NULL DEFAULT 'healthy',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "EmailDomainHealth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailHealthAlert" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "campaignId" TEXT,
    "domain" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "severity" "EmailHealthAlertSeverity" NOT NULL DEFAULT 'warning',
    "status" "EmailHealthAlertStatus" NOT NULL DEFAULT 'open',
    "recommendedAction" TEXT,
    "acknowledgedById" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "EmailHealthAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailHealthSnapshot_accountId_windowStart_idx" ON "EmailHealthSnapshot"("accountId", "windowStart");
CREATE INDEX "EmailHealthSnapshot_tenantId_healthLevel_idx" ON "EmailHealthSnapshot"("tenantId", "healthLevel");
CREATE INDEX "EmailHealthSnapshot_tenantId_windowStart_idx" ON "EmailHealthSnapshot"("tenantId", "windowStart");
CREATE INDEX "EmailHealthSnapshot_tenantId_domain_idx" ON "EmailHealthSnapshot"("tenantId", "domain");

CREATE INDEX "EmailDomainHealth_tenantId_healthLevel_idx" ON "EmailDomainHealth"("tenantId", "healthLevel");
CREATE UNIQUE INDEX "EmailDomainHealth_tenantId_domain_key" ON "EmailDomainHealth"("tenantId", "domain");

CREATE INDEX "EmailHealthAlert_tenantId_status_idx" ON "EmailHealthAlert"("tenantId", "status");
CREATE INDEX "EmailHealthAlert_tenantId_severity_idx" ON "EmailHealthAlert"("tenantId", "severity");
CREATE INDEX "EmailHealthAlert_accountId_idx" ON "EmailHealthAlert"("accountId");
CREATE INDEX "EmailHealthAlert_campaignId_idx" ON "EmailHealthAlert"("campaignId");
CREATE INDEX "EmailHealthAlert_domain_idx" ON "EmailHealthAlert"("domain");
-- Alert dedupe lookup: is there already an open alert of this type for this inbox?
CREATE INDEX "EmailHealthAlert_accountId_type_status_idx" ON "EmailHealthAlert"("accountId", "type", "status");

CREATE INDEX "EmailAccount_tenantId_healthLevel_idx" ON "EmailAccount"("tenantId", "healthLevel");

-- AddForeignKey
ALTER TABLE "EmailHealthSnapshot" ADD CONSTRAINT "EmailHealthSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailHealthSnapshot" ADD CONSTRAINT "EmailHealthSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmailHealthSnapshot" ADD CONSTRAINT "EmailHealthSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmailDomainHealth" ADD CONSTRAINT "EmailDomainHealth_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmailHealthAlert" ADD CONSTRAINT "EmailHealthAlert_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailHealthAlert" ADD CONSTRAINT "EmailHealthAlert_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailHealthAlert" ADD CONSTRAINT "EmailHealthAlert_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
