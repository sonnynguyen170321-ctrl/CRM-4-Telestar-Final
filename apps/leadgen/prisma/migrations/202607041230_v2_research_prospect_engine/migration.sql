-- V2 research prospect engine: run-local candidates + resumable query batches.
ALTER TABLE "V2ResearchRun"
  ADD COLUMN "paramsJson" JSONB,
  ADD COLUMN "queryCursor" INTEGER NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS "V2ResearchCandidate_organizationId_dedupeFingerprint_key";
CREATE UNIQUE INDEX "V2ResearchCandidate_organizationId_runId_dedupeFingerprint_key"
  ON "V2ResearchCandidate"("organizationId", "runId", "dedupeFingerprint");
CREATE INDEX "V2ResearchCandidate_organizationId_dedupeFingerprint_idx"
  ON "V2ResearchCandidate"("organizationId", "dedupeFingerprint");
