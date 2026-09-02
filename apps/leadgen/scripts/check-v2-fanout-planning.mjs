// S1 fan-out planning smoke — pure (no DB). Verifies pair dedupe + stable order +
// project counting that keep the fan-out idempotent (no duplicate assignments).
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { dedupeProjectIcpPairs, distinctProjectCount } = loadTsModule("lib/v2/scoring/runtime/fanOutPlanning.ts");

// dedupe identical pairs + trim, stable sort
{
  const out = dedupeProjectIcpPairs([
    { projectId: "p2", icpVersionId: "v9" },
    { projectId: "p1", icpVersionId: "v2" },
    { projectId: "p1", icpVersionId: "v2" }, // dup
    { projectId: "p1", icpVersionId: "v1" },
    { projectId: " p2 ", icpVersionId: " v9 " }, // dup after trim
  ]);
  assert.deepEqual(out, [
    { projectId: "p1", icpVersionId: "v1" },
    { projectId: "p1", icpVersionId: "v2" },
    { projectId: "p2", icpVersionId: "v9" },
  ]);
  assert.equal(distinctProjectCount(out), 2);
}

// drops blanks
{
  const out = dedupeProjectIcpPairs([
    { projectId: "", icpVersionId: "v1" },
    { projectId: "p1", icpVersionId: "" },
    { projectId: "p1", icpVersionId: "v1" },
  ]);
  assert.deepEqual(out, [{ projectId: "p1", icpVersionId: "v1" }]);
}

// empty
assert.deepEqual(dedupeProjectIcpPairs([]), []);
assert.equal(distinctProjectCount([]), 0);

console.log("PASS V2 fan-out planning smoke");

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
