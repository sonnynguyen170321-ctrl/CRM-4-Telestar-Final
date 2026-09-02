import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");

const hub = read("app/v2/outreach/page.tsx");
const compose = read("app/v2/outreach/compose/page.tsx");
const templates = read("app/v2/outreach/templates/page.tsx");
const templateActions = read("app/v2/outreach/templates/actions.ts");
const templateQueries = read("lib/v2/outreach/templates/queryComposeTemplates.ts");
const templatePreview = read("lib/v2/outreach/templates/renderTemplatePreview.ts");
const campaignNav = read("components/v2/outreach/CampaignNav.tsx");
const campaigns = read("app/v2/outreach/campaigns/page.tsx");
const senders = read("app/v2/outreach/senders/page.tsx");
const sequences = read("app/v2/outreach/sequences/page.tsx");
const campaignDetail = read("app/v2/outreach/campaigns/[campaignId]/page.tsx");
const campaignWorkspace = read("components/v2/outreach/CampaignTabbedWorkspace.tsx");
const campaignWorkspaceReadModel = read("lib/v2/outreach/campaigns/queryCampaignWorkspace.ts");
const suppression = read("app/v2/outreach/suppression/page.tsx");
const suppressionBatch = read("components/v2/outreach/BatchEmailCheckPanel.tsx");
const suppressionBatchActions = read("app/v2/outreach/suppression/batchActions.ts");
const suppressionBatchCore = read("lib/v2/outreach/suppression/batchEmailCheck.ts");
const inbox = read("app/v2/outreach/inbox/page.tsx");
const reports = read("app/v2/reports/page.tsx");
const env = read(".env.example");

assert.doesNotMatch(hub, /\/v2\/outreach\/senders\/new/, "hub must not link to missing /senders/new route");
assert.match(hub, /\/v2\/outreach\/senders\?add=1/, "hub Add sender CTA must open the real add form");
assert.doesNotMatch(hub, /senderId\.slice/, "hub must not display sender UUIDs as the primary sender label");
assert.match(hub, /Outreach command center/, "hub must present the command-center shell");
assert.match(hub, /Live-send checklist/, "hub must expose live-send readiness checklist");
assert.match(hub, /Sender setup/, "hub must keep a direct sender setup action");
assert.match(hub, /final synchronous suppression checks/, "hub must preserve the final suppression gate copy");
assert.match(hub, /<CampaignNav active="monitor" \/>/, "outreach hub must use the shared outreach nav");
assert.doesNotMatch(hub, /const TABS/, "outreach hub must not keep a second local tab UI");

assert.match(compose, /Smart compose/, "compose page must present the smart compose cockpit");
assert.match(compose, /Lead queue/, "compose page must expose the lead/contact queue");
assert.match(compose, /ReadinessChecklist/, "compose page must expose readiness blockers");
assert.match(compose, /blockers=\{blockers\}/, "compose send button must receive exact blockers");
assert.match(compose, /final synchronous suppression check/, "compose copy must preserve final suppression gate visibility");
assert.doesNotMatch(compose, /senderId\.slice/, "compose must not display sender UUIDs as primary identity");
assert.match(compose, /queryComposeTemplateDetail/, "compose must preload templates by templateId");
assert.match(compose, /saveComposeDraftAsTemplateAction/, "compose must allow saving the current draft as a template");
assert.match(compose, /subject,\s*\r?\n\s*body,/, "manual send must submit final subject/body snapshots");
assert.doesNotMatch(compose, /createManualSend[\s\S]*templateId[\s\S]*subject:\s*templateId/, "manual send must not submit only a template id");

assert.match(campaignNav, /href: "\/v2\/outreach\/templates"/, "outreach nav must expose Templates");
assert.match(templates, /Compose templates/, "templates page must exist");
assert.match(templates, /Template library/, "templates page must expose the template library");
assert.match(templates, /ComposeTemplateEditor/, "templates page must render the smart template editor");
assert.match(templateActions, /requirePermission\("outreach\.admin"\)/, "template create/edit/archive must be outreach.admin-gated");
assert.match(templateQueries, /"organizationId" = \$1/, "template reads must be tenant-scoped");
assert.match(templateQueries, /"deletedAt" IS NULL/, "template reads must be soft-delete aware");
assert.match(templatePreview, /renderCampaignTemplate/, "template preview must reuse the campaign Liquid renderer");
assert.match(templates, /Applying a template never bypasses|does not assert live-send readiness|does not change suppression, sender, or transport readiness/, "template UI must not claim applying a template makes send live-ready");

assert.match(campaigns, /Campaign command center/, "campaign list must use the command-center shell");
assert.match(campaigns, /Campaign work queue/, "campaign list must expose the dense work queue");
assert.match(campaigns, /filter=\$\{tab.key\}/, "campaign list must expose filter tabs");
assert.match(campaigns, /function getNextAction/, "campaign list must compute next actions from readiness");
assert.doesNotMatch(campaigns, /senderId\.slice/, "campaign list must not display sender UUIDs as primary identity");
assert.doesNotMatch(senders, /product_tree\.write/, "sender admin actions must use outreach.admin, not product_tree.write");
assert.match(senders, /requirePermission\("outreach\.admin"\)/, "sender mutations must be outreach.admin-gated");
assert.match(senders, /SMTP\/app-password first/, "senders page must make the supported first live path clear");
assert.match(senders, /XOAUTH2\s+transport hookup is verified/, "OAuth live-send must stay explicitly deferred");
assert.match(senders, /Sender fleet/, "senders page must present the sender fleet cockpit");
assert.match(senders, /Fleet readiness gates/, "senders page must expose global gate readiness");
assert.match(senders, /liveEligible/, "senders page must compute live eligibility instead of trusting the toggle alone");
assert.match(senders, /Live-send truth/, "senders page must keep conservative live-send truth copy");
assert.match(senders, /enableSenderFleetDefaultsAction/, "senders page must expose a fleet-level enable action");
assert.match(senders, /Enable ready senders/, "sender accounts panel must have the large fleet enable button");
assert.match(senders, /"organizationId" = \$1 AND "deletedAt" IS NULL AND "status" = 'ACTIVE'/, "fleet enable action must stay tenant-scoped, active-only, and soft-delete aware");
assert.match(senders, /"verifiedAt" IS NOT NULL AND "lastVerifyError" IS NULL THEN true/, "fleet enable action must only live-enable verified senders");
assert.match(senders, /V2_OUTREACH_CREDENTIAL_KEY/, "fleet live enable must remain credential-key gated");

