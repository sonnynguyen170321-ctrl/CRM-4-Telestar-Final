-- Inbox replies thread under the prospect message they answer. Additive, nullable columns only:
-- the previous image runs on this schema unchanged.

-- AlterTable
ALTER TABLE "InboundMessage" ADD COLUMN     "rfcMessageId" TEXT,
ADD COLUMN     "referencesHeader" TEXT;

-- AlterTable
ALTER TABLE "OutboundMessage" ADD COLUMN     "inReplyToInboundId" TEXT;
