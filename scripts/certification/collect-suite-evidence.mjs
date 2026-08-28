#!/usr/bin/env node
/**
 * Produces the three suite-level evidence records that nothing produced (TEL-P1-049).
 *
 * EV-EMAIL-EXACTLY-ONCE, EV-ROLE-MODEL and EV-SECURITY-BOUNDARIES were authored. Each named
 * a real command and cited a raw artifact, and the suites behind them genuinely pass — they
 * re-run inside ladder gates 11, 14 and 16 on every run. What was missing is a producer, and
 * the consequence was structural rather than cosmetic: a record no tool can regenerate is
 * stranded by every re-freeze, so `certify:validate` reported all three as evidence for a
 * superseded candidate and there was no way to answer it except by hand-editing.
 *
 * Two rules, both learned from what the authored versions got wrong.
 *
 * 1. COUNTS ARE PARSED, NOT TRANSCRIBED. Vitest is run with its JSON reporter and the
 *    numbers come out of the result file. The authored records carried counts a person had
 *    read off a terminal, which is the same act as typing a verdict.
 *
 * 2. THE SUITE SET IS DECLARED HERE, NOT DESCRIBED IN PROSE. EV-SECURITY-BOUNDARIES said
 *    "13 security suites" and its artifact — a 15-line excerpt — named none of them, so
 *    nobody could re-derive what had been measured. The lists below ARE the definition, and
 *    the record reports the count it observed rather than a count it was told.
 *
 * Descriptive commentary that cannot be derived from a run is deliberately not carried
 * forward. A record should say what was measured.
 *
 *   node scripts/certification/collect-suite-evidence.mjs [--suite <id>]
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONFIG_PATH, EVIDENCE_DIR, RAW_DIR, REPO_ROOT, repoRelative } from './lib/paths.mjs';

const VITEST = ['node_modules/vitest/vitest.mjs', 'run'];

/**
 * The suites each record stands for.
 *
 * Paths are vitest filters: a bare name matches every file whose path contains it, which is
 * how the original commands were written and is why some entries are not `.test.ts` files.
 */
const SUITES = {
  'email-exactly-once': {
    evidenceId: 'EV-EMAIL-EXACTLY-ONCE',
    kind: 'email-exactly-once',
    artifact: 'email-exactly-once.log',
    description: 'the send-once invariant, idempotency, the demo barrier and the sequence engine',
    filters: [
      'tests/email-send-once-invariant.test.ts',
      'tests/email-idempotency.test.ts',
      'tests/email-worker.test.ts',
      'tests/email-safety.test.ts',
      'tests/demo-email-barrier.test.ts',
      'tests/sequence-worker.test.ts',
      'tests/sequence-execute.test.ts',
    ],
  },
  'role-model': {
    evidenceId: 'EV-ROLE-MODEL',
    kind: 'role-model',
    artifact: 'role-model-suites.log',
    description: 'the six-role model exercised across journeys, surfaces and scoped reads',
    filters: [
      'tests/role-journeys',
      'tests/phase-9-role-surfaces',
      'tests/floor-manager-administration',
      'tests/leadgen',
      'tests/leadgen-redesign',
      'tests/ai-briefing-scope',
      'tests/client-report-scope',
      'tests/certification-role-evidence',
    ],
  },
  'security-boundaries': {
    evidenceId: 'EV-SECURITY-BOUNDARIES',
    kind: 'security-boundaries',
    artifact: 'security-boundaries.log',
    description: 'tenant isolation, object authorization, injection, headers and throttling',
    // Named individually. The authored record said "13 security suites" and its artifact
    // named none of them; a set nobody can enumerate is not a set anybody can re-measure.
    filters: [
      'tests/tenant-inject.test.ts',
      'tests/tenant-context.test.ts',
      'tests/tenant-includes.test.ts',
      'tests/test-tenant-leak.test.ts',
      'tests/raw-sql-tenant-context.test.ts',
      'tests/object-auth-red-team.test.ts',
      'tests/agent-object-authorization.test.ts',
      'tests/ai-route-cross-tenant-red-team.test.ts',
      'tests/api-key-privilege-escalation.test.ts',
      'tests/demo-diagnostics-authorization.test.ts',
      'tests/webhook-ssrf-and-authorization.test.ts',
      'tests/mass-assignment.test.ts',
      'tests/security-injection.test.ts',
      'tests/csp.test.ts',
      'tests/login-throttle.test.ts',
      'tests/gitleaks-allowlist.test.ts',
    ],
  },
};

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

