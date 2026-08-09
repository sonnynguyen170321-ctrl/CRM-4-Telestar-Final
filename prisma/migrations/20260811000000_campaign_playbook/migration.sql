-- Campaign playbooks: how approved outreach should operate.
--
-- Deliberately NOT ICP. CampaignLeadRequirement already owns who leadgen sources and what
-- qualifies, with delivery counters and its own lifecycle. Restating that here would create two
-- ICP definitions that can disagree, which is worse than one.
--
-- The playbook row is a stable identity holding no policy. Every rule lives in an immutable
-- version, so the policy a campaign ran under at any past instant is still on disk exactly as
-- it was — which is what makes outcome attribution possible at all.

CREATE TYPE "CampaignPlaybookVersionStatus" AS ENUM ('draft', 'approved', 'superseded');

CREATE TABLE "CampaignPlaybook" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currentVersionId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignPlaybook_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CampaignPlaybookVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "playbookId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "CampaignPlaybookVersionStatus" NOT NULL DEFAULT 'draft',
    "rules" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "CampaignPlaybookVersion_pkey" PRIMARY KEY ("id")
);

-- One playbook per campaign, and one current version per playbook. The unique on
-- currentVersionId also stops the same version being marked current for two playbooks.
CREATE UNIQUE INDEX "CampaignPlaybook_campaignId_key" ON "CampaignPlaybook"("campaignId");
CREATE UNIQUE INDEX "CampaignPlaybook_currentVersionId_key" ON "CampaignPlaybook"("currentVersionId");
CREATE INDEX "CampaignPlaybook_tenantId_idx" ON "CampaignPlaybook"("tenantId");

-- Version numbers are monotonic per playbook and the constraint is what guarantees it under
-- concurrent drafting: two callers computing max+1 at once cannot both win.
CREATE UNIQUE INDEX "CampaignPlaybookVersion_playbookId_versionNumber_key"
    ON "CampaignPlaybookVersion"("playbookId", "versionNumber");
CREATE INDEX "CampaignPlaybookVersion_tenantId_idx" ON "CampaignPlaybookVersion"("tenantId");
-- Attribution reads a playbook's versions ordered by activation.
CREATE INDEX "CampaignPlaybookVersion_playbookId_activatedAt_idx"
    ON "CampaignPlaybookVersion"("playbookId", "activatedAt");
CREATE INDEX "CampaignPlaybookVersion_playbookId_status_idx"
    ON "CampaignPlaybookVersion"("playbookId", "status");

ALTER TABLE "CampaignPlaybook" ADD CONSTRAINT "CampaignPlaybook_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignPlaybook" ADD CONSTRAINT "CampaignPlaybook_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignPlaybook" ADD CONSTRAINT "CampaignPlaybook_currentVersionId_fkey"
    FOREIGN KEY ("currentVersionId") REFERENCES "CampaignPlaybookVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CampaignPlaybookVersion" ADD CONSTRAINT "CampaignPlaybookVersion_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignPlaybookVersion" ADD CONSTRAINT "CampaignPlaybookVersion_playbookId_fkey"
    FOREIGN KEY ("playbookId") REFERENCES "CampaignPlaybook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
