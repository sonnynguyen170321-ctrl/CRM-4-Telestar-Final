-- CreateEnum
CREATE TYPE "CampaignProspectStatus" AS ENUM ('candidate', 'needs_contact', 'ready', 'active', 'completed', 'removed');

-- CreateTable
CREATE TABLE "CampaignProspect" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "poolItemId" TEXT NOT NULL,
    "assignedSdrId" TEXT,
    "leadId" TEXT,
    "createdById" TEXT,
    "assessedIcpVersionId" TEXT,
    "latestAssessmentId" TEXT,
    "status" "CampaignProspectStatus" NOT NULL DEFAULT 'candidate',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "removalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignProspect_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignProspect_tenantId_campaignId_status_idx" ON "CampaignProspect"("tenantId", "campaignId", "status");

-- CreateIndex
CREATE INDEX "CampaignProspect_tenantId_assignedSdrId_status_idx" ON "CampaignProspect"("tenantId", "assignedSdrId", "status");

-- CreateIndex
CREATE INDEX "CampaignProspect_tenantId_poolItemId_idx" ON "CampaignProspect"("tenantId", "poolItemId");

-- CreateIndex
CREATE INDEX "CampaignProspect_tenantId_assessedIcpVersionId_status_idx" ON "CampaignProspect"("tenantId", "assessedIcpVersionId", "status");

-- CreateIndex
CREATE INDEX "CampaignProspect_latestAssessmentId_tenantId_idx" ON "CampaignProspect"("latestAssessmentId", "tenantId");

-- CreateIndex
CREATE INDEX "CampaignProspect_createdById_tenantId_idx" ON "CampaignProspect"("createdById", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignProspect_id_tenantId_key" ON "CampaignProspect"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignProspect_tenantId_campaignId_poolItemId_key" ON "CampaignProspect"("tenantId", "campaignId", "poolItemId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignProspect_leadId_tenantId_campaignId_key" ON "CampaignProspect"("leadId", "tenantId", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_id_tenantId_campaignId_key" ON "Lead"("id", "tenantId", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadPoolAssessment_campaign_pointer_key" ON "LeadPoolAssessment"("id", "tenantId", "poolItemId", "icpVersionId");

-- AddForeignKey
ALTER TABLE "CampaignProspect" ADD CONSTRAINT "CampaignProspect_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignProspect" ADD CONSTRAINT "CampaignProspect_campaignId_tenantId_fkey" FOREIGN KEY ("campaignId", "tenantId") REFERENCES "Campaign"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignProspect" ADD CONSTRAINT "CampaignProspect_poolItemId_tenantId_fkey" FOREIGN KEY ("poolItemId", "tenantId") REFERENCES "LeadPoolItem"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignProspect" ADD CONSTRAINT "CampaignProspect_assignedSdrId_tenantId_fkey" FOREIGN KEY ("assignedSdrId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ("assignedSdrId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignProspect" ADD CONSTRAINT "CampaignProspect_leadId_tenantId_campaignId_fkey" FOREIGN KEY ("leadId", "tenantId", "campaignId") REFERENCES "Lead"("id", "tenantId", "campaignId") ON DELETE SET NULL ("leadId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignProspect" ADD CONSTRAINT "CampaignProspect_createdById_tenantId_fkey" FOREIGN KEY ("createdById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ("createdById") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignProspect" ADD CONSTRAINT "CampaignProspect_assessedIcpVersionId_tenantId_fkey" FOREIGN KEY ("assessedIcpVersionId", "tenantId") REFERENCES "IcpVersion"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignProspect" ADD CONSTRAINT "CampaignProspect_latestAssessmentId_tenantId_poolItemId_as_fkey" FOREIGN KEY ("latestAssessmentId", "tenantId", "poolItemId", "assessedIcpVersionId") REFERENCES "LeadPoolAssessment"("id", "tenantId", "poolItemId", "icpVersionId") ON DELETE SET NULL ("latestAssessmentId") ON UPDATE CASCADE;


-- An assessment pointer is valid only together with the ICP version used to produce it.
ALTER TABLE "CampaignProspect" ADD CONSTRAINT "CampaignProspect_assessment_requires_icp_check" CHECK ("latestAssessmentId" IS NULL OR "assessedIcpVersionId" IS NOT NULL);
