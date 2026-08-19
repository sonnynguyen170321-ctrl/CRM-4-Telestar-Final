/**
 * Restored-database integrity verification.
 *
 * A `pg_restore` that exits 0 proves the archive was readable. It does not prove the
 * database is usable: a partial restore, a dump taken mid-migration, or an archive
 * restored with `--data-only` against the wrong schema can all exit 0 and leave a
 * database nobody should point an application at.
 *
 * This script is the difference between "the restore command succeeded" and "the
 * restored database is sound". It is the script `BACKUP_RESTORE.md` invokes, and it is
 * required evidence for `DR-002` / `TEL-P0-001`.
 *
 * Checks, in order of what fails first when a restore is bad:
 *   1. every model in prisma/schema.prisma has a table
 *   2. the migration ledger is complete, applied, and matches prisma/migrations/
 *   3. no foreign key points at a row that is not there
 *   4. no tenant-owned row has a null tenantId
 *   5. row-level security is configured where the deployment expects it
 *   6. representative record counts, optionally reconciled against a pre-backup snapshot
 *
 * Reports only. It never repairs, deletes, or reassigns - deciding what a broken row
 * should become needs a human who knows which side is right.
 *
 *   DATABASE_URL=... npx tsx scripts/verify-db-integrity.ts
 *   DATABASE_URL=... npx tsx scripts/verify-db-integrity.ts --json
 *   DATABASE_URL=... npx tsx scripts/verify-db-integrity.ts --expect-counts counts.json
 *   DATABASE_URL=... npx tsx scripts/verify-db-integrity.ts --require-rls
 *
 * Exit code is 1 when any check fails, so it can gate a restore drill.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';

/** Models whose counts are reconciled across a backup/restore cycle (DR-002 §10.3). */
const REPRESENTATIVE_MODELS = [
  'Tenant',
  'User',
  'Client',
  'Campaign',
  'Account',
  'Contact',
  'Lead',
  'Task',
  'Activity',
  'Sequence',
  'SequenceEnrollment',
  'OutboundMessage',
  'ImportBatch',
] as const;

interface CheckResult {
  key: string;
  title: string;
  status: 'PASS' | 'FAIL' | 'SKIPPED';
  detail: string;
  findings: string[];
}

interface Options {
  json: boolean;
  requireRls: boolean;
  expectCountsPath: string | null;
}

function parseArgs(argv: string[]): Options {
  const expectIndex = argv.indexOf('--expect-counts');
  return {
    json: argv.includes('--json'),
    requireRls: argv.includes('--require-rls'),
    expectCountsPath: expectIndex >= 0 ? argv[expectIndex + 1] ?? null : null,
  };
}

/** Table names declared by the Prisma datamodel, honouring @@map. */
function declaredTables(): string[] {
  const schemaPath = path.resolve(process.cwd(), 'prisma', 'schema.prisma');
  const schema = readFileSync(schemaPath, 'utf8');
  const tables: string[] = [];

  const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  for (const match of schema.matchAll(modelRe)) {
    const [, modelName, body] = match;
    const mapped = body.match(/@@map\("([^"]+)"\)/);
    tables.push(mapped ? mapped[1] : modelName);
  }
  return tables;
}

async function checkTablesExist(db: PrismaClient): Promise<CheckResult> {
  const expected = declaredTables();
  const rows = await db.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  );
  const present = new Set(rows.map((row) => row.table_name));
  const missing = expected.filter((table) => !present.has(table));

  return {
    key: 'tables',
    title: 'Every datamodel model has a table',
    status: missing.length === 0 ? 'PASS' : 'FAIL',
    detail: `${expected.length - missing.length}/${expected.length} declared tables present`,
    findings: missing.map((table) => `missing table "${table}"`),
  };
}

