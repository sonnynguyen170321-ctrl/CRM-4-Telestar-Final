-- CreateTable
CREATE TABLE "LeadAiInsight" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "hooksJson" JSONB,
    "hooksGeneratedAt" TIMESTAMP(3),
    "draftJson" JSONB,
    "draftGeneratedAt" TIMESTAMP(3),
    "generatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadAiInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadAiInsight_tenantId_idx" ON "LeadAiInsight"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadAiInsight_id_tenantId_key" ON "LeadAiInsight"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadAiInsight_leadId_tenantId_key" ON "LeadAiInsight"("leadId", "tenantId");

-- AddForeignKey
ALTER TABLE "LeadAiInsight" ADD CONSTRAINT "LeadAiInsight_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAiInsight" ADD CONSTRAINT "LeadAiInsight_leadId_tenantId_fkey" FOREIGN KEY ("leadId", "tenantId") REFERENCES "Lead"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

