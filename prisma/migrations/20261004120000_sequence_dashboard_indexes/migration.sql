-- Sequence Performance and Activity tabs (lib/sequences/performance.ts, activity.ts) read by
-- sequence; without these both scan every message / activity the tenant has.
CREATE INDEX "OutboundMessage_tenantId_sequenceId_sentAt_idx" ON "OutboundMessage"("tenantId", "sequenceId", "sentAt");
CREATE INDEX "Activity_sequenceId_createdAt_idx" ON "Activity"("sequenceId", "createdAt");
