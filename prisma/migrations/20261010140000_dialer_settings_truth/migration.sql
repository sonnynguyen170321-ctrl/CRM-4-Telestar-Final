-- Dialer settings truth (owner decisions, 2026-10-08): call any time, Vietnam is not dialed through
-- the provider, recording on with no spoken notice by default.

-- One outcome model: "went to voicemail, no message" is one of the nine outcomes a rep can log.
ALTER TYPE "CallOutcome" ADD VALUE IF NOT EXISTS 'voicemail_not_left';

ALTER TABLE "TelephonySettings" ADD COLUMN "recordingNotice" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TelephonySettings" ALTER COLUMN "callingHoursStart" SET DEFAULT 0;
ALTER TABLE "TelephonySettings" ALTER COLUMN "callingHoursEnd" SET DEFAULT 1440;
ALTER TABLE "TelephonySettings" ALTER COLUMN "allowedCountries" SET DEFAULT ARRAY[]::TEXT[];

-- Existing rows still holding the OLD defaults move to the new ones; a deliberate manager setting
-- (any other hours, weekdays or country list) is left alone.
UPDATE "TelephonySettings"
   SET "callingHoursStart" = 0, "callingHoursEnd" = 1440
 WHERE "callingHoursStart" = 480 AND "callingHoursEnd" = 1020
   AND "allowedWeekdays" @> ARRAY[0,1,2,3,4,5,6] AND "allowedWeekdays" <@ ARRAY[0,1,2,3,4,5,6];
UPDATE "TelephonySettings" SET "allowedCountries" = ARRAY[]::TEXT[] WHERE "allowedCountries" = ARRAY['VN']::TEXT[];
