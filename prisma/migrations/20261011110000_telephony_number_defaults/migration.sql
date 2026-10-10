-- Caller ID defaults (docs/dialer/TASKS.md D9.2): one default number per country, and one overall default
-- for countries with no number of their own. Chosen on settings/telephony; read by lib/telephony/parked.ts.
ALTER TABLE "TelephonyNumber" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TelephonyNumber" ADD COLUMN "isOverallDefault" BOOLEAN NOT NULL DEFAULT false;
