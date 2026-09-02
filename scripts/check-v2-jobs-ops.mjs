import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// R3 smoke: jobs operations summary + safe retry/cancel decisions. Pure.

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { summarizeJobs, decideRetry, decideCancel } = loadTsModule("lib/v2/jobs/ops/jobOps.ts");

const now = new Date();
const old = new Date(now.getTime() - 30 * 60 * 1000);
const rows = [
  { id: "1", jobType: "EMAIL_SEND", status: "QUEUED", retryCount: 0, createdAt: now },
  { id: "2", jobType: "EMAIL_SEND", status: "QUEUED", retryCount: 0, createdAt: old },
  { id: "3", jobType: "ICP_SCORE", status: "FAILED", retryCount: 2, createdAt: now },
  { id: "4", jobType: "ICP_SCORE", status: "SUCCEEDED", retryCount: 0, createdAt: now },
  { id: "5", jobType: "COMPANY_ENRICHMENT", status: "RUNNING", retryCount: 0, createdAt: now },
  { id: "6", jobType: "EMAIL_SEND", status: "RETRY_SCHEDULED", retryCount: 1, createdAt: now },
];
const s = summarizeJobs(rows, now);
assert.equal(s.totals.total, 6);
assert.equal(s.totals.queued, 2);
assert.equal(s.totals.failed, 1);
assert.equal(s.totals.running, 1);
assert.equal(s.totals.retryScheduled, 1);
assert.equal(s.totals.succeeded, 1);
assert.equal(s.stuckQueued, 1, "one QUEUED job is older than the stale threshold");
assert.equal(s.byType.EMAIL_SEND.total, 3);
assert.equal(s.byType.ICP_SCORE.failed, 1);
console.log("PASS jobs summary (by status/type, stuck-queued)");

// retry FAILED/RETRY_SCHEDULED/CANCELLED
assert.deepEqual(decideRetry({ status: "FAILED" }), { ok: true, nextStatus: "QUEUED" });
assert.deepEqual(decideRetry({ status: "RETRY_SCHEDULED" }), { ok: true, nextStatus: "QUEUED" });
assert.deepEqual(decideRetry({ status: "CANCELLED" }), { ok: true, nextStatus: "QUEUED" });
assert.equal(decideRetry({ status: "RUNNING" }).ok, false, "cannot retry RUNNING");
assert.equal(decideRetry({ status: "SUCCEEDED" }).ok, false);
// cancel only QUEUED/RETRY_SCHEDULED, never RUNNING
assert.deepEqual(decideCancel({ status: "QUEUED" }), { ok: true, nextStatus: "CANCELLED" });
assert.equal(decideCancel({ status: "RUNNING" }).ok, false, "never cancel RUNNING");
assert.equal(decideCancel({ status: "SUCCEEDED" }).ok, false);
console.log("PASS retry/cancel decisions (cancelled retries are explicit and safe)");
console.log("PASS V2 jobs operations read-model (R3)");

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
