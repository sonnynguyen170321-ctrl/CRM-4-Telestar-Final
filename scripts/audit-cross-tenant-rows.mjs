#!/usr/bin/env node
/**
 * Does a cross-tenant relationship already exist in this database?
 *
 *     node scripts/audit-cross-tenant-rows.mjs
 *     DATABASE_URL=... node scripts/audit-cross-tenant-rows.mjs --json
 *
 * `scripts/audit-tenant-integrity.mjs` reports that the schema *permits* a child row in one
 * tenant to reference a parent in another. That is a statement about the constraints. This
 * asks the data whether it has happened, which is a different question and the one that
 * decides severity: a structural hole nobody has fallen through is a hardening task, and one
 * with rows in it is an incident.
 *
 * It is also the precondition for the composite-foreign-key migration. Adding
 * FOREIGN KEY (childCol, "tenantId") REFERENCES parent (id, "tenantId") fails on any row that
 * already violates it, so the migration cannot be written until this returns zero - or until
 * the offending rows have an agreed disposition.
 *
 * Read-only: it issues COUNT queries and nothing else. Safe against production.
 *
 * Exit 0 means no cross-tenant row was found. Exit 1 means at least one was, and the
 * offending pairs are listed with counts.
 */

import { PrismaClient, Prisma } from '@prisma/client';

const asJson = process.argv.includes('--json');

const models = Prisma.dmmf.datamodel.models;
const tenantOwned = new Set(
  models.filter((m) => m.fields.some((f) => f.name === 'tenantId')).map((m) => m.name),
);
/** Prisma model name -> physical table name, which @@map may have changed. */
const tableOf = new Map(models.map((m) => [m.name, m.dbName ?? m.name]));
/** Prisma field name -> physical column name, likewise. */
const columnOf = (model, fieldName) => {
  const f = models.find((m) => m.name === model)?.fields.find((x) => x.name === fieldName);
  return f?.dbName ?? fieldName;
};

const edges = [];
for (const model of models) {
  if (!tenantOwned.has(model.name)) continue;
  for (const field of model.fields) {
    const cols = field.relationFromFields ?? [];
    if (field.kind !== 'object' || cols.length === 0) continue;
    if (field.type === 'Tenant' || !tenantOwned.has(field.type)) continue;
    if (cols.includes('tenantId')) continue;
    edges.push({
      child: model.name,
      childTable: tableOf.get(model.name),
      childCol: columnOf(model.name, cols[0]),
      parent: field.type,
      parentTable: tableOf.get(field.type),
      nullable: !field.isRequired,
    });
  }
}

// Same convention as scripts/verify-rls.mjs: an explicit DSN wins, otherwise the local
// development database. The repository keeps its real environment in dotenvx-encrypted
// files, so `process.env.DATABASE_URL` is not populated for a bare `node scripts/...` run.
const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/telestar_crm';

const prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });
const violations = [];
const errors = [];

try {
  for (const e of edges) {
    // A NULL foreign key references nothing and cannot cross a tenant, so the JOIN excludes
    // it naturally. Identifiers are quoted because the datamodel is PascalCase.
    const sql =
      `SELECT count(*)::int AS n FROM "${e.childTable}" c ` +
      `JOIN "${e.parentTable}" p ON p."id" = c."${e.childCol}" ` +
      `WHERE c."tenantId" <> p."tenantId"`;
    try {
      const rows = await prisma.$queryRawUnsafe(sql);
      const n = Number(rows?.[0]?.n ?? 0);
      if (n > 0) violations.push({ ...e, rows: n });
    } catch (err) {
      // A table absent from this database (a migration not yet applied) is worth reporting
      // rather than swallowing: an unchecked edge is not a clean edge.
      const line =
        String(err?.message ?? err)
          .split('\n')
          .map((l) => l.trim())
          .find((l) => l.length > 0) ?? String(err);
      errors.push({ ...e, error: line.slice(0, 120) });
    }
  }
} finally {
  await prisma.$disconnect();
}

const totalRows = violations.reduce((sum, v) => sum + v.rows, 0);

if (asJson) {
  console.log(
    JSON.stringify(
      { edgesChecked: edges.length, violations, errors, totalRows, ok: violations.length === 0 },
      null,
      2,
    ),
  );
} else {
  console.log(`Checked ${edges.length} tenant-crossing foreign keys.\n`);
  if (violations.length === 0) {
    console.log('No cross-tenant rows found. The hole is structural, not yet exercised,');
    console.log('and the composite-key migration has nothing to clean up first.');
  } else {
    console.log(`CROSS-TENANT ROWS PRESENT: ${totalRows} across ${violations.length} relation(s)`);
    for (const v of violations) {
      console.log(`   ${v.child}.${v.childCol} -> ${v.parent}   ${v.rows} row(s)`);
    }
    console.log('\nEach of these blocks the composite foreign key and needs a disposition');
    console.log('before the migration can be applied.');
  }
  if (errors.length > 0) {
    console.log(`\n${errors.length} edge(s) could not be checked:`);
    for (const e of errors) console.log(`   ${e.child}.${e.childCol} -> ${e.parent}: ${e.error}`);
  }
}

process.exit(violations.length === 0 && errors.length === 0 ? 0 : 1);
