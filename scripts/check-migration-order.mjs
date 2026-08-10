#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Migration order preflight.
 *
 * Prisma timestamps a migration when you **generate** it, not by where it belongs in the
 * dependency chain. A branch whose earlier migrations were authored with dates ahead of the wall
 * clock therefore produces new migrations that sort *before* the tables they alter. The result
 * applies cleanly to a developer database that already has those tables, keeps
 * `prisma migrate status` green, and fails only on a replay from empty.
 *
 * That has now happened three times in this repository:
 *
 * ```text
 * 20260810053420_work_order_phase6a        → renamed 20260811010000
 * 20260810055927_work_order_lease_fencing  → renamed 20260811020000
 * 20260810065626_agent_execution_phase6b   → renamed 20260811030000
 * ```
 *
 * Each was caught by `migrate diff --from-migrations` against an empty shadow database, which
 * remains **the** correctness authority — it verifies the actual SQL, not the filenames. This
 * check does not replace it and cannot: a migration can sort correctly and still be wrong.
 *
 * What it buys is speed and locality. It runs in about a second with no database, so the fault
 * is named at generation time rather than after a full replay, and it can run before pushing.
 *
 * Exit 0 when the ordering is sound, 1 when it is not.
 */

const NAME_PATTERN = /^(\d{14})_[a-z0-9_]+$/;

/**
 * The whole rule, as a pure function so it can be tested without git or a filesystem.
 *
 * @param {{ base: string[], head: string[] }} input migration directory names
 * @returns {{ ok: boolean, errors: string[], added: string[] }}
 */
export function checkMigrationOrder({ base, head }) {
  const errors = [];

  for (const name of head) {
    if (!NAME_PATTERN.test(name)) {
      errors.push(`"${name}" is not a valid migration directory name (expected 14 digits, underscore, lowercase slug)`);
    }
  }

  const timestamps = new Map();
  for (const name of head) {
    const match = NAME_PATTERN.exec(name);
    if (!match) continue;
    const existing = timestamps.get(match[1]);
    if (existing) errors.push(`"${name}" and "${existing}" share the timestamp ${match[1]}`);
    else timestamps.set(match[1], name);
  }

  const headSet = new Set(head);
  for (const name of base) {
    // An applied migration that vanished is a different and worse problem than misordering: every
    // deployed database has it recorded, and `migrate status` will call the history divergent.
    if (!headSet.has(name)) errors.push(`"${name}" exists on the base branch but not here — an applied migration must never be deleted or renamed`);
  }

  const baseSet = new Set(base);
  const added = head.filter((name) => !baseSet.has(name)).sort();

  if (added.length > 0 && base.length > 0) {
    // Sorting is lexicographic, which is also how Prisma orders them — fixed-width timestamps
    // make that equivalent to chronological.
    const tail = [...base].sort().at(-1);
    for (const name of added) {
      if (name <= tail) {
        errors.push(
          `"${name}" sorts before the existing migration tail "${tail}". Prisma stamps generation time, not dependency position — rename it to sort after the tail, or it will replay before the migrations it depends on.`
        );
      }
    }
  }

  return { ok: errors.length === 0, errors, added };
}

/** Migration directory names in the working tree. */
function readHead(migrationsDir) {
  return readdirSync(migrationsDir).filter((entry) =>
    statSync(path.join(migrationsDir, entry)).isDirectory()
  );
}

/** Migration directory names on a git ref. Empty when the ref is unavailable. */
function readBase(ref) {
  try {
    const out = execFileSync('git', ['ls-tree', '-d', '--name-only', `${ref}:prisma/migrations`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

function main() {
  const ref = process.argv[2] ?? 'origin/main';
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const migrationsDir = path.join(root, 'prisma', 'migrations');

  const head = readHead(migrationsDir);
  const base = readBase(ref);

  if (base === null) {
    // A shallow clone without the base ref, or a first commit. Skipping is right: the alternative
    // is failing every fork and every fresh checkout for a condition this check cannot evaluate.
    console.log(`[migration-order] base ref "${ref}" unavailable — checking format only`);
  }

  const result = checkMigrationOrder({ base: base ?? [], head });

  if (result.ok) {
    const summary = result.added.length > 0 ? `${result.added.length} new: ${result.added.join(', ')}` : 'no new migrations';
    console.log(`[migration-order] ok — ${head.length} migrations, ${summary}`);
    return 0;
  }

  console.error('[migration-order] FAILED');
  for (const error of result.errors) console.error(`  - ${error}`);
  console.error('\nFresh-replay (`migrate diff --from-migrations`) remains the correctness gate; this check only fails faster.');
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exit(main());
}
