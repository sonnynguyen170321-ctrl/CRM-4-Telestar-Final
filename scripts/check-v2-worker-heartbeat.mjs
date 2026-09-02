// Worker heartbeat staleness smoke — pure, no DB.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { evaluateHeartbeat, DEFAULT_HEARTBEAT_MAX_AGE_MS } = loadTsModule(
  "lib/v2/outreach/worker/heartbeat.ts"
);

const now = new Date("2026-06-20T12:00:00Z");

// fresh -> OK healthy
{
  const r = evaluateHeartbeat(new Date(now.getTime() - 60_000), { now });
  assert.equal(r.reason, "OK");
  assert.equal(r.healthy, true);
}
// stale -> unhealthy (both dev + prod)
{
  const old = new Date(now.getTime() - DEFAULT_HEARTBEAT_MAX_AGE_MS - 1000);
  assert.equal(evaluateHeartbeat(old, { now }).reason, "STALE");
  assert.equal(evaluateHeartbeat(old, { now }).healthy, false);
  assert.equal(evaluateHeartbeat(old, { now, isProduction: true }).healthy, false);
}
// never recorded -> tolerated in dev, blocked in prod
{
  assert.equal(evaluateHeartbeat(null, { now }).reason, "NEVER");
  assert.equal(evaluateHeartbeat(null, { now, isProduction: false }).healthy, true);
  assert.equal(evaluateHeartbeat(null, { now, isProduction: true }).healthy, false);
}
// custom maxAge boundary
{
  const at = new Date(now.getTime() - 10_000);
  assert.equal(evaluateHeartbeat(at, { now, maxAgeMs: 5_000 }).reason, "STALE");
  assert.equal(evaluateHeartbeat(at, { now, maxAgeMs: 20_000 }).reason, "OK");
}

console.log("PASS V2 worker heartbeat staleness smoke");

function loadTsModule(relativePath) {
  const absolutePath = resolve(rootDir, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;
  const source = readFileSync(absolutePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const moduleUrl = JSON.stringify(pathToFileURL(absolutePath).href);
  const output = transpiled.split("import.meta.url").join(moduleUrl).split("import.meta").join(`({ url: ${moduleUrl} })`);
  const loadedModule = { exports: {} };
  moduleCache.set(absolutePath, loadedModule);
  const localRequire = (s) => {
    if (s === "server-only") return {};
    if (s === "@/lib/server/prisma" || s.endsWith("lib/server/prisma")) return { prisma: null };
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
