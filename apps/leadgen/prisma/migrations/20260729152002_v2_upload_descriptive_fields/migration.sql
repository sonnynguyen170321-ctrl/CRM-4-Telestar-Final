-- Persist the descriptive fields the CSV upload already carries but ingestion was discarding:
-- company industry / employee-count range / revenue, and contact department / seniority.
-- Idempotent (ADD COLUMN IF NOT EXISTS) to match the repo's drift-migration convention.
ALTER TABLE "V2Company" ADD COLUMN IF NOT EXISTS "industry" TEXT;
ALTER TABLE "V2Company" ADD COLUMN IF NOT EXISTS "employeeCountRange" TEXT;
ALTER TABLE "V2Company" ADD COLUMN IF NOT EXISTS "revenue" TEXT;
ALTER TABLE "V2Contact" ADD COLUMN IF NOT EXISTS "department" TEXT;
ALTER TABLE "V2Contact" ADD COLUMN IF NOT EXISTS "seniority" TEXT;
