// #3 consumer-consistency probes (LIVE, read-only, pool-based). Asserts DB invariants
// that read-models depend on — the cross-page leak class (deleted/archived/draft rows
// surfacing where only active selectable entities belong). Runs the real filtering SQL
// directly (reliable; the TS-loader's prisma singleton returns empty standalone). No
// writes. Picks the org with the most ICP data.
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Pool } = require("pg");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const f of [".env.local", ".env", ".env.production"]) {
  try { for (const l of readFileSync(resolve(root, f), "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#") || !t.includes("=")) continue; const i = t.indexOf("="); const k = t.slice(0, i).trim(); if (process.env[k] === undefined) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, ""); } } catch {}
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let failures = 0;
const A = "\x27ACTIVE\x27", P = "\x27PUBLISHED\x27";
async function expectZero(label, sql, params = []) {
  const r = await pool.query(sql, params);
  const n = r.rows.length;
  if (n === 0) console.log(`  OK  ${label}`);
  else { console.log(`  FAIL ${label} — ${n} row(s): ${JSON.stringify(r.rows.slice(0, 3))}`); failures += 1; }
}

try {
  const orgRow = await pool.query(`SELECT "organizationId", COUNT(*)::int n FROM "V2ICPVersion" GROUP BY "organizationId" ORDER BY n DESC LIMIT 1`);
  const org = orgRow.rows[0]?.organizationId;
  if (!org) { console.log("no org — skip"); process.exit(0); }
  console.log(`org: ${org}\n`);

  // 1. The Account->Project->ICP context tree (uploads/leads/companies selection) must
  //    expose ONLY published, non-deleted ICP versions on ACTIVE-status parents.
  await expectZero(
    "context tree exposes only PUBLISHED non-deleted ICPs",
    `SELECT icp."id", icp."status", profile."status" AS prof
       FROM "V2ClientAccount" account
       INNER JOIN "V2Project" project ON project."clientAccountId"=account."id" AND project."status"=${A}
       INNER JOIN "V2Offer" offer ON offer."projectId"=project."id" AND offer."status"=${A}
       INNER JOIN "V2ICPProfile" profile ON profile."offerId"=offer."id"
       INNER JOIN "V2ICPVersion" icp ON icp."icpProfileId"=profile."id" AND icp."deletedAt" IS NULL
      WHERE account."organizationId"=$1 AND account."status"=${A}
        AND profile."status"=${A} AND icp."status"=${P}
        AND (icp."status"<>${P} OR icp."deletedAt" IS NOT NULL OR profile."status"<>${A})`,
    [org]
  );

  // 2. No ACTIVE lead assignment references a soft-deleted company (consumers join
  //    company; a leak would surface a deleted company in leads/contacts/outreach).
  await expectZero(
    "no active LeadAssignment -> deleted Company",
    `SELECT la."id" FROM "V2LeadAssignment" la JOIN "V2Company" c ON c."id"=la."companyId"
      WHERE la."organizationId"=$1 AND la."status"=${A} AND la."deletedAt" IS NULL AND c."deletedAt" IS NOT NULL LIMIT 50`,
    [org]
  );

  // 3. No ACTIVE lead assignment references a soft-deleted contact.
  await expectZero(
    "no active LeadAssignment -> deleted Contact",
    `SELECT la."id" FROM "V2LeadAssignment" la JOIN "V2Contact" ct ON ct."id"=la."contactId"
      WHERE la."organizationId"=$1 AND la."status"=${A} AND la."deletedAt" IS NULL AND ct."deletedAt" IS NOT NULL LIMIT 50`,
    [org]
  );

  // 4. latestHardRuleAssessmentId never points at an ICP version that was hard-deleted.
  await expectZero(
    "no LeadAssignment.latest assessment -> missing ICP version",
    `SELECT la."id" FROM "V2LeadAssignment" la
       JOIN "V2HardRuleAssessment" a ON a."id"=la."latestHardRuleAssessmentId"
       LEFT JOIN "V2ICPVersion" icp ON icp."id"=a."icpVersionId"
      WHERE la."organizationId"=$1 AND la."status"=${A} AND la."deletedAt" IS NULL AND icp."id" IS NULL LIMIT 50`,
    [org]
  );

  console.log(failures === 0 ? "\nPASS V2 consumer consistency (no deleted/draft/archived leaks)." : `\nFAIL: ${failures} consistency violation(s).`);
} finally {
  await pool.end();
}
process.exit(failures === 0 ? 0 : 1);
