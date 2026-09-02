-- AlterTable
ALTER TABLE "CompanyAiAssessment" ADD COLUMN     "cacheHit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cacheKey" TEXT,
ADD COLUMN     "inputFingerprint" TEXT;

-- CreateTable
CREATE TABLE "CompanyAiJob" (
    "id" TEXT NOT NULL,
    "uploadJobId" TEXT,
    "companyRecordId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "inputFingerprint" TEXT,
    "cacheKey" TEXT,
    "cacheHit" BOOLEAN NOT NULL DEFAULT false,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "inputTokenEstimate" INTEGER,
    "outputTokenEstimate" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyAiJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyAiJob_uploadJobId_idx" ON "CompanyAiJob"("uploadJobId");

-- CreateIndex
CREATE INDEX "CompanyAiJob_companyRecordId_idx" ON "CompanyAiJob"("companyRecordId");

-- CreateIndex
CREATE INDEX "CompanyAiJob_status_nextAttemptAt_idx" ON "CompanyAiJob"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "CompanyAiJob_provider_model_promptVersion_idx" ON "CompanyAiJob"("provider", "model", "promptVersion");

-- CreateIndex
CREATE INDEX "CompanyAiJob_cacheKey_idx" ON "CompanyAiJob"("cacheKey");

-- CreateIndex
CREATE INDEX "CompanyAiAssessment_cacheKey_idx" ON "CompanyAiAssessment"("cacheKey");

-- CreateIndex
CREATE INDEX "CompanyAiAssessment_inputFingerprint_idx" ON "CompanyAiAssessment"("inputFingerprint");

-- AddForeignKey
ALTER TABLE "CompanyAiJob" ADD CONSTRAINT "CompanyAiJob_uploadJobId_fkey" FOREIGN KEY ("uploadJobId") REFERENCES "UploadJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyAiJob" ADD CONSTRAINT "CompanyAiJob_companyRecordId_fkey" FOREIGN KEY ("companyRecordId") REFERENCES "CompanyRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
