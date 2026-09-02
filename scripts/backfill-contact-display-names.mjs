// A2 backfill — legacy contacts whose fullName is an email or email local-part (the old ingestion
// default `email.split("@")[0]`) get a humanized display name ("john.doe" -> "John Doe"). Only rows
// whose fullName still matches their primary email's local-part (or literally contains "@") are
// touched, so real names are never overwritten. firstName/lastName are left untouched.
//
//   node --env-file=.env scripts/backfill-contact-display-names.mjs            # dry-run
//   node --env-file=.env scripts/backfill-contact-display-names.mjs --apply    # commit

import pg from "pg";

const APPLY = process.argv.includes("--apply");

// Mirror of humanizeEmailLocalPart in lib/v2/crm/resolveContactDisplayName.ts (kept in sync manually).
function humanizeEmailLocalPart(local) {
  const cleaned = local
    .replace(/[._+-]+/g, " ")
    .replace(/\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function stripDiacriticsLower(value) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function requireDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required (run with --env-file=.env).");
  return url;
}

const client = new pg.Client({ connectionString: requireDatabaseUrl() });
await client.connect();

try {
  // Candidate = active contact whose fullName is literally an email, or equals the local-part of its
  // primary email address. LATERAL picks the earliest EMAIL identifier as the canonical one.
  const { rows } = await client.query(`
    SELECT c."id", c."organizationId", c."fullName", ci."normalizedValue" AS email
    FROM "V2Contact" c
    LEFT JOIN LATERAL (
      SELECT "normalizedValue" FROM "V2ContactIdentifier"
      WHERE "contactId" = c."id" AND "type" = 'EMAIL'
      ORDER BY "createdAt" ASC LIMIT 1
    ) ci ON true
    WHERE c."deletedAt" IS NULL
      AND (
        c."fullName" LIKE '%@%'
        OR (ci."normalizedValue" IS NOT NULL
            AND lower(c."fullName") = split_part(lower(ci."normalizedValue"), '@', 1))
      )
  `);

  let updated = 0;
  let skipped = 0;
  const samples = [];

  for (const row of rows) {
    const full = (row.fullName ?? "").trim();
    const emailSource = full.includes("@") ? full : row.email ?? "";
    const local = emailSource.includes("@") ? emailSource.split("@")[0] : emailSource;
    const humanized = local ? humanizeEmailLocalPart(local) : "";

    if (!humanized || humanized === full) {
      skipped += 1;
      continue;
    }

    if (samples.length < 15) samples.push(`  ${full}  ->  ${humanized}`);

    if (APPLY) {
      await client.query(
        `UPDATE "V2Contact" SET "fullName" = $1, "fullNameNormalized" = $2, "updatedAt" = NOW() WHERE "id" = $3`,
        [humanized, stripDiacriticsLower(humanized), row.id]
      );
    }
    updated += 1;
  }

  console.log(`Candidates matched: ${rows.length}`);
  console.log(`${APPLY ? "Updated" : "Would update"}: ${updated}   Skipped (no better name): ${skipped}`);
  if (samples.length) {
    console.log("Sample rewrites:");
    console.log(samples.join("\n"));
  }
  if (!APPLY) console.log("\nDRY-RUN. Re-run with --apply to commit.");
} finally {
  await client.end();
}
