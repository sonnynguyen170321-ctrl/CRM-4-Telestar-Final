-- Denormalized industry category on the company (descriptive, NOT a qualification —
-- Invariant 2). Lets the directory aggregate "top industries" + filter by industry
-- without scanning factsJson on every request. Written by the enrichment handler;
-- this migration backfills existing rows from the latest intelligence profile.

-- AlterTable
ALTER TABLE "V2Company" ADD COLUMN "industryCategory" TEXT;

-- CreateIndex
CREATE INDEX "V2Company_organizationId_industryCategory_idx" ON "V2Company"("organizationId", "industryCategory");

-- Backfill: take each company's latest intelligence profile and pull the first
-- `category.<id>` fact token (e.g. category.logistics -> "logistics").
UPDATE "V2Company" c
SET "industryCategory" = sub.cat
FROM (
  SELECT DISTINCT ON (p."companyId")
    p."companyId",
    (
      SELECT substring(tok FROM 'category\.(.*)')
      FROM jsonb_array_elements_text(COALESCE(p."factsJson"::jsonb, '[]'::jsonb)) AS tok
      WHERE tok LIKE 'category.%'
      LIMIT 1
    ) AS cat
  FROM "V2CompanyIntelligenceProfile" p
  ORDER BY p."companyId", p."createdAt" DESC, p."researchVersion" DESC, p."id" DESC
) sub
WHERE c."id" = sub."companyId"
  AND sub.cat IS NOT NULL
  AND sub.cat <> '';
