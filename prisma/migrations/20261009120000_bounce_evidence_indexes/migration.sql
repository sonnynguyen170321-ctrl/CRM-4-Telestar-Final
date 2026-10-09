-- Bounce evidence at send time: any earlier bounce for an address stops the next send
-- (lib/email/suppress.ts findBounceEvidence). Both tables are read by tenant for the few bounced rows.
CREATE INDEX "OutboundMessage_tenantId_bouncedAt_idx" ON "OutboundMessage"("tenantId", "bouncedAt");
CREATE INDEX "InboundMessage_tenantId_isBounce_idx" ON "InboundMessage"("tenantId", "isBounce");