async function checkMigrations(db: PrismaClient): Promise<CheckResult> {
  const migrationsDir = path.resolve(process.cwd(), 'prisma', 'migrations');
  const onDisk = existsSync(migrationsDir)
    ? readdirSync(migrationsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    : [];

  const applied = await db.$queryRawUnsafe<
    { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]
  >(`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`);

  // A migration may legitimately have several ledger rows: an attempt that failed and
  // was rolled back, followed by one that succeeded. Prisma treats that as applied, and
  // so do we. What matters is that every migration on disk has at least one row that
  // finished and was not rolled back.
  const succeeded = new Set(
    applied
      .filter((row) => row.finished_at !== null && row.rolled_back_at === null)
      .map((row) => row.migration_name),
  );
  const findings: string[] = [];

  for (const name of onDisk) {
    if (!succeeded.has(name)) {
      const attempts = applied.filter((row) => row.migration_name === name);
      findings.push(
        attempts.length === 0
          ? `migration "${name}" exists on disk but was never applied`
          : `migration "${name}" has ${attempts.length} ledger row(s) but none completed successfully`,
      );
    }
  }
  for (const name of succeeded) {
    if (!onDisk.includes(name)) {
      findings.push(`migration "${name}" is applied but no longer exists on disk`);
    }
  }

  const abandoned = applied.filter(
    (row) => row.rolled_back_at !== null || row.finished_at === null,
  ).length;

  return {
    key: 'migrations',
    title: 'Migration ledger is complete and fully applied',
    status: findings.length === 0 ? 'PASS' : 'FAIL',
    detail:
      `${succeeded.size}/${onDisk.length} migrations applied successfully` +
      (abandoned > 0 ? ` (${abandoned} superseded rolled-back attempt(s), which is normal)` : ''),
    findings,
  };
}

/**
 * Postgres guarantees a foreign key was valid when it was written, but a restore can
 * load data with constraints disabled. This re-proves every FK by looking for children
 * whose parent is absent.
 */
async function checkForeignKeys(db: PrismaClient): Promise<CheckResult> {
  const constraints = await db.$queryRawUnsafe<
    {
      constraint_name: string;
      child_table: string;
      child_column: string;
      parent_table: string;
      parent_column: string;
    }[]
  >(`
    SELECT
      con.conname                AS constraint_name,
      child.relname              AS child_table,
      child_att.attname          AS child_column,
      parent.relname             AS parent_table,
      parent_att.attname         AS parent_column
    FROM pg_constraint con
    JOIN pg_class child        ON child.oid = con.conrelid
    JOIN pg_class parent       ON parent.oid = con.confrelid
    JOIN pg_namespace ns       ON ns.oid = child.relnamespace
    JOIN pg_attribute child_att  ON child_att.attrelid = con.conrelid
                                AND child_att.attnum = con.conkey[1]
    JOIN pg_attribute parent_att ON parent_att.attrelid = con.confrelid
                                AND parent_att.attnum = con.confkey[1]
    WHERE con.contype = 'f'
      AND ns.nspname = 'public'
      AND array_length(con.conkey, 1) = 1
    ORDER BY child.relname, con.conname
  `);

  const findings: string[] = [];
  for (const fk of constraints) {
    const [{ orphans }] = await db.$queryRawUnsafe<{ orphans: bigint }[]>(`
      SELECT COUNT(*)::bigint AS orphans
      FROM "${fk.child_table}" child
      WHERE child."${fk.child_column}" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "${fk.parent_table}" parent
          WHERE parent."${fk.parent_column}" = child."${fk.child_column}"
        )
    `);
    if (Number(orphans) > 0) {
      findings.push(
        `${fk.child_table}.${fk.child_column} has ${orphans} row(s) with no matching ${fk.parent_table}.${fk.parent_column} (${fk.constraint_name})`,
      );
    }
  }

  return {
    key: 'foreign-keys',
    title: 'No foreign key points at a missing row',
    status: findings.length === 0 ? 'PASS' : 'FAIL',
    detail: `${constraints.length} single-column foreign keys checked`,
    findings,
  };
}

/** A tenant-owned row with a null tenantId is invisible to tenant scoping and to RLS. */
async function checkTenantOwnership(db: PrismaClient): Promise<CheckResult> {
  const columns = await db.$queryRawUnsafe<{ table_name: string }[]>(`
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE c.table_schema = 'public'
      AND c.column_name = 'tenantId'
      AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name
  `);

  const findings: string[] = [];
  for (const { table_name: table } of columns) {
    const [{ orphans }] = await db.$queryRawUnsafe<{ orphans: bigint }[]>(
      `SELECT COUNT(*)::bigint AS orphans FROM "${table}" WHERE "tenantId" IS NULL`,
    );
    if (Number(orphans) > 0) findings.push(`${table} has ${orphans} row(s) with a null tenantId`);
  }

  return {
    key: 'tenant-ownership',
    title: 'No tenant-owned row has a null tenantId',
    status: findings.length === 0 ? 'PASS' : 'FAIL',
    detail: `${columns.length} tenant-owned tables checked`,
    findings,
  };
}

/**
 * Prisma migrations deliberately contain no ENABLE/FORCE/CREATE POLICY - RLS is applied
 * separately from supabase/rls.sql. A restore therefore silently produces a database with
 * the right tables and no row-level security at all, which is exactly the state that must
 * never reach production unnoticed.
 */
async function checkRowLevelSecurity(db: PrismaClient, required: boolean): Promise<CheckResult> {
  const tables = await db.$queryRawUnsafe<
    { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean; policies: bigint }[]
  >(`
    SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
           (SELECT COUNT(*)::bigint FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN information_schema.columns col
      ON col.table_name = c.relname AND col.table_schema = 'public' AND col.column_name = 'tenantId'
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    GROUP BY c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity
    ORDER BY c.relname
  `);

  const enabled = tables.filter((table) => table.relrowsecurity);
  const enabledWithoutPolicy = enabled.filter((table) => Number(table.policies) === 0);
  const findings = enabledWithoutPolicy.map(
    (table) => `${table.relname} has RLS enabled but no policy, which denies all access`,
  );

  if (required) {
    for (const table of tables) {
      if (!table.relrowsecurity) findings.push(`${table.relname} is tenant-owned but has RLS disabled`);
    }
  }

  const detail = `${enabled.length}/${tables.length} tenant-owned tables have RLS enabled`;
  if (!required && enabled.length === 0) {
    return {
      key: 'rls',
      title: 'Row-level security configuration',
      status: 'SKIPPED',
      detail: `${detail} - pass --require-rls to fail on this (RLS is applied from supabase/rls.sql, not by migrations)`,
      findings: [],
    };
  }

  return {
    key: 'rls',
    title: 'Row-level security configuration',
    status: findings.length === 0 ? 'PASS' : 'FAIL',
    detail,
    findings,
  };
}

async function collectCounts(db: PrismaClient): Promise<Record<string, number>> {
  const present = new Set(
    (
      await db.$queryRawUnsafe<{ table_name: string }[]>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
      )
    ).map((row) => row.table_name),
  );

  const counts: Record<string, number> = {};
  for (const model of REPRESENTATIVE_MODELS) {
    if (!present.has(model)) continue;
    const [{ total }] = await db.$queryRawUnsafe<{ total: bigint }[]>(
      `SELECT COUNT(*)::bigint AS total FROM "${model}"`,
    );
    counts[model] = Number(total);
  }
  return counts;
}

