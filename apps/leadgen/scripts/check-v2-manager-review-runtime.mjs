import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(relativePath) {
  // Normalize CRLF -> LF so the source-text assertions are line-ending-agnostic on Windows
  // checkouts (git autocrlf). These assertions encode behavior/placeholder ordering, not the
  // byte-for-byte EOL of the file. (Z1 cover: lifecycle.ts is intact; it only differed by \r\n.)
  return readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalManual({ organizationId, leadAssignmentId, reasonCode }) {
  return `v1|org:${organizationId}|source:MANUAL_SDR_REQUEST|lead:${leadAssignmentId}|reason:${reasonCode}`;
}

function canonicalActivityRecap({
  organizationId,
  ingestionJobId,
  sourceRowHash,
  eventIndexWithinRow,
  reasonCode,
}) {
  return `v1|org:${organizationId}|source:ACTIVITY_RECAP_ROW|job:${ingestionJobId}|row:${sourceRowHash}|event:${eventIndexWithinRow}|reason:${reasonCode}`;
}

const requiredFiles = [
  "lib/v2/manager-review/types.ts",
  "lib/v2/manager-review/sourceFingerprint.ts",
  "lib/v2/manager-review/queryReviewQueue.ts",
  "lib/v2/manager-review/queryReviewItem.ts",
  "lib/v2/manager-review/createReviewItem.ts",
  "lib/v2/manager-review/startReviewItem.ts",
  "lib/v2/manager-review/assignReviewItem.ts",
  "lib/v2/manager-review/snoozeReviewItem.ts",
  "lib/v2/manager-review/resolveReviewItem.ts",
  "lib/v2/manager-review/rejectOrIgnoreReviewItem.ts",
  "lib/v2/manager-review/index.ts",
];

for (const file of requiredFiles) {
  assert(existsSync(path.join(root, file)), `Missing required Manager Review runtime file: ${file}`);
}

const sourceFingerprint = read("lib/v2/manager-review/sourceFingerprint.ts");
assert(
  sourceFingerprint.includes("createHash") && sourceFingerprint.includes("sha256"),
  "sourceFingerprint.ts must use Node crypto SHA-256",
);
assert(
  sourceFingerprint.includes('input.sourceType === "MANUAL_SDR_REQUEST"') &&
    sourceFingerprint.includes("|lead:${input.leadAssignmentId}|reason:${input.reasonCode}") &&
    !/\bcreatedByUserId\b/.test(sourceFingerprint),
  "MANUAL_SDR_REQUEST fingerprint must exclude createdByUserId",
);
assert(
  sourceFingerprint.includes('input.sourceType === "ACTIVITY_RECAP_ROW"') &&
    sourceFingerprint.includes("|job:${input.ingestionJobId}|row:${input.sourceRowHash}|event:${input.eventIndexWithinRow}|reason:${input.reasonCode}"),
  "ACTIVITY_RECAP_ROW fingerprint must include job, row hash, and event index",
);

const manualA = sha256(
  canonicalManual({
    organizationId: "org_1",
    leadAssignmentId: "lead_1",
    reasonCode: "SDR_REQUESTED_REVIEW",
  }),
);
const manualB = sha256(
  canonicalManual({
    organizationId: "org_1",
    leadAssignmentId: "lead_1",
    reasonCode: "SDR_REQUESTED_REVIEW",
  }),
);
const manualDifferentLead = sha256(
  canonicalManual({
    organizationId: "org_1",
    leadAssignmentId: "lead_2",
    reasonCode: "SDR_REQUESTED_REVIEW",
  }),
);
const manualDifferentReason = sha256(
  canonicalManual({
    organizationId: "org_1",
    leadAssignmentId: "lead_1",
    reasonCode: "WORKFLOW_STATUS_CONFLICT",
  }),
);
assert(manualA === manualB, "Same manual request source inputs must produce same hash");
assert(manualA !== manualDifferentLead, "Different leadAssignmentId must produce different hash");
assert(manualA !== manualDifferentReason, "Different reasonCode must produce different hash");

const recapA = sha256(
  canonicalActivityRecap({
    organizationId: "org_1",
    ingestionJobId: "job_1",
    sourceRowHash: "row_hash_1",
    eventIndexWithinRow: 2,
    reasonCode: "NO_MATCH_FROM_RECAP",
  }),
);
const recapB = sha256(
  canonicalActivityRecap({
    organizationId: "org_1",
    ingestionJobId: "job_1",
    sourceRowHash: "row_hash_1",
    eventIndexWithinRow: 3,
    reasonCode: "NO_MATCH_FROM_RECAP",
  }),
);
assert(recapA !== recapB, "ACTIVITY_RECAP_ROW event index must affect fingerprint");

const managerReviewText = requiredFiles.map(read).join("\n");
assert(
  !/v2ManagerReviewItem\s*\.\s*(find|create|update|upsert|delete)/.test(managerReviewText),
  "Manager Review runtime must not use Prisma relation-style v2ManagerReviewItem client calls",
);
assert(
  !/\binclude\s*:/.test(managerReviewText),
  "Manager Review runtime must not use Prisma include in helper queries",
);
assert(
  !/\bselect\s*:\s*\{[^}]*relation/i.test(managerReviewText),
  "Manager Review runtime must not use relation select patterns",
);

const startReviewItem = read("lib/v2/manager-review/startReviewItem.ts");
const assignReviewItem = read("lib/v2/manager-review/assignReviewItem.ts");
const lifecycle = read("lib/v2/manager-review/lifecycle.ts");
assert(startReviewItem.includes('"OPEN"') && startReviewItem.includes('"IN_PROGRESS"'), "startReviewItem must support OPEN -> IN_PROGRESS");
assert(startReviewItem.includes("manager_review.item_started"), "startReviewItem must audit item_started");
assert(!startReviewItem.includes("assignedToUserId"), "startReviewItem must not change assignedToUserId");
assert(assignReviewItem.includes("assignedToUserId"), "assignReviewItem must own assignedToUserId mutation");
assert(assignReviewItem.includes("manager_review.item_assigned"), "assignReviewItem must audit item_assigned");
assert(lifecycle.includes("validateActorMembership"), "Mutations must validate actor membership integrity");

const mutationFiles = [
  "lib/v2/manager-review/startReviewItem.ts",
  "lib/v2/manager-review/assignReviewItem.ts",
  "lib/v2/manager-review/snoozeReviewItem.ts",
  "lib/v2/manager-review/resolveReviewItem.ts",
  "lib/v2/manager-review/rejectOrIgnoreReviewItem.ts",
];
for (const file of mutationFiles) {
  const contents = read(file);
  assert(contents.includes("Precondition:"), `${file} must document route/service permission precondition`);
  assert(contents.includes("membershipId"), `${file} must require membershipId in mutation input`);
}

const createReviewItem = read("lib/v2/manager-review/createReviewItem.ts");
assert(createReviewItem.includes("sourceFingerprint"), "createReviewItem must compute/store sourceFingerprint");
assert(createReviewItem.includes("existing_active"), "createReviewItem must return existing_active duplicates");
assert(
  createReviewItem.includes("ACTIVE_STATUS_SQL") && createReviewItem.includes("deletedAt"),
  "createReviewItem must query active duplicates by active status and deletedAt",
);
assert(
  !/\[\s*"HARD_RULE_ASSESSMENT"\s*,\s*"MANUAL_SDR_REQUEST"\s*,\s*"WORKFLOW_CONFLICT"\s*\]\.includes\(\s*input\.sourceType\s*\)\s*&&\s*!input\.leadAssignmentId/.test(createReviewItem) &&
    !/\[\s*"MANUAL_SDR_REQUEST"\s*,\s*"WORKFLOW_CONFLICT"\s*,\s*"HARD_RULE_ASSESSMENT"\s*\]\.includes\(\s*input\.sourceType\s*\)\s*&&\s*!input\.leadAssignmentId/.test(createReviewItem),
  "HARD_RULE_ASSESSMENT must not be part of a broad leadAssignmentId-required source array",
);
assert(
  sourceFingerprint.includes('input.sourceType === "HARD_RULE_ASSESSMENT"') &&
    sourceFingerprint.includes("HARD_RULE_ASSESSMENT requires hardRuleAssessmentId"),
  "HARD_RULE_ASSESSMENT fingerprint must require hardRuleAssessmentId",
);
assert(
  createReviewItem.includes("rows[0].leadAssignmentId !== input.leadAssignmentId") &&
    createReviewItem.includes("hardRuleAssessmentId and leadAssignmentId must refer to the same lead assignment."),
  "HARD_RULE_ASSESSMENT linked ids must be checked for lead-assignment consistency when both are provided",
);

assert(
  lifecycle.includes("$1 nextStatus, $2 review item id, $3 organizationId, $4+ caller values") &&
    lifecycle.includes("input.nextStatus,\n    input.item.id,\n    input.item.organizationId"),
  "updateReviewStatus must document and preserve SQL placeholder ordering",
);

const snoozeReviewItem = read("lib/v2/manager-review/snoozeReviewItem.ts");
const resolveReviewItem = read("lib/v2/manager-review/resolveReviewItem.ts");
const rejectOrIgnoreReviewItem = read("lib/v2/manager-review/rejectOrIgnoreReviewItem.ts");
assert(
  snoozeReviewItem.includes('"snoozedUntil" = $4::timestamp') &&
    snoozeReviewItem.includes('"resolutionNote" = COALESCE($5') &&
    snoozeReviewItem.includes('"resolutionMetadataJson" = COALESCE($6::jsonb'),
  "snoozeReviewItem mutation-specific placeholders must start at $4",
);
for (const [file, contents] of [
  ["resolveReviewItem.ts", resolveReviewItem],
  ["rejectOrIgnoreReviewItem.ts", rejectOrIgnoreReviewItem],
]) {
  assert(
    contents.includes('"resolutionType" = $4::"V2ManagerReviewResolutionType"') &&
      contents.includes('"resolutionNote" = $5') &&
      contents.includes('"resolutionMetadataJson" = $6::jsonb') &&
      contents.includes('"resolvedByUserId" = $7'),
    `${file} mutation-specific placeholders must start at $4`,
  );
}

const queryReviewItem = read("lib/v2/manager-review/queryReviewItem.ts");
const queryReviewQueue = read("lib/v2/manager-review/queryReviewQueue.ts");
assert(queryReviewItem.includes("queryReviewQueue"), "queryReviewItem must reuse tenant-scoped queue query");
assert(
  queryReviewQueue.includes('latestHardRuleAssessmentId') &&
    queryReviewQueue.includes("COALESCE") &&
    !queryReviewQueue.includes("history"),
  "Review item context must stay narrow and use latestHardRuleAssessmentId only",
);
for (const contextId of [
  "contextCompanyId",
  "contextContactId",
  "contextProjectId",
  "contextIcpVersionId",
]) {
  assert(
    queryReviewQueue.includes(`AS "${contextId}"`) &&
      queryReviewQueue.includes(`row.${contextId}`),
    `queryReviewQueue must select and map ${contextId}`,
  );
}

// NOTE (P0.2): removed the per-phase "allowed/forbidden files changed via git
// diff" guards. They false-failed on every later phase that legitimately touched
// these paths (the SESSION_LOG repeatedly notes this script failing "only on its
// MR2-era allowed-file guard"), which trains reviewers to ignore reds and hides
// real regressions. File-scope discipline lives in human review + the WF1
// checklist. The Manager Review behavior assertions above remain the contract.

// ---------------------------------------------------------------------------
// M1: resolution route + interactive UI (route + UI over the existing runtime).
// ---------------------------------------------------------------------------
const resolveRoutePath = "app/v2/reviews/[reviewItemId]/resolve/route.ts";
assert(
  existsSync(path.join(root, resolveRoutePath)),
  `Missing M1 resolution route: ${resolveRoutePath}`,
);
const resolveRoute = read(resolveRoutePath);
assert(
  resolveRoute.includes('requirePermission("manager_review.decide")'),
  "Resolve route must gate on manager_review.decide permission (Invariant 5)",
);
assert(
  resolveRoute.includes("resolveReviewItem(") &&
    resolveRoute.includes("organizationId: tenantContext.organizationId") &&
    resolveRoute.includes("actorUserId: tenantContext.userId") &&
    resolveRoute.includes("membershipId: tenantContext.membershipId"),
  "Resolve route must call resolveReviewItem with tenant-derived org/actor/membership (never client params)",
);
assert(
  resolveRoute.includes("isManagerReviewResolutionType(input.resolutionType)"),
  "Resolve route must validate resolutionType against the canonical set",
);
assert(
  resolveRoute.includes('result.code === "INVALID_TRANSITION"') &&
    resolveRoute.includes("REVIEW_ITEM_ALREADY_RESOLVED") &&
    resolveRoute.includes("isTerminalStatus"),
  "Resolve route must treat a duplicate resolve on a terminal item as a no-op success (M1 idempotency exit proof)",
);
assert(
  resolveRoute.includes("V2TenantError") &&
    resolveRoute.includes('error.code === "UNAUTHENTICATED" ? 401 : 403'),
  "Resolve route must map tenant errors to 401/403",
);

const resolutionPanelPath = "components/v2/reviews/ReviewResolutionPanel.tsx";
assert(
  existsSync(path.join(root, resolutionPanelPath)),
  `Missing M1 resolution UI: ${resolutionPanelPath}`,
);
const resolutionPanel = read(resolutionPanelPath);
assert(
  resolutionPanel.includes('"use client"'),
  "ReviewResolutionPanel must be a client component",
);
assert(
  resolutionPanel.includes("/resolve") &&
    resolutionPanel.includes('method: "POST"') &&
    resolutionPanel.includes("router.refresh()"),
  "ReviewResolutionPanel must POST to the resolve route and refresh so the resolved item leaves the active queue",
);
assert(
  !/from\s+"@\/lib\/v2\/manager-review/.test(resolutionPanel),
  "Client resolution panel must not import the server-only manager-review module",
);

const reviewWorkspace = read("components/v2/reviews/ReviewQueueWorkspace.tsx");
assert(
  reviewWorkspace.includes("ReviewResolutionPanel") &&
    reviewWorkspace.includes("ACTIVE_REVIEW_STATUSES"),
  "ReviewQueueWorkspace must render the resolution panel for active items and split active vs resolved",
);
assert(
  !reviewWorkspace.includes("Read-only P12 view"),
  "ReviewQueueWorkspace must no longer claim to be a read-only P12 view",
);

console.log("V2 Manager Review runtime checks passed");
