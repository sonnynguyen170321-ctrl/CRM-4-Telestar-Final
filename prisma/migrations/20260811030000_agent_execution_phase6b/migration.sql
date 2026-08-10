-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN     "researchUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tokensUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "toolCallsUsed" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "AgentApprovalRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actionKey" TEXT NOT NULL,
    "workOrderId" TEXT,
    "agentActionId" TEXT,
    "capability" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "leadId" TEXT,
    "campaignId" TEXT,
    "playbookVersionId" TEXT,
    "requiredLevel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "decisionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentApprovalRequest_tenantId_status_idx" ON "AgentApprovalRequest"("tenantId", "status");

-- CreateIndex
CREATE INDEX "AgentApprovalRequest_workOrderId_idx" ON "AgentApprovalRequest"("workOrderId");

-- CreateIndex
CREATE INDEX "AgentApprovalRequest_tenantId_status_expiresAt_idx" ON "AgentApprovalRequest"("tenantId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentApprovalRequest_tenantId_actionKey_key" ON "AgentApprovalRequest"("tenantId", "actionKey");

-- AddForeignKey
ALTER TABLE "AgentApprovalRequest" ADD CONSTRAINT "AgentApprovalRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentApprovalRequest" ADD CONSTRAINT "AgentApprovalRequest_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentApprovalRequest" ADD CONSTRAINT "AgentApprovalRequest_agentActionId_fkey" FOREIGN KEY ("agentActionId") REFERENCES "AgentAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentApprovalRequest" ADD CONSTRAINT "AgentApprovalRequest_playbookVersionId_fkey" FOREIGN KEY ("playbookVersionId") REFERENCES "CampaignPlaybookVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentApprovalRequest" ADD CONSTRAINT "AgentApprovalRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentApprovalRequest" ADD CONSTRAINT "AgentApprovalRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
