-- CreateTable
CREATE TABLE "ManagerReviewItem" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'activity_recap',
    "sourceActivityRowId" TEXT,
    "activityUploadId" TEXT,
    "contactRecordId" TEXT,
    "companyRecordId" TEXT,
    "sdrName" TEXT,
    "leadName" TEXT,
    "companyName" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'open',
    "reasonsJson" JSONB,
    "sourceNote" TEXT,
    "managerNote" TEXT,
    "nextAction" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagerReviewItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ManagerReviewItem_sourceActivityRowId_key" ON "ManagerReviewItem"("sourceActivityRowId");

-- CreateIndex
CREATE INDEX "ManagerReviewItem_status_idx" ON "ManagerReviewItem"("status");

-- CreateIndex
CREATE INDEX "ManagerReviewItem_priority_idx" ON "ManagerReviewItem"("priority");

-- CreateIndex
CREATE INDEX "ManagerReviewItem_sdrName_idx" ON "ManagerReviewItem"("sdrName");

-- CreateIndex
CREATE INDEX "ManagerReviewItem_activityUploadId_idx" ON "ManagerReviewItem"("activityUploadId");

-- CreateIndex
CREATE INDEX "ManagerReviewItem_contactRecordId_idx" ON "ManagerReviewItem"("contactRecordId");

-- CreateIndex
CREATE INDEX "ManagerReviewItem_companyRecordId_idx" ON "ManagerReviewItem"("companyRecordId");

-- AddForeignKey
ALTER TABLE "ManagerReviewItem" ADD CONSTRAINT "ManagerReviewItem_sourceActivityRowId_fkey" FOREIGN KEY ("sourceActivityRowId") REFERENCES "SdrActivityRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagerReviewItem" ADD CONSTRAINT "ManagerReviewItem_contactRecordId_fkey" FOREIGN KEY ("contactRecordId") REFERENCES "ContactRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagerReviewItem" ADD CONSTRAINT "ManagerReviewItem_companyRecordId_fkey" FOREIGN KEY ("companyRecordId") REFERENCES "CompanyRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
