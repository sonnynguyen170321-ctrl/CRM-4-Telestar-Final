-- Call counts (lib/telephony/metrics.ts) filter by tenant and the time the call was placed.
CREATE INDEX "Call_tenantId_initiatedAt_idx" ON "Call"("tenantId", "initiatedAt");

-- Call counts read call activities by tenant, type and time; the existing indexes lead with userId or leadId.
CREATE INDEX "Activity_tenantId_type_createdAt_idx" ON "Activity"("tenantId", "type", "createdAt");
