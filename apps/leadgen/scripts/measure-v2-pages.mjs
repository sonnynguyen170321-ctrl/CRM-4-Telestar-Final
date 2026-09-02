// D0 baseline: count the DB round-trips each headline read-model issues, WITHOUT a DB.
// A counting prisma proxy returns shape-compatible empty results, so the read model runs
// to completion and we record how many statements it fired. This is the deterministic
// "fan-out" metric (home today = 26). Wall-clock ms is measured live by the trace layer
// (lib/v2/observability/trace) when a page is hit in dev; this script is the query-count
// regression guard (re-run after D2 to prove 26 -> ~2).
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Read models to baseline: { label, module, export, call(fn) }. Add pages here as they
// get traced; each is loaded with the counting proxy injected for @/lib/server/prisma.
const TARGETS = [
  {
    label: "home.overview",
    module: "lib/v2/home/queryHomeOverview.ts",
    run: (mod) => mod.queryHomeOverview("measure-org"),
  },
  {
    label: "leads.list",
    module: "lib/v2/crm/queryContactLeads.ts",
    run: (mod) => mod.queryContactLeads({ organizationId: "measure-org" }),
  },
  {
    label: "leads.metrics",
    module: "lib/v2/crm/queryContactLeads.ts",
    run: (mod) => mod.queryContactLeadMetrics({ organizationId: "measure-org" }),
  },
  {
    label: "companies.directory",
    module: "lib/v2/company-intelligence/readModel.ts",
    run: (mod) => mod.queryCompanyDirectory({ organizationId: "measure-org" }),
  },
  {
    label: "outreach.report",
    module: "lib/v2/outreach/reporting/queryOutreachReport.ts",
    run: (mod) => mod.queryOutreachReport("measure-org"),
  },
];

const results = [];
for (const target of TARGETS) {
  const counter = { n: 0, labels: [] };
  const moduleCache = new Map();
  const mod = load(target.module, counter, moduleCache);
  try {
    await target.run(mod);
    results.push({ label: target.label, queries: counter.n, breakdown: tally(counter.labels) });
  } catch (error) {
    results.push({ label: target.label, queries: counter.n, error: String(error?.message ?? error) });
  }
}

console.log("\n=== V2 read-model query baseline (DB round-trips per loader) ===");
for (const r of results) {
  const flag = r.queries > 8 ? "  ⚠ over 8-query budget" : "";
  console.log(`\n${r.label}: ${r.queries} queries${flag}`);
  if (r.error) console.log(`   (completed-with-stub note: ${r.error})`);
  for (const [label, n] of Object.entries(r.breakdown ?? {})) console.log(`   ${n}x  ${label}`);
}
console.log("");

function tally(labels) {
  const out = {};
  for (const l of labels) out[l] = (out[l] ?? 0) + 1;
  return out;
}

// Counting prisma: any raw query / findMany -> [] (read models all use optional chaining +
// defaults, so an empty result lets them complete); findFirst -> null; count -> 0. Every
// call bumps the counter so we tally the round-trip shape.
function makeCountingPrisma(counter) {
  const raw = (label) => async () => { counter.n++; counter.labels.push(label); return []; };
  const model = (name) => new Proxy({}, { get: (_t, prop) => {
    const p = String(prop);
    return async () => {
      counter.n++; counter.labels.push(`${name}.${p}`);
      if (p === "count") return 0;
      if (p === "findFirst" || p === "findUnique") return null;
      if (p === "aggregate" || p === "groupBy") return {};
      return []; // findMany + default
    };
  }});
  return new Proxy({}, { get: (_t, prop) => {
    const p = String(prop);
    if (p === "$queryRawUnsafe" || p === "$queryRaw") return raw(p);
    if (p === "$executeRawUnsafe" || p === "$executeRaw") return async () => { counter.n++; return 0; };
    if (p === "then") return undefined; // not a thenable
    return model(p);
  }});
}

function load(relativePath, counter, cache) {
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
    if (s.includes("server/prisma")) return { prisma: makeCountingPrisma(counter) };
    if (s.includes("observability/trace")) return { traceQuery: (_l, fn) => fn(), withSpan: (_n, fn) => fn() };
    if (s.startsWith("@/")) return resolveAndLoad(resolve(rootDir, s.slice(2)), counter, cache);
    if (s.startsWith(".")) return resolveAndLoad(resolve(dirname(absolutePath), s), counter, cache);
    return require(s);
  };
  new Function("require", "module", "exports", output)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
function resolveAndLoad(base, counter, cache) {
  for (const c of [`${base}.ts`, `${base}/index.ts`, `${base}.tsx`]) if (existsSync(c)) return load(c.slice(rootDir.length + 1), counter, cache);
  return require(base);
}
