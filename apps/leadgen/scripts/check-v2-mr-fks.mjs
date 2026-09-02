// P0.3 — V2ManagerReviewItem foreign-key drift guard.
//
// Why this exists: V2ManagerReviewItem is intentionally protected by database
// foreign keys. Historical sessions briefly modeled those ids as scalar-only,
// which made Prisma try to drop the 10 manually-created FK constraints on new
// migrations. This guard fails loudly if the constraints disappear again, so a
// future schema session catches the drift before shipping a manager-review table
// without referential integrity.
//
// Usage: node scripts/check-v2-mr-fks.mjs   (needs DATABASE_URL / .env)
//
// If a schema migration legitimately changes the FK set, update EXPECTED_MIN_FKS
// and the migrations note in prisma/migrations/README.md in the same session.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { Pool } = require("pg");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The 10 manual FKs restored in
// prisma/migrations/20260614050000_v2_p1s0b_restore_manager_review_fks.
const EXPECTED_MIN_FKS = 10;

loadEnvFiles([".env.local", ".env", ".env.production"]);

if (!process.env.DATABASE_URL) {
  console.error("FAIL: DATABASE_URL is not set (.env.local/.env)");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  const { rows } = await pool.query(
    `SELECT con.conname,
            confrel.relname AS referenced_table
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       LEFT JOIN pg_class confrel ON confrel.oid = con.confrelid
      WHERE rel.relname = 'V2ManagerReviewItem'
        AND con.contype = 'f'
      ORDER BY con.conname`
  );

  console.log(`V2ManagerReviewItem foreign keys found: ${rows.length}`);
  for (const row of rows) {
    console.log(`  - ${row.conname} -> ${row.referenced_table ?? "?"}`);
  }

  assert(
    rows.length >= EXPECTED_MIN_FKS,
    `MR FK DRIFT: expected >= ${EXPECTED_MIN_FKS} foreign keys on V2ManagerReviewItem, found ${rows.length}. ` +
      `A migration likely dropped the manual FKs (see prisma/migrations/20260614050000_v2_p1s0b_restore_manager_review_fks). ` +
      `Restore them and update the migration before proceeding.`
  );

  console.log("PASS V2ManagerReviewItem FK guard (no drift detected)");
} finally {
  await pool.end();
}

function loadEnvFiles(fileNames) {
  for (const fileName of fileNames) {
    const filePath = resolve(rootDir, fileName);

    if (!existsSync(filePath)) {
      continue;
    }

    for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
        continue;
      }

      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      const rawValue = trimmed.slice(index + 1).trim();

      if (key && process.env[key] === undefined) {
        process.env[key] = rawValue.replace(/^["']|["']$/g, "");
      }
    }
  }
}
