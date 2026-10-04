-- Open and click tracking: per-sequence opt-in flags, counts on the message, and one row per event.
-- See lib/email/tracking.ts.

-- AlterTable
ALTER TABLE "OutboundMessage" ADD COLUMN     "clickCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "clickedAt" TIMESTAMP(3),
ADD COLUMN     "openCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Sequence" ADD COLUMN     "trackClicks" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "trackOpens" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "EmailEvent" (
    "id" TEXT NOT NULL,
    "outboundMessageId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT,
    "suspectedBot" BOOLEAN NOT NULL DEFAULT false,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "EmailEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailEvent_tenantId_idx" ON "EmailEvent"("tenantId");

-- CreateIndex
CREATE INDEX "EmailEvent_outboundMessageId_idx" ON "EmailEvent"("outboundMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailEvent_id_tenantId_key" ON "EmailEvent"("id", "tenantId");

-- AddForeignKey
ALTER TABLE "EmailEvent" ADD CONSTRAINT "EmailEvent_outboundMessageId_fkey" FOREIGN KEY ("outboundMessageId") REFERENCES "OutboundMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailEvent" ADD CONSTRAINT "EmailEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
