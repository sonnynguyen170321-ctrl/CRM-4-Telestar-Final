// P0.5 cleanup — cancel ghost jobs: QUEUED/RETRY_SCHEDULED jobs older than a threshold
// that have been sitting with no worker. Cancelling (not processing) avoids firing
// weeks-old outreach when a worker finally starts. Stuck RUNNING jobs are NOT touched
// here — the reaper (drain route / npm run v2:worker) requeues those safely. DRY-RUN
// by default.
//
//   node --env-file=.env scripts/cancel-v2-stale-jobs.mjs                          # dry-run, >24h
//   node --env-file=.env scripts/cancel-v2-stale-jobs.mjs --olderThanHours=72      # dry-run, >72h
//   node --env-file=.env scripts/cancel-v2-stale-jobs.mjs --apply                  # commit
//   node --env-file=.env scripts/cancel-v2-stale-jobs.mjs --jobType=EMAIL_SEND --apply

import pg from "pg";

const APPLY = process.argv.includes("--apply");
const olderThanHours = numArg("olderThanHours", 24);
const jobType = strArg("jobType"); // optional filter

const client = new pg.Client({ connectionString: requireDatabaseUrl() });
await client.connect();

try {
  const where = [
    `"status" IN ('QUEUED','RETRY_SCHEDULED')`,
    `"createdAt" < NOW() - ($1 || ' hours')::interval`,
  ];
  const params = [olderThanHours];
  if (jobType) {
    params.push(jobType);
    where.push(`"jobType" = $${params.length}::"V2JobType"`);
  }
  const whereSql = where.join(" AND ");

  const preview = await client.query(
    `SELECT "jobType"::text AS job_type, COUNT(*)::int AS n FROM "V2Job" WHERE ${whereSql} GROUP BY "jobType" ORDER BY n DESC`,
    params
  );
  const total = preview.rows.reduce((s, r) => s + r.n, 0);

  console.log(`${APPLY ? "[APPLY]" : "[DRY-RUN]"} cancel QUEUED/RETRY jobs older than ${olderThanHours}h${jobType ? ` of type ${jobType}` : ""}: ${total}`);
  for (const r of preview.rows) console.log(`   ${r.job_type}: ${r.n}`);

  if (total === 0) {
    console.log("Nothing to cancel.");
  } else if (!APPLY) {
    console.log("\nDry-run only. Re-run with --apply to cancel. (The reaper handles stuck RUNNING separately.)");
  } else {
    const result = await client.query(
      `UPDATE "V2Job"
       SET "status" = 'CANCELLED', "errorCode" = 'CANCELLED_STALE_GHOST',
           "errorMessage" = 'Cancelled by P0.5 cleanup: stale queued ghost job.', "updatedAt" = CURRENT_TIMESTAMP
       WHERE ${whereSql}`,
      params
    );
    console.log(`\n[APPLY] cancelled ${result.rowCount} ghost jobs.`);
  }
} finally {
  await client.end();
}

function numArg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  const v = hit ? Number(hit.split("=")[1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
function strArg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : null;
}
function requireDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required. Run with: node --env-file=.env scripts/cancel-v2-stale-jobs.mjs [--apply]");
    process.exit(1);
  }
  return url;
}
