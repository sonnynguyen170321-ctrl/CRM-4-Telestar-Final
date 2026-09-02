// P0.5 fix — repair ACTIVE leads that HAVE a HardRuleAssessment but whose
// latestHardRuleAssessmentId is NULL (a pointer bug), by pointing them at their newest
// assessment. NEVER deletes an assessment (Invariant 4) and NEVER fabricates a score
// (Invariant 7) — leads with no assessment at all are left as NOT_SCORED. Tenant-safe
// (each row keeps its own organizationId). DRY-RUN by default.
//
//   node --env-file=.env scripts/fix-v2-lead-pointers.mjs            # dry-run (report only)
//   node --env-file=.env scripts/fix-v2-lead-pointers.mjs --apply    # commit the repoint

import pg from "pg";

const APPLY = process.argv.includes("--apply");
const client = new pg.Client({ connectionString: requireDatabaseUrl() });
await client.connect();

try {
  const candidates = await client.query(`
    SELECT la."id" AS lead_id, la."organizationId" AS org, newest."id" AS assessment_id, newest."createdAt" AS scored_at
    FROM "V2LeadAssignment" la
    JOIN LATERAL (
      SELECT a."id", a."createdAt"
      FROM "V2HardRuleAssessment" a
      WHERE a."leadAssignmentId" = la."id" AND a."organizationId" = la."organizationId"
      ORDER BY a."createdAt" DESC, a."id" DESC
      LIMIT 1
    ) newest ON true
    WHERE la."status" = 'ACTIVE' AND la."deletedAt" IS NULL
      AND la."latestHardRuleAssessmentId" IS NULL
  `);

  console.log(`${APPLY ? "[APPLY]" : "[DRY-RUN]"} pointer-bug leads to repoint: ${candidates.rows.length}`);
  for (const r of candidates.rows.slice(0, 10)) {
    console.log(`   lead ${r.lead_id} -> assessment ${r.assessment_id} (scored ${new Date(r.scored_at).toISOString()})`);
  }
  if (candidates.rows.length > 10) console.log(`   ... and ${candidates.rows.length - 10} more`);

  if (candidates.rows.length === 0) {
    console.log("Nothing to fix.");
  } else if (!APPLY) {
    console.log("\nDry-run only. Re-run with --apply to commit the repoint.");
  } else {
    const result = await client.query(`
      UPDATE "V2LeadAssignment" la
      SET "latestHardRuleAssessmentId" = sub.assessment_id, "updatedAt" = CURRENT_TIMESTAMP
      FROM (
        SELECT la2."id" AS lead_id, newest."id" AS assessment_id
        FROM "V2LeadAssignment" la2
        JOIN LATERAL (
          SELECT a."id" FROM "V2HardRuleAssessment" a
          WHERE a."leadAssignmentId" = la2."id" AND a."organizationId" = la2."organizationId"
          ORDER BY a."createdAt" DESC, a."id" DESC LIMIT 1
        ) newest ON true
        WHERE la2."status" = 'ACTIVE' AND la2."deletedAt" IS NULL
          AND la2."latestHardRuleAssessmentId" IS NULL
      ) sub
      WHERE la."id" = sub.lead_id
    `);
    console.log(`\n[APPLY] repointed ${result.rowCount} leads. No assessment was created or deleted.`);
  }
} finally {
  await client.end();
}

function requireDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required. Run with: node --env-file=.env scripts/fix-v2-lead-pointers.mjs [--apply]");
    process.exit(1);
  }
  return url;
}
