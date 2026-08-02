-- Email Health P0 — deliverability data capture.
--
-- Bounce notifications were previously discarded at sync time (workers/sync.ts skipped
-- every message matching isBounceMessage before persisting), and handleApplyBounce never
-- touched OutboundMessage. As a result OutboundMessage.status = 'bounced' had no writer
-- and bounce rate was structurally uncomputable. Likewise handleApplyReply never set
-- repliedAt, so reply rate read zero.
--
-- This migration adds the columns and indexes those rollups need. It deliberately does
-- NOT include the unrelated TIMESTAMP(3) drift on CampaignLeadRequirement / LeadPoolItem /
-- LeadgenActivity that `migrate diff` reports against this database — that drift predates
-- this work and is tracked separately.

-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'email_replied';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'email_bounced';

-- AlterTable: OutboundMessage — link a bounce back to the send that caused it
ALTER TABLE "OutboundMessage" ADD COLUMN IF NOT EXISTS "bouncedAt" TIMESTAMP(3);
ALTER TABLE "OutboundMessage" ADD COLUMN IF NOT EXISTS "bounceType" TEXT;

-- AlterTable: InboundMessage — persist bounce/reply signal instead of discarding it
ALTER TABLE "InboundMessage" ADD COLUMN IF NOT EXISTS "isBounce" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InboundMessage" ADD COLUMN IF NOT EXISTS "isReply" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InboundMessage" ADD COLUMN IF NOT EXISTS "bounceType" TEXT;
ALTER TABLE "InboundMessage" ADD COLUMN IF NOT EXISTS "bouncedRecipient" TEXT;

-- CreateIndex: per-inbox and tenant-wide deliverability windows
CREATE INDEX IF NOT EXISTS "OutboundMessage_accountId_sentAt_idx" ON "OutboundMessage"("accountId", "sentAt");
CREATE INDEX IF NOT EXISTS "OutboundMessage_tenantId_status_sentAt_idx" ON "OutboundMessage"("tenantId", "status", "sentAt");

-- CreateIndex: bounce correlation lookup (most recent sent message to an address on an account)
CREATE INDEX IF NOT EXISTS "OutboundMessage_accountId_to_status_idx" ON "OutboundMessage"("accountId", "to", "status");

-- CreateIndex: windowed reply/bounce/spam counts
CREATE INDEX IF NOT EXISTS "InboundMessage_accountId_date_idx" ON "InboundMessage"("accountId", "date");
CREATE INDEX IF NOT EXISTS "InboundMessage_tenantId_date_idx" ON "InboundMessage"("tenantId", "date");

-- CreateIndex: suppression-growth metric
CREATE INDEX IF NOT EXISTS "SuppressionEntry_tenantId_createdAt_idx" ON "SuppressionEntry"("tenantId", "createdAt");
