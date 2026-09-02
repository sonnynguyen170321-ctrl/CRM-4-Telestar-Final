-- CreateEnum
CREATE TYPE "V2IngestionJobType" AS ENUM ('COMPANY_UPLOAD', 'CONTACT_UPLOAD', 'ACTIVITY_RECAP');

-- CreateEnum
CREATE TYPE "V2IngestionJobStatus" AS ENUM ('PENDING', 'VALIDATING', 'VALIDATED_WITH_ERRORS', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "V2IngestionRowStatus" AS ENUM ('RAW', 'NORMALIZED', 'MATCHED', 'APPLIED', 'ERROR');

-- CreateTable
CREATE TABLE "V2IngestionJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "uploadedByUserId" TEXT,
    "jobType" "V2IngestionJobType" NOT NULL,
    "status" "V2IngestionJobStatus" NOT NULL DEFAULT 'PENDING',
    "originalFileName" TEXT NOT NULL,
    "sourceFileStorageKey" TEXT,
    "mappingJson" JSONB,
    "rowCountsJson" JSONB,
    "errorSummaryJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "V2IngestionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "V2IngestionRow" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceRowNumber" INTEGER NOT NULL,
    "sourceRowHash" TEXT NOT NULL,
    "rawRowJson" JSONB NOT NULL,
    "normalizedRowJson" JSONB,
    "rowStatus" "V2IngestionRowStatus" NOT NULL DEFAULT 'RAW',
    "validationErrorsJson" JSONB,
    "matchedCompanyId" TEXT,
    "matchedContactId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "V2IngestionRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "V2IngestionJob_organizationId_idx" ON "V2IngestionJob"("organizationId");

-- CreateIndex
CREATE INDEX "V2IngestionJob_organizationId_jobType_status_idx" ON "V2IngestionJob"("organizationId", "jobType", "status");

-- CreateIndex
CREATE INDEX "V2IngestionJob_organizationId_createdAt_idx" ON "V2IngestionJob"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "V2IngestionJob_projectId_idx" ON "V2IngestionJob"("projectId");

-- CreateIndex
CREATE INDEX "V2IngestionJob_createdAt_idx" ON "V2IngestionJob"("createdAt");

-- CreateIndex
CREATE INDEX "V2IngestionRow_jobId_sourceRowNumber_idx" ON "V2IngestionRow"("jobId", "sourceRowNumber");

-- CreateIndex
CREATE INDEX "V2IngestionRow_jobId_rowStatus_idx" ON "V2IngestionRow"("jobId", "rowStatus");

-- CreateIndex
CREATE INDEX "V2IngestionRow_organizationId_idx" ON "V2IngestionRow"("organizationId");

-- CreateIndex
CREATE INDEX "V2IngestionRow_organizationId_rowStatus_idx" ON "V2IngestionRow"("organizationId", "rowStatus");

-- CreateIndex
CREATE INDEX "V2IngestionRow_matchedCompanyId_idx" ON "V2IngestionRow"("matchedCompanyId");

-- CreateIndex
CREATE INDEX "V2IngestionRow_matchedContactId_idx" ON "V2IngestionRow"("matchedContactId");

-- CreateIndex
CREATE UNIQUE INDEX "V2IngestionRow_jobId_sourceRowHash_key" ON "V2IngestionRow"("jobId", "sourceRowHash");

-- AddForeignKey
ALTER TABLE "V2IngestionJob" ADD CONSTRAINT "V2IngestionJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "V2Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2IngestionJob" ADD CONSTRAINT "V2IngestionJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "V2Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2IngestionJob" ADD CONSTRAINT "V2IngestionJob_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "V2User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2IngestionRow" ADD CONSTRAINT "V2IngestionRow_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "V2IngestionJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2IngestionRow" ADD CONSTRAINT "V2IngestionRow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "V2Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2IngestionRow" ADD CONSTRAINT "V2IngestionRow_matchedCompanyId_fkey" FOREIGN KEY ("matchedCompanyId") REFERENCES "V2Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2IngestionRow" ADD CONSTRAINT "V2IngestionRow_matchedContactId_fkey" FOREIGN KEY ("matchedContactId") REFERENCES "V2Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
