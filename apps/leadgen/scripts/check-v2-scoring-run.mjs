// R2 smoke: pure chunk-count planning for a scoring run. The heavy scoring/runtime/prisma
// deps are stubbed (planChunkCount needs none), so this stays a fast pure check. No DB.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { planChunkCount } = load("lib/v2/scoring/runtime/createScoringRun.ts");

assert.equal(planChunkCount(0, 100), 0, "empty selection => 0 chunks");
assert.equal(planChunkCount(50, 100), 1, "under one batch => 1 chunk");
assert.equal(planChunkCount(100, 100), 1, "exact batch => 1 chunk");
assert.equal(planChunkCount(101, 100), 2, "spillover => 2 chunks");
assert.equal(planChunkCount(2500, 500), 5, "even split => 5 chunks");
assert.equal(planChunkCount(2501, 500), 6, "odd split => 6 chunks");
assert.equal(planChunkCount(10, 0), 0, "zero batch size => 0 (guard)");

console.log("PASS V2 scoring-run smoke (chunk-count planning)");

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
    // Stub the heavy graph — planChunkCount needs none of it.
    if (s.includes("scoreLeadAssignments")) return { resolveLeadAssignmentIds: async () => [] };
    if (s.includes("runtimeStore")) return new Proxy({}, { get: () => async () => undefined });
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
