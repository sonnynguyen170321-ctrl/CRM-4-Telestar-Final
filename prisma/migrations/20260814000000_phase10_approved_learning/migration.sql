-- CreateEnum
CREATE TYPE "OutcomeSignalKind" AS ENUM ('draft_accepted', 'draft_edited', 'positive_reply', 'meeting_booked', 'lead_rejected', 'research_irrelevant', 'objection_raised', 'reengagement_reply');

-- CreateEnum
CREATE TYPE "PlaybookProposalStatus" AS ENUM ('proposed', 'approved', 'rejected', 'superseded');

-- CreateTable
CREATE TABLE "OutcomeSignal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "signalKey" TEXT NOT NULL,
    "kind" "OutcomeSignalKind" NOT NULL,
    "direction" INTEGER NOT NULL DEFAULT 0,
    "leadId" TEXT,
    "campaignId" TEXT,
    "sequenceId" TEXT,
    "playbookVersionId" TEXT,
    "actorUserId" TEXT,
    "detail" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutcomeSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaybookProposal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "playbookId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "basedOnVersionId" TEXT,
    "proposalKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "observation" TEXT NOT NULL,
    "suggestedChange" TEXT NOT NULL,
    "proposedRules" JSONB NOT NULL,
    "supportCount" INTEGER NOT NULL DEFAULT 0,
    "status" "PlaybookProposalStatus" NOT NULL DEFAULT 'proposed',
    "createdVersionId" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlaybookProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaybookProposalEvidence" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaybookProposalEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutcomeSignal_tenantId_kind_occurredAt_idx" ON "OutcomeSignal"("tenantId", "kind", "occurredAt");

-- CreateIndex
CREATE INDEX "OutcomeSignal_tenantId_campaignId_occurredAt_idx" ON "OutcomeSignal"("tenantId", "campaignId", "occurredAt");

-- CreateIndex
CREATE INDEX "OutcomeSignal_tenantId_playbookVersionId_idx" ON "OutcomeSignal"("tenantId", "playbookVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "OutcomeSignal_tenantId_signalKey_key" ON "OutcomeSignal"("tenantId", "signalKey");

-- CreateIndex
CREATE UNIQUE INDEX "PlaybookProposal_createdVersionId_key" ON "PlaybookProposal"("createdVersionId");

-- CreateIndex
CREATE INDEX "PlaybookProposal_tenantId_status_createdAt_idx" ON "PlaybookProposal"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PlaybookProposal_tenantId_campaignId_idx" ON "PlaybookProposal"("tenantId", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "PlaybookProposal_tenantId_proposalKey_key" ON "PlaybookProposal"("tenantId", "proposalKey");

-- CreateIndex
CREATE INDEX "PlaybookProposalEvidence_signalId_idx" ON "PlaybookProposalEvidence"("signalId");

-- CreateIndex
CREATE UNIQUE INDEX "PlaybookProposalEvidence_proposalId_signalId_key" ON "PlaybookProposalEvidence"("proposalId", "signalId");

-- AddForeignKey
ALTER TABLE "OutcomeSignal" ADD CONSTRAINT "OutcomeSignal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybookProposal" ADD CONSTRAINT "PlaybookProposal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybookProposal" ADD CONSTRAINT "PlaybookProposal_playbookId_fkey" FOREIGN KEY ("playbookId") REFERENCES "CampaignPlaybook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybookProposal" ADD CONSTRAINT "PlaybookProposal_basedOnVersionId_fkey" FOREIGN KEY ("basedOnVersionId") REFERENCES "CampaignPlaybookVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybookProposal" ADD CONSTRAINT "PlaybookProposal_createdVersionId_fkey" FOREIGN KEY ("createdVersionId") REFERENCES "CampaignPlaybookVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybookProposalEvidence" ADD CONSTRAINT "PlaybookProposalEvidence_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "PlaybookProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybookProposalEvidence" ADD CONSTRAINT "PlaybookProposalEvidence_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "OutcomeSignal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

