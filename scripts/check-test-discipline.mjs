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
    file: 'e2e/qa/laneC.spec.ts',
    line: 987,
    reason:
      'No lane-owned lead is visible to the leadgen member, so the assertion has nothing to ' +
      'act on. This is a product finding (QA C5/C7), not a flaky test: it is tracked as a RED ' +
      'row in docs/ALL_GREEN_ACCEPTANCE_MATRIX.md and removed when Phase 4/5 resolves the ' +
      'leadgen visibility gap.',
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
  const pending = report.numPendingTests ?? 0;
  const todo = report.numTodoTests ?? 0;

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
