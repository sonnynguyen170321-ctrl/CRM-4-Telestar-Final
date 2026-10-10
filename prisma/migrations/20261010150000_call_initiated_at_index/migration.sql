-- Call counts (lib/telephony/metrics.ts) filter by tenant and the time the call was placed.
CREATE INDEX "Call_tenantId_initiatedAt_idx" ON "Call"("tenantId", "initiatedAt");
