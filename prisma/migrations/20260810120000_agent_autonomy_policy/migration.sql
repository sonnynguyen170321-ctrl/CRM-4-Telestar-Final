-- Per-tenant, per-role autonomy overrides for agent capabilities.
--
-- role, capability and mode are text rather than enums so that adding a capability is a code
-- change, not a schema migration plus an enum alter. The set of valid values lives in
-- lib/agent/capabilities.ts, and lib/agent/authorization.ts treats an unrecognised stored
-- value as absent rather than trusting it.
--
-- A row here can only make the agent stricter. CAPABILITY_CEILING caps what it may loosen,
-- and CRM role authorization runs underneath regardless.
CREATE TABLE "AutonomyPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutonomyPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AutonomyPolicy_tenantId_role_capability_key"
    ON "AutonomyPolicy"("tenantId", "role", "capability");
CREATE INDEX "AutonomyPolicy_tenantId_idx" ON "AutonomyPolicy"("tenantId");

ALTER TABLE "AutonomyPolicy" ADD CONSTRAINT "AutonomyPolicy_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
