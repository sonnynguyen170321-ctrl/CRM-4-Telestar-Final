-- CreateEnum
CREATE TYPE "IcpVersionStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "IcpQualification" AS ENUM ('qualified', 'needs_review', 'unqualified');

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "icpVersionId" TEXT;

-- AlterTable
ALTER TABLE "LeadPoolItem" ADD COLUMN     "icpQualification" "IcpQualification",
ADD COLUMN     "latestAssessmentId" TEXT;

-- CreateTable
CREATE TABLE "IcpProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "IcpProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IcpVersion" (
    "id" TEXT NOT NULL,
    "icpProfileId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "IcpVersionStatus" NOT NULL DEFAULT 'draft',
    "rulesJson" JSONB,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "IcpVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadPoolAssessment" (
    "id" TEXT NOT NULL,
    "poolItemId" TEXT NOT NULL,
    "icpVersionId" TEXT NOT NULL,
    "fitScore" INTEGER NOT NULL,
    "confidenceScore" INTEGER NOT NULL,
    "dataQualityScore" INTEGER NOT NULL,
    "qualification" "IcpQualification" NOT NULL,
    "evidenceJson" JSONB,
    "inputSnapshot" JSONB NOT NULL,
    "rulesSnapshot" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "LeadPoolAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IcpProfile_tenantId_idx" ON "IcpProfile"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "IcpProfile_id_tenantId_key" ON "IcpProfile"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "IcpProfile_tenantId_name_key" ON "IcpProfile"("tenantId", "name");

-- CreateIndex
CREATE INDEX "IcpVersion_tenantId_idx" ON "IcpVersion"("tenantId");

-- CreateIndex
CREATE INDEX "IcpVersion_tenantId_status_idx" ON "IcpVersion"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "IcpVersion_id_tenantId_key" ON "IcpVersion"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "IcpVersion_tenantId_icpProfileId_versionNumber_key" ON "IcpVersion"("tenantId", "icpProfileId", "versionNumber");

-- CreateIndex
CREATE INDEX "LeadPoolAssessment_tenantId_idx" ON "LeadPoolAssessment"("tenantId");

-- CreateIndex
CREATE INDEX "LeadPoolAssessment_tenantId_icpVersionId_idx" ON "LeadPoolAssessment"("tenantId", "icpVersionId");

-- CreateIndex
CREATE INDEX "LeadPoolAssessment_poolItemId_createdAt_idx" ON "LeadPoolAssessment"("poolItemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeadPoolAssessment_id_tenantId_key" ON "LeadPoolAssessment"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadPoolAssessment_tenantId_poolItemId_fingerprint_key" ON "LeadPoolAssessment"("tenantId", "poolItemId", "fingerprint");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_icpVersionId_tenantId_fkey" FOREIGN KEY ("icpVersionId", "tenantId") REFERENCES "IcpVersion"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IcpProfile" ADD CONSTRAINT "IcpProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IcpVersion" ADD CONSTRAINT "IcpVersion_icpProfileId_tenantId_fkey" FOREIGN KEY ("icpProfileId", "tenantId") REFERENCES "IcpProfile"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IcpVersion" ADD CONSTRAINT "IcpVersion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPoolAssessment" ADD CONSTRAINT "LeadPoolAssessment_poolItemId_tenantId_fkey" FOREIGN KEY ("poolItemId", "tenantId") REFERENCES "LeadPoolItem"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPoolAssessment" ADD CONSTRAINT "LeadPoolAssessment_icpVersionId_tenantId_fkey" FOREIGN KEY ("icpVersionId", "tenantId") REFERENCES "IcpVersion"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPoolAssessment" ADD CONSTRAINT "LeadPoolAssessment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

