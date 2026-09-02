// AI1 mock-only smoke: the pure AI gate decision (AI never forced) + budget math.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { decideAiGate, creditsRemaining, budgetPercentUsed } = load("lib/v2/ai/aiGate.ts");

const base = { organizationId: "o", enabled: true, mode: "UNCERTAIN_ONLY", provider: "GEMINI", defaultModelId: "m", maxRowsPerUpload: 100, dailyCreditBudget: 2000, resultHandling: "APPEND_ONLY", environment: "production" };

// disabled => never runs
assert.equal(decideAiGate({ ...base, enabled: false }, { uncertain: true, creditsUsedToday: 0 }).reason, "disabled");
// mode OFF => never
assert.equal(decideAiGate({ ...base, mode: "OFF" }, { uncertain: true, creditsUsedToday: 0 }).reason, "mode_off");
// UNCERTAIN_ONLY + not uncertain => skip
assert.equal(decideAiGate(base, { uncertain: false, creditsUsedToday: 0 }).allow, false);
assert.equal(decideAiGate(base, { uncertain: false, creditsUsedToday: 0 }).reason, "not_uncertain");
// UNCERTAIN_ONLY + uncertain => allow
assert.equal(decideAiGate(base, { uncertain: true, creditsUsedToday: 0 }).allow, true);
// ALL => allow regardless of uncertainty
assert.equal(decideAiGate({ ...base, mode: "ALL" }, { uncertain: false, creditsUsedToday: 0 }).allow, true);
// over budget => skip
assert.equal(decideAiGate(base, { uncertain: true, creditsUsedToday: 2000 }).reason, "over_budget");
assert.equal(decideAiGate({ ...base, mode: "ALL" }, { uncertain: false, creditsUsedToday: 2001 }).allow, false);

// budget math
assert.equal(creditsRemaining(base, 1248), 752);
assert.equal(budgetPercentUsed(base, 1248), 62);
assert.equal(budgetPercentUsed({ ...base, dailyCreditBudget: 0 }, 5), 0);

console.log("PASS V2 AI gate smoke (never-forced + budget)");

function load(relativePath) {
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
  for (const c of [`${base}.ts`, `${base}/index.ts`, `${base}.tsx`]) if (existsSync(c)) return load(c.slice(rootDir.length + 1));
  return require(base);
}
