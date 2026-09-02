// M4 export source-of-truth smoke — pure, no network, no real DB.
// Proves: export row count == filtered CRM count (reuses queryLeadWorkspace via
// injectable fetchPage; no parallel lead query); rerun-safe (same filters →
// same content hash); idempotency key keyed by org+filter+requestId; CSV carries
// the immutable assessment-snapshot identity + explicit human overlay; every row
// is a LeadAssignment (no global company export, Invariant 2).

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const {
  collectLeadWorkspaceExportRows,
  serializeLeadWorkspaceCsv,
  buildExportFilterHash,
  buildExportGenerateIdempotencyKey,
  parseExportGenerateJobPayload,
  LEAD_EXPORT_COLUMNS,
  EXPORT_GENERATE_JOB_SCHEMA_VERSION,
} = loadTsModule("lib/v2/crm/exportLeadWorkspace.ts");

const {
  collectContactLeadExportRows,
  serializeContactLeadCsv,
  CONTACT_LEAD_EXPORT_COLUMNS,
} = loadTsModule("lib/v2/crm/contactLeadExport.ts");

// ---------------------------------------------------------------------------
// Fake rows + injectable page fetcher (stands in for queryLeadWorkspace)
// ---------------------------------------------------------------------------

function makeRow(i) {
  return {
    leadAssignmentId: `la_${i}`,
    organizationId: "org_1",
    projectId: "proj_1",
    projectName: "Proj",
    icpVersionId: "icp_1",
    icpVersionNumber: 1,
    icpProfileName: "ICP",
    companyId: `cmp_${i}`,
    companyName: i === 0 ? 'Acme, "Inc"' : `Company ${i}`,
    companyDomain: `company${i}.com`,
    companyWebsiteUrl: null,
    companyCountry: "VN",
    contactId: `con_${i}`,
    contactName: `Contact ${i}`,
    contactTitle: "Head of Ops",
    assignmentLevel: "CONTACT",
    workflowStatus: "WORKING",
    qualification: "QUALIFIED",
    accountPreRank: "STRONG_ACCOUNT_FIT",
    sourceIngestionJobId: "ing_1",
    sourceIngestionRowId: "row_1",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z",
    latestAssessment: {
      id: `asmt_${i}`,
      fitScore: 80,
      confidence: 0.9,
      scoringVersion: "V2.SCORE-HV0:rules-v2.v1",
      inputFingerprint: `fp_${i}`,
      icpRulesHash: "rules_hash_1",
      qualification: "QUALIFIED",
      createdAt: "2026-06-01T12:00:00.000Z",
    },
  };
}

function makeFetchPage(total) {
  const all = Array.from({ length: total }, (_, i) => makeRow(i));
  const pageSize = 100;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  let calls = 0;
  const fetchPage = async ({ page }) => {
    calls += 1;
    const start = (page - 1) * pageSize;
    return {
      rows: all.slice(start, start + pageSize),
      pagination: { page, pageSize, total, totalPages },
    };
  };
  return { fetchPage, getCalls: () => calls };
}

function makeContactRow(i) {
  return {
    contactId: `con_${i}`,
    contactName: i === 0 ? 'Casey, "Primary"' : `Contact ${i}`,
    contactTitle: "Head of Ops",
    contactCity: "Ho Chi Minh City",
    contactCountry: "VN",
    email: `contact${i}@example.test`,
    phone: "+84901234567",
    linkedInUrl: `https://linkedin.com/in/contact-${i}`,
    source: "csv",
    seniorityTier: "EXECUTIVE",
    department: "OPERATIONS",
    hasUsableEmail: true,
    leadAssignmentId: `la_${i}`,
    companyId: `cmp_${i}`,
    companyName: `Company ${i}`,
    companyDomain: `company${i}.com`,
    companyWebsiteUrl: null,
    companyCountry: "VN",
    projectId: "proj_1",
    projectName: "Project",
    icpVersionId: "icp_1",
    icpProfileName: "ICP",
    icpVersionNumber: 1,
    workflowStatus: "NEW",
    ownerUserId: null,
    ownerName: null,
    assignedAt: null,
    fitScore: 88,
    confidence: 0.9,
    qualification: "QUALIFIED",
    accountPreRank: "STRONG_ACCOUNT_FIT",
    reason: "Strong fit",
    companySummary: "Summary",
    companyIntelligenceStatus: "EXTRACTED",
    companyFactTokens: [],
    latestAssessmentId: `asmt_${i}`,
    scoringVersion: "v1",
    inputFingerprint: `fp_${i}`,
    icpRulesHash: "rules",
    assessmentCreatedAt: "2026-06-01T00:00:00.000Z",
    leadCount: 1,
    linkedProjectCount: 1,
    linkedIcpCount: 1,
    activeEnrollmentCount: i,
    lastTouchAt: null,
    lastTouchChannel: null,
    meetingStatus: "NONE",
    reviewStatus: "NOT_REVIEWED",
  };
}

