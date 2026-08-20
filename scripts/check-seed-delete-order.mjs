#!/usr/bin/env node
/**
 * The destructive demo seed's delete list must cover every child that can block it.
 *
 * `prisma/seed-demo.ts` wipes the database with an ordered list of `deleteMany()` calls. A
 * required relation declared without an `onDelete` gets Prisma's default, Restrict, so such a
 * child pins its parent in place and the parent's delete fails with P2003.
 *
 * That list rots silently. CI seeds an empty service container where no child rows exist, so a
 * missing entry is invisible there — and fails on every developer machine and every reused test
 * database, partway through the wipe, leaving a half-seeded database behind. The visible
 * symptom is a login-dependent Playwright spec failing as though the product were broken.
 *
 * This check reads both files and answers one question: for every model the seed deletes, is
 * each of its restricting children also deleted, and deleted first?
 *
 *   node scripts/check-seed-delete-order.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SCHEMA = path.join(ROOT, 'prisma', 'schema.prisma');
const SEED = path.join(ROOT, 'prisma', 'seed-demo.ts');

/** Prisma exposes `model Foo` as `prisma.foo`. */
const clientProperty = (model) => model.charAt(0).toLowerCase() + model.slice(1);

/**
 * Children that block their parent: a **required** relation with no explicit `onDelete`.
 *
 * Optional relations default to SetNull and never block, so they are skipped rather than
 * reported — listing them would bury the two or three that matter.
 */
function restrictingChildren() {
  const lines = readFileSync(SCHEMA, 'utf8').split(/\r?\n/);
  const edges = [];
  let model = null;

  for (const line of lines) {
    const declaration = line.match(/^model\s+(\w+)/);
    if (declaration) {
      model = declaration[1];
      continue;
    }
    if (!model || !line.includes('@relation(fields:') || line.includes('onDelete')) continue;

    const relation = line.trim().match(/^(\w+)\s+(\w+)(\?)?\s+@relation/);
    if (!relation) continue;

    const [, , target, optional] = relation;
    if (optional) continue;
    edges.push({ child: model, parent: target });
  }
  return edges;
}

/** The seed's delete list, in the order it runs. */
function seedDeleteOrder() {
  const source = readFileSync(SEED, 'utf8');
  const order = [];
  for (const match of source.matchAll(/\braw\.(\w+)\.deleteMany\(/g)) {
    if (!order.includes(match[1])) order.push(match[1]);
  }
  return order;
}

function main() {
  const edges = restrictingChildren();
  const order = seedDeleteOrder();
  const position = new Map(order.map((name, index) => [name, index]));

  if (order.length === 0) {
    console.error('FAIL: found no raw.<model>.deleteMany() calls in prisma/seed-demo.ts.');
    process.exit(1);
  }

  const problems = [];
  for (const { child, parent } of edges) {
    const parentProp = clientProperty(parent);
    const childProp = clientProperty(child);
    if (!position.has(parentProp)) continue; // the seed does not delete this parent

    if (!position.has(childProp)) {
      problems.push(
        `${childProp} is never deleted, but its required ${parentProp} relation has no onDelete — ` +
          `it will block raw.${parentProp}.deleteMany() with P2003 on any database holding one.`,
      );
      continue;
    }
    if (position.get(childProp) > position.get(parentProp)) {
      problems.push(
        `${childProp} is deleted after ${parentProp}, but it restricts it. Move the ` +
          `raw.${childProp}.deleteMany() call above raw.${parentProp}.deleteMany().`,
      );
    }
  }

  if (problems.length > 0) {
    console.error('\nprisma/seed-demo.ts cannot wipe a populated database:\n');
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(
      '\nAdd the missing call, children before parents. A seed that fails partway leaves a\n' +
        'half-wiped database, and the next login-dependent spec fails as though the product broke.\n',
    );
    process.exit(1);
  }

  console.log(
    `PASS: seed delete order covers every restricting child ` +
      `(${order.length} models deleted, ${edges.length} restricting relations checked).`,
  );
}

main();
