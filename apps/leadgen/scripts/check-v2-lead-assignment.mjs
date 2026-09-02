// M1 lead-assignment classifier smoke — pure (no DB). Verifies the no-op vs change
// decision that guards a redundant assignment write + audit row.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { classifyAssignment } = loadTsModule("lib/v2/crm/assignLead.ts");

// reassign to a different owner = change
assert.equal(classifyAssignment("u_1", "u_2"), "assign");
// assign a previously-unassigned lead = change
assert.equal(classifyAssignment(null, "u_2"), "assign");
// unassign an owned lead = change
assert.equal(classifyAssignment("u_1", null), "assign");
// same owner = no-op
assert.equal(classifyAssignment("u_1", "u_1"), "no_change");
// still unassigned = no-op (null vs undefined-ish both treated null)
assert.equal(classifyAssignment(null, null), "no_change");

console.log("PASS V2 lead-assignment classifier smoke");

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
