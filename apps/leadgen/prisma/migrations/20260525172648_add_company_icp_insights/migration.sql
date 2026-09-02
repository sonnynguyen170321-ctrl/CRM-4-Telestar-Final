-- CreateTable
CREATE TABLE "CompanyIcpInsight" (
    "id" TEXT NOT NULL,
    "companyRecordId" TEXT NOT NULL,
    "targetCustomerSegment" TEXT,
    "targetVerticalsJson" JSONB,
    "buyerPersonasJson" JSONB,
    "useCasesPainPointsJson" JSONB,
    "sdrMessagingAngle" TEXT,
    "confidence" DOUBLE PRECISION,
    "evidenceNote" TEXT,
    "source" TEXT NOT NULL,
    "provider" TEXT,
    "modelName" TEXT,
    "promptVersion" TEXT,
    "rawAiResponseJson" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyIcpInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyIcpInsight_companyRecordId_createdAt_idx" ON "CompanyIcpInsight"("companyRecordId", "createdAt");

-- CreateIndex
CREATE INDEX "CompanyIcpInsight_source_idx" ON "CompanyIcpInsight"("source");

-- CreateIndex
CREATE INDEX "CompanyIcpInsight_provider_modelName_promptVersion_idx" ON "CompanyIcpInsight"("provider", "modelName", "promptVersion");

-- AddForeignKey
ALTER TABLE "CompanyIcpInsight" ADD CONSTRAINT "CompanyIcpInsight_companyRecordId_fkey" FOREIGN KEY ("companyRecordId") REFERENCES "CompanyRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
