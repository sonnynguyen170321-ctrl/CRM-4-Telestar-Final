import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// T2 smoke: V2ActivityRecord table shape, indexes, unique idempotency key, and
// not-null contract (per V2_ACTIVITY_AND_TIMELINE_CONTRACT.md §2). Read-only on
// the catalog; the behavioral idempotency check runs inside a rolled-back
// transaction, so it never writes durable data.

const require = createRequire(import.meta.url);
const { Pool } = require("pg");
const rootDir = process.cwd();

for (const file of [".env.local", ".env", ".env.production"]) {
  const filePath = resolve(rootDir, file);
  if (!existsSync(filePath)) continue;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  // 1. Table + columns
  const cols = await pool.query(
    `SELECT column_name, is_nullable, data_type
     FROM information_schema.columns
     WHERE table_name = 'V2ActivityRecord'`
  );
  assert.ok(cols.rows.length > 0, "V2ActivityRecord table must exist");
  const byName = new Map(cols.rows.map((r) => [r.column_name, r]));

  const expectedCols = [
    "id", "organizationId", "leadAssignmentId", "companyId", "contactId",
    "actorUserId", "channel", "activityType", "outcome", "eventKind",
    "occurredAt", "timestampQuality", "sourceActivityHash", "sourceUploadId",
    "sourceRowNumber", "note", "metadataJson", "createdAt", "updatedAt", "deletedAt",
  ];
  for (const col of expectedCols) {
    assert.ok(byName.has(col), `column ${col} must exist`);
  }
  // not-null contract: the unit + company are required; contact/actor optional
  assert.equal(byName.get("leadAssignmentId").is_nullable, "NO", "leadAssignmentId NOT NULL");
  assert.equal(byName.get("companyId").is_nullable, "NO", "companyId NOT NULL");
  assert.equal(byName.get("organizationId").is_nullable, "NO", "organizationId NOT NULL");
  assert.equal(byName.get("sourceActivityHash").is_nullable, "NO", "sourceActivityHash NOT NULL");
  assert.equal(byName.get("occurredAt").is_nullable, "NO", "occurredAt NOT NULL");
  assert.equal(byName.get("contactId").is_nullable, "YES", "contactId nullable");
  assert.equal(byName.get("actorUserId").is_nullable, "YES", "actorUserId nullable");
  assert.equal(byName.get("deletedAt").is_nullable, "YES", "deletedAt nullable");

  // 2. Indexes (timeline hot paths + soft-delete) and the unique idempotency key
  const idx = await pool.query(
    `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'V2ActivityRecord'`
  );
  const defs = idx.rows.map((r) => r.indexdef.toLowerCase());
  const hasIndexOn = (cols) =>
    defs.some((d) => cols.every((c) => d.includes(`"${c.toLowerCase()}"`)));

  assert.ok(
    idx.rows.some(
      (r) => r.indexdef.toLowerCase().includes("unique") &&
        r.indexdef.toLowerCase().includes('"organizationid"') &&
        r.indexdef.toLowerCase().includes('"sourceactivityhash"')
    ),
    "UNIQUE(organizationId, sourceActivityHash) idempotency key must exist"
  );
  assert.ok(hasIndexOn(["organizationId", "leadAssignmentId", "occurredAt"]), "timeline index (lead) must exist");
  assert.ok(hasIndexOn(["organizationId", "companyId", "occurredAt"]), "company rollup index must exist");
  assert.ok(hasIndexOn(["organizationId", "occurredAt"]), "org activity-feed index must exist");
  assert.ok(hasIndexOn(["deletedAt"]), "soft-delete index must exist");

  // 3. Behavioral idempotency: duplicate (org, sourceActivityHash) is rejected.
  //    Runs in a transaction that is always rolled back (no durable writes).
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const org = "v2_activity_smoke_org";
    const hash = "v2_activity_smoke_hash";
    const insert = `
      INSERT INTO "V2ActivityRecord"
        ("id","organizationId","leadAssignmentId","companyId","channel","activityType","outcome","eventKind","occurredAt","timestampQuality","sourceActivityHash","updatedAt")
      VALUES ($1,$2,'la_x','co_x','call','call_connected','positive_response','activity.call_connected',CURRENT_TIMESTAMP,'exact_datetime',$3,CURRENT_TIMESTAMP)`;
    await client.query(insert, ["act_smoke_1", org, hash]);
    let duplicateRejected = false;
    try {
      await client.query(insert, ["act_smoke_2", org, hash]);
    } catch {
      duplicateRejected = true;
    }
    assert.ok(duplicateRejected, "duplicate (org, sourceActivityHash) must be rejected by the unique key");
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }

  console.log("PASS V2ActivityRecord columns + not-null contract");
  console.log("PASS V2ActivityRecord timeline indexes + soft-delete index");
  console.log("PASS V2ActivityRecord UNIQUE(org, sourceActivityHash) idempotency (duplicate rejected)");
  console.log("PASS V2 activity-record schema smoke (T2)");
} finally {
  await pool.end();
}
