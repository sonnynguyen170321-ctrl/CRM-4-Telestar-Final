-- CreateEnum
CREATE TYPE "UploadJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "Qualification" AS ENUM ('QUALIFIED', 'UNQUALIFIED', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "ReviewState" AS ENUM ('UNREVIEWED', 'NEEDS_REVIEW', 'REVIEWED');

-- CreateEnum
CREATE TYPE "CompanyType" AS ENUM ('Not Relevant', 'PAAS', 'SAAS', 'CLOUD', 'ITO', 'Data Solution', 'AI Solution', 'AI Service', 'Cyber Security', 'Blockchain Solution');

-- CreateEnum
CREATE TYPE "FeedbackSource" AS ENUM ('LOCAL_UI', 'IMPORTED_CSV', 'API');

-- CreateEnum
CREATE TYPE "DatasetSplit" AS ENUM ('UNSPECIFIED', 'TRAIN', 'EVAL', 'HOLDOUT');

-- CreateTable
CREATE TABLE "UploadJob" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" "UploadJobStatus" NOT NULL DEFAULT 'QUEUED',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyRecord" (
    "id" TEXT NOT NULL,
    "uploadJobId" TEXT,
    "sourceRowIndex" INTEGER,
    "companyName" TEXT NOT NULL,
    "website" TEXT,
    "companyCountry" TEXT,
    "companyLinkedInUrl" TEXT,
    "companyIndustry" TEXT,
    "companyPhone1" TEXT,
    "companyStaffCountRange" TEXT,
    "type" "CompanyType",
    "note" TEXT,
    "rawRowJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyScoreResult" (
    "id" TEXT NOT NULL,
    "companyRecordId" TEXT NOT NULL,
    "companyScore" INTEGER NOT NULL,
    "qualification" "Qualification" NOT NULL,
    "confidence" DECIMAL(3,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "oneSentenceCompanySummary" TEXT,
    "hardRuleFlags" JSONB NOT NULL,
    "reviewState" "ReviewState" NOT NULL DEFAULT 'UNREVIEWED',
    "scoringSource" TEXT NOT NULL DEFAULT 'local_hard_rules',
    "scoringVersion" TEXT NOT NULL DEFAULT 'v0',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyScoreResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackImportJob" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" "UploadJobStatus" NOT NULL DEFAULT 'QUEUED',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedbackImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackExample" (
    "id" TEXT NOT NULL,
    "companyRecordId" TEXT,
    "companyScoreResultId" TEXT,
    "feedbackImportJobId" TEXT,
    "companyName" TEXT NOT NULL,
    "website" TEXT,
    "predictedCompanyScore" INTEGER,
    "predictedCompanyType" "CompanyType",
    "predictedQualification" "Qualification",
    "predictedReason" TEXT,
    "finalCompanyScore" INTEGER NOT NULL,
    "finalCompanyType" "CompanyType" NOT NULL,
    "finalQualification" "Qualification" NOT NULL,
    "finalNote" TEXT,
    "approvedForLearning" BOOLEAN NOT NULL DEFAULT false,
    "useForPromptRefinement" BOOLEAN NOT NULL DEFAULT false,
    "useForRuleTuning" BOOLEAN NOT NULL DEFAULT false,
    "useForModelTraining" BOOLEAN NOT NULL DEFAULT false,
    "useForEvaluationBenchmark" BOOLEAN NOT NULL DEFAULT false,
    "datasetSplit" "DatasetSplit" NOT NULL DEFAULT 'UNSPECIFIED',
    "promptVersion" TEXT,
    "ruleVersion" TEXT,
    "modelVersion" TEXT,
    "source" "FeedbackSource" NOT NULL DEFAULT 'LOCAL_UI',
    "rawExampleJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedbackExample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportJob" (
    "id" TEXT NOT NULL,
    "uploadJobId" TEXT,
    "fileName" TEXT NOT NULL,
    "exportType" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyRecord_website_idx" ON "CompanyRecord"("website");

-- CreateIndex
CREATE INDEX "CompanyRecord_companyName_idx" ON "CompanyRecord"("companyName");

-- CreateIndex
CREATE INDEX "CompanyRecord_uploadJobId_idx" ON "CompanyRecord"("uploadJobId");

-- CreateIndex
CREATE INDEX "CompanyScoreResult_companyRecordId_idx" ON "CompanyScoreResult"("companyRecordId");

-- CreateIndex
CREATE INDEX "CompanyScoreResult_qualification_idx" ON "CompanyScoreResult"("qualification");

-- CreateIndex
CREATE INDEX "CompanyScoreResult_reviewState_idx" ON "CompanyScoreResult"("reviewState");

-- CreateIndex
CREATE INDEX "FeedbackExample_companyName_idx" ON "FeedbackExample"("companyName");

-- CreateIndex
CREATE INDEX "FeedbackExample_website_idx" ON "FeedbackExample"("website");

-- CreateIndex
CREATE INDEX "FeedbackExample_finalQualification_idx" ON "FeedbackExample"("finalQualification");

-- CreateIndex
CREATE INDEX "FeedbackExample_datasetSplit_idx" ON "FeedbackExample"("datasetSplit");

-- CreateIndex
CREATE INDEX "FeedbackExample_approvedForLearning_idx" ON "FeedbackExample"("approvedForLearning");

-- CreateIndex
CREATE INDEX "ExportJob_uploadJobId_idx" ON "ExportJob"("uploadJobId");

-- AddForeignKey
ALTER TABLE "CompanyRecord" ADD CONSTRAINT "CompanyRecord_uploadJobId_fkey" FOREIGN KEY ("uploadJobId") REFERENCES "UploadJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyScoreResult" ADD CONSTRAINT "CompanyScoreResult_companyRecordId_fkey" FOREIGN KEY ("companyRecordId") REFERENCES "CompanyRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackExample" ADD CONSTRAINT "FeedbackExample_companyRecordId_fkey" FOREIGN KEY ("companyRecordId") REFERENCES "CompanyRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackExample" ADD CONSTRAINT "FeedbackExample_companyScoreResultId_fkey" FOREIGN KEY ("companyScoreResultId") REFERENCES "CompanyScoreResult"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackExample" ADD CONSTRAINT "FeedbackExample_feedbackImportJobId_fkey" FOREIGN KEY ("feedbackImportJobId") REFERENCES "FeedbackImportJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_uploadJobId_fkey" FOREIGN KEY ("uploadJobId") REFERENCES "UploadJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
