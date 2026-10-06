-- Reply-in-thread for sequence emails (lib/sequences/threading.ts), and the reason a waiting step
-- is waiting. All additive: the constant default keeps every existing step a new email, and the
-- nullable columns leave every existing message and enrollment exactly as it was. Column adds with
-- a constant default are metadata-only in Postgres.
ALTER TABLE "SequenceStep" ADD COLUMN "replyInThread" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "OutboundMessage"
  ADD COLUMN "rfcMessageId" TEXT,
  ADD COLUMN "providerThreadId" TEXT,
  ADD COLUMN "referencesHeader" TEXT,
  ADD COLUMN "inReplyToOutboundId" TEXT;

ALTER TABLE "SequenceEnrollment" ADD COLUMN "holdReason" TEXT;

-- Run now (lib/sequences/runNow.ts): when a person asked for the step to go immediately.
ALTER TABLE "Task" ADD COLUMN "runNowRequestedAt" TIMESTAMP(3);
