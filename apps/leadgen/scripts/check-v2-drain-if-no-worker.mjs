// Track R smoke: drain inline ONLY when no live job worker will process the job (so a
// running worker makes the action non-blocking, but the zero-worker pilot still works).
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { shouldDrainInline } = load("lib/v2/jobs/drainIfNoWorker.ts");

assert.equal(shouldDrainInline(true), false, "healthy worker => let it process, no inline drain");
assert.equal(shouldDrainInline(false), true, "no/stale worker => drain inline (pilot fallback)");
console.log("PASS shouldDrainInline policy");
console.log("PASS V2 drain-if-no-worker smoke");

function load(relativePath) {
  const absolutePath = resolve(rootDir, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;
  const source = readFileSync(absolutePath, "utf8");
  const transpiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const loadedModule = { exports: {} };
  moduleCache.set(absolutePath, loadedModule);
  const localRequire = (s) => {
    if (s === "server-only") return {};
    if (s.includes("processJob")) return { processNextV2Job: async () => ({ kind: "no_job" }) };
    if (s.includes("queryWorkerHealth")) return { queryWorkerHealth: async () => ({ workers: [], backlog: {}, warning: null }) };
    if (s.startsWith("@/")) return resolveAndLoad(resolve(rootDir, s.slice(2)));
    if (s.startsWith(".")) return resolveAndLoad(resolve(dirname(absolutePath), s));
    return require(s);
  };
  new Function("require", "module", "exports", transpiled)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
function resolveAndLoad(base) {
  for (const c of [`${base}.ts`, `${base}/index.ts`, `${base}.tsx`]) if (existsSync(c)) return load(c.slice(rootDir.length + 1));
  return require(base);
}
