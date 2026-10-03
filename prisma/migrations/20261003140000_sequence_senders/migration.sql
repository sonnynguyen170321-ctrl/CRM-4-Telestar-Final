-- Sending mailboxes per sequence, and the mailbox each enrollment is fixed to.
-- See SequenceSender in schema.prisma.

-- AlterTable
ALTER TABLE "SequenceEnrollment" ADD COLUMN     "senderAccountId" TEXT;

-- CreateTable
CREATE TABLE "SequenceSender" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "emailAccountId" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "SequenceSender_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SequenceSender_tenantId_idx" ON "SequenceSender"("tenantId");

-- CreateIndex
CREATE INDEX "SequenceSender_emailAccountId_idx" ON "SequenceSender"("emailAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "SequenceSender_id_tenantId_key" ON "SequenceSender"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "SequenceSender_sequenceId_emailAccountId_key" ON "SequenceSender"("sequenceId", "emailAccountId");

-- AddForeignKey
ALTER TABLE "SequenceSender" ADD CONSTRAINT "SequenceSender_sequenceId_tenantId_fkey" FOREIGN KEY ("sequenceId", "tenantId") REFERENCES "Sequence"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceSender" ADD CONSTRAINT "SequenceSender_emailAccountId_tenantId_fkey" FOREIGN KEY ("emailAccountId", "tenantId") REFERENCES "EmailAccount"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceSender" ADD CONSTRAINT "SequenceSender_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

