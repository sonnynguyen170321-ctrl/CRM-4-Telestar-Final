-- CreateTable
CREATE TABLE "CompanyAiAssessment" (
    "id" TEXT NOT NULL,
    "companyRecordId" TEXT NOT NULL,
    "localScoreResultId" TEXT,
    "provider" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'uncertain_rows_only',
    "qualification" TEXT NOT NULL,
    "companyType" TEXT NOT NULL,
    "companyScore" INTEGER NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "oneSentenceCompanySummary" TEXT,
    "inputSnapshotJson" JSONB NOT NULL,
    "websiteSignalsSnapshotJson" JSONB,
    "rawResponseJson" JSONB,
    "finishReason" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyAiAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyAiAssessment_companyRecordId_createdAt_idx" ON "CompanyAiAssessment"("companyRecordId", "createdAt");

-- CreateIndex
CREATE INDEX "CompanyAiAssessment_provider_modelName_promptVersion_idx" ON "CompanyAiAssessment"("provider", "modelName", "promptVersion");

-- CreateIndex
CREATE INDEX "CompanyAiAssessment_localScoreResultId_idx" ON "CompanyAiAssessment"("localScoreResultId");

-- AddForeignKey
ALTER TABLE "CompanyAiAssessment" ADD CONSTRAINT "CompanyAiAssessment_companyRecordId_fkey" FOREIGN KEY ("companyRecordId") REFERENCES "CompanyRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
