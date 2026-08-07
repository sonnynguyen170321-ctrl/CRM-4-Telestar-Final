-- Outbound send claim bookkeeping.
--
-- `claimedAt` records when a worker won the compare-and-set that moves a message from
-- pending/failed to sending; `attemptCount` counts those claims. Stale-send detection now
-- keys off claimedAt rather than updatedAt, which any unrelated write would bump.
--
-- Additive only: both columns are nullable or defaulted, so an older image keeps running
-- against this schema.

ALTER TABLE "OutboundMessage" ADD COLUMN IF NOT EXISTS "claimedAt" TIMESTAMP(3);
ALTER TABLE "OutboundMessage" ADD COLUMN IF NOT EXISTS "attemptCount" INTEGER NOT NULL DEFAULT 0;

-- The reconciliation pass scans by status and age; existing @@index([status]) does not
-- cover the age predicate.
CREATE INDEX IF NOT EXISTS "OutboundMessage_status_claimedAt_idx"
  ON "OutboundMessage" ("status", "claimedAt");
