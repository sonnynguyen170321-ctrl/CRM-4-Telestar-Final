import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import pg from "pg";

loadEnvFiles([".env.local", ".env", ".env.production"]);

const args = parseArgs(process.argv.slice(2));
const runId = args.get("runId") ?? null;
const jobId = args.get("jobId") ?? null;
const organizationId = args.get("organizationId") ?? null;

if (!runId && !jobId) {
  console.error("Usage: node scripts/diagnose-v2-job-runtime.mjs --runId=<id> [--organizationId=<org>] or --jobId=<id>");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const out = { run: null, chunks: [], jobs: [], workerHints: {} };

  if (runId) {
    const run = await queryOne(
      `SELECT "id", "organizationId", "runType", "status", "totalUnits", "processedUnits", "succeededUnits", "failedUnits", "configJson", "createdAt", "updatedAt", "finishedAt"
         FROM "V2RuntimeRun"
        WHERE "id" = $1 AND ($2::text IS NULL OR "organizationId" = $2)
        LIMIT 1`,
      [runId, organizationId]
    );
    out.run = run;
    const org = organizationId ?? run?.organizationId ?? null;
    out.chunks = org
      ? await query(
          `SELECT "id", "chunkIndex", "chunkType", "status", "unitCount", "processedUnits", "attemptCount", "workerId", "bullJobId", "errorCode", "updatedAt"
             FROM "V2RuntimeChunk"
            WHERE "organizationId" = $1 AND "runId" = $2
            ORDER BY "chunkIndex", "id"`,
          [org, runId]
        )
      : [];
    out.jobs = org
      ? await query(
          `SELECT "id", "jobType", "sourceType", "sourceId", "status", "progressCurrent", "progressTotal", "retryCount", "nextAttemptAt", "idempotencyKey", "errorCode", "errorMessage", "createdAt", "updatedAt"
             FROM "V2Job"
            WHERE "organizationId" = $1
              AND ("idempotencyKey" LIKE $2 OR "sourceId" = $3 OR "payloadSnapshotJson"::text LIKE $4)
            ORDER BY "createdAt" DESC
            LIMIT 25`,
          [org, `%${runId}%`, runId, `%${runId}%`]
        )
      : [];
  }

  if (jobId) {
    const rows = await query(
      `SELECT "id", "organizationId", "jobType", "sourceType", "sourceId", "status", "progressCurrent", "progressTotal", "retryCount", "nextAttemptAt", "idempotencyKey", "errorCode", "errorMessage", "payloadSnapshotJson", "createdAt", "updatedAt"
         FROM "V2Job"
        WHERE "id" = $1 AND ($2::text IS NULL OR "organizationId" = $2)
        LIMIT 1`,
      [jobId, organizationId]
    );
    out.jobs = [...out.jobs, ...rows];
  }

  out.workerHints = buildWorkerHints(out.jobs);
  console.log(JSON.stringify(out, null, 2));
} finally {
  await pool.end();
}

async function query(text, values) {
  const result = await pool.query(text, values);
  return result.rows;
}

async function queryOne(text, values) {
  const rows = await query(text, values);
  return rows[0] ?? null;
}

function buildWorkerHints(jobs) {
  const hints = {};
  for (const job of jobs) {
    hints[job.id] = {
      jobType: job.jobType,
      source: `${job.sourceType}:${job.sourceId ?? "null"}`,
      dbDrainable: true,
      bullQueue:
        job.sourceType === "INGESTION_JOB" && job.jobType === "ICP_SCORE" ? "v2.ingest.score" :
        job.sourceType === "INGESTION_JOB" && job.jobType === "COMPANY_ENRICHMENT" ? "v2.ingest.enrich" :
        job.jobType === "ICP_SCORE" ? "none for manual DB fallback" :
        job.jobType === "COMPANY_ENRICHMENT" ? "manual DB job or research.* split pipeline" :
        "see V2 queue registry",
      nextAction:
        job.status === "QUEUED" ? "Start npm run v2:worker or use a bounded drain route for this job." :
        job.status === "CANCELLED" ? "Retry intentionally if this was not a user cancellation." :
        job.status === "RUNNING" ? "Check stale-running reaper and worker logs." :
        "No action for terminal success/failure without inspecting error fields.",
    };
  }
  return hints;
}

function parseArgs(raw) {
  const map = new Map();
  for (const arg of raw) {
    if (!arg.startsWith("--")) continue;
    const index = arg.indexOf("=");
    if (index === -1) map.set(arg.slice(2), "true");
    else map.set(arg.slice(2, index), arg.slice(index + 1));
  }
  return map;
}

function loadEnvFiles(names) {
  for (const name of names) {
    const path = resolve(process.cwd(), name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  }
}