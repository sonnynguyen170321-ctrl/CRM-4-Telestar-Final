#!/usr/bin/env node
/**
 * Rewrite every tenant-crossing relation in `prisma/schema.prisma` into a composite one.
 *
 *     node scripts/apply-composite-tenant-keys.mjs --dry-run
 *     node scripts/apply-composite-tenant-keys.mjs --write
 *
 * For each relation where a tenant-owned child references a tenant-owned parent by a single
 * column, this turns
 *
 *     @relation(fields: [leadId], references: [id], onDelete: SetNull)
 *
 * into
 *
 *     @relation(fields: [leadId, tenantId], references: [id, tenantId], onDelete: SetNull)
 *
 * and adds `@@unique([id, tenantId])` to every parent that is now referenced that way,
 * because a composite foreign key needs a matching unique key to point at.
 *
 * Done as a generator rather than by hand because it is 146 relations across 66 models: a
 * hand edit would be reviewed by reading 146 diff hunks and trusting that none was missed,
 * whereas this can be re-run and diffed against the datamodel to prove it was exhaustive.
 *
 * It only edits the datamodel. The migration SQL comes from `prisma migrate diff`, and the
 * 38 `SetNull` relations then need their `ON DELETE SET NULL` patched to the column-list
 * form `ON DELETE SET NULL ("childCol")` - a composite SET NULL would otherwise try to null
 * `tenantId`, which is NOT NULL, turning a parent delete into an error. Postgres 15+ has the
 * column-list form and `prisma migrate diff` treats it as equivalent to plain SET NULL, so it
 * does not register as drift. Both facts were measured before this script was written.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { Prisma } from '@prisma/client';

const SCHEMA = 'prisma/schema.prisma';
const write = process.argv.includes('--write');

const models = Prisma.dmmf.datamodel.models;
const tenantOwned = new Set(
  models.filter((m) => m.fields.some((f) => f.name === 'tenantId')).map((m) => m.name),
);

/** child model -> set of relation field names that must become composite. */
const targets = new Map();
/** parent models that will need @@unique([id, tenantId]). */
const needUnique = new Set();
/**
 * child model -> columns needing @@unique([col, tenantId]).
 *
 * A one-to-one is defined by the FK column carrying `@unique`. Once the relation becomes
 * composite, Prisma requires the uniqueness to cover the same pair the relation uses, so the
 * single-column `@unique` no longer satisfies it. The original stays: it is the business rule
 * that there is one of these per parent, and dropping it would widen the schema silently.
 */
const needPairUnique = new Map();

for (const model of models) {
  if (!tenantOwned.has(model.name)) continue;
  for (const field of model.fields) {
    const cols = field.relationFromFields ?? [];
    if (field.kind !== 'object' || cols.length !== 1) continue;
    if (field.type === 'Tenant' || !tenantOwned.has(field.type)) continue;
    if (cols.includes('tenantId')) continue;
    if ((field.relationToFields ?? []).join(',') !== 'id') continue; // only ...references: [id]
    if (!targets.has(model.name)) targets.set(model.name, new Map());
    targets.get(model.name).set(field.name, cols[0]);
    needUnique.add(field.type);

    const scalar = model.fields.find((f) => f.name === cols[0]);
    if (scalar?.isUnique) {
      if (!needPairUnique.has(model.name)) needPairUnique.set(model.name, new Set());
      needPairUnique.get(model.name).add(cols[0]);
    }
  }
}

const src = readFileSync(SCHEMA, 'utf8');
const lines = src.split(/\r?\n/);
const out = [];
let currentModel = null;
let rewritten = 0;
let uniquesAdded = 0;
let pairUniquesAdded = 0;
const missed = [];

for (const line of lines) {
  const modelStart = line.match(/^model\s+(\w+)\s*\{/);
  if (modelStart) {
    currentModel = modelStart[1];
    out.push(line);
    // The unique goes immediately after the opening brace so it cannot land inside a block
    // attribute list or after a trailing comment.
    if (needUnique.has(currentModel)) {
      out.push(`  @@unique([id, tenantId], map: "${currentModel}_id_tenantId_key")`);
      uniquesAdded++;
    }
    for (const col of needPairUnique.get(currentModel) ?? []) {
      out.push(`  @@unique([${col}, tenantId], map: "${currentModel}_${col}_tenantId_key")`);
      pairUniquesAdded++;
    }
    continue;
  }
  if (/^\}/.test(line)) {
    currentModel = null;
    out.push(line);
    continue;
  }

  const wanted = currentModel ? targets.get(currentModel) : null;
  if (wanted) {
    // `  lead   Lead?   @relation(fields: [leadId], references: [id], ...)`
    const m = line.match(/^\s*(\w+)\s+\w+\??\s+@relation\(/);
    const fieldName = m?.[1];
    if (fieldName && wanted.has(fieldName)) {
      const col = wanted.get(fieldName);
      const before = line;
      const next = line
        .replace(`fields: [${col}]`, `fields: [${col}, tenantId]`)
        .replace('references: [id]', 'references: [id, tenantId]');
      if (next === before) {
        missed.push(`${currentModel}.${fieldName} (${col}) — pattern did not match`);
      } else {
        rewritten++;
      }
      out.push(next);
      continue;
    }
  }
  out.push(line);
}

const expected = [...targets.values()].reduce((n, m) => n + m.size, 0);

console.log(`relations to rewrite : ${expected}`);
console.log(`relations rewritten  : ${rewritten}`);
console.log(`parents given @@unique: ${uniquesAdded} (of ${needUnique.size} needed)`);
const pairsNeeded = [...needPairUnique.values()].reduce((n, s2) => n + s2.size, 0);
console.log(`one-to-one pair uniques: ${pairUniquesAdded} (of ${pairsNeeded} needed)`);
if (missed.length > 0) {
  console.log(`\nNOT rewritten (${missed.length}):`);
  for (const x of missed) console.log(`   ${x}`);
}

if (rewritten !== expected || uniquesAdded !== needUnique.size || pairUniquesAdded !== pairsNeeded) {
  console.log('\nRefusing to write: the datamodel and the text edit disagree.');
  console.log('A partial rewrite is worse than none — it would look done and leave holes.');
  process.exit(1);
}

if (write) {
  writeFileSync(SCHEMA, out.join('\n'));
  console.log(`\nWrote ${SCHEMA}. Next: prisma validate, then migrate diff --script.`);
} else {
  console.log('\nDry run. Nothing written. Re-run with --write.');
}
