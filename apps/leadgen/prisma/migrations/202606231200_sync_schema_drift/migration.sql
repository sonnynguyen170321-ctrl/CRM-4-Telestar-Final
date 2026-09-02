-- P0.4 schema-drift reconcile. schema.prisma + the generated client had drifted ahead
-- of the migration history (project-refactor + client-account fields were applied via
-- `db push`, never migrated), so every deploy-based DB was MISSING real columns/tables
-- and the projects feature broke at runtime. This migration adds exactly what was
-- missing (V2ProjectStage enum, V2Project + V2ClientAccount columns, V2ProjectTeamMember
-- table, their FKs/indexes) plus the cosmetic index renames + @updatedAt default drops
-- Prisma expects. Written IDEMPOTENTLY (IF NOT EXISTS / guarded DO blocks) so it is a
-- no-op on machines that already have the schema (db push) and a real fix elsewhere.

-- Enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'V2ProjectStage') THEN
    CREATE TYPE "V2ProjectStage" AS ENUM ('PLANNING', 'IN_PROGRESS', 'PAUSED', 'COMPLETED');
  END IF;
END $$;

-- @updatedAt is app-managed; drop the DB default to match Prisma (no-op if absent).
ALTER TABLE "V2AiModel" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "V2AiProviderConfig" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "V2AiRateLimit" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "V2AiSettings" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "V2AiUsageDaily" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "V2LeadNote" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "V2Task" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- V2ClientAccount columns
ALTER TABLE "V2ClientAccount" ADD COLUMN IF NOT EXISTS "industry" TEXT;
ALTER TABLE "V2ClientAccount" ADD COLUMN IF NOT EXISTS "ownerUserId" TEXT;
ALTER TABLE "V2ClientAccount" ADD COLUMN IF NOT EXISTS "region" TEXT;

-- V2Project columns
ALTER TABLE "V2Project" ADD COLUMN IF NOT EXISTS "endDate" TIMESTAMP(3);
ALTER TABLE "V2Project" ADD COLUMN IF NOT EXISTS "ownerUserId" TEXT;
ALTER TABLE "V2Project" ADD COLUMN IF NOT EXISTS "stage" "V2ProjectStage" NOT NULL DEFAULT 'PLANNING';
ALTER TABLE "V2Project" ADD COLUMN IF NOT EXISTS "startDate" TIMESTAMP(3);

-- V2ProjectTeamMember table
CREATE TABLE IF NOT EXISTS "V2ProjectTeamMember" (
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "V2ProjectTeamMember_pkey" PRIMARY KEY ("projectId", "userId")
);

CREATE INDEX IF NOT EXISTS "V2ProjectTeamMember_organizationId_idx" ON "V2ProjectTeamMember"("organizationId");
CREATE INDEX IF NOT EXISTS "V2ProjectTeamMember_createdAt_idx" ON "V2ProjectTeamMember"("createdAt");
CREATE INDEX IF NOT EXISTS "V2ClientAccount_ownerUserId_idx" ON "V2ClientAccount"("ownerUserId");

-- Foreign keys (guarded by constraint name)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'V2ClientAccount_ownerUserId_fkey') THEN
    ALTER TABLE "V2ClientAccount" ADD CONSTRAINT "V2ClientAccount_ownerUserId_fkey"
      FOREIGN KEY ("ownerUserId") REFERENCES "V2User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'V2Project_ownerUserId_fkey') THEN
    ALTER TABLE "V2Project" ADD CONSTRAINT "V2Project_ownerUserId_fkey"
      FOREIGN KEY ("ownerUserId") REFERENCES "V2User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'V2ProjectTeamMember_projectId_fkey') THEN
    ALTER TABLE "V2ProjectTeamMember" ADD CONSTRAINT "V2ProjectTeamMember_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "V2Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'V2ProjectTeamMember_userId_fkey') THEN
    ALTER TABLE "V2ProjectTeamMember" ADD CONSTRAINT "V2ProjectTeamMember_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "V2User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'V2ProjectTeamMember_organizationId_fkey') THEN
    ALTER TABLE "V2ProjectTeamMember" ADD CONSTRAINT "V2ProjectTeamMember_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "V2Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Index renames (map: -> convention). Only rename when the old name exists and the new
-- one does not, so this is a no-op on db-push machines that already use the new names.
DO $$
DECLARE
  renames TEXT[][] := ARRAY[
    ['V2AiModel_org_active_idx', 'V2AiModel_organizationId_active_idx'],
    ['V2AiModel_org_provider_modelId_key', 'V2AiModel_organizationId_provider_modelId_key'],
    ['V2AiProviderConfig_org_provider_key', 'V2AiProviderConfig_organizationId_provider_key'],
    ['V2AiRateLimit_org_provider_key', 'V2AiRateLimit_organizationId_provider_key'],
    ['V2AiRunLog_org_provider_time_idx', 'V2AiRunLog_organizationId_provider_createdAt_idx'],
    ['V2AiRunLog_org_status_time_idx', 'V2AiRunLog_organizationId_status_createdAt_idx'],
    ['V2AiRunLog_org_time_idx', 'V2AiRunLog_organizationId_createdAt_idx'],
    ['V2AiUsageDaily_org_date_idx', 'V2AiUsageDaily_organizationId_usageDate_idx'],
    ['V2AiUsageDaily_org_date_provider_model_key', 'V2AiUsageDaily_organizationId_usageDate_provider_modelId_key'],
    ['V2LeadNote_org_lead_time_idx', 'V2LeadNote_organizationId_leadAssignmentId_createdAt_idx'],
    ['V2Task_org_lead_status_idx', 'V2Task_organizationId_leadAssignmentId_status_idx'],
    ['V2Task_org_owner_status_due_idx', 'V2Task_organizationId_ownerUserId_status_dueAt_idx']
  ];
  r TEXT[];
BEGIN
  FOREACH r SLICE 1 IN ARRAY renames LOOP
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = r[1])
       AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = r[2]) THEN
      EXECUTE format('ALTER INDEX %I RENAME TO %I', r[1], r[2]);
    END IF;
  END LOOP;
END $$;
