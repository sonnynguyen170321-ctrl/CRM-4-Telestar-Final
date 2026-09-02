import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

const requiredFiles = [
  "app/v2/icp-library/page.tsx",
  "app/v2/icp-library/loading.tsx",
  "app/v2/icp-library/error.tsx",
  "app/v2/reviews/page.tsx",
  "app/v2/reviews/loading.tsx",
  "app/v2/reviews/error.tsx",
  "components/v2/icp-library/IcpLibraryWorkspace.tsx",
  "components/v2/icp-library/IcpRulesSummary.tsx",
  "components/v2/reviews/ReviewQueueWorkspace.tsx",
  "lib/v2/icp/queryIcpLibrary.ts",
  "lib/v2/icp/summarizeIcpRules.ts",
  "lib/v2/icp/index.ts",
];

for (const file of requiredFiles) {
  assert(existsSync(path.join(root, file)), `Missing P12 visibility file: ${file}`);
}

const sideNav = read("components/shared/SideNav.tsx");
assert(sideNav.includes("V2 demo"), "SideNav must clearly group V2 demo routes");
assert(sideNav.includes("/v2/leads"), "SideNav must link V2 leads");
assert(sideNav.includes("/v2/icp-library"), "SideNav must link V2 ICP library");
assert(sideNav.includes("/v2/reviews"), "SideNav must link V2 reviews");
assert(sideNav.includes("V1 / current production"), "SideNav must preserve V1/current production boundary labels");

const leadDrawer = read("components/v2/leads/LeadDrawer.tsx");
assert(leadDrawer.includes("Deterministic ICP rule assessment"), "Lead drawer must label deterministic ICP assessment");
assert(leadDrawer.includes("not sales probability"), "Lead drawer must explain evidence confidence");
assert(leadDrawer.includes("snapshot"), "Lead drawer must expose assessment snapshot/provenance copy");
assert(leadDrawer.includes("/v2/icp-library?icpVersionId="), "Lead drawer must link to scored ICP version");
assert(leadDrawer.includes("/v2/reviews?reviewItemId="), "Lead drawer must link active review context");

const leadTable = read("components/v2/leads/LeadWorkspaceTable.tsx");
assert(leadTable.includes("Operational state"), "Lead table must distinguish workflow operational state");
assert(leadTable.includes("ICP rule result"), "Lead table must distinguish ICP qualification");
assert(leadTable.includes("Evidence confidence"), "Lead table must label confidence as evidence confidence");
assert(leadTable.includes("Company-level"), "Lead table must clarify company-level assignment");
assert(leadTable.includes("No active V2 LeadAssignments found"), "Lead empty state must explain active LeadAssignment scope");

const icpWorkspace = read("components/v2/icp-library/IcpLibraryWorkspace.tsx");
assert(icpWorkspace.includes("read-only"), "ICP library must still label existing ICP versions as read-only");
// P0.2 (Z1): removed the stale P12 assertion `includes("P12 does not create demo ICP")`. The ICP
// library legitimately evolved past P12 — it now exposes a "Create from Preset" flow plus
// Upload / View-leads navigation. The real guard kept here is: existing published versions must
// not get edit/publish/archive controls (those belong to the R5 authoring session).
assert(!/\bPublish\b|\bArchive\b|\bEdit\b/.test(icpWorkspace), "ICP library must not expose edit/publish/archive controls on existing versions");

const icpQuery = read("lib/v2/icp/queryIcpLibrary.ts");
assert(!icpQuery.includes('offer."clientAccountId"'), "ICP library query must not reference missing V2Offer.clientAccountId");
assert(!icpQuery.includes("offer.clientAccountId"), "ICP library query must not reference missing V2Offer.clientAccountId");
assert(icpQuery.includes('INNER JOIN "V2Project" project'), "ICP library query must join V2Project for client account context");
assert(icpQuery.includes('project."clientAccountId"'), "ICP library query must derive client account through V2Project.clientAccountId");

const reviewsWorkspace = read("components/v2/reviews/ReviewQueueWorkspace.tsx");
assert(reviewsWorkspace.includes("Read-only"), "Review queue must state read-only behavior");
assert(reviewsWorkspace.includes("no active manager review items"), "Review empty state must explain no active review items");
assert(
  !/startReviewItem|assignReviewItem|snoozeReviewItem|resolveReviewItem|rejectOrIgnoreReviewItem|createReviewItem/.test(reviewsWorkspace),
  "Review UI must not import or expose MR2 mutation helpers",
);

const topBar = read("components/shared/TopBar.tsx");
assert(topBar.includes("V2 Lead workspace"), "TopBar must describe the V2 Lead workspace");
assert(!/Upload, score, review, and export company-level decisions/.test(topBar), "TopBar must not claim upload/export/company-decision capabilities");

for (const errorBoundary of [
  "app/v2/icp-library/error.tsx",
  "app/v2/reviews/error.tsx",
  "app/v2/leads/error.tsx",
]) {
  const source = read(errorBoundary);
  assert(!source.includes("error.message"), `${errorBoundary} must not render raw error.message`);
  assert(source.includes("Unable to load this V2 view"), `${errorBoundary} must use safe generic error copy`);
}

// P0.2 (Z1): dropped icpWorkspace from the read-only forbidden-control set. The ICP library now
// legitimately links to Upload / View leads and exposes Create-from-Preset, so the blanket
// "no Upload/Apply control" guard false-failed on a valid surface. The forbidden read-only
// controls below still apply to the lead workspace + review queue, which remain read-only until
// the M-series intentionally adds rescore / export / resolve.
const forbiddenText = [
  leadDrawer,
  leadTable,
  reviewsWorkspace,
].join("\n");
assert(!/forceRescore|enqueueScoringJobs|>\s*Rescore\s*</.test(forbiddenText), "P12 UI must not expose rescore controls");
assert(!/worker controls|retry job|process job/i.test(forbiddenText), "P12 UI must not expose job controls");
assert(!/>\s*(Upload|Import|Apply|Upsert)\s*</.test(forbiddenText), "P12 UI must not expose ingestion/upload/apply/upsert controls");
assert(!/>\s*Export\s*</.test(forbiddenText), "P12 UI must not expose export controls");
assert(!/>\s*(Outreach|Send|Sequence|Send email)\s*</i.test(forbiddenText), "P12 UI must not expose outreach/send/sequence controls");
assert(!/JSON editor|rules editor/i.test(forbiddenText), "P12 UI must not expose ICP JSON/editor controls");

// NOTE (P0.2): removed the per-phase "forbidden files changed via git diff"
// guard (false-failed on later phases, hid real regressions). The rendered-text
// behavior assertions above are kept. They encode the P12 read-only stance, so
// they will need revisiting when the M1/M2 leads cockpit intentionally exposes
// rescore/export controls.

console.log("V2 UI visibility demo checks passed");
