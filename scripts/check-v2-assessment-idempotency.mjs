// P3 preflight: detect duplicate HardRuleAssessment rows on the would-be unique key
// (organizationId, leadAssignmentId, icpVersionId, inputFingerprint, scoringVersion).
// READ-ONLY. Run before adding the unique index. With --fix it dedupes (keeps newest,
// repoints V2LeadAssignment.latestHardRuleAssessmentId, deletes the older copies).
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Pool } = require("pg");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv([".env.local", ".env", ".env.production"]);

const fix = process.argv.includes("--fix");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const KEY = `"organizationId","leadAssignmentId","icpVersionId","inputFingerprint","scoringVersion"`;

try {
  const dupes = await pool.query(
    `SELECT ${KEY}, COUNT(*)::int AS n
       FROM "V2HardRuleAssessment"
      GROUP BY ${KEY} HAVING COUNT(*) > 1`
  );
  const groups = dupes.rows.length;
  const extra = dupes.rows.reduce((s, r) => s + (r.n - 1), 0);
  console.log(`duplicate key groups: ${groups}; redundant rows: ${extra}`);

  if (groups === 0) {
    console.log("PASS P3 preflight: no duplicates — safe to add the unique index.");
  } else if (!fix) {
    console.log("ACTION NEEDED: re-run with --fix to dedupe before adding the unique index.");
    process.exitCode = 1;
  } else {
    let deleted = 0;
    for (const r of dupes.rows) {
      // Keep the newest row in the group; repoint any lead pointer + delete the rest.
      const rows = await pool.query(
        `SELECT "id" FROM "V2HardRuleAssessment"
          WHERE "organizationId"=$1 AND "leadAssignmentId"=$2 AND "icpVersionId"=$3
            AND "inputFingerprint"=$4 AND "scoringVersion"=$5
          ORDER BY "createdAt" DESC, "id" DESC`,
        [r.organizationId, r.leadAssignmentId, r.icpVersionId, r.inputFingerprint, r.scoringVersion]
      );
      const keep = rows.rows[0].id;
      const drop = rows.rows.slice(1).map((x) => x.id);
      if (drop.length === 0) continue;
      await pool.query(
        `UPDATE "V2LeadAssignment" SET "latestHardRuleAssessmentId"=$1
          WHERE "latestHardRuleAssessmentId" = ANY($2::text[])`,
        [keep, drop]
      );
      // Detach previousAssessmentId references, then delete the older copies.
      await pool.query(`UPDATE "V2HardRuleAssessment" SET "previousAssessmentId"=NULL WHERE "previousAssessmentId" = ANY($1::text[])`, [drop]);
      const del = await pool.query(`DELETE FROM "V2HardRuleAssessment" WHERE "id" = ANY($1::text[])`, [drop]);
      deleted += del.rowCount;
    }
    console.log(`PASS P3 dedupe: removed ${deleted} redundant rows across ${groups} groups.`);
  }
} finally {
  await pool.end();
}

function loadEnv(names) {
  for (const n of names) {
    const p = resolve(rootDir, n);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#") || !t.includes("=")) continue;
      const i = t.indexOf("=");
      const k = t.slice(0, i).trim();
      if (k && process.env[k] === undefined) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
}
