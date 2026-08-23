#!/usr/bin/env node
/**
 * Remove accumulated per-run test tenants from a development database.
 *
 *     node scripts/purge-test-tenants.mjs            # dry run, prints what it would delete
 *     node scripts/purge-test-tenants.mjs --apply    # actually delete
 *
 * Eleven suites created a tenant per test case with a fresh `randomUUID()` and never deleted
 * it. Measured on the development database on 2026-08-23: **74,974 tenants and 430,835 leads**,
 * oldest 2026-08-12, 14,041 of them in the preceding 24 hours. Telestar is one BPO with one
 * tenant, so none of it is real. The leak itself is fixed — `tests/helpers/testTenant.ts`
 * registers the delete with `onTestFinished`, and `tests/test-tenant-leak.test.ts` keeps it
 * fixed — but every machine that ran the suite before then still carries the residue.
 *
 * It is not free to leave. Org-wide aggregates scan all of it, and the admin overview suite
 * began timing out at its 20-second budget: three failures in a full run that passed 33/33 once
 * the budget was raised, which is what a data problem looks like when mistaken for a code one.
 *
 * ---------------------------------------------------------------------------
 * WHY THE DELETE ORDER IS DISCOVERED AND NOT WRITTEN DOWN
 * ---------------------------------------------------------------------------
 * Deleting a tenant does not simply cascade. `Task.userId` references `User` with no
 * `onDelete`, so Prisma applies Restrict and the delete fails partway with a foreign-key
 * violation — which is exactly how the first attempt at this failed.
 *
 * `prisma/seed-demo.ts` keeps a hand-ordered list for the same reason, and its own comment
 * records that list rotting: "this list rotted — CI seeds an empty service container, while a
 * developer machine has messages, opportunities and import batches, and the seed dies with
 * P2003 partway through the wipe." `supabase/rls.sql` learned the same lesson about hardcoded
 * table lists and now derives its own.
 *
 * So this derives too, without needing a topological sort: it sweeps every tenant-owned table
 * repeatedly, ignoring foreign-key violations, until a whole pass deletes nothing new. Each
 * pass removes another layer of children, so it converges on any schema shape and cannot go
 * stale when a model is added.
 *
 * The sweep runs ONCE across every target tenant, not once per batch of them. The first
 * version batched 300 tenants at a time and swept all 66 tables inside each batch, which is
 * tables x passes x batches statements — it purged 1,800 tenants in several minutes and would
 * have taken about two hours. Sweeping globally is tables x passes in total, and the targets
 * are materialised into an indexed helper table so each delete is a join rather than a 75,000
 * element IN list.
 *
 * ---------------------------------------------------------------------------
 * WHY IT BUILDS INDEXES FIRST
 * ---------------------------------------------------------------------------
 * The schema has 72 single-column foreign keys with no index on the child column — 23 of them
 * pointing at `User`, 9 at `Lead`. PostgreSQL does not index the referencing side
 * automatically, so deleting a parent row scans every child table once to check or cascade it.
 * Deleting 419,000 leads that way is quadratic: a single `DELETE FROM "Lead"` ran for over six
 * minutes here without finishing.
 *
 * So the missing indexes are built before the sweep and dropped after. They are named
 * `purge_fk_*` and created only for the duration of the run, because whether any of them belong
 * in `prisma/schema.prisma` permanently is a real decision with write-amplification and storage
 * costs on the other side — not something a cleanup script should quietly make.
 *
 * SAFETY. Only tenants whose id carries a UUID suffix are considered — that is the shape the
 * leaking suites produced. Fixed-id fixtures (`ff-tenant`, `blref-tenant-a`) are left alone:
 * their suites delete and recreate them, so they never accumulate. `default-tenant` and
 * `demo-telestar` have no UUID suffix and are never matched. Anything created in the last 20
 * minutes is skipped so a test run in progress on the same database is not pulled out from
 * under itself.
 */

import { createAdminClient } from '../lib/db/adminClient.mjs';

const APPLY = process.argv.includes('--apply');

/** The leaking shape: `${prefix}-${randomUUID()}`. Fixed-id fixtures never match. */
const TARGET =
  `id ~ '-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' ` +
  `AND "createdAt" < now() - interval '20 minutes'`;

const db = createAdminClient();

async function tenantOwnedTables() {
  const rows = await db.$queryRawUnsafe(
    `SELECT c.relname FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND a.attname = 'tenantId' AND NOT a.attisdropped
      ORDER BY c.relname`
  );
  return rows.map((r) => r.relname);
}

