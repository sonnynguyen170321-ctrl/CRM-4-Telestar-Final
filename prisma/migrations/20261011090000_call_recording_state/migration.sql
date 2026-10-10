-- Recording state on Call: what was already sent to the provider (so a late replay does not re-record or
-- re-speak), the lead leg that was created for the call, and the purge back-off.
ALTER TABLE "Call" ADD COLUMN "recordingPurgeAttemptAt" TIMESTAMP(3),
  ADD COLUMN "recordingStartedAt" TIMESTAMP(3),
  ADD COLUMN "recordingNoticeAt" TIMESTAMP(3),
  ADD COLUMN "leadLegControlId" TEXT;
