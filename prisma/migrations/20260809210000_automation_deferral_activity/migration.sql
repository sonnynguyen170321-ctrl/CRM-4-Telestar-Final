-- Deferrals (send window, quota, mailbox pause) are scheduling events the lead timeline
-- has to be able to explain, so they get their own activity type rather than reusing an
-- outreach one. Additive: existing rows and enum values are untouched.
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'sequence_deferred';
