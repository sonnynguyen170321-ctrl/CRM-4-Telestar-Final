#!/usr/bin/env node
/**
 * Evidence collection.
 *
 * Runs a gate, captures its raw output **while it runs**, and writes a structured evidence
 * record. Nothing here reconstructs a log after the fact: a reconstructed log is a fabricated
 * log, and the whole point of this program is that the artifact is the thing that happened.
 *
 * Used directly for a single gate, and by `run-full-certification.mjs` for the whole ladder.
 *
 *   node scripts/certification/collect-evidence.mjs --gate 03-typecheck --candidate <sha>
 *   node scripts/certification/collect-evidence.mjs --gate 08-vitest --candidate <sha>
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { EVIDENCE_DIR, RAW_DIR, REPO_ROOT, repoRelative } from './lib/paths.mjs';
import { loadCertificationEnv } from './lib/loadEnv.mjs';

loadCertificationEnv();

/**
 * The gate catalogue. Each entry is exactly what runs, so a gate cannot be "executed" by
 * agent memory or quietly skipped - if it is not here, `certify:full` does not run it, and
 * the validator notices its absence.
 *
 * Commands invoke entry scripts through node directly. The checkout path contains an `&`,
 * which breaks every npm/npx `.bin` shim on this machine.
 */
export const GATES = {
  '03-typecheck': {
    description: 'tsc --noEmit',
    command: [process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit']],
    env: { NODE_OPTIONS: '--max-old-space-size=8192' },
  },
  '04-lint': {
    description: 'eslint across the whole tree',
    command: [
      process.execPath,
      ['node_modules/eslint/bin/eslint.js', 'app', 'components', 'lib', 'context', 'tests', 'workers', 'scripts', 'e2e'],
    ],
  },
  '05-test-discipline': {
    description: 'scripts/check-test-discipline.mjs',
    command: [process.execPath, ['scripts/check-test-discipline.mjs']],
  },
  '06-migration-validation': {
    description: 'scripts/check-migration-order.mjs',
    command: [process.execPath, ['scripts/check-migration-order.mjs']],
  },
  '07-database-integrity': {
    description: 'scripts/verify-db-integrity.ts against the certification database',
    command: [process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/verify-db-integrity.ts']],
  },
  '08-vitest': {
    description: 'full Vitest suite against real Postgres and Redis',
    command: [process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--maxWorkers=4', '--reporter=json', '--outputFile=.certification/vitest.json']],
    parser: 'vitest',
  },
  '09-redis-integration': {
    description: 'Redis integration suite - must execute, never skip',
    command: [
      process.execPath,
      ['node_modules/vitest/vitest.mjs', 'run', 'tests/redis-integration.test.ts', 'tests/ai-shared-circuit.test.ts', 'tests/redis-readiness.test.ts', '--reporter=json', '--outputFile=.certification/redis.json'],
    ],
    parser: 'redis',
  },
  '10-ai-certification': {
    description: 'AI durable budget, stream governance, shared circuit, capability routing',
    command: [
      process.execPath,
      ['node_modules/vitest/vitest.mjs', 'run', 'tests/ai-durable-budget.test.ts', 'tests/ai-stream-governance.test.ts', 'tests/ai-shared-circuit.test.ts', 'tests/ai-capability-routing.test.ts', 'tests/ai-structured-budget.test.ts', 'tests/ai-down-resilience.test.ts'],
    ],
  },
  '11-email-safety': {
    description: 'demo barrier, idempotency, safe-mode posture',
    command: [
      process.execPath,
      ['node_modules/vitest/vitest.mjs', 'run', 'tests/demo-email-barrier.test.ts', 'tests/email-idempotency.test.ts', 'tests/email-safety.test.ts'],
    ],
  },
  '12-import-fault-matrix': {
    description: 'import durable-write failpoint matrix',
    command: [
      process.execPath,
      ['node_modules/vitest/vitest.mjs', 'run', 'tests/import-fault-injection.test.ts', 'tests/import-race-stress.test.ts'],
    ],
  },
  '14-security-suite': {
    description: 'tenant isolation, object auth, mass assignment, XSS, formula injection, secrets',
    command: [
      process.execPath,
      ['node_modules/vitest/vitest.mjs', 'run', 'tests/tenant-inject.test.ts', 'tests/object-auth-red-team.test.ts', 'tests/mass-assignment.test.ts', 'tests/security-injection.test.ts', 'tests/gitleaks-allowlist.test.ts', 'tests/csp.test.ts', 'tests/login-throttle.test.ts'],
    ],
  },
  '15-production-build': {
    description: 'next build',
    command: [process.execPath, ['scripts/build.cjs']],
    env: { NODE_OPTIONS: '--max-old-space-size=8192' },
  },
  '21-compose-validation': {
    description: 'scripts/check-production-compose.mjs',
    command: [process.execPath, ['scripts/check-production-compose.mjs']],
  },
};

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

export function artifactOf(absolutePath) {
  return {
    path: repoRelative(absolutePath),
    sizeBytes: statSync(absolutePath).size,
    sha256: sha256(absolutePath),
  };
}

/**
 * Parses Vitest's machine-readable output into the per-file shape the requirement resolver
 * checks. Counts are machine-derived - nothing types "1,922 tests passed" by hand.
 */
export function parseVitest(outputFile) {
  if (!existsSync(outputFile)) return null;
  const report = JSON.parse(readFileSync(outputFile, 'utf8'));

  const files = {};
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const suite of report.testResults ?? []) {
    const relative = repoRelative(suite.name);
    const assertions = suite.assertionResults ?? [];
    const filePassed = assertions.filter((entry) => entry.status === 'passed').length;
    const fileFailed = assertions.filter((entry) => entry.status === 'failed').length;
    const fileSkipped = assertions.filter(
      (entry) => entry.status === 'pending' || entry.status === 'skipped' || entry.status === 'todo',
    ).length;

    passed += filePassed;
    failed += fileFailed;
    skipped += fileSkipped;

    files[relative] = {
      status: fileFailed > 0 ? 'failed' : fileSkipped > 0 && filePassed === 0 ? 'skipped' : 'passed',
      tests: filePassed,
      failed: fileFailed,
      skipped: fileSkipped,
    };
  }

  return {
    files,
    testFiles: Object.keys(files).length,
    testFilesPassed: Object.values(files).filter((entry) => entry.status === 'passed').length,
    testsPassed: passed,
    testsFailed: failed,
    testsSkipped: skipped,
  };
}

/**
 * Runs one gate, writing its raw output to `evidence/raw/` as it goes.
 *
 * Exit code is taken from the process itself. It is never inferred from output text, and
 * never read through a pipe - a piped command reports the exit code of the last stage, which
 * is how a full session of "green" gates once hid a real type error.
 */
export function runGate(gateId, { runLabel = 'gate', extraEnv = {} } = {}) {
  const gate = GATES[gateId];
  if (!gate) throw new Error(`Unknown gate "${gateId}"`);

  mkdirSync(RAW_DIR, { recursive: true });
  mkdirSync(path.join(REPO_ROOT, '.certification'), { recursive: true });

  const [command, args] = gate.command;
  const startedAt = new Date();
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...(gate.env ?? {}), ...extraEnv },
    maxBuffer: 256 * 1024 * 1024,
  });
  const finishedAt = new Date();

  const logPath = path.join(RAW_DIR, `${runLabel}-${gateId}.log`);
  writeFileSync(
    logPath,
    [
      `# gate: ${gateId} — ${gate.description}`,
      `# command: ${command} ${args.join(' ')}`,
      `# startedAt: ${startedAt.toISOString()}`,
      `# finishedAt: ${finishedAt.toISOString()}`,
      `# exitCode: ${result.status}`,
      '',
      '--- stdout ---',
      result.stdout || '(empty)',
      '--- stderr ---',
      result.stderr || '(empty)',
      '',
    ].join('\n'),
  );

  let metrics = {};
  if (gate.parser === 'vitest') {
    metrics = parseVitest(path.join(REPO_ROOT, '.certification/vitest.json')) ?? {};
  } else if (gate.parser === 'redis') {
    const parsed = parseVitest(path.join(REPO_ROOT, '.certification/redis.json'));
    metrics = parsed
      ? {
          ...parsed,
          executed: parsed.testsPassed + parsed.testsFailed > 0,
          skipped: parsed.testsSkipped,
        }
      : { executed: false, skipped: null };
  }

  return {
    gateId,
    description: gate.description,
    command: `${command} ${args.join(' ')}`,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt - startedAt,
    exitCode: result.status,
    status: result.status === 0 ? 'PASS' : 'FAIL',
    metrics,
    logPath,
  };
}

