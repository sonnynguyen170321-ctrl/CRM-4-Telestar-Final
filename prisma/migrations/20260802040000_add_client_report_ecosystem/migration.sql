-- Client Reports — client-facing campaign report snapshots

-- ─── Enums ────────────────────────────────────────────────────────────────

CREATE TYPE "ReportStatus" AS ENUM ('draft', 'internal_review', 'approved', 'shared', 'archived');
CREATE TYPE "ReportPeriodType" AS ENUM ('weekly', 'monthly', 'custom');
CREATE TYPE "ReportAudience" AS ENUM ('internal', 'client');
CREATE TYPE "ReportExportType" AS ENUM ('pdf', 'csv', 'share_link');

-- ─── ClientReport ────────────────────────────────────────────────────────────

CREATE TABLE "ClientReport" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "campaignId" TEXT,
    "title" TEXT NOT NULL,
    "periodType" "ReportPeriodType" NOT NULL DEFAULT 'weekly',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'draft',
    "audience" "ReportAudience" NOT NULL DEFAULT 'client',
    "summary" TEXT,
    "keyWins" TEXT[],
    "blockers" TEXT[],
    "recommendations" TEXT[],
    "clientActions" TEXT[],
    "snapshotJson" JSONB NOT NULL,
    "generatedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "sharedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientReport_pkey" PRIMARY KEY ("id")
);

-- ─── ClientReportRecipient ──────────────────────────────────────────────────

CREATE TABLE "ClientReportRecipient" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "role" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientReportRecipient_pkey" PRIMARY KEY ("id")
);

-- ─── ClientReportExport ─────────────────────────────────────────────────────

CREATE TABLE "ClientReportExport" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "type" "ReportExportType" NOT NULL,
    "fileUrl" TEXT,
    "fileName" TEXT,
    "exportedById" TEXT NOT NULL,
    "exportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "ClientReportExport_pkey" PRIMARY KEY ("id")
);

-- ─── ClientReportShareLink ──────────────────────────────────────────────────

CREATE TABLE "ClientReportShareLink" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "passwordHash" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientReportShareLink_pkey" PRIMARY KEY ("id")
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX "ClientReport_tenantId_idx" ON "ClientReport"("tenantId");
CREATE INDEX "ClientReport_clientId_idx" ON "ClientReport"("clientId");
CREATE INDEX "ClientReport_campaignId_idx" ON "ClientReport"("campaignId");
CREATE INDEX "ClientReport_periodStart_periodEnd_idx" ON "ClientReport"("periodStart", "periodEnd");
CREATE INDEX "ClientReport_status_idx" ON "ClientReport"("status");

CREATE INDEX "ClientReportRecipient_tenantId_idx" ON "ClientReportRecipient"("tenantId");
CREATE INDEX "ClientReportRecipient_reportId_idx" ON "ClientReportRecipient"("reportId");
CREATE INDEX "ClientReportRecipient_email_idx" ON "ClientReportRecipient"("email");

CREATE INDEX "ClientReportExport_tenantId_idx" ON "ClientReportExport"("tenantId");
CREATE INDEX "ClientReportExport_reportId_idx" ON "ClientReportExport"("reportId");
CREATE INDEX "ClientReportExport_type_idx" ON "ClientReportExport"("type");

CREATE UNIQUE INDEX "ClientReportShareLink_tokenHash_key" ON "ClientReportShareLink"("tokenHash");
CREATE INDEX "ClientReportShareLink_tenantId_idx" ON "ClientReportShareLink"("tenantId");
CREATE INDEX "ClientReportShareLink_reportId_idx" ON "ClientReportShareLink"("reportId");
CREATE INDEX "ClientReportShareLink_expiresAt_idx" ON "ClientReportShareLink"("expiresAt");

-- ─── Foreign keys ────────────────────────────────────────────────────────────

ALTER TABLE "ClientReport" ADD CONSTRAINT "ClientReport_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientReport" ADD CONSTRAINT "ClientReport_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ClientReport" ADD CONSTRAINT "ClientReport_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientReport" ADD CONSTRAINT "ClientReport_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ClientReport" ADD CONSTRAINT "ClientReport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientReportRecipient" ADD CONSTRAINT "ClientReportRecipient_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ClientReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientReportRecipient" ADD CONSTRAINT "ClientReportRecipient_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientReportExport" ADD CONSTRAINT "ClientReportExport_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ClientReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientReportExport" ADD CONSTRAINT "ClientReportExport_exportedById_fkey" FOREIGN KEY ("exportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientReportExport" ADD CONSTRAINT "ClientReportExport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientReportShareLink" ADD CONSTRAINT "ClientReportShareLink_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ClientReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientReportShareLink" ADD CONSTRAINT "ClientReportShareLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientReportShareLink" ADD CONSTRAINT "ClientReportShareLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