/**
 * Counts only. Never row contents - a DR report must not become a place where
 * customer data leaks into documentation.
 */
function checkCountReconciliation(
  counts: Record<string, number>,
  expectPath: string | null,
): CheckResult {
  if (!expectPath) {
    return {
      key: 'counts',
      title: 'Representative record counts',
      status: 'SKIPPED',
      detail: 'no --expect-counts snapshot supplied; counts recorded but not reconciled',
      findings: [],
    };
  }
  if (!existsSync(expectPath)) {
    return {
      key: 'counts',
      title: 'Representative record counts',
      status: 'FAIL',
      detail: `expected-counts file not found: ${expectPath}`,
      findings: [`missing snapshot file ${expectPath}`],
    };
  }

  const expected = JSON.parse(readFileSync(expectPath, 'utf8')) as Record<string, number>;
  const findings: string[] = [];
  for (const [model, expectedCount] of Object.entries(expected)) {
    const actual = counts[model];
    if (actual === undefined) {
      findings.push(`${model} is absent from the restored database (expected ${expectedCount} rows)`);
    } else if (actual !== expectedCount) {
      findings.push(`${model}: expected ${expectedCount} rows, restored ${actual}`);
    }
  }

  return {
    key: 'counts',
    title: 'Representative record counts reconcile with the pre-backup snapshot',
    status: findings.length === 0 ? 'PASS' : 'FAIL',
    detail: `${Object.keys(expected).length} models reconciled`,
    findings,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('DATABASE_URL is required. Point it at the RESTORED database, not production.');
    process.exit(2);
  }

  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const startedAt = new Date().toISOString();
  let counts: Record<string, number> = {};
  const results: CheckResult[] = [];

  try {
    results.push(await checkTablesExist(db));
    results.push(await checkMigrations(db));
    results.push(await checkForeignKeys(db));
    results.push(await checkTenantOwnership(db));
    results.push(await checkRowLevelSecurity(db, options.requireRls));
    counts = await collectCounts(db);
    results.push(checkCountReconciliation(counts, options.expectCountsPath));
  } catch (error) {
    results.push({
      key: 'execution',
      title: 'Verification executed to completion',
      status: 'FAIL',
      detail: error instanceof Error ? error.message : String(error),
      findings: [error instanceof Error ? error.message : String(error)],
    });
  } finally {
    await db.$disconnect();
  }

  const failed = results.filter((result) => result.status === 'FAIL');
  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    database: new URL(databaseUrl).pathname.slice(1),
    status: failed.length === 0 ? 'PASS' : 'FAIL',
    checks: results,
    counts,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`database integrity verification — ${report.database}`);
    console.log('='.repeat(72));
    for (const result of results) {
      console.log(`[${result.status.padEnd(7)}] ${result.title}`);
      console.log(`          ${result.detail}`);
      for (const finding of result.findings.slice(0, 10)) console.log(`          - ${finding}`);
      if (result.findings.length > 10) {
        console.log(`          ... ${result.findings.length - 10} more`);
      }
    }
    console.log('-'.repeat(72));
    console.log('representative counts:');
    for (const [model, total] of Object.entries(counts)) {
      console.log(`  ${model.padEnd(20)} ${total}`);
    }
    console.log('='.repeat(72));
    console.log(`RESULT: ${report.status}`);
  }

  process.exit(failed.length === 0 ? 0 : 1);
}

void main();
