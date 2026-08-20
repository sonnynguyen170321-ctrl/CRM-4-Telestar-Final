-- CreateTable
CREATE TABLE "TenantAiBudgetPeriod" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "limitMicros" BIGINT NOT NULL,
    "usedMicros" BIGINT NOT NULL DEFAULT 0,
    "reservedMicros" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantAiBudgetPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantAiBudgetReservation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "amountMicros" BIGINT NOT NULL,
    "operation" TEXT,
    "status" TEXT NOT NULL DEFAULT 'held',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),
    "settledMicros" BIGINT,

    CONSTRAINT "TenantAiBudgetReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantAiBudgetPeriod_tenantId_idx" ON "TenantAiBudgetPeriod"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantAiBudgetPeriod_tenantId_periodKey_key" ON "TenantAiBudgetPeriod"("tenantId", "periodKey");

-- CreateIndex
CREATE INDEX "TenantAiBudgetReservation_tenantId_status_idx" ON "TenantAiBudgetReservation"("tenantId", "status");

-- CreateIndex
CREATE INDEX "TenantAiBudgetReservation_status_expiresAt_idx" ON "TenantAiBudgetReservation"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "TenantAiBudgetReservation_periodId_idx" ON "TenantAiBudgetReservation"("periodId");

-- AddForeignKey
ALTER TABLE "TenantAiBudgetPeriod" ADD CONSTRAINT "TenantAiBudgetPeriod_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantAiBudgetReservation" ADD CONSTRAINT "TenantAiBudgetReservation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantAiBudgetReservation" ADD CONSTRAINT "TenantAiBudgetReservation_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "TenantAiBudgetPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

