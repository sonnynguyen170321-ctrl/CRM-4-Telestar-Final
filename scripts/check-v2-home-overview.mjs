import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// R1 smoke: home command-center overview shaping (funnel rates, next actions).
// Every number maps to a real count (no fabricated data). Pure.

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { buildHomeOverview } = loadTsModule("lib/v2/home/buildHomeOverview.ts");

const o = buildHomeOverview({
  activeAccounts: 4, activeProjects: 9, publishedIcps: 12, companiesInReview: 18,
  leadsAssigned: 612, meetingsBooked: 27,
  totalLeads: 800, qualified: 200, inProgress: 120, meetingSet: 27, won: 10,
  openReviewItems: 18, queuedJobs: 5, failedJobs: 2,
});

assert.equal(o.metrics.activeAccounts, 4);
assert.equal(o.metrics.leadsAssigned, 612);
assert.equal(o.funnel.qualifiedRate, Number((200 / 800).toFixed(4)), "qualified rate from real counts");
assert.equal(o.funnel.winRate, Number((10 / 800).toFixed(4)));
assert.ok(o.nextActions.some((a) => a.id === "review" && a.count === 18 && a.href === "/v2/reviews"), "review next action");
assert.ok(o.nextActions.some((a) => a.id === "failed_jobs" && a.href === "/v2/jobs"), "failed jobs next action");
assert.deepEqual(o.dataHealth, { queuedJobs: 5, failedJobs: 2 });

// zero state: no divide-by-zero, no fabricated actions
const z = buildHomeOverview({ activeAccounts: 0, activeProjects: 0, publishedIcps: 0, companiesInReview: 0, leadsAssigned: 0, meetingsBooked: 0, totalLeads: 0, qualified: 0, inProgress: 0, meetingSet: 0, won: 0, openReviewItems: 0, queuedJobs: 0, failedJobs: 0 });
assert.equal(z.funnel.qualifiedRate, 0);
assert.equal(z.nextActions.length, 0, "no next actions when nothing pending");
console.log("PASS R1 home overview (funnel rates, next actions, zero-state)");
console.log("PASS V2 home command-center read-model (R1)");

function loadTsModule(relativePath) {
  const absolutePath = resolve(rootDir, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;
  const source = readFileSync(absolutePath, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const loadedModule = { exports: {} };
  moduleCache.set(absolutePath, loadedModule);
  const localRequire = (specifier) => {
    if (specifier === "server-only") return {};
    if (specifier.startsWith(".")) { const base = resolve(dirname(absolutePath), specifier); for (const c of [`${base}.ts`, `${base}/index.ts`]) if (existsSync(c)) return loadTsModule(c.slice(rootDir.length + 1)); }
    return require(specifier);
  };
  new Function("require", "module", "exports", output)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