{
  const all = Array.from({ length: 205 }, (_, index) => makeContactRow(index));
  let calls = 0;
  const fetchPage = async ({ page, pageSize }) => {
    calls += 1;
    const start = (page - 1) * pageSize;
    return {
      rows: all.slice(start, start + pageSize),
      pagination: { page, pageSize, total: all.length, totalPages: 3 },
    };
  };
  const result = await collectContactLeadExportRows(
    {
      organizationId: "org_1",
      filters: { clientAccountId: "acct_1", projectId: "proj_1", icpVersionId: "icp_1" },
    },
    { fetchPage }
  );
  assert.equal(result.rows.length, result.total, "contact export equals filtered contact count");
  assert.equal(calls, 3);
  const csv = serializeContactLeadCsv(result.rows.slice(0, 2));
  assert.equal(csv.split("\r\n")[0], CONTACT_LEAD_EXPORT_COLUMNS.join(","));
  assert.ok(csv.includes('"Casey, ""Primary"""'), "contact CSV quotes rich identity fields");
  assert.equal(CONTACT_LEAD_EXPORT_COLUMNS[0], "contactId");
  assert.ok(CONTACT_LEAD_EXPORT_COLUMNS.includes("leadAssignmentId"));
}

console.log("PASS contact-first export count parity + CSV contract");

// ---------------------------------------------------------------------------
// 1. Export row count == filtered CRM count (paged collection)
// ---------------------------------------------------------------------------

{
  const { fetchPage, getCalls } = makeFetchPage(250);
  const { rows, total } = await collectLeadWorkspaceExportRows(
    { organizationId: "org_1", filters: { projectId: "proj_1" } },
    { fetchPage }
  );
  assert.equal(total, 250, "total reflects CRM count");
  assert.equal(rows.length, 250, "export collects every matching row");
  assert.equal(rows.length, total, "export row count == filtered CRM count (exit proof)");
  assert.equal(getCalls(), 3, "paged exactly ceil(250/100)=3 times");
}

// Empty result terminates cleanly.
{
  const { fetchPage } = makeFetchPage(0);
  const { rows, total } = await collectLeadWorkspaceExportRows(
    { organizationId: "org_1", filters: {} },
    { fetchPage }
  );
  assert.equal(total, 0);
  assert.equal(rows.length, 0);
}

console.log("PASS export row count equals filtered CRM count");

// ---------------------------------------------------------------------------
// 2. Rerun-safe: same filters → identical CSV content hash
// ---------------------------------------------------------------------------

{
  const { fetchPage } = makeFetchPage(5);
  const a = await collectLeadWorkspaceExportRows(
    { organizationId: "org_1", filters: { projectId: "proj_1" } },
    { fetchPage }
  );
  const { fetchPage: fetchPage2 } = makeFetchPage(5);
  const b = await collectLeadWorkspaceExportRows(
    { organizationId: "org_1", filters: { projectId: "proj_1" } },
    { fetchPage: fetchPage2 }
  );
  const hashA = createHash("sha256").update(serializeLeadWorkspaceCsv(a.rows)).digest("hex");
  const hashB = createHash("sha256").update(serializeLeadWorkspaceCsv(b.rows)).digest("hex");
  assert.equal(hashA, hashB, "same filters/rows → identical CSV hash (rerun-safe)");
}

console.log("PASS rerun-safe deterministic CSV");

// ---------------------------------------------------------------------------
// 3. CSV: header, quoting, assessment-snapshot identity, overlay, no company-only
// ---------------------------------------------------------------------------

{
  const rows = [makeRow(0), makeRow(1)];
  const overlay = new Map([["la_1", { openReviewCount: 2, feedbackCount: 1 }]]);
  const csv = serializeLeadWorkspaceCsv(rows, overlay);
  const lines = csv.split("\r\n");

  assert.equal(lines[0], LEAD_EXPORT_COLUMNS.join(","), "header is the canonical column set");
  // Immutable assessment snapshot identity columns are present.
  for (const col of ["latestAssessmentId", "scoringVersion", "inputFingerprint", "icpRulesHash"]) {
    assert.ok(LEAD_EXPORT_COLUMNS.includes(col), `${col} is an export column (assessment identity)`);
  }
  // Explicit human overlay columns.
  assert.ok(LEAD_EXPORT_COLUMNS.includes("openReviewCount"));
  assert.ok(LEAD_EXPORT_COLUMNS.includes("feedbackCount"));
  // Every row is keyed by a LeadAssignment (no global company export, Invariant 2).
  assert.equal(LEAD_EXPORT_COLUMNS[0], "leadAssignmentId");
  // Quoting: company name with comma + embedded quotes is CSV-escaped.
  assert.ok(lines[1].includes('"Acme, ""Inc"""'), "comma/quote company name is escaped");
  assert.ok(lines[1].startsWith("la_0,"), "row starts with the lead assignment id");
  // Overlay values land on the right row.
  assert.ok(lines[2].endsWith(",2,1"), "overlay counts serialized for la_1");
  assert.ok(lines[1].endsWith(",0,0"), "no-overlay row defaults to 0,0");
}

