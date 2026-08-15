-- Phase 8a — durable launch state for AI outreach activation.
--
-- Two things this table exists to make provable rather than inferred:
--
--   1. WHICH work order created an enrollment. An active enrollment on a lead says nothing about
--      its origin — the authenticated enroll route calls the same domain service — so a resume
--      must match on `workOrderId` and the `enrollmentId` this launch recorded.
--   2. HOW FAR a launch got. The writes cannot share a transaction (Neon HTTP has no interactive
--      transactions), so `stage` lets a retry resume instead of inferring completion from the
--      existence of a Task.
--
-- Tenant-owned: an RLS-enabled deployment must reapply `supabase/rls.sql` after this migration
-- (docs/DEPLOY.md §9). The file derives its table list from the catalog, so no edit is needed.
CREATE TABLE "SequenceLaunch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "taskId" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'claimed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SequenceLaunch_pkey" PRIMARY KEY ("id")
);

-- One launch per work order. This is the constraint that makes two concurrent finalizers of the
-- same order collide instead of both proceeding.
CREATE UNIQUE INDEX "SequenceLaunch_tenantId_workOrderId_key" ON "SequenceLaunch"("tenantId", "workOrderId");
CREATE INDEX "SequenceLaunch_tenantId_idx" ON "SequenceLaunch"("tenantId");
CREATE INDEX "SequenceLaunch_tenantId_leadId_idx" ON "SequenceLaunch"("tenantId", "leadId");
CREATE INDEX "SequenceLaunch_tenantId_leadId_sequenceId_idx" ON "SequenceLaunch"("tenantId", "leadId", "sequenceId");

ALTER TABLE "SequenceLaunch" ADD CONSTRAINT "SequenceLaunch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SequenceLaunch" ADD CONSTRAINT "SequenceLaunch_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SequenceLaunch" ADD CONSTRAINT "SequenceLaunch_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SequenceLaunch" ADD CONSTRAINT "SequenceLaunch_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
