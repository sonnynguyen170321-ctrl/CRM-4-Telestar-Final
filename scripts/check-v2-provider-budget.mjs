// P4 smoke: pure provider-budget gate + daily-cap env read. Prisma stubbed. No DB.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { overBudget, readProviderDailyCap } = load("lib/v2/company-intelligence/providerBudget.ts");

assert.equal(overBudget(0, 5000), false, "fresh => under");
assert.equal(overBudget(4999, 5000), false, "below cap => under");
assert.equal(overBudget(5000, 5000), true, "at cap => over");
assert.equal(overBudget(9999, 5000), true, "above cap => over");
assert.equal(overBudget(10, 0), false, "cap 0 => unlimited");

assert.equal(readProviderDailyCap({}), 5000, "default cap 5000");
assert.equal(readProviderDailyCap({ COMPANY_INTEL_MAX_PROVIDER_CALLS_PER_ORG_PER_DAY: "100" }), 100, "env cap honored");
assert.equal(readProviderDailyCap({ COMPANY_INTEL_MAX_PROVIDER_CALLS_PER_ORG_PER_DAY: "0" }), 0, "0 => unlimited");
assert.equal(readProviderDailyCap({ COMPANY_INTEL_MAX_PROVIDER_CALLS_PER_ORG_PER_DAY: "nope" }), 5000, "bad value => default");

console.log("PASS V2 provider-budget smoke (gate + cap)");

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
    if (s.includes("server/prisma")) return { prisma: {} };
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
