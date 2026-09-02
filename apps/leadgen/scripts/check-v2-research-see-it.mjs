import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// SEE-IT guard for the /v2/research review-first prospecting workspace (command cockpit + grid + rail + drawer),
// the intelligent engine (ICP-fit ranking, adaptive planner), auto-drive runtime, and the
// extra modules (translate, clickable domains, email finder, lookalike/people).

const page = read("app/v2/research/page.tsx");
const rail = read("components/v2/research/ResearchRunRail.tsx");
const builder = read("components/v2/research/ProspectBuilderModal.tsx");
const grid = read("components/v2/research/ProspectGrid.tsx");
const progress = read("components/v2/research/RunProgressPanel.tsx");
const progressHelper = read("lib/v2/research/progress.ts");
const drawer = read("components/v2/research/ResearchCandidateDrawer.tsx");
const drawerPrimitives = read("components/v2/drawers/V2DetailDrawer.tsx");
const leadsPage = read("app/v2/leads/page.tsx");
const leadDrawerHost = read("components/v2/leads/LeadDrawerHost.tsx");
const drawerRoute = read("app/v2/research/candidates/[candidateId]/drawer/route.ts");
const query = read("lib/v2/research/queryResearch.ts");

// Review-first workspace
assert.match(page, /CommandCockpit/, "page renders the command cockpit first");
assert.match(page, /Review queue/, "page frames the main surface as a review queue");
assert.match(page, /ResearchRunRail/, "page renders the run rail as a secondary panel");
assert.match(page, /ProspectGrid/, "page renders the prospect grid as the main workbench");
assert.match(page, /queryResearchRun\(/, "page fetches the active run by id so deep links always render");
assert.match(page, /lead \+ enrichment pipeline/, "page describes lead + enrichment only");
assert.doesNotMatch(page, /toLocaleString\(/, "page avoids server locale date rendering");

// Builder modal: ICP anchor + all four modes + AI-fit toggle + flexible caps
assert.match(rail, /Prospect builder/, "rail keeps the builder secondary");
assert.match(rail, /New run/, "rail exposes a new-run launcher");
assert.match(builder, /People at company/, "builder supports people-at-company mode");
assert.match(builder, /Lookalike/, "builder supports lookalike mode");
assert.match(builder, /scopeCompanyName/, "builder submits company-contact scope");
assert.match(builder, /seedName/, "builder submits lookalike seed");
assert.match(builder, /aiFit/, "builder exposes the AI-fit toggle");
assert.match(builder, /\[50, 100, 200, 1000\]/, "builder offers flexible query caps");
assert.doesNotMatch(builder, /Batch size/, "builder does not hardcode runtime batch size as UI contract");

// Auto-drive runtime (no manual clicking)
assert.match(progress, /method: "POST"/, "progress panel self-drives via the process route");
assert.match(progress, /isDriveable|Discovering/, "progress panel auto-drives to terminal");
assert.match(progress, /providerConfigured/, "cockpit exposes provider configured state");
assert.match(progress, /jobs\.queued|jobs\.running/, "cockpit surfaces real job counts");
assert.match(progressHelper, /Configure provider/, "progress helper derives provider-missing action");

// Intelligent, ranked grid
assert.match(grid, /Needs review/, "grid defaults to needs-review framing");
assert.match(grid, /ScoreRing/, "grid shows an ICP-fit ring per candidate");
assert.match(grid, /Best fit/, "grid can sort by ICP fit");
assert.match(grid, /DomainLink/, "grid renders clickable domains");
assert.match(grid, /researchedAgoLabel/, "grid shows the researched-date chip");
assert.match(grid, /Add to pipeline/, "grid has the promotion action");
assert.match(grid, /EmailTier/, "grid surfaces contact email confidence tiers");
assert.match(grid, /CrmState/, "grid surfaces CRM match state");
assert.match(grid, /MobileCandidateCard/, "grid has mobile review cards instead of forcing only a wide table");
assert.match(grid, /openDrawer/, "grid rows open a detail drawer");

// Drawer: translate + clickable domains + contact data + discover-more
assert.match(drawer, /Translate|Languages/, "drawer offers translate-to-English");
assert.match(drawer, /https:\/\/\$\{candidate\.domain\}|MiniStatusLink/, "drawer renders clickable domains/websites");
assert.match(drawer, /Contact data/, "drawer shows a contact-data (email/phone) section");
assert.match(drawer, /Find lookalikes/, "drawer can launch a lookalike run");
assert.match(drawer, /Find people/, "drawer can launch a people-at-company run");
assert.match(drawer, /Evidence coverage/, "drawer shows evidence coverage");
assert.match(drawer, /Company pages crawled/, "drawer shows crawled/source evidence");
assert.match(drawer, /People discovery/, "drawer shows people discovery state");
assert.match(drawer, /Email waterfall/, "drawer shows the contact email waterfall");
assert.match(drawer, /Learned pattern/, "drawer shows learned domain patterns");
assert.match(drawer, /Verification signals/, "drawer shows verification signals");
assert.match(drawer, /Job timeline/, "drawer shows runtime attempt timeline");
assert.match(drawer, /Reacher not configured/, "drawer copy is honest when Reacher is unavailable");
assert.match(drawer, /SMTP disabled/, "drawer copy is honest when SMTP probing is disabled");
assert.match(drawer, /Ready to add to pipeline/, "drawer shows reviewed candidates are ready to add to leads/pipeline");
assert.match(drawer, /V2DetailDrawer|EntityHeader|NextActionRail/, "research drawer uses neutral shared drawer primitives");
assert.match(drawerPrimitives, /export function V2DetailDrawer/, "shared drawer primitive exports V2DetailDrawer");
assert.match(drawerPrimitives, /export function DrawerSection/, "shared drawer primitive exports DrawerSection");
assert.match(drawerPrimitives, /export function DrawerTimeline/, "shared drawer primitive exports DrawerTimeline");
assert.match(drawerPrimitives, /export function EvidenceList/, "shared drawer primitive exports EvidenceList");
assert.match(drawerPrimitives, /export function EntityHeader/, "shared drawer primitive exports EntityHeader");
assert.match(drawerPrimitives, /export function NextActionRail/, "shared drawer primitive exports NextActionRail");
assert.match(drawerPrimitives, /export function RuntimeStatusStrip/, "shared drawer primitive exports RuntimeStatusStrip");
assert.match(leadsPage, /LeadMetricStrip/, "leads command center keeps metric strip");
assert.match(leadsPage, /LeadPriorityQueue/, "leads command center keeps the priority queue main surface");
assert.match(leadsPage, /LeadBulkActionBar/, "leads command center keeps bulk command actions");
assert.match(leadsPage, /LeadDrawerHost/, "leads command center keeps a lazy detail drawer host");
assert.match(leadsPage, /RuntimeHeaderBadge/, "leads command center shows runtime status");
assert.match(leadDrawerHost, /ContactLeadDrawer/, "lead drawer host hydrates the lead detail drawer lazily");
assert.match(drawerRoute, /requirePermission\("ingestion\.apply"\)/, "drawer API is permission gated");
assert.match(drawerRoute, /ctx\.organizationId/, "drawer API is tenant scoped");

// Read model still grounds state in real CRM/research/scoring rows
assert.match(query, /v2CompanyResearchSnapshot/, "read model checks company research snapshots");
assert.match(query, /v2CompanyIntelligenceProfile/, "read model checks intelligence profiles");
assert.match(query, /v2LeadAssignment/, "read model checks lead assignments");
assert.match(query, /lookupProspects/, "read model joins the durable prospect ledger");
assert.match(query, /v2ResearchEvidence/, "drawer read model reads research evidence rows");
assert.match(query, /v2ResearchFieldObservation/, "drawer read model reads field observations");
assert.match(query, /v2ResearchProviderAttempt/, "drawer read model reads provider attempt timeline");
assert.match(query, /v2ResearchEmailPattern/, "drawer read model reads learned email patterns");
assert.match(query, /buildDrawerEvidence/, "drawer evidence is derived in the read model");

for (const source of [page, rail, builder, grid, progress, drawer, drawerPrimitives, drawerRoute, query, leadsPage, leadDrawerHost]) {
  assert.doesNotMatch(source, /Outreach[A-Z]/, "research UI must not import Outreach-named primitives");
  assert.doesNotMatch(source, /\bfake\b|\bmock\b/i, "research UI must not add fake display data");
  assert.doesNotMatch(source, /V2IngestionJob|V2IngestionRow/, "research review must not create fake upload rows");
}

console.log("PASS V2 research SEE-IT guards");

function read(path) {
  return readFileSync(path, "utf8");
}
