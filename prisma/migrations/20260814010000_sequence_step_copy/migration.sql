-- Approved, prospect-facing copy for one step of one enrollment occurrence.
--
-- Personalization is prepared and approved at design time and stored here; the sequence worker
-- reads it at execution. Nothing in the send path calls an AI provider, so an outage cannot
-- change what an already-approved cadence sends.
--
-- Additive: a step with no row here falls back to its shared Template exactly as before.
CREATE TABLE "SequenceStepCopy" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "citedEvidenceIds" TEXT[],
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "SequenceStepCopy_pkey" PRIMARY KEY ("id")
);

-- One approved copy per step of a cadence. The unique key is also what makes materialization
-- idempotent: a retried approval collides rather than writing a second body for the same step.
CREATE UNIQUE INDEX "SequenceStepCopy_enrollmentId_stepOrder_key"
    ON "SequenceStepCopy"("enrollmentId", "stepOrder");

CREATE INDEX "SequenceStepCopy_tenantId_idx" ON "SequenceStepCopy"("tenantId");

ALTER TABLE "SequenceStepCopy"
    ADD CONSTRAINT "SequenceStepCopy_enrollmentId_fkey"
    FOREIGN KEY ("enrollmentId") REFERENCES "SequenceEnrollment"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SequenceStepCopy"
    ADD CONSTRAINT "SequenceStepCopy_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SequenceStepCopy"
    ADD CONSTRAINT "SequenceStepCopy_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
