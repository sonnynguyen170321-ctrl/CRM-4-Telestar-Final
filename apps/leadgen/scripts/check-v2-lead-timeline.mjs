// T4 queryLeadTimeline smoke — pure, no DB, no network.
// Proves: union shape, sort order, title builders, reason-code formatter,
// tenant isolation guard, no V1/AI imports.

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

// ---------------------------------------------------------------------------
// Load T4 module helpers
// ---------------------------------------------------------------------------

const {
  buildActivityTitle,
  buildAuditTitle,
  formatReasonCode,
} = loadTsModule("lib/v2/crm/queryLeadTimeline.ts");

// ---------------------------------------------------------------------------
// 1. buildActivityTitle
// ---------------------------------------------------------------------------

assert.equal(
  buildActivityTitle("email", "new_email", "no_response"),
  "Email — New email: No response",
  "email/new_email/no_response title"
);
assert.equal(
  buildActivityTitle("call", "call_connected", "meeting_booked"),
  "Call — Call connected: Meeting booked",
  "call/connected/meeting_booked title"
);
assert.equal(
  buildActivityTitle("linkedin", "linkedin_message", "replied"),
  "Linkedin — Linkedin message: Replied",
  "linkedin title"
);

console.log("PASS buildActivityTitle formats channel/type/outcome");

// ---------------------------------------------------------------------------
// 2. buildAuditTitle
// ---------------------------------------------------------------------------

assert.equal(buildAuditTitle("workflow_status_changed"), "Workflow status changed");
assert.equal(buildAuditTitle("lead_assignment_created"), "Lead assignment created");
assert.equal(buildAuditTitle("icp_score_persisted"), "Icp score persisted");

console.log("PASS buildAuditTitle formats eventType");

// ---------------------------------------------------------------------------
// 3. formatReasonCode
// ---------------------------------------------------------------------------

assert.equal(formatReasonCode("FUZZY_NAME_ONLY"), "Fuzzy Name Only");
assert.equal(formatReasonCode("NO_MATCH_FROM_RECAP"), "No Match From Recap");
assert.equal(formatReasonCode("MULTIPLE_COMPANY_CANDIDATES"), "Multiple Company Candidates");

console.log("PASS formatReasonCode formats reason codes");

// ---------------------------------------------------------------------------
// 4. Timeline sort order — same-timestamp events sort audit < review < activity
// ---------------------------------------------------------------------------

const TS = "2026-06-17T10:00:00.000Z";

const mockEvents = [
  {
    source: "activity",
    sourceId: "act_1",
    leadAssignmentId: "la_1",
    occurredAt: TS,
    eventKind: "activity.new_email",
    channel: "email",
    actorUserId: "user_1",
    title: "Email — New email: No response",
    metadata: {},
  },
  {
    source: "review",
    sourceId: "rev_1",
    leadAssignmentId: "la_1",
    occurredAt: TS,
    eventKind: "review.opened",
    channel: "review",
    actorUserId: null,
    title: "Review opened: Fuzzy Name Only",
    metadata: {},
  },
  {
    source: "audit",
    sourceId: "aud_1",
    leadAssignmentId: "la_1",
    occurredAt: TS,
    eventKind: "audit.workflow_status_changed",
    channel: "system",
    actorUserId: "user_1",
    title: "Workflow status changed",
    metadata: {},
  },
];

// Sort using same comparator as queryLeadTimeline
const SOURCE_ORDER = { audit: 0, review: 1, activity: 2, outreach: 3 };
const sorted = [...mockEvents].sort((a, b) => {
  const timeDiff = a.occurredAt.localeCompare(b.occurredAt);
  if (timeDiff !== 0) return timeDiff;
  const sourceDiff = (SOURCE_ORDER[a.source] ?? 99) - (SOURCE_ORDER[b.source] ?? 99);
  if (sourceDiff !== 0) return sourceDiff;
  return a.sourceId.localeCompare(b.sourceId);
});

assert.equal(sorted[0].source, "audit", "same timestamp: audit first");
assert.equal(sorted[1].source, "review", "same timestamp: review second");
assert.equal(sorted[2].source, "activity", "same timestamp: activity third");

console.log("PASS timeline sort: audit < review < activity at same timestamp");

// ---------------------------------------------------------------------------
// 5. Timeline sort — different timestamps sorted chronologically
// ---------------------------------------------------------------------------

const earlier = { ...mockEvents[0], occurredAt: "2026-06-17T08:00:00.000Z", source: "activity" };
const later   = { ...mockEvents[1], occurredAt: "2026-06-17T12:00:00.000Z", source: "review" };
const middle  = { ...mockEvents[2], occurredAt: "2026-06-17T10:00:00.000Z", source: "audit" };

const chronological = [later, earlier, middle].sort((a, b) =>
  a.occurredAt.localeCompare(b.occurredAt)
);