/** Writes a standalone evidence record for one gate. */
export function writeGateEvidence(gateResult, { evidenceId, kind, candidateSha, environment }) {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const record = {
    evidenceId,
    kind,
    candidateSha,
    environment,
    command: gateResult.command,
    startedAt: gateResult.startedAt,
    finishedAt: gateResult.finishedAt,
    exitCode: gateResult.exitCode,
    status: gateResult.status,
    metrics: gateResult.metrics,
    artifacts: [artifactOf(gateResult.logPath)],
  };
  writeFileSync(path.join(EVIDENCE_DIR, `${evidenceId}.json`), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

export function describeEnvironment() {
  return `${process.platform} / node ${process.versions.node} / postgres 16 / redis ${process.env.REDIS_URL ? 'real' : 'absent'}`;
}

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

function main() {
  const gateId = arg('gate');
  const candidateSha = arg('candidate');

  if (!gateId || !GATES[gateId]) {
    console.error(`--gate is required. Known gates:\n  ${Object.keys(GATES).join('\n  ')}`);
    process.exit(2);
  }
  if (!candidateSha || !/^[0-9a-f]{40}$/.test(candidateSha)) {
    console.error('--candidate <40-char commit sha> is required');
    process.exit(2);
  }

  console.log(`running gate ${gateId} — ${GATES[gateId].description}`);
  const result = runGate(gateId);
  console.log(`  exit ${result.exitCode} (${result.status}) in ${(result.durationMs / 1000).toFixed(1)}s`);

  writeGateEvidence(result, {
    evidenceId: `EV-GATE-${gateId.toUpperCase()}`,
    kind: 'gate',
    candidateSha,
    environment: describeEnvironment(),
  });

  rmSync(path.join(REPO_ROOT, '.certification'), { recursive: true, force: true });
  process.exit(result.exitCode === 0 ? 0 : 1);
}

if (process.argv[1] && process.argv[1].endsWith('collect-evidence.mjs')) {
  main();
}
