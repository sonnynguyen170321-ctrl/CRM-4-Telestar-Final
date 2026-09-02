// D0 smoke: the pure budget policy for the trace layer — a loader is slow when it blows
// the query-count budget OR the time budget; topSlowQueries ranks by duration. No clock.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { isSlowLoader, topSlowQueries } = load("lib/v2/observability/trace.ts");

// query-count budget
assert.equal(isSlowLoader({ queryCount: 26, totalMs: 50, queryBudget: 8, slowLoaderMs: 500 }), true, "26 queries > 8 budget => slow");
assert.equal(isSlowLoader({ queryCount: 3, totalMs: 50, queryBudget: 8, slowLoaderMs: 500 }), false, "fast + few => not slow");
// time budget
assert.equal(isSlowLoader({ queryCount: 2, totalMs: 800, queryBudget: 8, slowLoaderMs: 500 }), true, "800ms >= 500 => slow");
assert.equal(isSlowLoader({ queryCount: 8, totalMs: 499, queryBudget: 8, slowLoaderMs: 500 }), false, "at budget edge => not slow");
console.log("PASS isSlowLoader budget policy");

const ranked = topSlowQueries(
  [
    { label: "a", durationMs: 10, rowCount: 1 },
    { label: "b", durationMs: 300, rowCount: 2 },
    { label: "c", durationMs: 120, rowCount: 3 },
  ],
  2
);
assert.deepEqual(ranked.map((r) => r.label), ["b", "c"], "slowest first, limited to n");
console.log("PASS topSlowQueries ranking");

console.log("PASS V2 trace smoke (D0)");

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
