-- Per-mailbox sender display name for the From header. Null keeps the bare address.

-- AlterTable
ALTER TABLE "EmailAccount" ADD COLUMN "fromName" TEXT;
