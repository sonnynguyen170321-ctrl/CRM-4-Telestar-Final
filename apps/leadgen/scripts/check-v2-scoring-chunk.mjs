// R3 smoke: pure chunk id-slicing for BullMQ scoring chunks. Heavy deps stubbed. No DB.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { sliceChunkIds } = load("lib/v2/scoring/runtime/scoreScoringChunk.ts");

const ids = Array.from({ length: 250 }, (_, i) => `la_${i}`);
assert.equal(sliceChunkIds(ids, 0, 100).length, 100, "chunk 0 => first 100");
assert.equal(sliceChunkIds(ids, 0, 100)[0], "la_0");
assert.equal(sliceChunkIds(ids, 1, 100)[0], "la_100", "chunk 1 starts at 100");
assert.equal(sliceChunkIds(ids, 2, 100).length, 50, "last chunk is the remainder");
assert.equal(sliceChunkIds(ids, 3, 100).length, 0, "out-of-range chunk => empty");
assert.equal(sliceChunkIds(ids, 0, 0).length, 0, "zero batch => empty (guard)");
// Non-overlapping + full coverage across chunks.
const reassembled = [...sliceChunkIds(ids, 0, 100), ...sliceChunkIds(ids, 1, 100), ...sliceChunkIds(ids, 2, 100)];
assert.deepEqual(reassembled, ids, "chunks tile the id list with no gaps/overlap");

console.log("PASS V2 scoring-chunk smoke (deterministic id slicing)");

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
    if (s.includes("scoreLeadAssignments")) return { scoreLeadAssignments: async () => ({ counts: { processed: 0 } }) };
    if (s.includes("runtimeStore")) return new Proxy({}, { get: () => async () => "SUCCEEDED" });
    if (s.includes("server/prisma")) return { prisma: { $queryRawUnsafe: async () => [] } };
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
