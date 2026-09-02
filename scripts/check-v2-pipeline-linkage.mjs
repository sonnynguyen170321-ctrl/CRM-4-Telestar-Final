import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Runtime workflow-linkage guard. The ingestion pipeline runs as a chain of jobs
// drained by a run control that claims by source scope. If any stage is enqueued
// with a source the run control cannot claim, that stage (and everything after it)
// silently stalls -- exactly the leak that left COMPANY_ENRICHMENT stuck QUEUED and
// every lead unscored. This guard enforces the chaining contract so the leak cannot
// reappear (in this pipeline or the CRM/outreach pipelines modeled on it).
//
// Pure: no DB, no network, no provider calls.

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

function read(rel) {
  return readFileSync(resolve(rootDir, rel), "utf8").replace(/\r\n/g, "\n");
}

// ---------------------------------------------------------------------------
// 1. BEHAVIORAL: the score-job enqueue honours its source binding
// ---------------------------------------------------------------------------

const { enqueueIcpScoreJob } = loadTsModule("lib/v2/scoring/runtime/enqueueScoringJobs.ts");

function makeCapturingDb() {
  const inserted = [];
  const db = {
    async $queryRaw(strings, ...values) {
      const sql = strings.join("?");
      if (sql.includes("INSERT INTO \"V2Job\"")) {
        // values order: id, orgId, jobType, sourceType, sourceId, idempotencyKey, payload, createdBy
        const row = {
          id: values[0],
          organizationId: values[1],
          jobType: values[2],
          sourceType: values[3],
          sourceId: values[4],
          status: "QUEUED",
          idempotencyKey: values[5],
          payloadSnapshotJson: {},
        };
        inserted.push(row);
        return [row];
      }
      // existing-row lookup: none
      return [];
    },
    async $executeRaw() {
      return 0;
    },
  };
  return { db, inserted };
}

{
  const { db, inserted } = makeCapturingDb();
  await enqueueIcpScoreJob(db, {
    organizationId: "org_1",
    selection: { kind: "lead_assignment_ids", leadAssignmentIds: ["la_1"] },
  });
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].jobType, "ICP_SCORE");
  assert.equal(inserted[0].sourceType, "MANUAL", "default score job is MANUAL-scoped");
  assert.equal(inserted[0].sourceId, null);
}
{
  const { db, inserted } = makeCapturingDb();
  await enqueueIcpScoreJob(db, {
    organizationId: "org_1",
    selection: { kind: "lead_assignment_ids", leadAssignmentIds: ["la_1"] },
    source: { sourceType: "INGESTION_JOB", sourceId: "ing_42" },
  });
  assert.equal(inserted[0].sourceType, "INGESTION_JOB", "bound score job is ingestion-scoped");
  assert.equal(inserted[0].sourceId, "ing_42");
}
console.log("PASS score-job enqueue honours source binding (MANUAL default; INGESTION_JOB when bound)");

// ---------------------------------------------------------------------------
// 2. CONTRACT (static): every pipeline stage is enqueued claimably + the run
//    control drains the whole chain
// ---------------------------------------------------------------------------

