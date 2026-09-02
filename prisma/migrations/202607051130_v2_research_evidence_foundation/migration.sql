-- V2 Research evidence foundation: provenance and provider ledger before promotion.
-- Additive only; does not change discovery, enrichment, scoring, or promotion semantics.

CREATE TABLE "V2ResearchEvidence" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "runId" TEXT,
  "candidateId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "sourceKind" TEXT NOT NULL,
  "provider" TEXT,
  "sourceUrl" TEXT,
  "sourceTitle" TEXT,
  "sourceSnippet" TEXT,
  "query" TEXT,
  "confidence" INTEGER,
  "evidenceJson" JSONB,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "V2ResearchEvidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "V2ResearchFieldObservation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "evidenceId" TEXT,
  "fieldName" TEXT NOT NULL,
  "valueText" TEXT,
  "valueJson" JSONB,
  "confidence" INTEGER,
  "sourceKind" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "V2ResearchFieldObservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "V2ResearchProviderAttempt" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "runId" TEXT,
  "candidateId" TEXT,
  "stage" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "requestJson" JSONB,
  "responseJson" JSONB,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "V2ResearchProviderAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "V2ResearchEmailPattern" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "pattern" TEXT NOT NULL,
  "confidence" INTEGER NOT NULL DEFAULT 0,
  "sampleCount" INTEGER NOT NULL DEFAULT 0,
  "sourceJson" JSONB,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "V2ResearchEmailPattern_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "V2ResearchEvidence_organizationId_idempotencyKey_key"
  ON "V2ResearchEvidence"("organizationId", "idempotencyKey");
CREATE INDEX "V2ResearchEvidence_organizationId_runId_createdAt_idx"
  ON "V2ResearchEvidence"("organizationId", "runId", "createdAt");
CREATE INDEX "V2ResearchEvidence_organizationId_candidateId_createdAt_idx"
  ON "V2ResearchEvidence"("organizationId", "candidateId", "createdAt");
CREATE INDEX "V2ResearchEvidence_organizationId_sourceKind_idx"
  ON "V2ResearchEvidence"("organizationId", "sourceKind");

CREATE INDEX "V2ResearchFieldObservation_organizationId_candidateId_fieldName_idx"
  ON "V2ResearchFieldObservation"("organizationId", "candidateId", "fieldName");
CREATE INDEX "V2ResearchFieldObservation_organizationId_evidenceId_idx"
  ON "V2ResearchFieldObservation"("organizationId", "evidenceId");

CREATE INDEX "V2ResearchProviderAttempt_organizationId_runId_stage_createdAt_idx"
  ON "V2ResearchProviderAttempt"("organizationId", "runId", "stage", "createdAt");
CREATE INDEX "V2ResearchProviderAttempt_organizationId_candidateId_stage_createdAt_idx"
  ON "V2ResearchProviderAttempt"("organizationId", "candidateId", "stage", "createdAt");
CREATE INDEX "V2ResearchProviderAttempt_organizationId_provider_status_createdAt_idx"
  ON "V2ResearchProviderAttempt"("organizationId", "provider", "status", "createdAt");

CREATE UNIQUE INDEX "V2ResearchEmailPattern_organizationId_domain_pattern_key"
  ON "V2ResearchEmailPattern"("organizationId", "domain", "pattern");
CREATE INDEX "V2ResearchEmailPattern_organizationId_domain_confidence_idx"
  ON "V2ResearchEmailPattern"("organizationId", "domain", "confidence");

ALTER TABLE "V2ResearchEvidence"
  ADD CONSTRAINT "V2ResearchEvidence_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "V2Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "V2ResearchEvidence"
  ADD CONSTRAINT "V2ResearchEvidence_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "V2ResearchRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "V2ResearchEvidence"
  ADD CONSTRAINT "V2ResearchEvidence_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "V2ResearchCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "V2ResearchFieldObservation"
  ADD CONSTRAINT "V2ResearchFieldObservation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "V2Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "V2ResearchFieldObservation"
  ADD CONSTRAINT "V2ResearchFieldObservation_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "V2ResearchCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "V2ResearchFieldObservation"
  ADD CONSTRAINT "V2ResearchFieldObservation_evidenceId_fkey"
  FOREIGN KEY ("evidenceId") REFERENCES "V2ResearchEvidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "V2ResearchProviderAttempt"
  ADD CONSTRAINT "V2ResearchProviderAttempt_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "V2Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "V2ResearchProviderAttempt"
  ADD CONSTRAINT "V2ResearchProviderAttempt_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "V2ResearchRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "V2ResearchProviderAttempt"
  ADD CONSTRAINT "V2ResearchProviderAttempt_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "V2ResearchCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "V2ResearchEmailPattern"
  ADD CONSTRAINT "V2ResearchEmailPattern_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "V2Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;