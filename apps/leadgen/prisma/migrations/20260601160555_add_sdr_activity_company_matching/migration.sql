-- AlterTable
ALTER TABLE "SdrActivityRow" ADD COLUMN     "companyMatchConfidence" INTEGER,
ADD COLUMN     "companyMatchKey" TEXT,
ADD COLUMN     "companyMatchReason" TEXT,
ADD COLUMN     "companyMatchStatus" TEXT,
ADD COLUMN     "matchedCompanyRecordId" TEXT;

-- CreateIndex
CREATE INDEX "SdrActivityRow_matchedCompanyRecordId_idx" ON "SdrActivityRow"("matchedCompanyRecordId");

-- CreateIndex
CREATE INDEX "SdrActivityRow_companyMatchStatus_idx" ON "SdrActivityRow"("companyMatchStatus");

-- CreateIndex
CREATE INDEX "SdrActivityRow_companyMatchConfidence_idx" ON "SdrActivityRow"("companyMatchConfidence");

-- AddForeignKey
ALTER TABLE "SdrActivityRow" ADD CONSTRAINT "SdrActivityRow_matchedCompanyRecordId_fkey" FOREIGN KEY ("matchedCompanyRecordId") REFERENCES "CompanyRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