/** Runs one suite set and reports what the run actually produced. */
function runSuite(suite) {
  const resultFile = path.join(REPO_ROOT, '.certification', `${suite.kind}.json`);
  mkdirSync(path.dirname(resultFile), { recursive: true });
  rmSync(resultFile, { force: true });

  const startedAt = new Date();
  const result = spawnSync(
    process.execPath,
    [...VITEST, ...suite.filters, '--reporter=default', '--reporter=json', `--outputFile.json=${resultFile}`],
    { cwd: REPO_ROOT, encoding: 'utf8', timeout: 30 * 60 * 1000 },
  );
  const finishedAt = new Date();

  const stdout = `${result.stdout ?? ''}${result.stderr ?? ''}`;

  // Counts come out of the reporter, never off the terminal.
  let counts = null;
  if (existsSync(resultFile)) {
    try {
      const json = JSON.parse(readFileSync(resultFile, 'utf8'));
      const files = json.testResults ?? [];
      counts = {
        testFiles: files.length,
        tests: json.numTotalTests ?? null,
        passed: json.numPassedTests ?? null,
        failed: json.numFailedTests ?? null,
        skipped: (json.numPendingTests ?? 0) + (json.numTodoTests ?? 0),
        suiteFiles: files.map((f) => repoRelative(f.name)).sort(),
      };
    } catch {
      counts = null;
    }
  }
  rmSync(resultFile, { force: true });

  return { exitCode: result.status ?? 1, stdout, startedAt, finishedAt, counts };
}

function writeArtifact(name, body) {
  mkdirSync(RAW_DIR, { recursive: true });
  const file = path.join(RAW_DIR, name);
  const text = body.endsWith('\n') ? body : `${body}\n`;
  writeFileSync(file, text, 'utf8');
  return {
    path: repoRelative(file),
    sizeBytes: Buffer.byteLength(text, 'utf8'),
    sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
  };
}

function collect(id, candidateSha) {
  const suite = SUITES[id];
  console.log(`running ${id} — ${suite.filters.length} filter(s)`);
  const run = runSuite(suite);

  const ok = run.exitCode === 0 && run.counts !== null && run.counts.failed === 0;
  const artifact = writeArtifact(
    suite.artifact,
    [
      `# ${suite.evidenceId} — ${suite.description}`,
      `# candidate: ${candidateSha}`,
      `# started:   ${run.startedAt.toISOString()}`,
      `# finished:  ${run.finishedAt.toISOString()}`,
      `# exit:      ${run.exitCode}`,
      '',
      '--- suite filters requested ---',
      ...suite.filters.map((f) => `  ${f}`),
      '',
      '--- files the run actually executed ---',
      ...(run.counts?.suiteFiles ?? ['  (no reporter output)']).map((f) => `  ${f}`),
      '',
      '--- run output ---',
      run.stdout,
    ].join('\n'),
  );

  const record = {
    evidenceId: suite.evidenceId,
    kind: suite.kind,
    candidateSha,
    environment: `${process.platform} node ${process.version}, local Postgres and Redis`,
    command: `node scripts/certification/collect-suite-evidence.mjs --suite ${id}`,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt.toISOString(),
    exitCode: run.exitCode,
    status: ok ? 'PASS' : 'FAIL',
    metrics: {
      description: suite.description,
      requestedFilters: suite.filters,
      ...(run.counts ?? { countsUnavailable: true }),
    },
    artifacts: [artifact],
  };

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(path.join(EVIDENCE_DIR, `${suite.evidenceId}.json`), `${JSON.stringify(record, null, 2)}\n`);

  console.log(
    `  ${record.status} — ${run.counts ? `${run.counts.testFiles} files, ${run.counts.passed}/${run.counts.tests} passed` : 'no counts'} (exit ${run.exitCode})`,
  );
  return record.status === 'PASS';
}

function main() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const candidateSha = config.candidateSha;
  if (!candidateSha) {
    console.error('certification.config.json declares no candidateSha.');
    process.exit(2);
  }

  const only = arg('suite');
  if (only && !SUITES[only]) {
    console.error(`unknown suite ${only}. Known: ${Object.keys(SUITES).join(', ')}`);
    process.exit(2);
  }

  const ids = only ? [only] : Object.keys(SUITES);
  let allPassed = true;
  for (const id of ids) {
    if (!collect(id, candidateSha)) allPassed = false;
  }

  process.exitCode = allPassed ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();

export { SUITES };
