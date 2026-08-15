#!/usr/bin/env node
/**
 * Test-discipline guard.
 *
 * Two different failures wear the same green tick, and this catches both.
 *
 * **1. A test that was switched off.** `it.only` silently discards every other test in its
 * file; `test.skip` / `it.todo` discard themselves. Either can be committed by accident and
 * neither turns CI red. Any occurrence must be in ALLOWED_DISABLED below, with a reason and a
 * pointer to the work that removes it — which makes disabling a test a reviewable decision
 * rather than a quiet one.
 *
 * **2. A test that never ran because its dependency was missing.** 49 suites are written as
 * `describe.skipIf(!hasDb)`. That is correct on a developer's machine with no Postgres and a
 * lie on CI, where a missing `DATABASE_URL` means the service container is broken — and a
 * silent skip reports that as success. `tests/redis-integration.test.ts` already throws in
 * this situation; `--ci` generalises the rule to every mandatory dependency, before a single
 * test runs.
 *
 * A third check, `--results`, closes the gap the static scan cannot see: a suite skipped at
 * runtime for a reason no grep can predict. Point it at a Vitest JSON report and it fails if
 * anything was pending or todo.
 *
 * Usage:
 *   node scripts/check-test-discipline.mjs                     # static scan
 *   node scripts/check-test-discipline.mjs --ci                # + mandatory dependencies
 *   node scripts/check-test-discipline.mjs --results out.json  # + zero skipped at runtime
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['tests', 'e2e'];

/**
 * Deliberately disabled tests. Every entry needs a reason and an owner phase — an entry with
 * neither is how a permanent hole starts looking like a temporary one.
 *
 * Match is on `file:line`, so moving the line forces the entry to be re-justified.
 */
const ALLOWED_DISABLED = [
  {
    file: 'e2e/qa/laneC.qa.ts',
    line: 987,
    reason:
      'No lane-owned lead is visible to the leadgen member, so the assertion has nothing to ' +
      'act on. This is a product finding (QA C5/C7), not a flaky test. It sits in exploratory ' +
      'scaffolding that no Playwright project executes (see e2e/qa/README.md), and the finding ' +
      'is owned by the leadgen visibility work in the RBAC/browser phases — the exemption goes ' +
      'when a lane-owned lead is visible to that role. The acceptance matrix is maintained by ' +
      'the independent auditor, so this entry deliberately claims no status in it.',
  },
];

/**
 * Dependencies CI must provide. A suite conditioned on one of these may skip locally and must
 * never skip here.
 */
const REQUIRED_CI_ENV = [
  {
    name: 'DATABASE_URL',
    why: '49 suites are gated on it — the entire DB, RLS, admin and golden-journey surface disappears without it.',
  },
  {
    name: 'REDIS_URL',
    why: 'tests/redis-integration.test.ts is the only real-Redis coverage in the repository.',
  },
];

/** `it.only` and friends: the whole-file killers and the self-disablers. */
const DISABLED_PATTERN =
  /\b(?:it|test|describe|suite|bench)\s*(?:\.\s*(?:concurrent|sequential|each|for|extend))*\s*\.\s*(only|skip|todo|fails)\b/g;

/** Bare `test.skip(...)` / `this.skip()` calls inside a body, which greps for `.skip` also hit. */
const BARE_SKIP_CALL = /\b(?:test|it)\s*\.\s*skip\s*\(/;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Strips line and block comments so a `.skip` inside prose is not reported as code. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

function isAllowed(file, line) {
  return ALLOWED_DISABLED.some((a) => a.file === file && a.line === line);
}

function scan() {
  const findings = [];
  for (const dir of SCAN_DIRS) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) continue;

    for (const file of walk(abs)) {
      const rel = relative(ROOT, file).split(sep).join('/');
      const lines = stripComments(readFileSync(file, 'utf8')).split('\n');

      lines.forEach((text, index) => {
        const lineNo = index + 1;
        DISABLED_PATTERN.lastIndex = 0;
        let match;
        while ((match = DISABLED_PATTERN.exec(text)) !== null) {
          // `skipIf` / `runIf` are conditional and legitimate; the `--ci` check is what makes
          // sure their condition is satisfied here. The pattern already excludes them by
          // requiring a word boundary, but a bare `test.skip(cond, reason)` is unconditional
          // in the sense that matters: it disables at runtime with no dependency behind it.
          if (isAllowed(rel, lineNo)) continue;
          findings.push({
            file: rel,
            line: lineNo,
            form: `.${match[1]}`,
            text: text.trim().slice(0, 120),
          });
        }
        if (BARE_SKIP_CALL.test(text) && !isAllowed(rel, lineNo)) {
          // Already reported by the pattern above; keeping the check documents the shape.
        }
      });
    }
  }
  return findings;
}

