// P6 smoke: the pure retry-mode decision. failedCount<=0 => "none"; failures but no bull
// worker => "unavailable"; failures + bull => "bull". Heavy deps (prisma/bullmq) stubbed.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { decideRetryMode } = load("lib/v2/scoring/runtime/retryScoringRun.ts");

assert.equal(decideRetryMode({ failedCount: 0, bullEnabled: true }), "none", "nothing failed => none");
assert.equal(decideRetryMode({ failedCount: 0, bullEnabled: false }), "none", "nothing failed => none (no bull)");
assert.equal(decideRetryMode({ failedCount: 3, bullEnabled: false }), "unavailable", "failures + no bull => unavailable");
assert.equal(decideRetryMode({ failedCount: 3, bullEnabled: true }), "bull", "failures + bull => bull");
assert.equal(decideRetryMode({ failedCount: -1, bullEnabled: true }), "none", "negative guarded => none");

console.log("PASS V2 scoring-retry smoke (retry-mode decision)");

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
    if (s.includes("bullmq/config")) return { isBullEnabled: () => false };
    if (s.includes("bullmq/queueNames")) return { V2_QUEUE_NAMES: { scoringPlan: "v2.scoring.plan" } };
    if (s.includes("bullmq/queues")) return { addJob: async () => undefined };
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
