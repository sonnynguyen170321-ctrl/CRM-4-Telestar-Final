// Unified V2 runtime worker — one canonical entry point with a pluggable backend.
//
//   --backend=db    (default) drain V2 jobs by POSTing the secret-gated drain route on
//                   an interval. Identical to the legacy v2-job-worker.mjs. Zero Redis.
//   --backend=bull  run BullMQ workers (Redis-backed). Only meaningful with
//                   V2_BULL_ENABLED=true + REDIS_URL. Wires the REAL per-queue processors
//                   via makeRuntimeWorkerHandlers(): scoring (plan/chunk/reduce), research
//                   (discover/fetch/extract), all ingestion stages, durable outreach/
//                   sequence/export jobs, and readmodel refresh. `v2.noop` remains only as
//                   a liveness probe alongside them.
//
// The backend defaults to "bull" when V2_BULL_ENABLED is truthy, else "db", so the same
// command does the right thing per environment. Local dev (no Redis) runs the db backend.
//
// Env: V2_WORKER_APP_URL (falls back to APP_URL/NEXT_PUBLIC_APP_URL/APP_BASE_URL),
//      V2_WORKER_SECRET, V2_WORKER_INTERVAL_MS (db backend);
//      REDIS_URL, V2_BULL_PREFIX, V2_BULL_WORKER_ID (bull backend).

import { readFileSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const args = process.argv.slice(2);
function arg(name, fallback) {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
function bullEnabled() {
  const v = (process.env.V2_BULL_ENABLED ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

// Load .env up front so the backend auto-pick (and bullEnabled) see file-based config.
loadEnvFiles([".env.local", ".env", ".env.production"]);

const backend = arg("backend", bullEnabled() ? "bull" : "db");

if (backend === "bull") {
  await runBullBackend();
} else {
  await runDbBackend();
}

// --- db backend: drain via the HTTP route (legacy behavior, verbatim) ---
async function runDbBackend() {
  const baseUrl = workerBaseUrl();
  const secret = process.env.V2_WORKER_SECRET;
  const intervalMs = Number(process.env.V2_WORKER_INTERVAL_MS ?? 15000);

  if (!secret) {
    console.error("V2_WORKER_SECRET is required for the db backend.");
    process.exit(1);
  }

  async function drainOnce() {
    try {
      const res = await fetch(`${baseUrl}/v2/outreach/drain`, {
        method: "POST",
        headers: { "x-v2-worker-secret": secret },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error(`[v2-runtime:db] drain failed ${res.status}:`, body.error ?? "");
        return;
      }
      if (body.processed > 0 || (body.reaped && body.reaped.retryScheduled > 0)) {
        console.log(
          `[v2-runtime:db] drained ${body.processed} (${body.stoppedReason})`,
          JSON.stringify({ summary: body.summary, reaped: body.reaped })
        );
      }
    } catch (error) {
      console.error("[v2-runtime:db] error:", error instanceof Error ? error.message : error);
    }
  }

  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    await drainOnce();
    process.exit(0);
  }

  console.log(`[v2-runtime:db] draining V2 jobs every ${intervalMs}ms at ${baseUrl}`);
   
  while (true) {
    await drainOnce();
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
function workerBaseUrl() {
  return (
    process.env.V2_WORKER_APP_URL ||
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_BASE_URL ||
    "http://localhost:3000"
  ).replace(/\/+$/, "");
}
// --- bull backend: Redis-backed workers (real scoring fan-out, R3) ---
async function runBullBackend() {
  // Load .env FIRST so V2_BULL_ENABLED / REDIS_URL from the file are honored (the
  // top-level backend pick can't see them yet).
  loadEnvFiles([".env.local", ".env", ".env.production"]);

  if (!bullEnabled()) {
    console.error("[v2-runtime:bull] V2_BULL_ENABLED is not true — refusing to start the bull backend.");
    process.exit(1);
  }
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.error("[v2-runtime:bull] REDIS_URL is required for the bull backend.");
    process.exit(1);
  }

  const { Worker } = await import("bullmq");
  const { default: IORedis } = await import("ioredis");
  // `{...}` hash tag pins all keys to one slot — required on cluster-mode Redis
  // (ElastiCache Serverless) or multi-key ops fail CROSSSLOT. Must match bullPrefix().
  const prefix = process.env.V2_BULL_PREFIX?.trim() || "{telestar:v2}";
  const workerId = process.env.V2_BULL_WORKER_ID?.trim() || `v2-runtime-${process.pid}`;
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

  // R3: load the real scoring handlers (plan/chunk/reduce) from TypeScript at runtime,
  // the same transpile approach the db worker uses. The noop stays as a liveness probe.
  const { makeRuntimeWorkerHandlers, recordRuntimeHeartbeat, handleJobFailure } = loadTsModule("lib/v2/bullmq/events.ts");
  const handlers = makeRuntimeWorkerHandlers();

  // Per-queue concurrency: process several at once (a single fetch crawls ~30s, so a
  // batch behind concurrency=1 backs up badly). Network-heavy fetch stays modest.
  const numEnv = (name, fallback) => {
    const n = Number(process.env[name]);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const concurrencyFor = (queueName) => ({
    "v2.noop": 1,
    "v2.research.discover": numEnv("V2_BULL_RESEARCH_DISCOVER_CONCURRENCY", 5),
    "v2.research.fetch": numEnv("V2_BULL_RESEARCH_FETCH_CONCURRENCY", 4),
    "v2.research.extract": numEnv("V2_BULL_RESEARCH_EXTRACT_CONCURRENCY", 4),
    "v2.scoring.plan": numEnv("V2_BULL_SCORING_PLAN_CONCURRENCY", 4),
    "v2.scoring.chunk": numEnv("V2_BULL_SCORING_CHUNK_CONCURRENCY", 4),
    "v2.scoring.reduce": numEnv("V2_BULL_SCORING_REDUCE_CONCURRENCY", 4),
    // Ingestion stages bridge to the V2Job runtime; each stage handler loops batches
    // internally, so a single worker per stage already drains a whole job. Concurrency
    // here = how many DISTINCT ingestion jobs advance in parallel per stage.
    "v2.ingest.parse": numEnv("V2_BULL_INGEST_PARSE_CONCURRENCY", 3),
    "v2.ingest.normalize": numEnv("V2_BULL_INGEST_NORMALIZE_CONCURRENCY", 3),
    "v2.ingest.identity": numEnv("V2_BULL_INGEST_IDENTITY_CONCURRENCY", 3),
    "v2.ingest.lead-upsert": numEnv("V2_BULL_INGEST_LEAD_UPSERT_CONCURRENCY", 3),
    "v2.ingest.activity": numEnv("V2_BULL_INGEST_ACTIVITY_CONCURRENCY", 3),
    "v2.ingest.activity-apply": numEnv("V2_BULL_INGEST_ACTIVITY_APPLY_CONCURRENCY", 3),
    // Enrichment is network-bound (crawl + SERP; rules-only when AI is off), so it
    // parallelizes safely — 12 default (override per env/infra). Pair with a DB pool
    // (V2_DB_POOL_MAX) >= this so connections don't starve.
    "v2.ingest.enrich": numEnv("V2_BULL_INGEST_ENRICH_CONCURRENCY", 12),
    "v2.ingest.score": numEnv("V2_BULL_INGEST_SCORE_CONCURRENCY", 8),
  })[queueName] ?? 2;

  const workers = [];
  const make = (queueName, handler) => {
    const w = new Worker(queueName, async (job) => handler(job.data), { connection, prefix, concurrency: concurrencyFor(queueName) });
    w.on("failed", (job, err) => {
      console.error(`[v2-runtime:bull] ${queueName} failed`, job?.id, err?.message);
      if (job) {
        handleJobFailure(queueName, job.data, job.attemptsMade, job.opts?.attempts ?? 1).catch((e) =>
          console.error(`[v2-runtime:bull] ${queueName} failure-hook error`, e?.message)
        );
      }
    });
    w.on("error", (err) => console.error(`[v2-runtime:bull] ${queueName} error`, err?.message));
    workers.push(w);
    return w;
  };

  make("v2.noop", async (data) => ({ ok: true, echo: data }));
  for (const [queueName, handler] of Object.entries(handlers)) make(queueName, handler);

  const queueNames = ["v2.noop", ...Object.keys(handlers)];
  console.log(`[v2-runtime:bull] workers listening on ${prefix}: ${queueNames.join(", ")}`);

  // Heartbeat so the runtime UI can see the worker is alive.
  const beat = async () => {
    try { await recordRuntimeHeartbeat({ workerId, queueName: "v2.scoring", status: "ONLINE", pid: process.pid }); }
    catch (err) { console.error("[v2-runtime:bull] heartbeat error", err?.message); }
  };
  await beat();
  const heartbeatTimer = setInterval(beat, 15_000);

  const shutdown = async () => {
    clearInterval(heartbeatTimer);
    await Promise.all(workers.map((w) => w.close().catch(() => undefined)));
    await connection.quit().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// --- runtime TypeScript loader (transpile-on-load), mirrors process-v2-jobs.mjs ---
function loadEnvFiles(fileNames) {
  for (const fileName of fileNames) {
    const filePath = resolve(rootDir, fileName);
    if (!existsSync(filePath)) continue;
    for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      const rawValue = trimmed.slice(index + 1).trim();
      if (key && process.env[key] === undefined) process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }
}

function loadTsModule(relativePath) {
  const absolutePath = isAbsolute(relativePath) ? relativePath : resolve(rootDir, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;
  const ts = require("typescript");
  const source = readFileSync(absolutePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  // Neutralize `import.meta` — the transpiled CommonJS runs inside `new Function`, which
  // is not an ES module, so any `import.meta(.url)` reference would throw at parse time.
  const moduleUrl = JSON.stringify(pathToFileURL(absolutePath).href);
  const output = transpiled
    .split("import.meta.url").join(moduleUrl)
    .split("import.meta").join(`({ url: ${moduleUrl} })`);
  const loadedModule = { exports: {} };
  moduleCache.set(absolutePath, loadedModule);
  const localRequire = (specifier) => {
    if (specifier === "server-only") return {};
    if (specifier.startsWith("@/")) return loadTsModule(resolveTsModulePath(rootDir, specifier.slice(2)));
    if (!specifier.startsWith(".")) return require(specifier);
    return loadTsModule(resolveTsModulePath(dirname(absolutePath), specifier));
  };
  new Function("require", "module", "exports", output)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

function resolveTsModulePath(baseDir, specifier) {
  const modulePath = resolve(baseDir, specifier);
  const candidates = [modulePath, `${modulePath}.ts`, `${modulePath}.tsx`, resolve(modulePath, "index.ts"), resolve(modulePath, "index.tsx")];
  const resolved = candidates.find((p) => { try { return statSync(p).isFile(); } catch { return false; } });
  if (!resolved) throw new Error(`Unable to resolve TypeScript module '${specifier}' from '${baseDir}'.`);
  return resolved;
}