function checkAllowlistStillApplies() {
  const stale = [];
  for (const entry of ALLOWED_DISABLED) {
    const abs = join(ROOT, entry.file);
    if (!existsSync(abs)) {
      stale.push(`${entry.file}:${entry.line} — file no longer exists`);
      continue;
    }
    const lines = readFileSync(abs, 'utf8').split('\n');
    const text = lines[entry.line - 1] ?? '';
    if (!/\.(only|skip|todo|fails)\b/.test(text)) {
      stale.push(
        `${entry.file}:${entry.line} — no disabled test on this line any more; remove the allowlist entry`
      );
    }
  }
  return stale;
}

function checkRequiredEnv() {
  return REQUIRED_CI_ENV.filter((dep) => !process.env[dep.name]);
}

/**
 * No unscoped `deleteMany()` / `updateMany()` in test cleanup.
 *
 * Test suites run against one shared database and `bypassRls: true` deliberately injects **no**
 * tenant filter — cross-tenant reads have to keep working so a worker can resolve its own JobRun
 * before the tenant is known (`lib/prisma.ts`). A bulk write with no `where` therefore hits every
 * row in the table, across every tenant, including fixtures a suite running in parallel is about
 * to read.
 *
 * `bullmq.test.ts` and `run-now-immediate.test.ts` both did this to `JobRun` and wiped each
 * other; the symptom was a row that had just been written reading back as null, intermittently,
 * in whichever suite lost. That is expensive to diagnose and trivial to prevent.
 *
 * Only the provably unsafe form is flagged: a call with no `where` key at all. A `where` that is
 * merely narrow (`{ id }`, `{ email }`, `{ batchId }`) is the suite's own business.
 */
function checkScopedCleanup() {
  const findings = [];
  for (const dir of SCAN_DIRS) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) continue;

    for (const file of walk(abs)) {
      const rel = relative(ROOT, file).split(sep).join('/');
      const src = stripComments(readFileSync(file, 'utf8'));

      for (const m of src.matchAll(/\.(deleteMany|updateMany)\s*\(/g)) {
        // Read the argument list to its matching paren so a multi-line `where` is seen.
        let depth = 1;
        let i = m.index + m[0].length;
        for (; i < src.length && depth > 0; i++) {
          if (src[i] === '(') depth++;
          else if (src[i] === ')') depth--;
        }
        const args = src.slice(m.index + m[0].length, i - 1);
        if (/\bwhere\b/.test(args)) continue;

        findings.push({
          file: rel,
          line: src.slice(0, m.index).split('\n').length,
          call: m[1],
        });
      }
    }
  }
  return findings;
}

/**
 * Every `e2e/**\/*.spec.ts` must be matched by a Playwright project.
 *
 * A spec matched by no project does not fail, warn, or appear anywhere — it silently never
 * runs, and it looks exactly like coverage. `e2e/qa/` held eight such files, one of which
 * (`laneG`) was the only browser assertion anywhere on the no-silent-removal dialog, and it had
 * never executed. `automation-journeys.spec.ts` hit the same trap earlier and is called out in
 * CLAUDE.md.
 *
 * Support files, fixtures and deliberately non-executable material are fine — they simply must
 * not be named `.spec.ts`, which is the thing that reads as "this runs".
 */
