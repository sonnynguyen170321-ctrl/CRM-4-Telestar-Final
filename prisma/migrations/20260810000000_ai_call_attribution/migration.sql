-- AI usage attribution. One row per outbound call to an AI or research provider.
--
-- leadId and workOrderId deliberately carry no foreign key: an AiCall is an accounting
-- record and has to outlive an archived lead, and the WorkOrder model does not exist yet
-- (Revenue AI Phase 6). tenantId does have one, because a deleted tenant's spend is not
-- a record anyone may read.
CREATE TABLE "AiCall" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "leadId" TEXT,
    "workOrderId" TEXT,
    "operation" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "totalTokens" INTEGER,
    "searchCredits" INTEGER,
    "latencyMs" INTEGER NOT NULL,
    "estimatedCostUsd" DECIMAL(12,6),
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCall_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiCall_tenantId_createdAt_idx" ON "AiCall"("tenantId", "createdAt");
CREATE INDEX "AiCall_tenantId_operation_idx" ON "AiCall"("tenantId", "operation");
CREATE INDEX "AiCall_tenantId_provider_idx" ON "AiCall"("tenantId", "provider");
CREATE INDEX "AiCall_userId_createdAt_idx" ON "AiCall"("userId", "createdAt");
CREATE INDEX "AiCall_workOrderId_idx" ON "AiCall"("workOrderId");

ALTER TABLE "AiCall" ADD CONSTRAINT "AiCall_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
