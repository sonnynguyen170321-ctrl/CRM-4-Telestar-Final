-- A person's verdict on a lead's ICP fit (lib/leads/effectiveQualification.ts). Additive: the
-- running image never reads these columns, so it keeps working on the new schema.
SET lock_timeout = '10s';

ALTER TABLE "Lead" ADD COLUMN "qualificationOverride" "IcpQualification",
ADD COLUMN "qualificationOverrideAt" TIMESTAMP(3),
ADD COLUMN "qualificationOverrideById" TEXT,
ADD COLUMN "latestQualificationReviewId" TEXT;

CREATE TABLE "LeadQualificationReview" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "verdict" "IcpQualification",
    "reasonCode" TEXT NOT NULL,
    "note" TEXT,
    "reviewedById" TEXT NOT NULL,
    "computedQualification" "IcpQualification",
    "computedFitScore" INTEGER,
    "assessmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "LeadQualificationReview_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LeadQualificationReview_tenantId_leadId_createdAt_idx" ON "LeadQualificationReview"("tenantId", "leadId", "createdAt");
CREATE UNIQUE INDEX "LeadQualificationReview_id_tenantId_key" ON "LeadQualificationReview"("id", "tenantId");
CREATE INDEX "Lead_tenantId_qualificationOverride_idx" ON "Lead"("tenantId", "qualificationOverride");

ALTER TABLE "LeadQualificationReview" ADD CONSTRAINT "LeadQualificationReview_leadId_tenantId_fkey" FOREIGN KEY ("leadId", "tenantId") REFERENCES "Lead"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadQualificationReview" ADD CONSTRAINT "LeadQualificationReview_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
