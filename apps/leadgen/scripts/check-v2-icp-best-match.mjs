// S1 multi-ICP best-match ranker smoke — pure (no DB). Verifies qualification
// ordering, fit/confidence tiebreaks, the no-overclaim "confident" flag, and gap
// reasons.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { rankIcpAssignments } = loadTsModule("lib/v2/crm/icpBestMatchRanking.ts");

function row(over) {
  return {
    leadAssignmentId: "la_x",
    projectId: "p1",
    projectName: "P1",
    icpProfileName: "ICP",
    icpVersionNumber: 1,
    workflowStatus: "NEW",
    qualification: "NOT_SCORED",
    accountPreRank: null,
    fitScore: null,
    confidenceScore: null,
    ownerUserId: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    ...over,
  };
}

// QUALIFIED beats NEEDS_REVIEW regardless of fit
{
  const r = rankIcpAssignments([
    row({ leadAssignmentId: "a", qualification: "NEEDS_REVIEW", fitScore: 99 }),
    row({ leadAssignmentId: "b", qualification: "QUALIFIED", fitScore: 40 }),
  ]);
  assert.equal(r.best.leadAssignmentId, "b");
  assert.equal(r.confident, true);
  assert.equal(r.ranked.find((x) => x.leadAssignmentId === "a").gapReason !== null, true);
}

// fit tiebreak within same qualification
{
  const r = rankIcpAssignments([
    row({ leadAssignmentId: "a", qualification: "QUALIFIED", fitScore: 70 }),
    row({ leadAssignmentId: "b", qualification: "QUALIFIED", fitScore: 85 }),
  ]);
  assert.equal(r.best.leadAssignmentId, "b");
  assert.match(r.ranked.find((x) => x.leadAssignmentId === "a").gapReason, /Lower fit/);
}

// NOT_SCORED ranks above a decided UNQUALIFIED, and best is NOT confident
{
  const r = rankIcpAssignments([
    row({ leadAssignmentId: "a", qualification: "UNQUALIFIED", fitScore: 10 }),
    row({ leadAssignmentId: "b", qualification: "NOT_SCORED" }),
  ]);
  assert.equal(r.best.leadAssignmentId, "b");
  assert.equal(r.confident, false, "an unscored best is not a confident match");
}

// empty + single
{
  assert.equal(rankIcpAssignments([]).best, null);
  const one = rankIcpAssignments([row({ leadAssignmentId: "solo", qualification: "QUALIFIED", fitScore: 50 })]);
  assert.equal(one.best.isBest, true);
  assert.equal(one.best.gapReason, null);
  assert.equal(one.totalIcps, 1);
}

console.log("PASS V2 ICP best-match ranker smoke");

function loadTsModule(relativePath) {
  const absolutePath = resolve(rootDir, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;
  const source = readFileSync(absolutePath, "utf8");
  const transpiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const moduleUrl = JSON.stringify(pathToFileURL(absolutePath).href);
  const output = transpiled.split("import.meta.url").join(moduleUrl).split("import.meta").join(`({ url: ${moduleUrl} })`);
  const loadedModule = { exports: {} };
  moduleCache.set(absolutePath, loadedModule);
  const localRequire = (s) => {
    if (s === "server-only") return {};
    if (s.startsWith("@/")) return resolveAndLoad(resolve(rootDir, s.slice(2)));
    if (s.startsWith(".")) return resolveAndLoad(resolve(dirname(absolutePath), s));
    return require(s);
  };
  new Function("require", "module", "exports", output)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
function resolveAndLoad(base) {
  for (const c of [`${base}.ts`, `${base}/index.ts`, `${base}.tsx`]) if (existsSync(c)) return loadTsModule(c.slice(rootDir.length + 1));
  return require(base);
}
