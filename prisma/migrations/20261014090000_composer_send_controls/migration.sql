-- Composer send controls (PR G): schedule send, undo send, draft autosave, per-email tracking.
-- Additive and backward compatible: every new column is nullable or defaulted, so the previous image
-- runs on this schema unchanged. EmailDraft is a new tenant-owned table: RLS must be reapplied
-- (supabase/rls.sql derives its table list from the "tenantId" columns) after this migration.

-- AlterTable
ALTER TABLE "OutboundMessage" ADD COLUMN     "scheduledFor" TIMESTAMP(3),
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "composedById" TEXT,
ADD COLUMN     "trackOpens" BOOLEAN,
ADD COLUMN     "trackClicks" BOOLEAN;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "defaultTrackOpens" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "defaultTrackClicks" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "OutboundMessage_tenantId_composedById_status_idx" ON "OutboundMessage"("tenantId", "composedById", "status");

-- CreateTable
CREATE TABLE "EmailDraft" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leadId" TEXT,
    "threadId" TEXT,
    "accountId" TEXT,
    "subject" TEXT NOT NULL DEFAULT '',
    "bodyHtml" TEXT NOT NULL DEFAULT '',
    "cc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bcc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "attachmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "EmailDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailDraft_userId_updatedAt_idx" ON "EmailDraft"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDraft_tenantId_userId_scopeKey_key" ON "EmailDraft"("tenantId", "userId", "scopeKey");

-- AddForeignKey
ALTER TABLE "EmailDraft" ADD CONSTRAINT "EmailDraft_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDraft" ADD CONSTRAINT "EmailDraft_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