const enrichmentEnqueue = read("lib/v2/company-intelligence/index.ts");
assert.ok(
  /source\?:\s*\{\s*sourceType/.test(enrichmentEnqueue) &&
    /input\.source\?\.sourceType\s*\?\?\s*"MANUAL"/.test(enrichmentEnqueue),
  "enqueueCompanyEnrichmentJob accepts a source binding (default MANUAL)"
);

const upsert = read("lib/v2/ingestion/upsertLeadAssignments.ts");
assert.ok(
  /enqueueCompanyEnrichmentJob\([\s\S]*?source:\s*\{\s*sourceType:\s*"INGESTION_JOB",\s*sourceId:\s*ingestionJobId/.test(upsert),
  "ingestion upsert binds enrichment to the ingestion job"
);
assert.ok(
  /loadCompanyIdForContact\([\s\S]*?"V2ContactEmployment"[\s\S]*?"V2LeadAssignment"/.test(upsert) &&
    /upsertCurrentContactEmployment/.test(upsert),
  "contact uploads recover company context from contact links and persist current employment"
);

const ingestionHandlers = read("lib/v2/ingestion/handlers.ts");
assert.ok(
  /COALESCE\(current_employment\."companyId", current_lead\."companyId"\) AS "companyId"/.test(ingestionHandlers) &&
    /companyId: contact\.companyId \?\? undefined/.test(ingestionHandlers),
  "identity candidates carry contact company context for exact-contact upload rows"
);

const identityResolver = read("lib/v2/identity/resolveIdentity.ts");
assert.ok(
  /if \(resolvedContact\) \{[\s\S]*?companyId: resolvedContact\.companyId[\s\S]*?contactId: resolvedContact\.id/.test(identityResolver),
  "exact contact matches preserve company context when no company evidence is present in the row"
);

const enrichHandler = read("lib/v2/company-intelligence/companyEnrichmentHandler.ts");
assert.ok(
  /enqueueIcpScoreJob\([\s\S]*?context\.job\.sourceType === "INGESTION_JOB"[\s\S]*?sourceType:\s*"INGESTION_JOB"/.test(enrichHandler),
  "enrichment handler forwards the ingestion source onto the score job"
);

const route = read("app/v2/ingestion/[jobId]/run-until-idle/route.ts");
assert.ok(route.includes('{ ingestionJobId: jobId }'), "run-until-idle drains ingestion-scoped jobs");
assert.ok(route.includes('jobType: "COMPANY_ENRICHMENT"'), "run-until-idle drains the enrichment tail");
assert.ok(route.includes('jobType: "ICP_SCORE"'), "run-until-idle drains the scoring tail");

const claim = read("lib/v2/jobs/claimNextJob.ts");
assert.ok(
  /options\.organizationId && options\.jobType/.test(claim),
  "claimNextJob supports the {organizationId, jobType} tail-drain scope"
);

console.log("PASS pipeline chaining contract: enrichment+scoring bound to ingestion job AND drained by the run control");

// ---------------------------------------------------------------------------
// 3. Search provider: real provider is env-gated; default stays the stub
// ---------------------------------------------------------------------------

const { readSearchProviderConfigFromEnv, getSearchProvider, StubSearchProvider, HttpSearchProvider } =
  loadTsModule("lib/v2/company-intelligence/searchProvider.ts");

assert.equal(readSearchProviderConfigFromEnv({}), null, "no env -> no real provider config");
assert.equal(
  readSearchProviderConfigFromEnv({ V2_SEARCH_PROVIDER: "brave" }),
  null,
  "provider without api key -> no config"
);
const cfg = readSearchProviderConfigFromEnv({ V2_SEARCH_PROVIDER: "brave", V2_SEARCH_API_KEY: "k" });
assert.ok(cfg && cfg.kind === "brave" && cfg.apiKey === "k", "provider + key -> real config");
assert.ok(getSearchProvider() instanceof StubSearchProvider, "default getSearchProvider is the stub (no live calls without env)");
assert.equal(typeof HttpSearchProvider, "function", "a real HttpSearchProvider exists for when env is configured");
// the real provider never throws and returns [] without a key
const empty = await new HttpSearchProvider({ kind: "brave", apiKey: "" }).search("x");
assert.deepEqual(empty, [], "HttpSearchProvider with no key degrades to []");

console.log("PASS search provider is env-gated real provider with stub fallback (no live call without credentials)");
console.log("PASS V2 pipeline runtime-linkage guard");

// ---------------------------------------------------------------------------
// loader
// ---------------------------------------------------------------------------

function loadTsModule(relativePath) {
  const absolutePath = resolve(rootDir, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;

  const source = readFileSync(absolutePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const loadedModule = { exports: {} };
  moduleCache.set(absolutePath, loadedModule);

  const localRequire = (specifier) => {
    if (specifier === "server-only") return {};
    if (specifier.startsWith("@/")) return resolveAndLoad(resolve(rootDir, specifier.slice(2)));
    if (specifier.startsWith(".")) return resolveAndLoad(resolve(dirname(absolutePath), specifier));
    return require(specifier);
  };

  new Function("require", "module", "exports", output)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

function resolveAndLoad(base) {
  for (const candidate of [`${base}.ts`, `${base}/index.ts`, `${base}.tsx`]) {
    if (existsSync(candidate)) return loadTsModule(candidate.slice(rootDir.length + 1));
  }
  return require(base);
}