console.log("PASS CSV header + quoting + assessment identity + overlay");

// ---------------------------------------------------------------------------
// 4. Idempotency key: org + filter + requestId
// ---------------------------------------------------------------------------

{
  const k = buildExportGenerateIdempotencyKey("org_1", { projectId: "p1" }, "req_1");
  assert.equal(
    k,
    buildExportGenerateIdempotencyKey("org_1", { projectId: "p1" }, "req_1"),
    "deterministic"
  );
  assert.notEqual(
    k,
    buildExportGenerateIdempotencyKey("org_1", { projectId: "p2" }, "req_1"),
    "different filter → different key"
  );
  assert.notEqual(
    k,
    buildExportGenerateIdempotencyKey("org_2", { projectId: "p1" }, "req_1"),
    "tenant isolation: different org → different key"
  );
  assert.notEqual(
    k,
    buildExportGenerateIdempotencyKey("org_1", { projectId: "p1" }, "req_2"),
    "different requestId → different key"
  );
  // Filter hash is order-independent (stable serialization).
  assert.equal(
    buildExportFilterHash({ projectId: "p1", icpVersionId: "v1" }),
    buildExportFilterHash({ icpVersionId: "v1", projectId: "p1" }),
    "filter hash is key-order independent"
  );
}

console.log("PASS idempotency key keyed by org+filter+requestId");

// ---------------------------------------------------------------------------
// 5. Payload validation
// ---------------------------------------------------------------------------

{
  const valid = parseExportGenerateJobPayload({
    schemaVersion: EXPORT_GENERATE_JOB_SCHEMA_VERSION,
    organizationId: "org_1",
    filters: { projectId: "p1" },
    requestId: "req_1",
  });
  assert.equal(valid.organizationId, "org_1");
  assert.equal(valid.requestId, "req_1");

  // Missing filters defaults to {}.
  const noFilters = parseExportGenerateJobPayload({
    schemaVersion: EXPORT_GENERATE_JOB_SCHEMA_VERSION,
    organizationId: "org_1",
    requestId: "req_1",
  });
  assert.deepEqual(noFilters.filters, {});

  assert.throws(
    () => parseExportGenerateJobPayload({ schemaVersion: "wrong", organizationId: "o", requestId: "r" }),
    /schemaVersion/
  );
  assert.throws(
    () => parseExportGenerateJobPayload({ schemaVersion: EXPORT_GENERATE_JOB_SCHEMA_VERSION, requestId: "r" }),
    /organizationId/
  );
  assert.throws(
    () => parseExportGenerateJobPayload({ schemaVersion: EXPORT_GENERATE_JOB_SCHEMA_VERSION, organizationId: "o" }),
    /requestId/
  );
}

console.log("PASS payload validation");

// ---------------------------------------------------------------------------
// 6. Source guards: handler wired; reuses queryLeadWorkspace (no parallel lead query)
// ---------------------------------------------------------------------------

const handlersSrc = readFileSync(resolve(rootDir, "lib/v2/jobs/handlers.ts"), "utf8");
assert.ok(
  handlersSrc.includes("exportGenerateJobHandler") &&
    handlersSrc.includes("v2JobHandlers.EXPORT_GENERATE = exportGenerateJobHandler"),
  "EXPORT_GENERATE handler is wired in v2JobHandlers"
);

const exportSrc = readFileSync(resolve(rootDir, "lib/v2/crm/exportLeadWorkspace.ts"), "utf8");
assert.ok(
  exportSrc.includes("queryLeadWorkspace"),
  "export reuses queryLeadWorkspace (the CRM filter contract)"
);
assert.ok(
  !/FROM\s+"V2LeadAssignment"/i.test(exportSrc),
  "export must not write a parallel lead-assignment query (reuse the contract)"
);
assert.ok(
  exportSrc.includes("TENANT_MISMATCH"),
  "export handler enforces tenant isolation"
);

const routeSrc = readFileSync(
  resolve(rootDir, "app/v2/exports/[exportId]/route.ts"),
  "utf8"
);
assert.ok(
  routeSrc.includes('requirePermission("crm.read")'),
  "download route gates on crm.read"
);
assert.ok(
  routeSrc.includes("payload.organizationId !== tenantContext.organizationId"),
  "download route rejects cross-tenant export ids"
);
assert.ok(
  routeSrc.includes("text/csv"),
  "download route returns text/csv"
);

console.log("PASS handler wiring + reuse + tenant guards");

console.log(
  "PASS V2 M4 export source-of-truth smoke (count==CRM, rerun-safe, idempotent, snapshot+overlay, tenant)"
);

// ---------------------------------------------------------------------------
// Loader (same pattern as other check scripts)
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
