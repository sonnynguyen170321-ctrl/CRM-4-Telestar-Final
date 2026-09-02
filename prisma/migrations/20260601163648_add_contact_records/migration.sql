-- AlterTable
ALTER TABLE "SdrActivityRow" ADD COLUMN     "contactRecordId" TEXT;

-- CreateTable
CREATE TABLE "ContactRecord" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "title" TEXT,
    "email" TEXT,
    "normalizedEmail" TEXT,
    "phone" TEXT,
    "normalizedPhone" TEXT,
    "contactLinkedInUrl" TEXT,
    "normalizedLinkedInUrl" TEXT,
    "companyNameRaw" TEXT,
    "normalizedCompanyName" TEXT,
    "companyRecordId" TEXT,
    "ownerSdrName" TEXT,
    "latestSdrName" TEXT,
    "source" TEXT NOT NULL DEFAULT 'activity_recap',
    "sourceUploadId" TEXT,
    "firstActivityDate" TEXT,
    "latestActivityDate" TEXT,
    "latestActivitySummary" TEXT,
    "activityCount" INTEGER NOT NULL DEFAULT 0,
    "linkedinCount" INTEGER NOT NULL DEFAULT 0,
    "emailCount" INTEGER NOT NULL DEFAULT 0,
    "callCount" INTEGER NOT NULL DEFAULT 0,
    "noPickupCount" INTEGER NOT NULL DEFAULT 0,
    "notInterestedCount" INTEGER NOT NULL DEFAULT 0,
    "managerReviewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactRecord_companyRecordId_idx" ON "ContactRecord"("companyRecordId");

-- CreateIndex
CREATE INDEX "ContactRecord_normalizedEmail_idx" ON "ContactRecord"("normalizedEmail");

-- CreateIndex
CREATE INDEX "ContactRecord_normalizedLinkedInUrl_idx" ON "ContactRecord"("normalizedLinkedInUrl");

-- CreateIndex
CREATE INDEX "ContactRecord_normalizedCompanyName_idx" ON "ContactRecord"("normalizedCompanyName");

-- CreateIndex
CREATE INDEX "ContactRecord_ownerSdrName_idx" ON "ContactRecord"("ownerSdrName");

-- CreateIndex
CREATE INDEX "ContactRecord_latestSdrName_idx" ON "ContactRecord"("latestSdrName");

-- CreateIndex
CREATE INDEX "ContactRecord_sourceUploadId_idx" ON "ContactRecord"("sourceUploadId");

-- CreateIndex
CREATE INDEX "SdrActivityRow_contactRecordId_idx" ON "SdrActivityRow"("contactRecordId");

-- AddForeignKey
ALTER TABLE "SdrActivityRow" ADD CONSTRAINT "SdrActivityRow_contactRecordId_fkey" FOREIGN KEY ("contactRecordId") REFERENCES "ContactRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactRecord" ADD CONSTRAINT "ContactRecord_companyRecordId_fkey" FOREIGN KEY ("companyRecordId") REFERENCES "CompanyRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
