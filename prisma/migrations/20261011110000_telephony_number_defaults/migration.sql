-- Caller ID defaults (docs/dialer/TASKS.md D9.2): one default number per country, and one overall default
-- for countries with no number of their own. Chosen on settings/telephony; read by lib/telephony/parked.ts.
ALTER TABLE "TelephonyNumber" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TelephonyNumber" ADD COLUMN "isOverallDefault" BOOLEAN NOT NULL DEFAULT false;

-- At most one overall default per tenant and one default per country per tenant, kept by the database as
-- well as by the settings route. Prisma cannot express partial indexes; migrate diff ignores them
-- (see tests/partial-unique-indexes.test.ts). The flags are new columns, so no row can hold them yet.
CREATE UNIQUE INDEX "telephony_number_overall_default_unique" ON "TelephonyNumber"("tenantId") WHERE "isOverallDefault";
CREATE UNIQUE INDEX "telephony_number_country_default_unique" ON "TelephonyNumber"("tenantId", "country") WHERE "isDefault";
