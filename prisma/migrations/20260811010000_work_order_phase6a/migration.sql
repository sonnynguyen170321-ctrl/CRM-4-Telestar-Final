-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "pausedReason" TEXT,
    "requestKey" TEXT NOT NULL,
    "leadId" TEXT,
    "campaignId" TEXT,
    "playbookVersionId" TEXT,
    "createdById" TEXT NOT NULL,
    "researchBudget" INTEGER NOT NULL,
    "tokenBudget" INTEGER NOT NULL,
    "maxToolCalls" INTEGER NOT NULL,
    "maxExecutionDuration" INTEGER NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderLease" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "renewedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "WorkOrderLease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkOrder_tenantId_idx" ON "WorkOrder"("tenantId");

-- CreateIndex
CREATE INDEX "WorkOrder_tenantId_status_idx" ON "WorkOrder"("tenantId", "status");

-- CreateIndex
CREATE INDEX "WorkOrder_tenantId_leadId_status_idx" ON "WorkOrder"("tenantId", "leadId", "status");

-- CreateIndex
CREATE INDEX "WorkOrder_campaignId_status_idx" ON "WorkOrder"("campaignId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_tenantId_requestKey_key" ON "WorkOrder"("tenantId", "requestKey");

-- CreateIndex
CREATE INDEX "WorkOrderLease_tenantId_expiresAt_idx" ON "WorkOrderLease"("tenantId", "expiresAt");

-- CreateIndex
CREATE INDEX "WorkOrderLease_workOrderId_idx" ON "WorkOrderLease"("workOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrderLease_tenantId_leadId_key" ON "WorkOrderLease"("tenantId", "leadId");

-- Clear dangling workOrderId values before the foreign keys are added.
--
-- `ProspectTransition.workOrderId`, `AgentAction.workOrderId` and `AiCall.workOrderId` have
-- existed as loose nullable TEXT columns since Phases 1, 3 and 5, explicitly annotated "set once
-- typed work orders exist (Phase 6). No FK until the model does." This migration is that model,
-- so every value currently in those columns references a work order that has never existed —
-- the table is created above, empty. Without this, each ALTER below fails with
-- `insert or update on table "..." violates foreign key constraint`.
--
-- No production data is lost: nothing writes these columns. The only writers are test fixtures
-- using placeholder ids such as 'wo-1'. Phase 6a is the first real producer.
UPDATE "ProspectTransition" SET "workOrderId" = NULL WHERE "workOrderId" IS NOT NULL;
UPDATE "AgentAction" SET "workOrderId" = NULL WHERE "workOrderId" IS NOT NULL;
UPDATE "AiCall" SET "workOrderId" = NULL WHERE "workOrderId" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "ProspectTransition" ADD CONSTRAINT "ProspectTransition_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCall" ADD CONSTRAINT "AiCall_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_playbookVersionId_fkey" FOREIGN KEY ("playbookVersionId") REFERENCES "CampaignPlaybookVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderLease" ADD CONSTRAINT "WorkOrderLease_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderLease" ADD CONSTRAINT "WorkOrderLease_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderLease" ADD CONSTRAINT "WorkOrderLease_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
