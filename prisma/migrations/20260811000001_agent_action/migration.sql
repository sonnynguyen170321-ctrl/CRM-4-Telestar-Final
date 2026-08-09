-- AlterTable
ALTER TABLE "AiCall" ADD COLUMN     "agentActionId" TEXT;

-- CreateTable
CREATE TABLE "AgentAction" (
    "id" TEXT NOT NULL,
    "actionKey" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "capability" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "authorizationOutcome" TEXT NOT NULL,
    "playbookVersionId" TEXT,
    "workOrderId" TEXT,
    "leadId" TEXT,
    "campaignId" TEXT,
    "result" JSONB,
    "error" JSONB,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentAction_tenantId_idx" ON "AgentAction"("tenantId");

-- CreateIndex
CREATE INDEX "AgentAction_userId_idx" ON "AgentAction"("userId");

-- CreateIndex
CREATE INDEX "AgentAction_leadId_idx" ON "AgentAction"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentAction_tenantId_actionKey_key" ON "AgentAction"("tenantId", "actionKey");

-- AddForeignKey
ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_playbookVersionId_fkey" FOREIGN KEY ("playbookVersionId") REFERENCES "CampaignPlaybookVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCall" ADD CONSTRAINT "AiCall_agentActionId_fkey" FOREIGN KEY ("agentActionId") REFERENCES "AgentAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

