// P0.2 smoke: worker-health shaping must warn when work is queued but the job worker
// is dead/stale, and stay quiet when it's live. Pure (no DB).

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { shapeWorkerHealth } = loadTsModule("lib/v2/jobs/queryWorkerHealth.ts");

const NOW = new Date("2026-06-23T12:00:00Z");
const fresh = new Date(NOW.getTime() - 30_000); // 30s ago
const stale = new Date(NOW.getTime() - 20 * 60_000); // 20m ago

// 1. Stale job worker + queued work -> a warning telling the user to start it.
{
  const h = shapeWorkerHealth({
    heartbeats: [{ workerKind: "job_worker", lastBeatAt: stale }],
    backlog: { queued: 51, running: 6, retryScheduled: 0 },
    now: NOW,
  });
  assert.ok(h.warning && /stale/i.test(h.warning) && /51/.test(h.warning), `expected stale warning, got: ${h.warning}`);
  const jw = h.workers.find((w) => w.kind === "job_worker");
  assert.equal(jw.healthy, false);
  assert.equal(jw.reason, "STALE");
  assert.deepEqual(h.backlog, { queued: 51, running: 6, retryScheduled: 0 });
}
console.log("PASS stale worker + backlog -> warning + STALE status");

// 2. Fresh job worker -> no warning even with a backlog (it's draining).
{
  const h = shapeWorkerHealth({
    heartbeats: [{ workerKind: "job_worker", lastBeatAt: fresh }],
    backlog: { queued: 10, running: 1, retryScheduled: 0 },
    now: NOW,
  });
  assert.equal(h.warning, null, "live worker -> no warning");
  assert.equal(h.workers.find((w) => w.kind === "job_worker").healthy, true);
}
console.log("PASS live worker -> no warning");

// 3. Never-seen worker in production is unhealthy; with queued work -> 'not running'.
{
  const h = shapeWorkerHealth({
    heartbeats: [],
    backlog: { queued: 3, running: 0, retryScheduled: 2 },
    now: NOW,
    isProduction: true,
  });
  const jw = h.workers.find((w) => w.kind === "job_worker");
  assert.equal(jw.reason, "NEVER");
  assert.equal(jw.healthy, false);
  assert.ok(/not running/i.test(h.warning) && /5\b/.test(h.warning), `queued+retry counted, got: ${h.warning}`);
}
console.log("PASS never-seen worker in prod -> unhealthy + 'not running' warning (queued+retry)");

// 4. No backlog + dead worker -> no warning (nothing waiting).
{
  const h = shapeWorkerHealth({
    heartbeats: [{ workerKind: "job_worker", lastBeatAt: stale }],
    backlog: { queued: 0, running: 0, retryScheduled: 0 },
    now: NOW,
  });
  assert.equal(h.warning, null, "no work waiting -> no warning even if worker is stale");
}
console.log("PASS dead worker but empty backlog -> no warning");

console.log("PASS V2 worker health (P0.2)");

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
  const localRequire = (specifier) => {
    if (specifier === "server-only") return {};
    if (specifier === "@/lib/server/prisma" || specifier.endsWith("lib/server/prisma")) return { prisma: null };
    if (specifier.startsWith("@/")) return resolveAndLoad(resolve(rootDir, specifier.slice(2)));
    if (specifier.startsWith(".")) return resolveAndLoad(resolve(dirname(absolutePath), specifier));
    return require(specifier);
  };
  new Function("require", "module", "exports", output)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

function resolveAndLoad(base) {
  for (const candidate of [`${base}.ts`, `${base}/index.ts`, `${base}.tsx`]) {
    if (existsSync(candidate)) return loadTsModule(candidate.slice(rootDir.length + 1));
  }
  return require(base);
}
