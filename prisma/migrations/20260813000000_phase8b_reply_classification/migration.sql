-- Phase 8b: reply classification stored on the inbound message itself.
-- Additive and nullable: every existing row is simply unclassified.
ALTER TABLE "InboundMessage"
  ADD COLUMN "replyClass" TEXT,
  ADD COLUMN "replyKind" TEXT,
  ADD COLUMN "replyConfidence" DOUBLE PRECISION,
  ADD COLUMN "classificationSource" TEXT,
  ADD COLUMN "classifiedAt" TIMESTAMP(3);

CREATE INDEX "InboundMessage_tenantId_replyClass_idx" ON "InboundMessage"("tenantId", "replyClass");
