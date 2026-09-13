#!/usr/bin/env node
/**
 * Fail-closed coverage check for deploy/hostinger/sanitize.sql.
 *
 * A dump labelled `.sanitized.dump` gets treated as safe to copy to a laptop. If the scrub misses
 * a column, that label is worse than no label at all — which is what happened here: the first
 * version covered the obvious `email`/`phone`/`token` columns and left note bodies, audit-log
 * JSON diffs, raw import rows and HTML email bodies untouched.
 *
 * So the list is derived from prisma/schema.prisma on every run rather than maintained by hand.
 * Every textual column whose name looks like personal data, a credential, or free text a human
 * typed must either be assigned in sanitize.sql or carry a written reason in
 * deploy/hostinger/sanitize-exemptions.json. A new migration that adds such a column fails this
 * check until someone decides which it is.
 *
 *   node scripts/check-sanitize-coverage.mjs            # report + exit 1 on a gap
 *   node scripts/check-sanitize-coverage.mjs --json     # machine-readable
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = join(ROOT, 'prisma', 'schema.prisma');
const SANITIZE = join(ROOT, 'deploy', 'hostinger', 'sanitize.sql');
const EXEMPTIONS = join(ROOT, 'deploy', 'hostinger', 'sanitize-exemptions.json');

/**
 * Split a column name into lowercase words: `encAccessToken` → enc, access, token;
 * `normalized_email` → normalized, email. Matching whole words rather than prefixes is what
 * catches the encrypted variants (`encAccessToken`, `encPassword`) that a `^token…` anchor misses
 * — and those are the columns whose exposure matters most.
 */
function words(column) {
  return column
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/** A word that means "this is a person, or the key to their account", wherever it appears. */
const IDENTITY_WORDS = new Set([
  'email', 'emails', 'mail', 'phone', 'phones', 'mobile', 'fax', 'whatsapp', 'linkedin',
  'password', 'token', 'secret', 'apikey', 'keyhash', 'credential', 'credentials',
  'address', 'street', 'postcode', 'postalcode', 'zip', 'signature', 'useragent', 'ip',
]);

/** `firstName`, `fullName`, `displayName` — but not `fileName` or `templateName`. */
const NAME_QUALIFIERS = new Set(['first', 'last', 'full', 'display', 'given', 'family', 'contact', 'owner', 'prospect']);

/** Columns that hold text or JSON a human wrote, or that echo what a human wrote. */
const FREE_TEXT = /^(content|body|bodyhtml|bodytext|html|text|note|notes|description|message|memory|summary|transcript|prompt|response|payload|metadata|changedfields|data|errors|rawhtml|snippet|reason|comment|comments|answer|question|subject)$/i;

function isIdentity(column) {
  const w = words(column);
  if (w.some((x) => IDENTITY_WORDS.has(x))) return true;
  // "…Name" only counts when something qualifies it as a person's name.
  const nameAt = w.indexOf('name');
  if (nameAt > 0 && NAME_QUALIFIERS.has(w[nameAt - 1])) return true;
  if (nameAt === 0 && w.length === 1) return false;
  return false;
}

/** Scalar types worth scrubbing. An Int or a DateTime cannot carry a name. */
const SCALARS = new Set(['String', 'Json', 'Bytes']);

export function parseModels(schemaText) {
  const models = new Map();
  for (const [, name, body] of schemaText.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const columns = [];
    for (const line of body.split('\n')) {
      const m = line.match(/^\s{2,}(\w+)\s+(\w+)(\[\])?(\?)?/);
      if (!m) continue;
      const [, column, type, list, optional] = m;
      if (!SCALARS.has(type)) continue;
      columns.push({ column, type, list: Boolean(list), optional: Boolean(optional) });
    }
    models.set(name, columns);
  }
  return models;
}

export function sensitiveColumns(models) {
  const out = [];
  for (const [model, columns] of models) {
    for (const c of columns) {
      const why = isIdentity(c.column) ? 'identity' : FREE_TEXT.test(c.column) ? 'free-text' : null;
      if (why) out.push({ model, ...c, kind: why });
    }
  }
  return out;
}

/** Every `"Table"."column" =` or `"Table" SET column =` assignment the scrub performs. */
export function parseCoverage(sqlText) {
  const covered = new Map();
  // Statements are `UPDATE "Model" SET a = …, b = … [WHERE …];` possibly spanning lines.
  for (const [, model, assignments] of sqlText.matchAll(/UPDATE\s+"(\w+)"\s+SET\s+([\s\S]*?);/g)) {
    const set = covered.get(model) ?? new Set();
    // Strip string literals first so a value like 'contact-' || id cannot look like an assignment.
    const withoutLiterals = assignments.replace(/'(?:[^']|'')*'/g, "''");
    for (const [, column] of withoutLiterals.matchAll(/(?:^|,)\s*"?(\w+)"?\s*=/g)) set.add(column);
    covered.set(model, set);
  }
  return covered;
}

export function findGaps({ schemaText, sqlText, exemptions }) {
  const models = parseModels(schemaText);
  const covered = parseCoverage(sqlText);
  const gaps = [];
  for (const col of sensitiveColumns(models)) {
    if (covered.get(col.model)?.has(col.column)) continue;
    if (exemptions?.[col.model]?.[col.column]) continue;
    gaps.push(col);
  }
  return { gaps, modelCount: models.size, coveredCount: [...covered.values()].reduce((n, s) => n + s.size, 0) };
}

function main() {
  const schemaText = readFileSync(SCHEMA, 'utf8');
  const sqlText = readFileSync(SANITIZE, 'utf8');
  let exemptions = {};
  try {
    exemptions = JSON.parse(readFileSync(EXEMPTIONS, 'utf8')).exemptions ?? {};
  } catch {
    // Absent is fine; it means nothing has been exempted yet.
  }

  const { gaps, modelCount, coveredCount } = findGaps({ schemaText, sqlText, exemptions });

  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ gaps, modelCount, coveredCount }, null, 2) + '\n');
  } else {
    console.log(`models: ${modelCount} · columns scrubbed: ${coveredCount} · gaps: ${gaps.length}`);
    if (gaps.length) {
      console.log('\nSensitive columns neither scrubbed nor exempted:\n');
      const byModel = new Map();
      for (const g of gaps) byModel.set(g.model, [...(byModel.get(g.model) ?? []), g]);
      for (const [model, cols] of [...byModel].sort()) {
        console.log(`  ${model}`);
        for (const c of cols) console.log(`    ${c.column.padEnd(28)} ${c.type}${c.optional ? '?' : ''}  (${c.kind})`);
      }
      console.log(
        '\nEither scrub the column in deploy/hostinger/sanitize.sql, or record why it is safe in\n' +
          'deploy/hostinger/sanitize-exemptions.json. A dump labelled "sanitized" that still\n' +
          'carries one of these is worse than an unsanitized one.'
      );
    }
  }
  process.exit(gaps.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('check-sanitize-coverage.mjs')) {
  main();
}
