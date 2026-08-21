-- CreateTable
CREATE TABLE "CommercialClaim" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT,
    "claimType" TEXT NOT NULL,
    "claimText" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "sourceObservedAt" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastConfirmedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "supersedesId" TEXT,
    "correctionReason" TEXT,
    "createdByType" TEXT NOT NULL,
    "createdById" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "CommercialClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommercialClaim_supersedesId_key" ON "CommercialClaim"("supersedesId");

-- CreateIndex
CREATE INDEX "CommercialClaim_tenantId_scopeType_scopeId_status_createdAt_idx" ON "CommercialClaim"("tenantId", "scopeType", "scopeId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CommercialClaim_tenantId_status_expiresAt_idx" ON "CommercialClaim"("tenantId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "CommercialClaim_tenantId_claimType_status_idx" ON "CommercialClaim"("tenantId", "claimType", "status");

-- AddForeignKey
ALTER TABLE "CommercialClaim" ADD CONSTRAINT "CommercialClaim_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialClaim" ADD CONSTRAINT "CommercialClaim_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "CommercialClaim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