/**
 * Single-column foreign keys whose child column has no index. Building these turns each
 * parent-row delete from a sequential scan of every child table into an index lookup.
 */
async function missingFkIndexes() {
  return db.$queryRawUnsafe(
    `SELECT c.conrelid::regclass::text AS child_ident,
            pc.relname               AS child,
            a.attname                AS col
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
       JOIN pg_class pc    ON pc.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = pc.relnamespace
      WHERE c.contype = 'f' AND n.nspname = 'public' AND array_length(c.conkey, 1) = 1
        AND NOT EXISTS (
          SELECT 1 FROM pg_index i
           WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1]
        )
      ORDER BY 1, 2`
  );
}

const indexName = (child, col) =>
  `purge_fk_${child}_${col}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 63);

async function main() {
  const tables = await tenantOwnedTables();
  const [{ n: targeted }] = await db.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM "Tenant" WHERE ${TARGET}`
  );
  const [{ n: kept }] = await db.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM "Tenant" WHERE NOT (${TARGET})`
  );

  console.log(`${tables.length} tenant-owned tables`);
  console.log(`${targeted} tenants match the leaked shape`);
  console.log(`${kept} tenants kept (fixed-id fixtures, default-tenant, demo-telestar)\n`);

  if (!APPLY) {
    const sample = await db.$queryRawUnsafe(
      `SELECT id FROM "Tenant" WHERE ${TARGET} ORDER BY "createdAt" LIMIT 5`
    );
    console.log('Dry run. Examples that would be deleted:');
    for (const r of sample) console.log(`  ${r.id}`);
    console.log('\nRe-run with --apply to delete.');
    return;
  }

  const started = Date.now();

  const missing = await missingFkIndexes();
  console.log(`building ${missing.length} temporary index(es) on unindexed foreign keys...`);
  for (const fk of missing) {
    await db.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "${indexName(fk.child, fk.col)}" ` +
        `ON ${fk.child_ident} ("${fk.col}")`
    );
  }
  console.log(`  built in ${((Date.now() - started) / 1000).toFixed(0)}s\n`);

  // Materialised and indexed so every delete below is a join. A regular table, not a TEMP one:
  // Prisma pools connections and a temporary table would only exist on whichever session
  // happened to create it.
  await db.$executeRawUnsafe('DROP TABLE IF EXISTS _purge_targets');
  await db.$executeRawUnsafe('CREATE TABLE _purge_targets (id text PRIMARY KEY)');
  const targeted2 = await db.$executeRawUnsafe(
    `INSERT INTO _purge_targets (id) SELECT id FROM "Tenant" WHERE ${TARGET}`
  );
  console.log(`staged ${targeted2} tenants for deletion\n`);

  let statements = 0;
  for (let pass = 1; pass <= tables.length; pass++) {
    let removed = 0;
    let blocked = 0;
    for (const table of tables) {
      try {
        removed += await db.$executeRawUnsafe(
          `DELETE FROM "${table}" t USING _purge_targets p WHERE t."tenantId" = p.id`
        );
      } catch (err) {
        if (err?.meta?.code !== '23503') throw err; // only tolerate FK violations
        blocked++;
      }
      statements++;
    }
    console.log(
      `  pass ${pass}: ${removed} rows removed, ${blocked} table(s) still blocked, ` +
        `${((Date.now() - started) / 1000).toFixed(0)}s`
    );
    if (removed === 0 && blocked === 0) break;
    if (removed === 0) {
      throw new Error(
        `${blocked} table(s) still hold rows that cannot be deleted and no progress was made. ` +
          'A foreign key outside the tenant-owned set is holding them.'
      );
    }
  }

  const purged = await db.$executeRawUnsafe(
    'DELETE FROM "Tenant" t USING _purge_targets p WHERE t.id = p.id'
  );
  await db.$executeRawUnsafe('DROP TABLE IF EXISTS _purge_targets');

  // Leave the schema as it was found.
  for (const fk of missing) {
    await db.$executeRawUnsafe(`DROP INDEX IF EXISTS "${indexName(fk.child, fk.col)}"`);
  }
  console.log(`\n${statements} delete statements issued, ${missing.length} temporary index(es) dropped`);

  const [{ n: tenantsLeft }] = await db.$queryRawUnsafe(
    'SELECT count(*)::int AS n FROM "Tenant"'
  );
  const [{ n: leadsLeft }] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "Lead"');
  console.log(
    `\nPurged ${purged} tenants in ${((Date.now() - started) / 1000).toFixed(0)}s — ` +
      `${tenantsLeft} tenants and ${leadsLeft} leads remain.`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
