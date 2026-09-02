-- AlterTable: optional HTML signature on the sender.
ALTER TABLE "V2SenderAccount" ADD COLUMN     "signatureHtml" TEXT;

-- CreateTable: email attachments with a pluggable storage backend (DB blob default).
CREATE TABLE "V2EmailAttachment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "messageId" TEXT,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageBackend" TEXT NOT NULL DEFAULT 'DB',
    "storageRef" TEXT NOT NULL,
    "contentBytes" BYTEA,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "V2EmailAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "V2EmailAttachment_organizationId_messageId_idx" ON "V2EmailAttachment"("organizationId", "messageId");

-- CreateIndex
CREATE INDEX "V2EmailAttachment_organizationId_createdAt_idx" ON "V2EmailAttachment"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "V2EmailAttachment_deletedAt_idx" ON "V2EmailAttachment"("deletedAt");
