// P0.5 preflight — READ-ONLY data-health report for the real-data env. Run with:
//   node --env-file=.env scripts/preflight-v2-data-health.mjs
//
// Reports the three things the audit flagged, so the cleanup scripts (and the future
// Phase R/P3 unique constraint) act on real numbers:
//   1) duplicate HardRuleAssessment fingerprints (would block the unique constraint)
//   2) ACTIVE leads with a null latestHardRuleAssessmentId, split into
//      genuinely-NOT_SCORED vs pointer-bug (an assessment exists but the pointer is null)
//   3) job backlog + worker-heartbeat freshness (stuck RUNNING / ghost QUEUED)
//
// Makes NO writes. Safe to run anytime, on any environment.

import pg from "pg";

const STALE_RUNNING_MIN = Number(process.env.STALE_RUNNING_MIN ?? 30);
const STALE_BEAT_MIN = Number(process.env.STALE_BEAT_MIN ?? 5);

const client = new pg.Client({ connectionString: requireDatabaseUrl() });
await client.connect();
try {
  await report();
} finally {
  await client.end();
}

async function report() {
  hr("V2 DATA HEALTH PREFLIGHT (read-only)");

  // 1) Duplicate assessment fingerprints.
  const dup = (
    await client.query(`
      SELECT COUNT(*)::int AS dup_groups, COALESCE(SUM(cnt - 1), 0)::int AS excess_rows
      FROM (
        SELECT COUNT(*) AS cnt
        FROM "V2HardRuleAssessment"
        GROUP BY "organizationId", "leadAssignmentId", "icpVersionId", "inputFingerprint", "scoringVersion"
        HAVING COUNT(*) > 1
      ) g
    `)
  ).rows[0];
  console.log(`\n[1] Duplicate assessment fingerprints (org,lead,icp,fingerprint,scoringVersion):`);
  console.log(`    duplicate groups: ${dup.dup_groups}   excess rows: ${dup.excess_rows}`);
  if (dup.dup_groups > 0) {
    const worst = await client.query(`
      SELECT "leadAssignmentId", "icpVersionId", "scoringVersion", COUNT(*)::int AS cnt
      FROM "V2HardRuleAssessment"
      GROUP BY "organizationId", "leadAssignmentId", "icpVersionId", "inputFingerprint", "scoringVersion"
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
      LIMIT 5
    `);
    for (const r of worst.rows) console.log(`      lead ${r.leadAssignmentId} icp ${r.icpVersionId} x${r.cnt}`);
    console.log(`    => the Phase R/P3 unique constraint needs these resolved first.`);
  }

  // 2) Null-pointer leads.
  const ptr = (
    await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE has_assessment)::int  AS pointer_bug,
        COUNT(*) FILTER (WHERE NOT has_assessment)::int AS genuinely_not_scored
      FROM (
        SELECT EXISTS (
          SELECT 1 FROM "V2HardRuleAssessment" a
          WHERE a."leadAssignmentId" = la."id" AND a."organizationId" = la."organizationId"
        ) AS has_assessment
        FROM "V2LeadAssignment" la
        WHERE la."status" = 'ACTIVE' AND la."deletedAt" IS NULL
          AND la."latestHardRuleAssessmentId" IS NULL
      ) x
    `)
  ).rows[0];
  console.log(`\n[2] ACTIVE leads with NULL latestHardRuleAssessmentId:`);
  console.log(`    pointer-bug (assessment exists, pointer null): ${ptr.pointer_bug}  <- fix-v2-lead-pointers can repair`);
  console.log(`    genuinely NOT_SCORED (no assessment at all):   ${ptr.genuinely_not_scored}  <- expected; score them to fill`);

  // 3) Job backlog + worker heartbeat.
  const backlog = await client.query(`
    SELECT "status"::text AS status, COUNT(*)::int AS n
    FROM "V2Job" WHERE "status" IN ('QUEUED','RUNNING','RETRY_SCHEDULED','FAILED')
    GROUP BY "status"
  `);
  const staleRunning = (
    await client.query(`
      SELECT COUNT(*)::int AS n FROM "V2Job"
      WHERE "status" = 'RUNNING'
        AND COALESCE("startedAt", "updatedAt") < NOW() - ($1 || ' minutes')::interval
    `, [STALE_RUNNING_MIN])
  ).rows[0].n;
  const beats = await client.query(`SELECT "workerKind", "lastBeatAt" FROM "V2WorkerHeartbeat"`);

  console.log(`\n[3] Job backlog:`);
  const counts = Object.fromEntries(backlog.rows.map((r) => [r.status, r.n]));
  console.log(`    QUEUED ${counts.QUEUED ?? 0} · RUNNING ${counts.RUNNING ?? 0} (stale>${STALE_RUNNING_MIN}m: ${staleRunning}) · RETRY ${counts.RETRY_SCHEDULED ?? 0} · FAILED ${counts.FAILED ?? 0}`);
  console.log(`    Worker heartbeats:`);
  if (beats.rows.length === 0) {
    console.log(`      (none) — no worker has ever run on this DB`);
  } else {
    for (const b of beats.rows) {
      const ageMin = b.lastBeatAt ? Math.round((Date.now() - new Date(b.lastBeatAt).getTime()) / 60000) : null;
      const live = ageMin !== null && ageMin <= STALE_BEAT_MIN;
      console.log(`      ${b.workerKind}: ${ageMin === null ? "never" : `${ageMin}m ago`} ${live ? "(live)" : "(STALE)"}`);
    }
  }
  if (staleRunning > 0) console.log(`    => run \`npm run v2:worker\` (auto-reaps stale RUNNING) or fix scripts below.`);

  hr("END PREFLIGHT");
}

function hr(label) {
  console.log(`\n${"=".repeat(8)} ${label} ${"=".repeat(8)}`);
}

function requireDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required. Run with: node --env-file=.env scripts/preflight-v2-data-health.mjs");
    process.exit(1);
  }
  return url;
}
