-- CreateTable
CREATE TABLE "WebsiteResearchResult" (
    "id" TEXT NOT NULL,
    "companyRecordId" TEXT,
    "uploadJobId" TEXT,
    "inputUrl" TEXT NOT NULL,
    "normalizedUrl" TEXT,
    "normalizedDomain" TEXT,
    "finalUrl" TEXT,
    "reachable" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "quality" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "signalsJson" JSONB NOT NULL,
    "classificationHintsJson" JSONB NOT NULL,
    "pagesCheckedJson" JSONB NOT NULL,
    "errorsJson" JSONB NOT NULL,
    "redirectChainJson" JSONB NOT NULL,
    "researchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebsiteResearchResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebsiteResearchResult_companyRecordId_idx" ON "WebsiteResearchResult"("companyRecordId");

-- CreateIndex
CREATE INDEX "WebsiteResearchResult_uploadJobId_idx" ON "WebsiteResearchResult"("uploadJobId");

-- CreateIndex
CREATE INDEX "WebsiteResearchResult_normalizedDomain_idx" ON "WebsiteResearchResult"("normalizedDomain");

-- CreateIndex
CREATE INDEX "WebsiteResearchResult_status_idx" ON "WebsiteResearchResult"("status");

-- CreateIndex
CREATE INDEX "WebsiteResearchResult_quality_idx" ON "WebsiteResearchResult"("quality");

-- CreateIndex
CREATE INDEX "WebsiteResearchResult_researchedAt_idx" ON "WebsiteResearchResult"("researchedAt");

-- AddForeignKey
ALTER TABLE "WebsiteResearchResult" ADD CONSTRAINT "WebsiteResearchResult_companyRecordId_fkey" FOREIGN KEY ("companyRecordId") REFERENCES "CompanyRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteResearchResult" ADD CONSTRAINT "WebsiteResearchResult_uploadJobId_fkey" FOREIGN KEY ("uploadJobId") REFERENCES "UploadJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
