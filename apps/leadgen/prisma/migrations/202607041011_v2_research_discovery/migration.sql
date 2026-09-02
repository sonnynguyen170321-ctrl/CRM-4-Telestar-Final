-- ICP-driven prospect discovery (/v2/research). Additive only.
ALTER TYPE "V2JobType" ADD VALUE IF NOT EXISTS 'RESEARCH_DISCOVERY';

CREATE TYPE "V2ResearchRunKind" AS ENUM ('COMPANY', 'CONTACT');
CREATE TYPE "V2ResearchRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "V2ResearchCandidateStatus" AS ENUM ('DISCOVERED', 'DUPLICATE', 'PROMOTED', 'DISMISSED');

CREATE TABLE "V2ResearchRun" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "icpVersionId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "kind" "V2ResearchRunKind" NOT NULL,
  "status" "V2ResearchRunStatus" NOT NULL DEFAULT 'QUEUED',
  "queriesJson" JSONB NOT NULL,
  "discoveredCount" INTEGER NOT NULL DEFAULT 0,
  "duplicateCount" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "createdByUserId" TEXT,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "V2ResearchRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "V2ResearchRun_organizationId_createdAt_idx" ON "V2ResearchRun"("organizationId", "createdAt");
CREATE INDEX "V2ResearchRun_organizationId_status_idx" ON "V2ResearchRun"("organizationId", "status");
CREATE INDEX "V2ResearchRun_deletedAt_idx" ON "V2ResearchRun"("deletedAt");
ALTER TABLE "V2ResearchRun" ADD CONSTRAINT "V2ResearchRun_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "V2Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "V2ResearchCandidate" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "kind" "V2ResearchRunKind" NOT NULL,
  "name" TEXT NOT NULL,
  "domain" TEXT,
  "linkedinUrl" TEXT,
  "title" TEXT,
  "companyName" TEXT,
  "sourceJson" JSONB NOT NULL,
  "matchHintsJson" JSONB NOT NULL,
  "dedupeFingerprint" TEXT NOT NULL,
  "status" "V2ResearchCandidateStatus" NOT NULL DEFAULT 'DISCOVERED',
  "promotedCompanyId" TEXT,
  "promotedContactId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "V2ResearchCandidate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "V2ResearchCandidate_organizationId_dedupeFingerprint_key" ON "V2ResearchCandidate"("organizationId", "dedupeFingerprint");
CREATE INDEX "V2ResearchCandidate_organizationId_runId_status_idx" ON "V2ResearchCandidate"("organizationId", "runId", "status");
CREATE INDEX "V2ResearchCandidate_deletedAt_idx" ON "V2ResearchCandidate"("deletedAt");
ALTER TABLE "V2ResearchCandidate" ADD CONSTRAINT "V2ResearchCandidate_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "V2Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "V2ResearchCandidate" ADD CONSTRAINT "V2ResearchCandidate_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "V2ResearchRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
