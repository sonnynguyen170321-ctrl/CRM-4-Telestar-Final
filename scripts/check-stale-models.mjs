/**
 * Fails the build when a retired AI model id appears in runtime code.
 *
 * The production chat outage was a model id that outlived the model. It survived in four
 * places at once — a default constant, a picker list, a price table and a stored user
 * preference — and no gate looked at any of them, so the only signal was an SDR reporting a
 * sentence.
 *
 *   node scripts/check-stale-models.mjs            # fail on any runtime match
 *   node scripts/check-stale-models.mjs --report   # list every match, classified, exit 0
 *
 * Classification:
 *   ACTIVE RUNTIME  — lib/, app/, components/, workers/, context/, hooks/  ... FAILS
 *   TEST            — tests/, e2e/                                          ... allowed
 *   SCRIPT          — scripts/                                              ... allowed
 *   DOCUMENTATION   — docs/, *.md                                           ... allowed
 *
 * Tests and docs legitimately name a retired model: a regression test that a withdrawn id is
 * refused has to say the id out loud, and the incident write-up would be useless without it.
 * Runtime code has no such excuse.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

/** Every id the product must never route to again. */
const RETIRED = [
  'gpt-4o-mini',
  'gpt-4o',
  'o3-mini',
  'gpt-5.6-terra',
  'gpt-5.6-sol',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-flash-latest',
  'gemini-pro-latest',
  'gemini-3.1-pro-preview',
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'llama3-70b-8192',
  'gemma2-9b-it',
];

const RUNTIME_DIRS = ['lib', 'app', 'components', 'workers', 'context', 'hooks'];
const TEST_DIRS = ['tests', 'e2e'];
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '.git', 'playwright-report', 'test-results']);
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

/**
 * Blanks out comments and keeps line numbering intact.
 *
 * A retired id inside a comment is documentation, and the most valuable documentation this
 * codebase has right now names those ids explicitly — the whole account of how the outage
 * happened is unreadable without them. Matching on comments would force that history to be
 * deleted to keep a gate green, which is the wrong trade. Code is what routes traffic.
 */
function stripComments(source) {
  const blank = (text) => text.replace(/[^\r\n]/g, ' ');
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, (match, prefix) => prefix + blank(match.slice(prefix.length)));
}

function classify(relative) {
  const top = relative.split(path.sep)[0];
  if (TEST_DIRS.includes(top)) return 'TEST';
  if (top === 'scripts') return 'SCRIPT';
  if (top === 'docs' || relative.endsWith('.md')) return 'DOCUMENTATION';
  if (RUNTIME_DIRS.includes(top)) return CODE.test(relative) ? 'ACTIVE RUNTIME' : 'DOCUMENTATION';
  return 'OTHER';
}

const files = [
  ...RUNTIME_DIRS.flatMap((dir) => walk(path.join(ROOT, dir))),
  ...TEST_DIRS.flatMap((dir) => walk(path.join(ROOT, dir))),
  ...walk(path.join(ROOT, 'scripts')),
  ...walk(path.join(ROOT, 'docs')),
];

const matches = [];

for (const file of files) {
  if (!CODE.test(file) && !file.endsWith('.md')) continue;
  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const relative = path.relative(ROOT, file);
  // Markdown is all documentation; only source files have comments to strip.
  const lines = (file.endsWith('.md') ? source : stripComments(source)).split('\n');

  lines.forEach((line, index) => {
    for (const model of RETIRED) {
      if (!line.includes(model)) continue;
      // `gpt-4o-mini` contains `gpt-4o`; count the longest match only, so one occurrence is
      // one finding rather than two.
      if (RETIRED.some((other) => other !== model && other.includes(model) && line.includes(other))) continue;
      matches.push({ file: relative, line: index + 1, model, kind: classify(relative), text: line.trim().slice(0, 110) });
    }
  });
}

const offenders = matches.filter((m) => m.kind === 'ACTIVE RUNTIME');
const report = process.argv.includes('--report');

if (report) {
  const byKind = new Map();
  for (const match of matches) byKind.set(match.kind, [...(byKind.get(match.kind) ?? []), match]);
  for (const [kind, list] of [...byKind.entries()].sort()) {
    console.log(`\n${kind} — ${list.length}`);
    for (const m of list) console.log(`  ${m.file}:${m.line}  ${m.model}`);
  }
  console.log(`\nTotal ${matches.length} · ACTIVE RUNTIME ${offenders.length}`);
}

if (offenders.length > 0) {
  console.error(`\nFAIL: ${offenders.length} retired AI model id(s) in runtime code.\n`);
  for (const m of offenders) console.error(`  ${m.file}:${m.line}  ${m.model}\n    ${m.text}`);
  console.error('\nRuntime code must route only to lib/ai/registry.ts.');
  process.exit(1);
}

if (!report) console.log(`PASS: no retired model id in runtime code (${matches.length} allowed matches in tests/scripts/docs).`);
process.exit(0);
