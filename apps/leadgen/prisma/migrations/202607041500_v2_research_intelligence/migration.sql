-- V2 research intelligence: ICP-fit scoring, translation, contact-data columns on candidates,
-- plus a durable per-org prospect ledger for researched-date + cross-run recency dedupe.

ALTER TABLE "V2ResearchCandidate"
  ADD COLUMN "fitScore" INTEGER,
  ADD COLUMN "fitReason" TEXT,
  ADD COLUMN "fitSource" TEXT,
  ADD COLUMN "location" TEXT,
  ADD COLUMN "translatedName" TEXT,
  ADD COLUMN "translatedSnippet" TEXT,
  ADD COLUMN "emailGuess" TEXT,
  ADD COLUMN "emailStatus" TEXT,
  ADD COLUMN "phone" TEXT;

CREATE INDEX "V2ResearchCandidate_organizationId_runId_fitScore_idx"
  ON "V2ResearchCandidate"("organizationId", "runId", "fitScore");

CREATE TABLE "V2ResearchProspect" (
  "id"                TEXT NOT NULL,
  "organizationId"    TEXT NOT NULL,
  "kind"              "V2ResearchRunKind" NOT NULL,
  "dedupeFingerprint" TEXT NOT NULL,
  "domain"            TEXT,
  "linkedinUrl"       TEXT,
  "displayName"       TEXT NOT NULL,
  "firstSeenAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "timesSeen"         INTEGER NOT NULL DEFAULT 1,
  "lastRunId"         TEXT,
  "promotedCompanyId" TEXT,
  "promotedContactId" TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  "deletedAt"         TIMESTAMP(3),
  CONSTRAINT "V2ResearchProspect_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "V2ResearchProspect_organizationId_dedupeFingerprint_key"
  ON "V2ResearchProspect"("organizationId", "dedupeFingerprint");
CREATE INDEX "V2ResearchProspect_organizationId_domain_idx"
  ON "V2ResearchProspect"("organizationId", "domain");
CREATE INDEX "V2ResearchProspect_organizationId_linkedinUrl_idx"
  ON "V2ResearchProspect"("organizationId", "linkedinUrl");
CREATE INDEX "V2ResearchProspect_organizationId_lastSeenAt_idx"
  ON "V2ResearchProspect"("organizationId", "lastSeenAt");
CREATE INDEX "V2ResearchProspect_deletedAt_idx"
  ON "V2ResearchProspect"("deletedAt");

ALTER TABLE "V2ResearchProspect"
  ADD CONSTRAINT "V2ResearchProspect_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "V2Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
