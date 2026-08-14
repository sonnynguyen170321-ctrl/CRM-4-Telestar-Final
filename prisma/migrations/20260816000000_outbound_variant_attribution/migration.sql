-- Durable A/B variant attribution at send time.
--
-- Variant selection was deterministic but transient: the worker picked a variant, incremented
-- `AbTestVariant.sentCount`, and threw the identity away. Nothing recorded which wording a given
-- prospect actually received, so no outcome could be attributed back to it — a running counter
-- says how many went out, never which one worked.
--
-- All columns are nullable and nothing is backfilled. Every send that predates this migration was
-- made without recording its variant, and inventing one by recomputing the seed would manufacture
-- history rather than recover it.

-- AlterTable
ALTER TABLE "OutboundMessage" ADD COLUMN     "abVariantId" TEXT,
ADD COLUMN     "sequenceId" TEXT,
ADD COLUMN     "sequenceStepOrder" INTEGER;

-- AlterTable
ALTER TABLE "OutcomeSignal" ADD COLUMN     "abVariantId" TEXT;

-- CreateIndex
CREATE INDEX "OutboundMessage_tenantId_abVariantId_idx" ON "OutboundMessage"("tenantId", "abVariantId");

-- CreateIndex
CREATE INDEX "OutboundMessage_leadId_sentAt_idx" ON "OutboundMessage"("leadId", "sentAt");

-- CreateIndex
CREATE INDEX "OutcomeSignal_tenantId_abVariantId_kind_idx" ON "OutcomeSignal"("tenantId", "abVariantId", "kind");

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_abVariantId_fkey" FOREIGN KEY ("abVariantId") REFERENCES "AbTestVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
