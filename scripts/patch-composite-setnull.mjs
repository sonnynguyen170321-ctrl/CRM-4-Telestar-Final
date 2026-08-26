#!/usr/bin/env node
/**
 * Patch `ON DELETE SET NULL` into its column-list form in a generated migration.
 *
 *     node scripts/patch-composite-setnull.mjs prisma/migrations/<dir>/migration.sql
 *
 * `prisma migrate diff` emits, for a composite tenant foreign key:
 *
 *     FOREIGN KEY ("leadId", "tenantId") REFERENCES "Lead"("id", "tenantId")
 *       ON DELETE SET NULL ON UPDATE CASCADE
 *
 * Plain `SET NULL` nulls EVERY referencing column, and `tenantId` is NOT NULL - so deleting a
 * Lead would raise a not-null violation instead of detaching the Activity. That would turn a
 * tenant-isolation fix into an outage the first time anybody deleted a parent row.
 *
 * Postgres 15+ accepts `ON DELETE SET NULL ("leadId")`, which nulls only the foreign key and
 * leaves the row's tenant intact. This server is 16.15.
 *
 * `prisma migrate diff` does not distinguish the two forms, so the patched constraint reports
 * no drift against a datamodel that says `onDelete: SetNull`. That was measured on a throwaway
 * database before this approach was chosen, not assumed: with Prisma's own constraint names the
 * diff prints "No difference detected."
 *
 * Idempotent - a constraint already carrying a column list is left alone.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/patch-composite-setnull.mjs <migration.sql>');
  process.exit(2);
}

const src = readFileSync(file, 'utf8');

// Only composite keys whose second column is tenantId. A single-column SET NULL is already
// correct and must not be touched.
const pattern =
  /FOREIGN KEY \("(\w+)", "tenantId"\) REFERENCES "[^"]+"\("id", "tenantId"\) ON DELETE SET NULL(?! \()/g;

let patched = 0;
const out = src.replace(pattern, (match, childCol) => {
  patched++;
  return match.replace('ON DELETE SET NULL', `ON DELETE SET NULL ("${childCol}")`);
});

const remaining = [...out.matchAll(/ON DELETE SET NULL(?! \()/g)].length;

console.log(`patched to column-list SET NULL : ${patched}`);
console.log(`plain SET NULL left in file     : ${remaining}`);

if (remaining > 0) {
  // Not necessarily wrong - a single-column relation legitimately uses plain SET NULL - but
  // it must be looked at rather than assumed, because a composite one left plain is the exact
  // failure this script exists to prevent.
  console.log('\nReview the remaining ones: a composite key left plain will fail on delete.');
  for (const line of out.split('\n')) {
    if (/ON DELETE SET NULL(?! \()/.test(line)) console.log(`   ${line.trim().slice(0, 130)}`);
  }
}

if (patched > 0) {
  writeFileSync(file, out);
  console.log(`\nWrote ${file}.`);
} else {
  console.log('\nNothing to patch.');
}
