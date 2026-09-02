// R1 smoke: pure runtime-status rollup. No DB. Proves the run terminal/partial logic
// the UI badge depends on.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { rollupRunStatus } = load("lib/v2/runtime/types.ts");

const r = (total, succeeded, failed, running, queued) => rollupRunStatus({ total, succeeded, failed, running, queued });
assert.equal(r(0, 0, 0, 0, 0), "QUEUED", "no chunks => QUEUED");
assert.equal(r(4, 0, 0, 0, 4), "QUEUED", "all queued => QUEUED");
assert.equal(r(4, 1, 0, 1, 2), "RUNNING", "in flight => RUNNING");
assert.equal(r(4, 4, 0, 0, 0), "SUCCEEDED", "all ok => SUCCEEDED");
assert.equal(r(4, 0, 4, 0, 0), "FAILED", "all failed => FAILED");
assert.equal(r(4, 3, 1, 0, 0), "PARTIAL", "mixed terminal => PARTIAL");
assert.equal(r(4, 2, 1, 0, 1), "RUNNING", "one still queued => RUNNING, not PARTIAL");

console.log("PASS V2 runtime mirror smoke (run status rollup)");

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
