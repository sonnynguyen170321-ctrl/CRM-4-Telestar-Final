// D3 hard-check: catch read-model column drift. Raw SQL has no compile-time guarantee its
// columns exist — a renamed/dropped schema column only fails at runtime (a 500). This
// captures the actual SQL each headline read model fires (via a capturing prisma proxy),
// then runs each query wrapped in `SELECT * FROM (<sql>) LIMIT 0` against the dev DB: a
// drifted column makes Postgres error here instead of in production. Also asserts the
// typed-Row's key columns are actually returned. Needs the DB:
//   node --env-file=.env scripts/check-v2-readmodel-columns.mjs
import pg from "pg";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Each read model + the key column aliases its typed Row depends on (a rename that still
// parses is caught by the expect check; a dropped column is caught by execution).
const READ_MODELS = [
  { label: "home.overview", module: "lib/v2/home/queryHomeOverview.ts", run: (m) => m.queryHomeOverview("drift-org"), expect: ["leadsAssigned", "qualified", "activeAccounts", "publishedIcps", "queuedJobs"] },
  { label: "leads.list", module: "lib/v2/crm/queryContactLeads.ts", run: (m) => m.queryContactLeads({ organizationId: "drift-org" }), expect: ["leadAssignmentId", "ownerName", "qualification", "companyName", "activeEnrollmentCount"] },
  { label: "leads.metrics", module: "lib/v2/crm/queryContactLeads.ts", run: (m) => m.queryContactLeadMetrics({ organizationId: "drift-org" }), expect: ["total", "qualified", "needsReview", "meetings"] },
  { label: "companies.directory", module: "lib/v2/company-intelligence/readModel.ts", run: (m) => m.queryCompanyDirectory({ organizationId: "drift-org" }), expect: ["id", "name", "leadAssignmentCount", "latestResearchStatus"] },
  { label: "outreach.report", module: "lib/v2/outreach/reporting/queryOutreachReport.ts", run: (m) => m.queryOutreachReport("drift-org"), expect: ["sent", "bounced", "replied", "meetingsBooked", "unsubscribed"] },
];

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

let failures = 0;
for (const rm of READ_MODELS) {
  const captures = [];
  const mod = load(rm.module, captures, new Map());
  try {
    await rm.run(mod); // runs the builders -> fires (and captures) the raw SQL; returns []
  } catch (error) {
    console.log(`FAIL [${rm.label}] read model threw before issuing SQL: ${String(error?.message ?? error)}`);
    failures++;
    continue;
  }

  const columns = new Set();
  let queryErrored = false;
  for (const { sql, params } of captures) {
    try {
      const res = await client.query(`SELECT * FROM (${sql}) AS _drift LIMIT 0`, params);
      for (const field of res.fields) columns.add(field.name);
    } catch (error) {
      console.log(`FAIL [${rm.label}] column drift — Postgres rejected a query: ${String(error?.message ?? error).split("\n")[0]}`);
      failures++;
      queryErrored = true;
    }
  }
  if (queryErrored) continue;

  const missing = rm.expect.filter((c) => !columns.has(c));
  if (missing.length) {
    console.log(`FAIL [${rm.label}] expected columns not returned (alias drift?): ${missing.join(", ")}`);
    failures++;
  } else {
    console.log(`PASS [${rm.label}] — ${captures.length} raw quer${captures.length === 1 ? "y" : "ies"} execute, ${rm.expect.length} key columns present`);
  }
}

await client.end();

if (failures > 0) {
  console.log(`\n✖ ${failures} read-model column-drift problem(s)`);
  process.exit(1);
}
console.log("\nPASS V2 read-model column-drift check (D3)");

// Capturing prisma: records raw SQL + params (the drift-prone surface), returns [] so the
// read model completes. Prisma-client calls (findMany/count) are typed — drift there is a
// tsc/`prisma generate` failure, not a runtime column error — so they're not captured.
function makeCapturingPrisma(captures) {
  const raw = () => async (sql, ...params) => { captures.push({ sql, params }); return []; };
  const model = () => new Proxy({}, { get: (_t, prop) => async () => {
    const p = String(prop);
    if (p === "count") return 0;
    if (p === "findFirst" || p === "findUnique") return null;
    if (p === "aggregate" || p === "groupBy") return {};
    return [];
  } });
  return new Proxy({}, { get: (_t, prop) => {
    const p = String(prop);
    if (p === "$queryRawUnsafe" || p === "$queryRaw") return raw();
    if (p === "$executeRawUnsafe" || p === "$executeRaw") return async () => 0;
    if (p === "then") return undefined;
    return model();
  } });
}

function load(relativePath, captures, cache) {
  const absolutePath = resolve(rootDir, relativePath);
  if (cache.has(absolutePath)) return cache.get(absolutePath).exports;
  const source = readFileSync(absolutePath, "utf8");
  const transpiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const moduleUrl = JSON.stringify(pathToFileURL(absolutePath).href);
  const output = transpiled.split("import.meta.url").join(moduleUrl).split("import.meta").join(`({ url: ${moduleUrl} })`);
  const loadedModule = { exports: {} };
  cache.set(absolutePath, loadedModule);
  const localRequire = (s) => {
    if (s === "server-only") return {};
    if (s.includes("server/prisma")) return { prisma: makeCapturingPrisma(captures) };
    if (s.includes("observability/trace")) return { traceQuery: (_l, fn) => fn(), withSpan: (_n, fn) => fn() };
    if (s.startsWith("@/")) return resolveAndLoad(resolve(rootDir, s.slice(2)), captures, cache);
    if (s.startsWith(".")) return resolveAndLoad(resolve(dirname(absolutePath), s), captures, cache);
    return require(s);
  };
  new Function("require", "module", "exports", output)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
function resolveAndLoad(base, captures, cache) {
  for (const c of [`${base}.ts`, `${base}/index.ts`, `${base}.tsx`]) if (existsSync(c)) return load(c.slice(rootDir.length + 1), captures, cache);
  return require(base);
}
