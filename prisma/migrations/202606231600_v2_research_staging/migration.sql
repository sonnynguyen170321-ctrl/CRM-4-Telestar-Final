-- P4 split: fetch->extract checkpoint table for the BullMQ enrichment stages. Additive.
CREATE TABLE IF NOT EXISTS "V2CompanyResearchStaging" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "researchVersion" INTEGER NOT NULL,
  "materialJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "V2CompanyResearchStaging_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "V2CompanyResearchStaging_org_company_version_key" ON "V2CompanyResearchStaging" ("organizationId", "companyId", "researchVersion");
CREATE INDEX IF NOT EXISTS "V2CompanyResearchStaging_org_createdAt_idx" ON "V2CompanyResearchStaging" ("organizationId", "createdAt");
