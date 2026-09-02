-- CreateTable
CREATE TABLE "SdrActivityUpload" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT,
    "fileSize" INTEGER,
    "sheetName" TEXT,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "uploadedBy" TEXT,
    "mappingProfileJson" JSONB,
    "detectedHeadersJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SdrActivityUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SdrActivityRow" (
    "id" TEXT NOT NULL,
    "activityUploadId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "sdrName" TEXT NOT NULL,
    "leadName" TEXT,
    "companyName" TEXT,
    "website" TEXT,
    "title" TEXT,
    "contactLinkedInUrl" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "companyCountry" TEXT,
    "contactCountry" TEXT,
    "companyLinkedInUrl" TEXT,
    "companyIndustry" TEXT,
    "companyStaffCountRange" TEXT,
    "activityDate" TEXT,
    "weekLabel" TEXT,
    "linkedinStageRaw" TEXT,
    "linkedinStageNormalized" TEXT NOT NULL,
    "emailStageRaw" TEXT,
    "emailStageNormalized" TEXT NOT NULL,
    "callStageRaw" TEXT,
    "callStageNormalized" TEXT NOT NULL,
    "otherChannelRaw" TEXT,
    "otherChannelNormalized" TEXT NOT NULL,
    "noteCombined" TEXT,
    "meetingDate" TEXT,
    "meetingStatus" TEXT,
    "channelResponded" TEXT,
    "linkedinCount" INTEGER NOT NULL DEFAULT 0,
    "emailCount" INTEGER NOT NULL DEFAULT 0,
    "callCount" INTEGER NOT NULL DEFAULT 0,
    "noPickupCount" INTEGER NOT NULL DEFAULT 0,
    "notInterestedCount" INTEGER NOT NULL DEFAULT 0,
    "otherChannelCount" INTEGER NOT NULL DEFAULT 0,
    "totalActivityCount" INTEGER NOT NULL DEFAULT 0,
    "managerReviewFlag" BOOLEAN NOT NULL DEFAULT false,
    "managerReviewPriority" TEXT NOT NULL DEFAULT 'none',
    "managerReviewReasonsJson" JSONB,
    "rawRowJson" JSONB NOT NULL,
    "normalizedRowJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SdrActivityRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SdrActivityRow_activityUploadId_idx" ON "SdrActivityRow"("activityUploadId");

-- CreateIndex
CREATE INDEX "SdrActivityRow_sdrName_idx" ON "SdrActivityRow"("sdrName");

-- CreateIndex
CREATE INDEX "SdrActivityRow_managerReviewFlag_idx" ON "SdrActivityRow"("managerReviewFlag");

-- CreateIndex
CREATE INDEX "SdrActivityRow_companyName_idx" ON "SdrActivityRow"("companyName");

-- AddForeignKey
ALTER TABLE "SdrActivityRow" ADD CONSTRAINT "SdrActivityRow_activityUploadId_fkey" FOREIGN KEY ("activityUploadId") REFERENCES "SdrActivityUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;
