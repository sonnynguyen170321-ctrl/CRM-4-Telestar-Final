-- V2 research: business-insight enrichment on candidates + the RESEARCH_ENRICH job type.

ALTER TYPE "V2JobType" ADD VALUE IF NOT EXISTS 'RESEARCH_ENRICH';

ALTER TABLE "V2ResearchCandidate"
  ADD COLUMN "insightJson" JSONB,
  ADD COLUMN "enrichedAt" TIMESTAMP(3);