assert.doesNotMatch(sequences, /product_tree\.write/, "sequence authoring must use outreach.admin, not product_tree.write");
assert.match(sequences, /requirePermission\("outreach\.admin"\)/, "sequence authoring must be outreach.admin-gated");

assert.match(campaignDetail, /CampaignTabbedWorkspace/, "campaign detail route must render the tabbed workspace");
for (const tab of ["Editor", "Contacts", "Emails", "Activity", "Report", "Settings"]) {
  assert.match(campaignWorkspace, new RegExp(`label: "${tab}"`), `campaign workspace exposes ${tab} tab`);
}
assert.match(campaignWorkspace, /nextCampaignWindow/, "editor preview context must use the scheduler helper");
assert.match(campaignWorkspace, /queryCampaignEmailRows/, "emails tab must use the email row read model");
assert.match(campaignWorkspace, /queryCampaignActivityRows/, "activity tab must use the activity row read model");
assert.match(campaignWorkspace, /saveCampaignSenderPoolAction/, "settings tab must allow sender pool weight editing");
assert.match(campaignWorkspace, /CTD-backed tracking is not ready/, "report tab must hide open/click metrics when CTD is unavailable");
assert.match(campaignWorkspaceReadModel, /FROM "V2OutreachMessage" message/, "email rows must come from V2OutreachMessage");
assert.doesNotMatch(campaignWorkspace, /senderId\.slice/, "campaign workspace must not display sender UUIDs as primary identity");
assert.doesNotMatch(campaignDetail, /intentionally not claimed/, "campaign page must not claim timezone support is absent");

assert.doesNotMatch(reports, /senderId\.slice/, "reports must not display sender UUIDs when address/display name is missing");
assert.match(reports, /tracking\.available/, "reports must gate open/click metrics on verified CTD tracking availability");
assert.match(reports, /Unique opens/, "reports must surface real open metrics when tracking is available");

assert.match(suppression, /addSuppressionAction/, "suppression page must support manual suppression entries");
assert.match(suppression, /deleteSuppressionAction/, "suppression page must support soft-removing suppression entries");
assert.match(suppression, /BatchEmailCheckPanel/, "suppression page must expose batch email checking");
assert.match(suppressionBatch, /Export valid/, "batch checker must support CSV export for valid rows");
assert.match(suppressionBatch, /Sync to campaign/, "batch checker must support campaign sync from valid lead rows");
assert.match(suppressionBatchActions, /checkBatchEmailsAction/, "batch checker must have upload/check server action");
assert.match(suppressionBatchActions, /syncBatchToCampaignAction/, "batch checker must have campaign sync server action");
assert.match(suppressionBatchActions, /launchCampaign/, "campaign sync must go through campaign runtime");
assert.match(suppressionBatchCore, /decideSuppression/, "batch checker must reuse suppression decision logic");
assert.match(suppressionBatchCore, /v2ContactIdentifier/, "batch checker must consider contact identifier validity");

assert.match(inbox, /InboxFilters/, "inbox page must expose outcome filters");
assert.match(inbox, /filterThreads/, "inbox page must apply filters server-side");
assert.match(inbox, /lastOutcome/, "inbox filters must use real inbound outcomes");
assert.match(inbox, /BOUNCE_DSN/, "inbox filters must expose bounced outcomes");
assert.match(inbox, /UNSUBSCRIBE/, "inbox filters must expose unsubscribed outcomes");

for (const key of [
  "APP_URL=",
  "V2_IMAP_POLL_INTERVAL_MS=",
  "V2_TRACKING_HOST=",
  "V2_TRACKING_SECRET=",
  "V2_WORKER_SECRET=",
  "V2_WORKER_APP_URL=",
  "V2_OUTREACH_KILL_SWITCH=",
]) {
  assert.match(env, new RegExp(`^${key}`, "m"), `.env.example must document ${key}`);
}

for (const route of [
  "app/v2/outreach/page.tsx",
  "app/v2/outreach/campaigns/page.tsx",
  "app/v2/outreach/compose/page.tsx",
  "app/v2/outreach/templates/page.tsx",
  "app/v2/outreach/inbox/page.tsx",
  "app/v2/outreach/sequences/page.tsx",
  "app/v2/outreach/suppression/page.tsx",
  "app/v2/outreach/senders/page.tsx",
  "app/v2/reports/page.tsx",
  "app/v2/settings/page.tsx",
]) {
  assert.ok(existsSync(resolve(root, route)), `SEE-IT route exists: ${route}`);
}

console.log("PASS V2 outreach SEE-IT wiring guard");
