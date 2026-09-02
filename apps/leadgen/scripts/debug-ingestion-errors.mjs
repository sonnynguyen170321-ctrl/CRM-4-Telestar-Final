// Print why rows failed on the most recent ingestion job: the error distribution, three sample rows
// with their normalized payload, and the row-status breakdown.
//
// This used to live in `lib/v2/identity/__tests__/debug-errors.test.ts`, where its only assertion was
// `expect(jid).toBeTruthy()` — "this database happens to contain an ingestion job". That is a
// property of whoever's machine ran it, not a behaviour, so the suite passed locally and failed
// everywhere else, including CI. It is a diagnostic, so it lives with the diagnostics.
//
//   node --env-file=.env scripts/debug-ingestion-errors.mjs
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const { rows: jobs } = await client.query(
  `SELECT "id", "status", "originalFileName" FROM "V2IngestionJob" ORDER BY "createdAt" DESC LIMIT 1`
);
const job = jobs[0];

if (!job) {
  console.log("No ingestion job in this database — nothing to explain.");
  await client.end();
  process.exit(0);
}

console.log(`Latest job: ${job.id}  status=${job.status}  file=${job.originalFileName}`);

const show = async (label, sql, format) => {
  const { rows } = await client.query(sql, [job.id]);
  console.log(`\n${label}`);
  if (rows.length === 0) console.log("  (none)");
  for (const row of rows) console.log(`  ${format(row)}`);
};

await show(
  "ERROR DISTRIBUTION:",
  `SELECT "errorMessage", COUNT(*)::int AS cnt FROM "V2IngestionRow"
    WHERE "jobId" = $1 AND "rowStatus" = 'ERROR'
    GROUP BY "errorMessage" ORDER BY cnt DESC LIMIT 10`,
  (r) => `[${r.cnt}x] ${r.errorMessage}`
);

await show(
  "SAMPLE ERRORS:",
  `SELECT "sourceRowNumber", "errorMessage", substring("normalizedRowJson"::text, 1, 500) AS np
     FROM "V2IngestionRow"
    WHERE "jobId" = $1 AND "rowStatus" = 'ERROR'
    ORDER BY "sourceRowNumber" LIMIT 3`,
  (r) => `Row #${r.sourceRowNumber}: ${r.errorMessage}\n    normalized: ${r.np}`
);

await show(
  "STATUS DISTRIBUTION:",
  `SELECT "rowStatus", COUNT(*)::int AS cnt FROM "V2IngestionRow"
    WHERE "jobId" = $1 GROUP BY "rowStatus" ORDER BY cnt DESC`,
  (r) => `${r.rowStatus}: ${r.cnt}`
);

await client.end();
