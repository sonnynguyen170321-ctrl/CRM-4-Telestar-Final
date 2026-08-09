-- Prospect operating state: who or what should be acting on this prospect right now.
--
-- A third axis, deliberately. Lead.stage is the sales process, SequenceEnrollment.status is
-- cadence execution, and neither answers "who owns this". After a meaningful reply all three
-- differ: replied / paused+reply / human_managed.

CREATE TYPE "ProspectOperatingState" AS ENUM (
    'unassigned',
    'researching',
    'ready_for_outreach',
    'ai_managed',
    'human_attention',
    'human_managed',
    'waiting_for_prospect',
    'reengagement_eligible',
    'ai_reengagement',
    'completed'
);

ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'prospect_handed_off';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'prospect_reengagement_eligible';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'prospect_handed_back';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'prospect_ai_reengagement_started';

ALTER TABLE "Lead"
    ADD COLUMN "operatingState" "ProspectOperatingState" NOT NULL DEFAULT 'unassigned',
    ADD COLUMN "operatingStateAt" TIMESTAMP(3);

-- Backfill from state the CRM already holds, most specific first. Deliberately conservative:
-- a lead is only called human_managed where the sales stage says a human is already in the
-- conversation. Everything unclassified stays 'unassigned' rather than being guessed into an
-- AI-owned state, because an over-eager backfill would hand prospects to automation that no
-- one decided to automate.
UPDATE "Lead" SET "operatingState" = 'completed', "operatingStateAt" = NOW()
    WHERE "stage" IN ('won', 'lost');

UPDATE "Lead" SET "operatingState" = 'human_managed', "operatingStateAt" = NOW()
    WHERE "stage" IN ('replied', 'meeting_booked') AND "operatingState" = 'unassigned';

UPDATE "Lead" SET "operatingState" = 'ai_managed', "operatingStateAt" = NOW()
    WHERE "operatingState" = 'unassigned'
      AND EXISTS (
        SELECT 1 FROM "SequenceEnrollment" e
        WHERE e."leadId" = "Lead"."id" AND e."status" = 'active'
      );

CREATE INDEX "Lead_operatingState_idx" ON "Lead"("operatingState");
CREATE INDEX "Lead_tenantId_operatingState_idx" ON "Lead"("tenantId", "operatingState");

-- The idempotency ledger. Activity remains the audit trail; this exists because idempotency
-- needs a unique constraint and a JSON metadata field cannot carry one.
CREATE TABLE "ProspectTransition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "transitionKey" TEXT NOT NULL,
    "fromState" "ProspectOperatingState" NOT NULL,
    "toState" "ProspectOperatingState" NOT NULL,
    "actorUserId" TEXT,
    "workOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProspectTransition_pkey" PRIMARY KEY ("id")
);

-- The key identifies one occurrence, never just (lead, kind): a prospect legitimately moves
-- AI -> human -> AI -> human, and a coarser key would permanently block the second genuine
-- handoff.
CREATE UNIQUE INDEX "ProspectTransition_tenantId_transitionKey_key"
    ON "ProspectTransition"("tenantId", "transitionKey");
CREATE INDEX "ProspectTransition_leadId_createdAt_idx" ON "ProspectTransition"("leadId", "createdAt");
CREATE INDEX "ProspectTransition_tenantId_kind_idx" ON "ProspectTransition"("tenantId", "kind");

ALTER TABLE "ProspectTransition" ADD CONSTRAINT "ProspectTransition_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProspectTransition" ADD CONSTRAINT "ProspectTransition_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
