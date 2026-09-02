import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");
const listPage = read("app/v2/outreach/campaigns/page.tsx");
const detailPage = read("app/v2/outreach/campaigns/[campaignId]/page.tsx");
const newPage = read("app/v2/outreach/campaigns/new/page.tsx");
const workspace = read("components/v2/outreach/CampaignTabbedWorkspace.tsx");
const workspaceReadModel = read("lib/v2/outreach/campaigns/queryCampaignWorkspace.ts");
const query = read("lib/v2/outreach/campaigns/queryCampaigns.ts");
const nav = read("components/v2/outreach/CampaignNav.tsx");

for (const page of [listPage, detailPage]) {
  assert.match(page, /requirePermission\("crm\.read"\)/);
  assert.doesNotMatch(page, /\b(create|update|delete|launch|pause|resume)Campaign\s*\(/);
}

assert.match(query, /sequence\."organizationId" = \$1/);
assert.match(query, /sequence\."deletedAt" IS NULL/);
assert.match(query, /sender\."deletedAt" IS NULL/);
assert.match(query, /enrollment\."deletedAt" IS NULL/);
assert.match(query, /message\."deletedAt" IS NULL/);
assert.match(query, /domain\."deletedAt" IS NULL/);
assert.match(query, /TRACKING_DOMAIN_UNVERIFIED/);
assert.match(query, /NO_LIVE_SENDER/);
assert.match(query, /V2SequenceStepVariant/);
assert.match(query, /V2SequenceSenderAccount/);
assert.match(listPage, /Campaign command center/);
assert.match(listPage, /Campaign work queue/);
assert.match(listPage, /function getNextAction/);
assert.match(listPage, /\/v2\/outreach\/campaigns\/new/, "campaign list New campaign CTA must use the V2 creation route");
assert.match(newPage, /createCampaignAction/, "new campaign route must expose the create action");
assert.match(newPage, /leadIds/, "new campaign route must preserve selected lead ids");
assert.match(newPage, /source/, "new campaign route must preserve lead source params");
assert.match(detailPage, /CampaignTabbedWorkspace/, "detail route must render the tabbed workspace");
for (const tab of ["editor", "contacts", "emails", "activity", "report", "settings"]) {
  assert.match(workspace, new RegExp(`key: "${tab}"`), `campaign workspace exposes ${tab} tab`);
}
assert.match(workspace, /launchCampaignAction/, "contacts launch remains wired through the runtime action");
assert.match(workspace, /Suppression runs again immediately before every provider call/, "launch copy must preserve final suppression gate");
assert.match(workspaceReadModel, /FROM "V2OutreachMessage" message/, "emails tab read model must use V2OutreachMessage");
assert.match(workspaceReadModel, /FROM "V2OutreachActivity" activity/, "activity tab read model must use V2OutreachActivity");
assert.match(workspaceReadModel, /FROM "V2OutreachAuditEvent" audit/, "activity tab read model must include audit events");
assert.doesNotMatch(workspace, /senderId\.slice/, "workspace must not display sender UUIDs as the primary identity");
assert.match(workspace, /never declares live send available by itself/, "live-send copy must not overclaim readiness");
assert.match(nav, /\/v2\/outreach\/campaigns/);

console.log("PASS V2 campaign SEE-IT shell contract");