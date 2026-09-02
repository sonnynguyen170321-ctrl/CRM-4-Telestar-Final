-- M1 lead ownership: assign a lead (LeadAssignment, never a global company — Inv 2)
-- to an SDR. Additive + nullable only (no backfill, existing leads stay
-- unassigned). ownerUserId/assignedByUserId are soft FKs (app-validated as active
-- org members), distinct from workflowStatus + qualification (Inv 3).

ALTER TABLE "V2LeadAssignment" ADD COLUMN IF NOT EXISTS "ownerUserId" TEXT;
ALTER TABLE "V2LeadAssignment" ADD COLUMN IF NOT EXISTS "assignedAt" TIMESTAMP(3);
ALTER TABLE "V2LeadAssignment" ADD COLUMN IF NOT EXISTS "assignedByUserId" TEXT;

-- Supports the "my leads" / "team" / "unassigned" queues (owner + workflow filter).
CREATE INDEX IF NOT EXISTS "V2LeadAssignment_org_owner_workflow_idx"
  ON "V2LeadAssignment" ("organizationId", "ownerUserId", "workflowStatus");
