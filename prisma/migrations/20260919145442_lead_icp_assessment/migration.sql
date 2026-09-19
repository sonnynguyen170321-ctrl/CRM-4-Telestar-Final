-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "icpFitScore" INTEGER,
ADD COLUMN     "icpQualification" "IcpQualification",
ADD COLUMN     "icpScoredAt" TIMESTAMP(3),
ADD COLUMN     "icpVersionId" TEXT,
ADD COLUMN     "latestIcpAssessmentId" TEXT;

-- CreateTable
CREATE TABLE "LeadIcpAssessment" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
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

    CONSTRAINT "LeadIcpAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadIcpAssessment_tenantId_idx" ON "LeadIcpAssessment"("tenantId");

-- CreateIndex
CREATE INDEX "LeadIcpAssessment_tenantId_icpVersionId_idx" ON "LeadIcpAssessment"("tenantId", "icpVersionId");

-- CreateIndex
CREATE INDEX "LeadIcpAssessment_leadId_createdAt_idx" ON "LeadIcpAssessment"("leadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeadIcpAssessment_id_tenantId_key" ON "LeadIcpAssessment"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadIcpAssessment_tenantId_leadId_fingerprint_key" ON "LeadIcpAssessment"("tenantId", "leadId", "fingerprint");

-- CreateIndex
CREATE INDEX "Lead_tenantId_icpQualification_idx" ON "Lead"("tenantId", "icpQualification");

-- CreateIndex
CREATE INDEX "Lead_icpVersionId_idx" ON "Lead"("icpVersionId");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_icpVersionId_tenantId_fkey" FOREIGN KEY ("icpVersionId", "tenantId") REFERENCES "IcpVersion"("id", "tenantId") ON DELETE SET NULL ("icpVersionId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadIcpAssessment" ADD CONSTRAINT "LeadIcpAssessment_leadId_tenantId_fkey" FOREIGN KEY ("leadId", "tenantId") REFERENCES "Lead"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadIcpAssessment" ADD CONSTRAINT "LeadIcpAssessment_icpVersionId_tenantId_fkey" FOREIGN KEY ("icpVersionId", "tenantId") REFERENCES "IcpVersion"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadIcpAssessment" ADD CONSTRAINT "LeadIcpAssessment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
