-- Shared composer (PR 2): CC/BCC on a sent message, ad-hoc attachments, and snippets.
-- Additive and backward compatible: the previous image runs on this schema unchanged (the new
-- OutboundMessage columns default to an empty list; Attachment.templateId only loses NOT NULL).

-- AlterTable
ALTER TABLE "OutboundMessage" ADD COLUMN     "cc" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "bcc" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable: an attachment may now belong to one composed message instead of a template.
ALTER TABLE "Attachment" ALTER COLUMN "templateId" DROP NOT NULL,
ADD COLUMN     "outboundMessageId" TEXT,
ADD COLUMN     "uploadedById" TEXT,
ADD COLUMN     "cid" TEXT,
ADD COLUMN     "sizeBytes" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Attachment_outboundMessageId_idx" ON "Attachment"("outboundMessageId");

-- CreateIndex
CREATE INDEX "Attachment_uploadedById_createdAt_idx" ON "Attachment"("uploadedById", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_outboundMessageId_cid_key" ON "Attachment"("outboundMessageId", "cid");

-- CreateTable
CREATE TABLE "Snippet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "ownerUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "Snippet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Snippet_tenantId_isShared_idx" ON "Snippet"("tenantId", "isShared");

-- CreateIndex
CREATE INDEX "Snippet_ownerUserId_idx" ON "Snippet"("ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Snippet_id_tenantId_key" ON "Snippet"("id", "tenantId");

-- AddForeignKey
ALTER TABLE "Snippet" ADD CONSTRAINT "Snippet_ownerUserId_tenantId_fkey" FOREIGN KEY ("ownerUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Snippet" ADD CONSTRAINT "Snippet_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
