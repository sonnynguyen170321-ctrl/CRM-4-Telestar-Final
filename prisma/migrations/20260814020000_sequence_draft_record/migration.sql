-- CreateTable
CREATE TABLE "SequenceDraftRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "grounded" BOOLEAN NOT NULL,
    "groundingReason" TEXT,
    "aiGenerated" BOOLEAN NOT NULL DEFAULT true,
    "skillModules" TEXT[],
    "citedEvidenceIds" TEXT[],
    "aiCallId" TEXT,
    "workOrderId" TEXT,
    "draftedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SequenceDraftRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SequenceDraftRecord_tenantId_idx" ON "SequenceDraftRecord"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "SequenceDraftRecord_tenantId_leadId_key" ON "SequenceDraftRecord"("tenantId", "leadId");

-- AddForeignKey
ALTER TABLE "SequenceDraftRecord" ADD CONSTRAINT "SequenceDraftRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceDraftRecord" ADD CONSTRAINT "SequenceDraftRecord_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceDraftRecord" ADD CONSTRAINT "SequenceDraftRecord_draftedById_fkey" FOREIGN KEY ("draftedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

