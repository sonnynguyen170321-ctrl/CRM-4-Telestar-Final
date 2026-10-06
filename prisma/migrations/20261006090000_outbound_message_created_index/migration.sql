-- Email Log (/api/email-log) lists a tenant's sends newest first. Additive index only.
CREATE INDEX "OutboundMessage_tenantId_createdAt_idx" ON "OutboundMessage"("tenantId", "createdAt");
