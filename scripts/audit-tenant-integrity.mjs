#!/usr/bin/env node
/**
 * Two tenant-isolation holes that Row-Level Security cannot close, reported from the
 * Prisma datamodel rather than from anybody's recollection of it.
 *
 *     node scripts/audit-tenant-integrity.mjs
 *     node scripts/audit-tenant-integrity.mjs --json
 *
 * A. CROSS-TENANT FOREIGN KEYS.
 *    A child row honestly labelled tenant A may carry a foreign key pointing at tenant B's
 *    parent. The RLS policy checks the row's own `tenantId` and is satisfied; the foreign
 *    key checks that the parent id exists and is satisfied too, because FK validation does
 *    not run under the caller's policies. Nothing compares the two tenants. The constraint
 *    also answers whether a foreign id exists, which makes it an existence oracle for
 *    another tenant's primary keys.
 *
 *    Closing it is a composite key: UNIQUE (id, "tenantId") on the parent, and
 *    FOREIGN KEY (childCol, "tenantId") REFERENCES parent (id, "tenantId") on the child.
 *
 * B. TABLES RLS CANNOT REACH.
 *    `supabase/rls.sql` generates its policies by looping over tables that have a
 *    `tenantId` column (line 112). A table without one therefore gets no ENABLE and no
 *    policy, while `GRANT ... ON ALL TABLES IN SCHEMA public` still hands the application
 *    role full DML on it. It is readable by every tenant.
 *
 *    `tests/rls-policy-coverage.test.ts` filters on `a.attname = 'tenantId'` as well, so
 *    the test that proves coverage cannot see the tables that lack it. The generator and
 *    its check share one blind spot, which is why this audit reads the datamodel instead.
 *
 * Exit 0 means neither class has any instance left. Exit 1 lists them.
 */

import { Prisma } from '@prisma/client';

const asJson = process.argv.includes('--json');

const models = Prisma.dmmf.datamodel.models;
const tenantOwned = new Set(
  models.filter((m) => m.fields.some((f) => f.name === 'tenantId')).map((m) => m.name),
);

/** The tenant table itself is the root of ownership, not a peer that can be crossed. */
const ROOT = 'Tenant';

const crossTenantFks = [];
for (const model of models) {
  if (!tenantOwned.has(model.name)) continue;
  for (const field of model.fields) {
    if (field.kind !== 'object') continue;
    const cols = field.relationFromFields ?? [];
    if (cols.length === 0) continue; // the back-reference side owns no columns
    if (field.type === ROOT) continue;
    if (!tenantOwned.has(field.type)) continue; // parent is global; no tenant to cross
    if (cols.includes('tenantId')) continue; // already composite
    crossTenantFks.push({
      child: model.name,
      columns: cols,
      parent: field.type,
      relation: field.name,
      optional: !field.isRequired,
    });
  }
}

const unreachableByRls = [];
for (const model of models) {
  if (tenantOwned.has(model.name)) continue;
  if (model.name === ROOT) continue;
  const links = model.fields
    .filter((f) => f.kind === 'object' && (f.relationFromFields ?? []).length > 0)
    .filter((f) => tenantOwned.has(f.type))
    .map((f) => `${(f.relationFromFields ?? []).join(',')} -> ${f.type}`);
  if (links.length === 0) continue; // genuinely global, nothing tenant-owned hangs off it
  unreachableByRls.push({ table: model.name, links });
}

if (asJson) {
  console.log(
    JSON.stringify(
      {
        modelsTotal: models.length,
        tenantOwned: tenantOwned.size,
        crossTenantFks,
        unreachableByRls,
        ok: crossTenantFks.length === 0 && unreachableByRls.length === 0,
      },
      null,
      2,
    ),
  );
} else {
  console.log(`Models: ${models.length}   tenant-owned: ${tenantOwned.size}\n`);

  console.log(`A. Foreign keys with no tenant component: ${crossTenantFks.length}`);
  if (crossTenantFks.length > 0) {
    const byParent = new Map();
    for (const fk of crossTenantFks) {
      if (!byParent.has(fk.parent)) byParent.set(fk.parent, []);
      byParent.get(fk.parent).push(fk);
    }
    for (const [parent, fks] of [...byParent.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`   ${parent}  <- ${fks.length}`);
      for (const fk of fks) {
        console.log(`      ${fk.child}.${fk.columns.join(',')}${fk.optional ? '  (nullable)' : ''}`);
      }
    }
  }

  console.log(`\nB. Tenant-linked tables RLS cannot reach: ${unreachableByRls.length}`);
  for (const t of unreachableByRls) {
    console.log(`   ${t.table}  (no tenantId, no policy, full DML granted)`);
    for (const l of t.links) console.log(`      ${l}`);
  }

  const total = crossTenantFks.length + unreachableByRls.length;
  console.log(
    total === 0
      ? '\nNo cross-tenant relationship can be created at rest.'
      : `\n${total} finding(s). Neither class is visible to RLS or to the policy-coverage test.`,
  );
}

process.exit(crossTenantFks.length === 0 && unreachableByRls.length === 0 ? 0 : 1);
