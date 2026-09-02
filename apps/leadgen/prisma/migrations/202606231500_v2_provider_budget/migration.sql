-- P4 (budget rail): per-org per-provider daily call counters. Additive (IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS "V2ProviderUsageDaily" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "usageDate" DATE NOT NULL,
  "requests" INTEGER NOT NULL DEFAULT 0,
  "errors" INTEGER NOT NULL DEFAULT 0,
  "rateLimited" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "V2ProviderUsageDaily_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "V2ProviderUsageDaily_org_provider_date_key" ON "V2ProviderUsageDaily" ("organizationId", "provider", "usageDate");
CREATE INDEX IF NOT EXISTS "V2ProviderUsageDaily_org_date_idx" ON "V2ProviderUsageDaily" ("organizationId", "usageDate");
