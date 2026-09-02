// UD1 lead-workspace metric-strip truth smoke — pure, no DB, no network.
// Proves the metric strip cannot drift from the filtered table:
//  - queryLeadWorkspaceMetrics reuses the SAME tenant-scoped where-builder
//    (createWhereBuilder) + base FROM (buildBaseFromSql) as queryLeadWorkspace,
//    so card counts == filtered table total by construction (Invariant 5 scope).
//  - NOT_SCORED is DERIVED from latestHardRuleAssessmentId IS NULL, never a
//    stored qualification bucket (Invariant 7 — no fake rows).
//  - UNCERTAIN is never counted (deprecated canonical output).
//  - bigint -> number mapping for every bucket.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(resolve(rootDir, rel), "utf8");

// ---------------------------------------------------------------------------
// 1. Read-model: same source of truth as the table
// ---------------------------------------------------------------------------

const src = read("lib/v2/crm/queryLeadWorkspace.ts");

assert.ok(
  src.includes("export async function queryLeadWorkspaceMetrics"),
  "queryLeadWorkspaceMetrics is exported"
);
assert.ok(
  src.includes("createWhereBuilder(input.organizationId, input.filters)"),
  "metrics reuses the tenant-scoped createWhereBuilder (same filter + org scope)"
);

const metricsSqlMatch = src.match(/function buildMetricsSql\([\s\S]*?\n}/);
assert.ok(metricsSqlMatch, "buildMetricsSql is defined");
const metricsSql = metricsSqlMatch[0];

assert.ok(
  metricsSql.includes("${buildBaseFromSql()}"),
  "metrics SQL uses the SAME base FROM as the table → count parity by construction"
);
assert.ok(
  metricsSql.includes("WHERE ${whereSql}"),
  "metrics SQL applies the SAME filter WHERE as the table"
);

// ---------------------------------------------------------------------------
// 2. The 7 buckets, NOT_SCORED derived, mutually-exclusive scored buckets
// ---------------------------------------------------------------------------

assert.ok(metricsSql.includes('COUNT(*) AS "total"'), "total bucket present");
for (const q of ["QUALIFIED", "NEEDS_REVIEW", "COMPANY_QUALIFIED_NEEDS_CONTACT", "UNQUALIFIED"]) {
  assert.ok(
    metricsSql.includes(`assessment."qualification" = '${q}'`),
    `scored bucket ${q} is filtered from the immutable assessment`
  );
}
assert.ok(
  metricsSql.includes('la."latestHardRuleAssessmentId" IS NULL') &&
    metricsSql.includes('AS "notScored"'),
  "NOT_SCORED is derived from latestHardRuleAssessmentId IS NULL (never stored)"
);
assert.ok(
  /IN \('MEETING_BOOKED', ?'MEETING_DONE'\)[\s\S]*AS "meetings"/.test(metricsSql),
  "meetings bucket counts MEETING_BOOKED + MEETING_DONE workflow"
);

// NOT_SCORED must NOT be a stored qualification comparison anywhere in metrics.
assert.ok(
  !metricsSql.includes(`"qualification" = 'NOT_SCORED'`),
  "NOT_SCORED is never compared as a stored qualification value"
);
// UNCERTAIN is deprecated and must not be a bucket.
assert.ok(!metricsSql.includes("UNCERTAIN"), "UNCERTAIN is never counted");

// ---------------------------------------------------------------------------
// 3. bigint -> number mapping for every returned bucket
// ---------------------------------------------------------------------------

for (const field of ["total", "qualified", "needsReview", "needsContact", "unqualified", "notScored", "meetings"]) {
  assert.ok(
    new RegExp(`${field}: Number\\(row\\?\\.${field} \\?\\? 0\\)`).test(src),
    `${field} is mapped bigint -> number with a 0 fallback`
  );
}

// ---------------------------------------------------------------------------
// 4. Wiring: page binds the read-model + strip; rail/strip carry no fake rows
// ---------------------------------------------------------------------------

const pageSrc = read("app/v2/leads/page.tsx");
assert.ok(
  pageSrc.includes("queryLeadWorkspaceMetrics({ organizationId, filters })"),
  "the leads page calls the metrics read-model with the active filters"
);
assert.ok(
  pageSrc.includes("<LeadMetricStrip") && pageSrc.includes("metrics={metrics}"),
  "the leads page renders the metric strip bound to the read-model"
);

const stripSrc = read("components/v2/leads/LeadMetricStrip.tsx");
assert.ok(!stripSrc.includes("UNCERTAIN"), "metric strip never references UNCERTAIN");

const railSrc = read("components/v2/leads/LeadWorkspaceRail.tsx");
assert.ok(
  railSrc.includes("RescoreViewButton") && railSrc.includes("exportHref"),
  "rail wires the real re-score action + export route (no dead buttons)"
);

const routeSrc = read("app/v2/leads/rescore-view/route.ts");
assert.ok(
  routeSrc.includes('requirePermission("workflow.update")'),
  "rescore-view route gates on workflow.update"
);
assert.ok(
  routeSrc.includes('project."organizationId" = $2'),
  "rescore-view route is tenant-scoped (project must belong to the session org)"
);

console.log("PASS UD1 lead-metric truth: count parity, NOT_SCORED derived, no UNCERTAIN, tenant-scoped re-score");
