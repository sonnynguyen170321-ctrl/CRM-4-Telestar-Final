-- Opportunity / Deal pipeline (Priority item 2)

-- ─── Enums ───────────────────────────────────────────────────────────────────

CREATE TYPE "OpportunityStage" AS ENUM ('pending_client_review', 'accepted_by_client', 'discovery', 'proposal', 'negotiation', 'won', 'lost', 'nurture');
CREATE TYPE "OpportunityStatus" AS ENUM ('open', 'won', 'lost', 'rejected', 'archived');
CREATE TYPE "HandoffStatus" AS ENUM ('pending', 'accepted', 'rejected', 'needs_more_info');
CREATE TYPE "OpportunitySource" AS ENUM ('meeting_outcome', 'manual', 'import');
CREATE TYPE "LostReason" AS ENUM ('no_budget', 'no_authority', 'no_need', 'no_timeline', 'wrong_icp', 'wrong_persona', 'duplicate', 'competitor', 'unresponsive', 'client_rejected', 'other');
CREATE TYPE "OpportunityActivityType" AS ENUM ('created', 'stage_changed', 'value_updated', 'handoff_submitted', 'client_accepted', 'client_rejected', 'note_added', 'next_step_updated', 'closed_won', 'closed_lost');

-- ─── Opportunity ─────────────────────────────────────────────────────────────

CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "leadId" TEXT,
    "accountId" TEXT,
    "contactId" TEXT,
    "meetingId" TEXT,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "contactTitle" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "source" "OpportunitySource" NOT NULL DEFAULT 'meeting_outcome',
    "stage" "OpportunityStage" NOT NULL DEFAULT 'pending_client_review',
    "status" "OpportunityStatus" NOT NULL DEFAULT 'open',
    "handoffStatus" "HandoffStatus" NOT NULL DEFAULT 'pending',
    "value" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "probability" INTEGER NOT NULL DEFAULT 10,
    "expectedCloseDate" TIMESTAMPTZ,
    "clientOwnerName" TEXT,
    "clientOwnerEmail" TEXT,
    "externalCrmName" TEXT,
    "externalCrmUrl" TEXT,
    "externalDealId" TEXT,
    "qualificationSummary" TEXT,
    "painPoints" TEXT,
    "prospectNeed" TEXT,
    "budgetNotes" TEXT,
    "authorityNotes" TEXT,
    "timelineNotes" TEXT,
    "nextStep" TEXT,
    "nextStepAt" TIMESTAMPTZ,
    "clientFeedback" TEXT,
    "lostReason" "LostReason",
    "lostReasonDetails" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "closedAt" TIMESTAMPTZ,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Opportunity_meetingId_key" ON "Opportunity"("meetingId");
CREATE INDEX "Opportunity_tenantId_idx" ON "Opportunity"("tenantId");
CREATE INDEX "Opportunity_clientId_idx" ON "Opportunity"("clientId");
CREATE INDEX "Opportunity_campaignId_idx" ON "Opportunity"("campaignId");
CREATE INDEX "Opportunity_leadId_idx" ON "Opportunity"("leadId");
CREATE INDEX "Opportunity_accountId_idx" ON "Opportunity"("accountId");
CREATE INDEX "Opportunity_contactId_idx" ON "Opportunity"("contactId");
CREATE INDEX "Opportunity_ownerId_idx" ON "Opportunity"("ownerId");
CREATE INDEX "Opportunity_stage_idx" ON "Opportunity"("stage");
CREATE INDEX "Opportunity_status_idx" ON "Opportunity"("status");
CREATE INDEX "Opportunity_handoffStatus_idx" ON "Opportunity"("handoffStatus");
CREATE INDEX "Opportunity_expectedCloseDate_idx" ON "Opportunity"("expectedCloseDate");
CREATE INDEX "Opportunity_tenantId_stage_idx" ON "Opportunity"("tenantId", "stage");
CREATE INDEX "Opportunity_tenantId_status_idx" ON "Opportunity"("tenantId", "status");
CREATE INDEX "Opportunity_campaignId_stage_idx" ON "Opportunity"("campaignId", "stage");

ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- NOTE: meetingId FK intentionally omitted — the Meeting table is not part of the
-- migration history (created via `prisma db push`). Add the FK on a future reconcile
-- migration once Meeting lands in migrations. Unique index above still enforces 1:1.
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── OpportunityActivity ─────────────────────────────────────────────────────

CREATE TABLE "OpportunityActivity" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "OpportunityActivityType" NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "OpportunityActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OpportunityActivity_tenantId_idx" ON "OpportunityActivity"("tenantId");
CREATE INDEX "OpportunityActivity_opportunityId_idx" ON "OpportunityActivity"("opportunityId");
CREATE INDEX "OpportunityActivity_userId_idx" ON "OpportunityActivity"("userId");
CREATE INDEX "OpportunityActivity_type_idx" ON "OpportunityActivity"("type");
CREATE INDEX "OpportunityActivity_createdAt_idx" ON "OpportunityActivity"("createdAt");

ALTER TABLE "OpportunityActivity" ADD CONSTRAINT "OpportunityActivity_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OpportunityActivity" ADD CONSTRAINT "OpportunityActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OpportunityActivity" ADD CONSTRAINT "OpportunityActivity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
