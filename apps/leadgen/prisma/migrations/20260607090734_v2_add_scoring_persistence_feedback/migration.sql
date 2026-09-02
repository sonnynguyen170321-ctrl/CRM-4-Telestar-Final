-- CreateEnum
CREATE TYPE "V2Qualification" AS ENUM ('QUALIFIED', 'UNQUALIFIED', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "V2DatasetSplit" AS ENUM ('UNSPECIFIED', 'TRAIN', 'EVAL', 'HOLDOUT');

-- CreateTable
CREATE TABLE "V2HardRuleAssessment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadAssignmentId" TEXT NOT NULL,
    "icpVersionId" TEXT NOT NULL,
    "fitScore" INTEGER NOT NULL,
    "confidence" DECIMAL(3,2) NOT NULL,
    "qualification" "V2Qualification" NOT NULL,
    "companyType" TEXT,
    "reason" TEXT NOT NULL,
    "oneSentenceCompanySummary" TEXT,
    "evidenceSnapshotJson" JSONB,
    "hardGateResultsJson" JSONB,
    "confidenceBreakdownJson" JSONB,
    "dataQualityJson" JSONB,
    "inputFingerprint" TEXT NOT NULL,
    "icpRulesHash" TEXT,
    "scoringSource" TEXT NOT NULL DEFAULT 'local_hard_rules',
    "scoringVersion" TEXT NOT NULL,
    "previousAssessmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "V2HardRuleAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "V2AiInsight" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadAssignmentId" TEXT NOT NULL,
    "icpVersionId" TEXT NOT NULL,
    "hardRuleAssessmentId" TEXT,
    "generatedByUserId" TEXT,
    "provider" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'manual',
    "summary" TEXT,
    "qualification" "V2Qualification",
    "companyType" TEXT,
    "fitScore" INTEGER,
    "confidence" DECIMAL(3,2),
    "reason" TEXT,
    "recommendedNextAction" TEXT,
    "inputSnapshotJson" JSONB,
    "evidenceSnapshotJson" JSONB,
    "rawResponseJson" JSONB,
    "finishReason" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER,
    "errorMessage" TEXT,
    "inputFingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "V2AiInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "V2FeedbackExample" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadAssignmentId" TEXT NOT NULL,
    "icpVersionId" TEXT NOT NULL,
    "hardRuleAssessmentId" TEXT,
    "aiInsightId" TEXT,
    "reviewedByUserId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual_review',
    "predictedFitScore" INTEGER,
    "predictedQualification" "V2Qualification",
    "predictedCompanyType" TEXT,
    "predictedReason" TEXT,
    "finalFitScore" INTEGER,
    "finalQualification" "V2Qualification" NOT NULL,
    "finalCompanyType" TEXT,
    "finalReason" TEXT,
    "correctionJson" JSONB,
    "evidenceJson" JSONB,
    "rawExampleJson" JSONB,
    "approvedForLearning" BOOLEAN NOT NULL DEFAULT false,
    "datasetSplit" "V2DatasetSplit" NOT NULL DEFAULT 'UNSPECIFIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "V2FeedbackExample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "V2HardRuleAssessment_organizationId_idx" ON "V2HardRuleAssessment"("organizationId");

-- CreateIndex
CREATE INDEX "V2HardRuleAssessment_leadAssignmentId_createdAt_idx" ON "V2HardRuleAssessment"("leadAssignmentId", "createdAt");

-- CreateIndex
CREATE INDEX "V2HardRuleAssessment_icpVersionId_idx" ON "V2HardRuleAssessment"("icpVersionId");

-- CreateIndex
CREATE INDEX "V2HardRuleAssessment_qualification_idx" ON "V2HardRuleAssessment"("qualification");

-- CreateIndex
CREATE INDEX "V2HardRuleAssessment_inputFingerprint_idx" ON "V2HardRuleAssessment"("inputFingerprint");

-- CreateIndex
CREATE INDEX "V2HardRuleAssessment_previousAssessmentId_idx" ON "V2HardRuleAssessment"("previousAssessmentId");

-- CreateIndex
CREATE INDEX "V2HardRuleAssessment_createdAt_idx" ON "V2HardRuleAssessment"("createdAt");

-- CreateIndex
CREATE INDEX "V2AiInsight_organizationId_idx" ON "V2AiInsight"("organizationId");

-- CreateIndex
CREATE INDEX "V2AiInsight_leadAssignmentId_createdAt_idx" ON "V2AiInsight"("leadAssignmentId", "createdAt");

-- CreateIndex
CREATE INDEX "V2AiInsight_icpVersionId_idx" ON "V2AiInsight"("icpVersionId");

-- CreateIndex
CREATE INDEX "V2AiInsight_hardRuleAssessmentId_idx" ON "V2AiInsight"("hardRuleAssessmentId");

-- CreateIndex
CREATE INDEX "V2AiInsight_generatedByUserId_idx" ON "V2AiInsight"("generatedByUserId");

-- CreateIndex
CREATE INDEX "V2AiInsight_provider_modelName_promptVersion_idx" ON "V2AiInsight"("provider", "modelName", "promptVersion");

-- CreateIndex
CREATE INDEX "V2AiInsight_inputFingerprint_idx" ON "V2AiInsight"("inputFingerprint");

-- CreateIndex
CREATE INDEX "V2AiInsight_createdAt_idx" ON "V2AiInsight"("createdAt");

-- CreateIndex
CREATE INDEX "V2FeedbackExample_organizationId_idx" ON "V2FeedbackExample"("organizationId");

-- CreateIndex
CREATE INDEX "V2FeedbackExample_leadAssignmentId_createdAt_idx" ON "V2FeedbackExample"("leadAssignmentId", "createdAt");

-- CreateIndex
CREATE INDEX "V2FeedbackExample_icpVersionId_idx" ON "V2FeedbackExample"("icpVersionId");

-- CreateIndex
CREATE INDEX "V2FeedbackExample_hardRuleAssessmentId_idx" ON "V2FeedbackExample"("hardRuleAssessmentId");

-- CreateIndex
CREATE INDEX "V2FeedbackExample_aiInsightId_idx" ON "V2FeedbackExample"("aiInsightId");

-- CreateIndex
CREATE INDEX "V2FeedbackExample_reviewedByUserId_idx" ON "V2FeedbackExample"("reviewedByUserId");

-- CreateIndex
CREATE INDEX "V2FeedbackExample_finalQualification_idx" ON "V2FeedbackExample"("finalQualification");

-- CreateIndex
CREATE INDEX "V2FeedbackExample_approvedForLearning_idx" ON "V2FeedbackExample"("approvedForLearning");

-- CreateIndex
CREATE INDEX "V2FeedbackExample_datasetSplit_idx" ON "V2FeedbackExample"("datasetSplit");

-- CreateIndex
CREATE INDEX "V2FeedbackExample_source_idx" ON "V2FeedbackExample"("source");

-- CreateIndex
CREATE INDEX "V2FeedbackExample_createdAt_idx" ON "V2FeedbackExample"("createdAt");

-- AddForeignKey
ALTER TABLE "V2HardRuleAssessment" ADD CONSTRAINT "V2HardRuleAssessment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "V2Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2HardRuleAssessment" ADD CONSTRAINT "V2HardRuleAssessment_leadAssignmentId_fkey" FOREIGN KEY ("leadAssignmentId") REFERENCES "V2LeadAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2HardRuleAssessment" ADD CONSTRAINT "V2HardRuleAssessment_icpVersionId_fkey" FOREIGN KEY ("icpVersionId") REFERENCES "V2ICPVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2HardRuleAssessment" ADD CONSTRAINT "V2HardRuleAssessment_previousAssessmentId_fkey" FOREIGN KEY ("previousAssessmentId") REFERENCES "V2HardRuleAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2AiInsight" ADD CONSTRAINT "V2AiInsight_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "V2Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2AiInsight" ADD CONSTRAINT "V2AiInsight_leadAssignmentId_fkey" FOREIGN KEY ("leadAssignmentId") REFERENCES "V2LeadAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2AiInsight" ADD CONSTRAINT "V2AiInsight_icpVersionId_fkey" FOREIGN KEY ("icpVersionId") REFERENCES "V2ICPVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2AiInsight" ADD CONSTRAINT "V2AiInsight_hardRuleAssessmentId_fkey" FOREIGN KEY ("hardRuleAssessmentId") REFERENCES "V2HardRuleAssessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2AiInsight" ADD CONSTRAINT "V2AiInsight_generatedByUserId_fkey" FOREIGN KEY ("generatedByUserId") REFERENCES "V2User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2FeedbackExample" ADD CONSTRAINT "V2FeedbackExample_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "V2Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2FeedbackExample" ADD CONSTRAINT "V2FeedbackExample_leadAssignmentId_fkey" FOREIGN KEY ("leadAssignmentId") REFERENCES "V2LeadAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2FeedbackExample" ADD CONSTRAINT "V2FeedbackExample_icpVersionId_fkey" FOREIGN KEY ("icpVersionId") REFERENCES "V2ICPVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2FeedbackExample" ADD CONSTRAINT "V2FeedbackExample_hardRuleAssessmentId_fkey" FOREIGN KEY ("hardRuleAssessmentId") REFERENCES "V2HardRuleAssessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2FeedbackExample" ADD CONSTRAINT "V2FeedbackExample_aiInsightId_fkey" FOREIGN KEY ("aiInsightId") REFERENCES "V2AiInsight"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2FeedbackExample" ADD CONSTRAINT "V2FeedbackExample_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "V2User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
