import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// R4 smoke: contacts workspace shaping — seniority enrichment from title (reusing
// the scoring dictionary) + facets. Pure.

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { shapeContact, shapeContactsWorkspace } = loadTsModule("lib/v2/crm/shapeContacts.ts");

const ceo = shapeContact({ id: "1", fullName: "Sarah Mitchell", title: "Chief Executive Officer", status: "ACTIVE", email: "sarah@x.io" });
assert.equal(ceo.seniorityTier, "C_LEVEL", "title -> seniority tier from the shared dictionary");
assert.equal(ceo.emailPresent, true);

const eng = shapeContact({ id: "2", fullName: "Joe Dev", title: "Software Engineer", status: "ACTIVE", email: null });
assert.equal(eng.seniorityTier, "IC");
assert.equal(eng.department, "ENGINEERING");
assert.equal(eng.emailPresent, false, "no email flagged");

const ws = shapeContactsWorkspace([
  { id: "1", fullName: "A", title: "CEO", status: "ACTIVE", email: "a@x.io" },
  { id: "2", fullName: "B", title: "VP Sales", status: "ACTIVE", email: "b@x.io" },
  { id: "3", fullName: "C", title: "Software Engineer", status: "ACTIVE", email: null },
]);
assert.equal(ws.facets.total, 3);
assert.equal(ws.facets.withEmail, 2);
assert.equal(ws.facets.bySeniority.C_LEVEL, 1);
assert.equal(ws.facets.bySeniority.VP, 1);
assert.equal(ws.facets.bySeniority.IC, 1);
console.log("PASS R4 contacts workspace (seniority enrichment + facets)");
console.log("PASS V2 contacts read-model (R4)");

function loadTsModule(relativePath) {
  const absolutePath = resolve(rootDir, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;
  const source = readFileSync(absolutePath, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const loadedModule = { exports: {} };
  moduleCache.set(absolutePath, loadedModule);
  const localRequire = (specifier) => {
    if (specifier === "server-only") return {};
    if (specifier.startsWith(".")) { const base = resolve(dirname(absolutePath), specifier); for (const c of [`${base}.ts`, `${base}/index.ts`]) if (existsSync(c)) return loadTsModule(c.slice(rootDir.length + 1)); }
    return require(specifier);
  };
  new Function("require", "module", "exports", output)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
