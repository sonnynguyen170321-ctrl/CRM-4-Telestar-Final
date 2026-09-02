-- Add predicted company type to persisted score results.
-- Existing score results are backfilled conservatively as Not Relevant.
ALTER TABLE "CompanyScoreResult"
ADD COLUMN "companyType" "CompanyType" NOT NULL DEFAULT 'Not Relevant';

CREATE INDEX "CompanyScoreResult_companyType_idx" ON "CompanyScoreResult"("companyType");
