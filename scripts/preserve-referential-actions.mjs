#!/usr/bin/env node
/**
 * Keep the referential action a relation already had, when it was only ever implicit.
 *
 *     node scripts/preserve-referential-actions.mjs <before.sql> [--write]
 *
 * Prisma's default `onDelete` depends on whether the foreign key's fields are all optional:
 * optional gets `SetNull`, anything required gets `Restrict`. Making a relation composite adds
 * `tenantId`, which is NOT NULL - so every relation that never wrote `onDelete` and relied on
 * the optional default silently becomes `Restrict`.
 *
 * Measured on this schema: 28 of them, including `User.managerId` (a manager with reports
 * could no longer be deleted) and `Lead.accountId` (an account with leads could no longer be
 * deleted). None of that is a tenant-isolation change; it is collateral, and it would have
 * shipped as one.
 *
 * `before.sql` is the schema materialised from the migrations as they stood before the
 * composite change - the authority on what each constraint actually did:
 *
 *     prisma migrate diff --from-empty --to-migrations <old-migrations> --script > before.sql
 *
 * Relations that already state `onDelete` explicitly are left alone: the author said what they
 * wanted and this is not the place to second-guess it.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { Prisma } from '@prisma/client';

const beforeFile = process.argv[2];
const write = process.argv.includes('--write');
if (!beforeFile) {
  console.error('usage: node scripts/preserve-referential-actions.mjs <before.sql> [--write]');
  process.exit(2);
}

/** table.firstColumn -> ON DELETE action, as the database had it before the change. */
const wasSetNull = new Set();
{
  const sql = readFileSync(beforeFile, 'utf8').replace(/\s+/g, ' ');
  const re =
    /ALTER TABLE "(\w+)" ADD CONSTRAINT "[^"]+" FOREIGN KEY \(([^)]+)\) REFERENCES "\w+"\([^)]*\)([^;]*);/g;
  let m;
  while ((m = re.exec(sql))) {
    const [, table, cols, tail] = m;
    if (!/ON DELETE SET NULL/.test(tail)) continue;
    wasSetNull.add(`${table}.${cols.split(',')[0].trim().replace(/"/g, '')}`);
  }
}

/** model -> relation field names that must carry an explicit onDelete: SetNull. */
const needExplicit = new Map();
for (const model of Prisma.dmmf.datamodel.models) {
  for (const field of model.fields) {
    const cols = field.relationFromFields ?? [];
    if (field.kind !== 'object' || cols.length === 0) continue;
    if (!wasSetNull.has(`${model.name}.${cols[0]}`)) continue;
    if (field.relationOnDelete) continue; // stated explicitly already
    if (!needExplicit.has(model.name)) needExplicit.set(model.name, new Set());
    needExplicit.get(model.name).add(field.name);
  }
}

const SCHEMA = 'prisma/schema.prisma';
const lines = readFileSync(SCHEMA, 'utf8').split(/\r?\n/);
const out = [];
let current = null;
let patched = 0;
const missed = [];

for (const line of lines) {
  const start = line.match(/^model\s+(\w+)\s*\{/);
  if (start) current = start[1];
  else if (/^\}/.test(line)) current = null;

  const wanted = current ? needExplicit.get(current) : null;
  const name = line.match(/^\s*(\w+)\s+\w+\??\s+@relation\(/)?.[1];
  if (wanted && name && wanted.has(name)) {
    if (/onDelete:/.test(line)) {
      out.push(line);
    } else {
      // Insert before the closing paren of @relation(...), which is the last ')' on the line.
      const close = line.lastIndexOf(')');
      if (close === -1) {
        missed.push(`${current}.${name} — @relation spans lines`);
        out.push(line);
      } else {
        out.push(`${line.slice(0, close)}, onDelete: SetNull${line.slice(close)}`);
        patched++;
      }
    }
    continue;
  }
  out.push(line);
}

const expected = [...needExplicit.values()].reduce((n, s) => n + s.size, 0);
console.log(`relations that were implicitly SET NULL : ${expected}`);
console.log(`given an explicit onDelete: SetNull     : ${patched}`);
if (missed.length > 0) {
  console.log(`\nnot patched (${missed.length}):`);
  for (const x of missed) console.log(`   ${x}`);
}

if (patched !== expected) {
  console.log('\nRefusing to write: some relations could not be patched.');
  process.exit(1);
}

if (write) {
  writeFileSync(SCHEMA, out.join('\n'));
  console.log(`\nWrote ${SCHEMA}.`);
} else {
  console.log('\nDry run. Re-run with --write.');
}
