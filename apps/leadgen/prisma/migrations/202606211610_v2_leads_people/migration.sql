-- Contacts & Leads people layer (mock parity). Additive + nullable only; no backfill,
-- non-destructive. Contact location, Lead notes, and Tasks/next-action.

-- Contact location (drawer header).
ALTER TABLE "V2Contact" ADD COLUMN IF NOT EXISTS "city" TEXT;
ALTER TABLE "V2Contact" ADD COLUMN IF NOT EXISTS "country" TEXT;

-- Task status enum.
DO $$ BEGIN
  CREATE TYPE "V2TaskStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Free-text notes on a LeadAssignment.
CREATE TABLE IF NOT EXISTS "V2LeadNote" (
  "id"               TEXT NOT NULL,
  "organizationId"   TEXT NOT NULL,
  "leadAssignmentId" TEXT NOT NULL,
  "authorUserId"     TEXT,
  "body"             TEXT NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"        TIMESTAMP(3),
  CONSTRAINT "V2LeadNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "V2LeadNote_org_lead_time_idx"
  ON "V2LeadNote" ("organizationId", "leadAssignmentId", "createdAt");
CREATE INDEX IF NOT EXISTS "V2LeadNote_deletedAt_idx" ON "V2LeadNote" ("deletedAt");

-- Follow-up tasks / next actions on a LeadAssignment.
CREATE TABLE IF NOT EXISTS "V2Task" (
  "id"               TEXT NOT NULL,
  "organizationId"   TEXT NOT NULL,
  "leadAssignmentId" TEXT NOT NULL,
  "contactId"        TEXT,
  "title"            TEXT NOT NULL,
  "detail"           TEXT,
  "dueAt"            TIMESTAMP(3),
  "status"           "V2TaskStatus" NOT NULL DEFAULT 'OPEN',
  "ownerUserId"      TEXT,
  "createdByUserId"  TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"      TIMESTAMP(3),
  "deletedAt"        TIMESTAMP(3),
  CONSTRAINT "V2Task_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "V2Task_org_owner_status_due_idx"
  ON "V2Task" ("organizationId", "ownerUserId", "status", "dueAt");
CREATE INDEX IF NOT EXISTS "V2Task_org_lead_status_idx"
  ON "V2Task" ("organizationId", "leadAssignmentId", "status");
CREATE INDEX IF NOT EXISTS "V2Task_deletedAt_idx" ON "V2Task" ("deletedAt");