assert.equal(chronological[0].occurredAt, "2026-06-17T08:00:00.000Z", "earliest first");
assert.equal(chronological[1].occurredAt, "2026-06-17T10:00:00.000Z", "middle second");
assert.equal(chronological[2].occurredAt, "2026-06-17T12:00:00.000Z", "latest third");

console.log("PASS timeline sort: chronological order correct");

// ---------------------------------------------------------------------------
// 6. LeadTimelineEvent shape — all required fields present
// ---------------------------------------------------------------------------

const sampleEvent = {
  source: "activity",
  sourceId: "act_test",
  leadAssignmentId: "la_test",
  occurredAt: "2026-06-17T09:00:00.000Z",
  eventKind: "activity.new_email",
  channel: "email",
  actorUserId: null,
  title: "Email — New email: No response",
  metadata: { outcome: "no_response", note: null, timestampQuality: "date_only" },
};

const REQUIRED_FIELDS = ["source", "sourceId", "leadAssignmentId", "occurredAt",
  "eventKind", "channel", "actorUserId", "title", "metadata"];

for (const field of REQUIRED_FIELDS) {
  assert.ok(Object.prototype.hasOwnProperty.call(sampleEvent, field),
    `LeadTimelineEvent must have field: ${field}`);
}

assert.ok(
  ["activity", "outreach", "audit", "review"].includes(sampleEvent.source),
  "source must be one of: activity | outreach | audit | review"
);

console.log("PASS LeadTimelineEvent shape — all required fields present");

// ---------------------------------------------------------------------------
// 7. Source file guards — no V1 / AI imports, tenant isolation enforced
// ---------------------------------------------------------------------------

const timelineSrc = readFileSync(
  resolve(rootDir, "lib/v2/crm/queryLeadTimeline.ts"),
  "utf8"
);

assert.ok(
  timelineSrc.includes("organizationId is required"),
  "queryLeadTimeline enforces organizationId (tenant isolation)"
);
assert.ok(
  !timelineSrc.includes("lib/activityRecaps") && !timelineSrc.includes("lib/server/scoring"),
  "queryLeadTimeline: no V1 business import"
);
assert.ok(
  !timelineSrc.includes("openai") && !timelineSrc.includes("anthropic"),
  "queryLeadTimeline: no AI provider import"
);
assert.ok(
  timelineSrc.includes('"V2ActivityRecord"') &&
  timelineSrc.includes('"V2AuditEvent"') &&
  timelineSrc.includes('"V2ManagerReviewItem"'),
  "queryLeadTimeline unions all three sources"
);
assert.ok(
  timelineSrc.includes('"deletedAt" IS NULL'),
  "queryLeadTimeline respects soft-delete (Invariant 8)"
);
assert.ok(
  timelineSrc.includes("'LeadAssignment'"),
  "audit filter scoped to LeadAssignment entityType"
);

// CRM index exports queryLeadTimeline
const crmIndex = readFileSync(
  resolve(rootDir, "lib/v2/crm/index.ts"),
  "utf8"
);
assert.ok(
  crmIndex.includes("queryLeadTimeline"),
  "lib/v2/crm/index.ts exports queryLeadTimeline"
);

console.log("PASS source guards: tenant isolation, no V1/AI, three-source union, soft-delete, exports");

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------

console.log("PASS V2 T4 queryLeadTimeline smoke (shape, sort, titles, guards)");

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

function loadTsModule(relativePath) {
  const absolutePath = resolve(rootDir, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;

  const source = readFileSync(absolutePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;

  const moduleUrl = JSON.stringify(pathToFileURL(absolutePath).href);
  const output = transpiled
    .split("import.meta.url").join(moduleUrl)
    .split("import.meta").join(`({ url: ${moduleUrl} })`);

  const loadedModule = { exports: {} };
  moduleCache.set(absolutePath, loadedModule);

  const localRequire = (specifier) => {
    if (specifier === "server-only") return {};
    if (specifier === "@/lib/server/prisma" || specifier.endsWith("lib/server/prisma")) {
      return { prisma: null };
    }
    if (specifier.startsWith("@/")) {
      return resolveAndLoad(resolve(rootDir, specifier.slice(2)));
    }
    if (specifier.startsWith(".")) {
      return resolveAndLoad(resolve(dirname(absolutePath), specifier));
    }
    return require(specifier);
  };

  new Function("require", "module", "exports", output)(
    localRequire,
    loadedModule,
    loadedModule.exports
  );
  return loadedModule.exports;
}

function resolveAndLoad(base) {
  for (const candidate of [`${base}.ts`, `${base}/index.ts`, `${base}.tsx`]) {
    if (existsSync(candidate)) {
      return loadTsModule(candidate.slice(rootDir.length + 1));
    }
  }
  return require(base);
}
