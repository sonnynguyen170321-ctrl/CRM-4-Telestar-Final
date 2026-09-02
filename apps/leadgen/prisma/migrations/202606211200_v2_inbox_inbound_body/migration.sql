-- Unibox persistence spine: store the inbound reply body + a stripped snippet so the
-- in-app inbox/thread view can render conversations, plus a per-message read marker.
-- Additive + nullable only (no backfill, no data loss). Body for prior inbound events
-- stays null (those predate the inbox); new replies persist their body going forward.

ALTER TABLE "V2InboundMailEvent" ADD COLUMN IF NOT EXISTS "bodyText" TEXT;
ALTER TABLE "V2InboundMailEvent" ADD COLUMN IF NOT EXISTS "snippet" TEXT;
ALTER TABLE "V2InboundMailEvent" ADD COLUMN IF NOT EXISTS "readAt" TIMESTAMP(3);

-- Supports the thread list (per-lead latest reply + unread count) and thread view.
CREATE INDEX IF NOT EXISTS "V2InboundMailEvent_org_lead_kind_time_idx"
  ON "V2InboundMailEvent" ("organizationId", "correlatedLeadAssignmentId", "eventKind", "createdAt");