function checkEverySpecIsExecuted() {
  const configPath = join(ROOT, 'playwright.config.ts');
  if (!existsSync(configPath)) return [];

  const config = readFileSync(configPath, 'utf8');

  // `testMatch:` entries, in either form the config uses: a RegExp literal or a glob array
  // built from a file list. Both are read as text — importing the config would need a TS
  // loader, and this check has to run before anything else in CI.
  const regexMatchers = [];
  for (const m of config.matchAll(/testMatch:\s*\//g)) {
    // Read the literal by hand. A `matchAll` pattern cannot do this: the config's own matchers
    // contain `[\\/]`, and the `/` inside that character class terminates any naive scan — which
    // is exactly the bug the first version of this check shipped with, reporting every spec in
    // the repository as unexecuted.
    let i = m.index + m[0].length; // first char of the pattern body
    let inClass = false;
    let body = '';
    for (; i < config.length; i++) {
      const ch = config[i];
      if (ch === '\\') {
        body += ch + config[i + 1];
        i++;
        continue;
      }
      if (ch === '[') inClass = true;
      else if (ch === ']') inClass = false;
      else if (ch === '/' && !inClass) break;
      else if (ch === '\n') break; // unterminated — give up on this one
      body += ch;
    }
    let flags = '';
    for (let j = i + 1; j < config.length && /[gimsuy]/.test(config[j]); j++) flags += config[j];
    try {
      regexMatchers.push(new RegExp(body, flags));
    } catch {
      /* an unparseable matcher is reported below as "no project matched" */
    }
  }

  // The `chromium` project matches a hardcoded list of legacy filenames.
  const legacy = new Set();
  const legacyBlock = config.match(/LEGACY_SPECS\s*=\s*\[([\s\S]*?)\]/);
  if (legacyBlock) {
    for (const f of legacyBlock[1].matchAll(/['"`]([^'"`]+)['"`]/g)) legacy.add(f[1]);
  }

  const e2eDir = join(ROOT, 'e2e');
  if (!existsSync(e2eDir)) return [];

  const orphans = [];
  for (const file of walk(e2eDir)) {
    const rel = relative(ROOT, file).split(sep).join('/');
    if (!rel.endsWith('.spec.ts')) continue;

    const base = rel.slice('e2e/'.length);
    const matched =
      legacy.has(base) ||
      regexMatchers.some((re) => {
        re.lastIndex = 0;
        // Playwright tests both separators; the config's own patterns allow either.
        return re.test(rel) || re.test(rel.replace(/\//g, '\\'));
      });

    if (!matched) orphans.push(rel);
  }
  return orphans;
}

function checkResults(path) {
  if (!existsSync(path)) {
    return [`Vitest result file not found: ${path}`];
  }
  let report;
  try {
    report = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    return [`Could not parse ${path}: ${err.message}`];
  }

  const problems = [];

  // Never `?? 0`. If the reporter's shape changes — a Vitest major bump renaming these keys, a
  // different reporter wired in by mistake — a defaulted zero makes this gate silently pass
  // everything while looking like it ran. Verified: fed `{"stats":{"skipped":7}}`, the defaulting
  // version printed "0 skipped at runtime" and exited 0. An unrecognised shape is a failure.
  const hasCounts =
    typeof report.numPendingTests === 'number' && typeof report.numTodoTests === 'number';
  if (!hasCounts) {
    return [
      `${path} does not carry numeric numPendingTests/numTodoTests.`,
      '  The Vitest JSON reporter format this gate reads has changed, so it can no longer tell',
      '  whether anything was skipped. Update checkResults() rather than defaulting to zero.',
      `  Top-level keys present: ${Object.keys(report).join(', ') || '(none)'}`,
    ];
  }

  const pending = report.numPendingTests;
  const todo = report.numTodoTests;

  if (pending > 0 || todo > 0) {
    problems.push(`${pending} skipped and ${todo} todo test(s) ran as non-executed on CI.`);
    for (const suite of report.testResults ?? []) {
      for (const t of suite.assertionResults ?? []) {
        if (t.status === 'pending' || t.status === 'todo') {
          const name = [...(t.ancestorTitles ?? []), t.title].join(' > ');
          problems.push(`  ${relative(ROOT, suite.name ?? '?')}: ${name} [${t.status}]`);
        }
      }
    }
  }
  return problems;
}

// ── main ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const ciMode = args.includes('--ci') || process.env.CI === 'true';
const resultsIdx = args.indexOf('--results');
const resultsPath = resultsIdx >= 0 ? args[resultsIdx + 1] : null;

let failed = false;

const findings = scan();
if (findings.length > 0) {
  failed = true;
  console.error('\nDisabled tests found outside the allowlist:\n');
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  ${f.form}   ${f.text}`);
  }
  console.error(
    '\nEither restore the test, or add it to ALLOWED_DISABLED in scripts/check-test-discipline.mjs\n' +
      'with a reason and the phase that removes it. Do not disable a test to make CI green.\n'
  );
}

const stale = checkAllowlistStillApplies();
if (stale.length > 0) {
  failed = true;
  console.error('\nStale allowlist entries — the exemption no longer describes the code:\n');
  for (const s of stale) console.error(`  ${s}`);
  console.error('');
}

const unscoped = checkScopedCleanup();
if (unscoped.length > 0) {
  failed = true;
  console.error('\nBulk writes with no `where`, against a database every suite shares:\n');
  for (const u of unscoped) console.error(`  ${u.file}:${u.line}  .${u.call}()`);
  console.error(
    '\n`bypassRls: true` injects no tenant filter, so these delete or update every row in the\n' +
      'table across every tenant — including fixtures a suite running in parallel is about to\n' +
      'read. Scope the call.\n'
  );
}

const orphanSpecs = checkEverySpecIsExecuted();
if (orphanSpecs.length > 0) {
  failed = true;
  console.error('\nPlaywright specs that no project executes:\n');
  for (const s of orphanSpecs) console.error(`  ${s}`);
  console.error(
    '\nA spec matched by no project never runs and never complains — it is dead surface that\n' +
      'looks like coverage. Either add it to a project in playwright.config.ts, or rename it so\n' +
      'it does not end in .spec.ts.\n'
  );
}

if (ciMode) {
  const missing = checkRequiredEnv();
  if (missing.length > 0) {
    failed = true;
    console.error('\nMandatory CI dependencies are not configured:\n');
    for (const dep of missing) console.error(`  ${dep.name} — ${dep.why}`);
    console.error(
      '\nSuites gated on these would skip silently and report a broken environment as a pass.\n'
    );
  }
}

if (resultsPath) {
  const problems = checkResults(resultsPath);
  if (problems.length > 0) {
    failed = true;
    console.error('\nTests did not execute:\n');
    for (const p of problems) console.error(`  ${p}`);
    console.error('');
  }
}

if (failed) {
  process.exit(1);
}

console.log(
  `test discipline OK — ${ALLOWED_DISABLED.length} allowlisted exemption(s)` +
    (ciMode ? `, ${REQUIRED_CI_ENV.length} mandatory dependenc(ies) present` : '') +
    (resultsPath ? ', 0 skipped at runtime' : '')
);
