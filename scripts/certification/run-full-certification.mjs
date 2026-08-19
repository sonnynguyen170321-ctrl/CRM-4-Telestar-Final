#!/usr/bin/env node
/**
 * The full certification ladder (TEL-P1-014).
 *
 * The previous "full" runs executed four gates - typecheck, lint, migration order, Vitest -
 * and were documented as full certification runs. Redis was skipped in all three. The ladder
 * is defined in code here so a run cannot omit a gate by anyone forgetting it: every gate in
 * `certification.config.json` is attempted, and any gate that does not run is reported as
 * missing rather than silently absent.
 *
 *   npm run certify:full -- --candidate <40-char sha> --run 1
 *
 * Writes a run manifest, an evidence record per run, and the derived RUN_N.md. Exits non-zero
 * if any mandatory gate failed.
 */
import 'dotenv/config';

import { spawnSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  GATES,
  artifactOf,
  describeEnvironment,
  parseVitest,
  runGate,
  writeGateEvidence,
} from './collect-evidence.mjs';
import { CONFIG_PATH, EVIDENCE_DIR, RAW_DIR, REPO_ROOT, RUNS_DIR } from './lib/paths.mjs';

const RUN_MANIFEST_DIR = path.join(RUNS_DIR, 'manifests');
const SERVER_PORT = Number(process.env.CERT_PORT || 3000);
const BASE_URL = `http://localhost:${SERVER_PORT}`;

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

function git(args) {
  const result = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function shell(command, args, { env = {}, timeoutMs = 30 * 60 * 1000 } = {}) {
  return spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 256 * 1024 * 1024,
    timeout: timeoutMs,
  });
}

function writeLog(name, label, result) {
  const logPath = path.join(RAW_DIR, `${name}.log`);
  writeFileSync(
    logPath,
    [
      `# ${label}`,
      `# exitCode: ${result.status}`,
      '',
      '--- stdout ---',
      result.stdout || '(empty)',
      '--- stderr ---',
      result.stderr || '(empty)',
      '',
    ].join('\n'),
  );
  return logPath;
}

/** Gate 01: the candidate must be exactly what is checked out, with a clean tree. */
function gateSourceIdentity(candidateSha, { allowDirty }) {
  const head = git(['rev-parse', 'HEAD']);
  const status = git(['status', '--porcelain']) ?? '';
  const problems = [];

  if (head !== candidateSha) problems.push(`HEAD ${String(head).slice(0, 7)} != candidate ${candidateSha.slice(0, 7)}`);
  if (status.trim() && !allowDirty) {
    problems.push(`working tree has ${status.trim().split('\n').length} uncommitted path(s)`);
  }

  return {
    gateId: '01-source-identity',
    description: 'HEAD equals the candidate SHA and the tree is clean',
    command: 'git rev-parse HEAD; git status --porcelain',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 0,
    exitCode: problems.length === 0 ? 0 : 1,
    status: problems.length === 0 ? 'PASS' : 'FAIL',
    metrics: { head, uncommittedPaths: status.trim() ? status.trim().split('\n').length : 0, problems },
    logPath: null,
  };
}

/** Gate 02: the services the ladder depends on are actually reachable. */
function gateEnvironment() {
  const startedAt = new Date();
  const probe = shell(process.execPath, ['scripts/certification/probe-environment.mjs'], {
    timeoutMs: 60_000,
  });
  const finishedAt = new Date();
  const logPath = writeLog('gate-02-environment', 'environment probe', probe);

  let metrics = {};
  try {
    metrics = JSON.parse(probe.stdout.slice(probe.stdout.indexOf('{')));
  } catch {
    metrics = { parseError: true };
  }

  return {
    gateId: '02-environment',
    description: 'Postgres and Redis reachable; required configuration present',
    command: 'node scripts/certification/probe-environment.mjs',
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt - startedAt,
    exitCode: probe.status,
    status: probe.status === 0 ? 'PASS' : 'FAIL',
    metrics,
    logPath,
  };
}

function scriptGate(gateId, description, command, args, { env = {}, timeoutMs } = {}) {
  const startedAt = new Date();
  const result = shell(command, args, { env, timeoutMs });
  const finishedAt = new Date();
  return {
    gateId,
    description,
    command: `${command} ${args.join(' ')}`,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt - startedAt,
    exitCode: result.status,
    status: result.status === 0 ? 'PASS' : 'FAIL',
    metrics: {},
    logPath: writeLog(`gate-${gateId}`, description, result),
  };
}

function blockedGate(gateId, description, reason) {
  const now = new Date().toISOString();
  return {
    gateId,
    description,
    command: '(not executed)',
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    exitCode: 127,
    status: 'BLOCKED_EXTERNAL',
    metrics: { reason },
    logPath: null,
  };
}

/** Starts the built app so browser and health gates run against a production build. */
async function withServer(fn) {
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(SERVER_PORT)], {
    cwd: REPO_ROOT,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  server.stdout.on('data', (chunk) => {
    output += chunk;
  });
  server.stderr.on('data', (chunk) => {
    output += chunk;
  });

  try {
    const deadline = Date.now() + 120_000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${BASE_URL}/login`);
        if (response.status < 500) {
          ready = true;
          break;
        }
      } catch {
        // not up yet
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!ready) throw new Error(`server did not become ready at ${BASE_URL}`);
    return await fn();
  } finally {
    server.kill();
    writeFileSync(path.join(RAW_DIR, 'certification-server.log'), output);
  }
}

async function gateHealthSmoke() {
  const startedAt = new Date();
  const results = {};
  let ok = true;

  for (const endpoint of ['/api/health', '/api/health/db', '/api/health/redis']) {
    try {
      const response = await fetch(`${BASE_URL}${endpoint}`);
      const text = await response.text();
      results[endpoint] = { status: response.status, body: text.slice(0, 400) };
      if (response.status >= 500) ok = false;
    } catch (error) {
      results[endpoint] = { status: null, error: String(error) };
      ok = false;
    }
  }

  const finishedAt = new Date();
  writeFileSync(
    path.join(RAW_DIR, 'gate-22-health-smoke.log'),
    `# health smoke\n${JSON.stringify(results, null, 2)}\n`,
  );

  return {
    gateId: '22-health-smoke',
    description: 'web health endpoints answer and report release identity',
    command: `GET ${BASE_URL}/api/health*`,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt - startedAt,
    exitCode: ok ? 0 : 1,
    status: ok ? 'PASS' : 'FAIL',
    metrics: { endpoints: results },
    logPath: path.join(RAW_DIR, 'gate-22-health-smoke.log'),
  };
}

async function main() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const candidateSha = arg('candidate', config.candidateSha);
  const runNumber = Number(arg('run', '1'));
  const allowDirty = process.argv.includes('--allow-dirty');

  if (!candidateSha || !/^[0-9a-f]{40}$/.test(candidateSha)) {
    console.error('--candidate <40-char commit sha> is required (or freeze one in certification.config.json)');
    process.exit(2);
  }

  mkdirSync(RAW_DIR, { recursive: true });
  mkdirSync(RUN_MANIFEST_DIR, { recursive: true });
  mkdirSync(path.join(REPO_ROOT, '.certification'), { recursive: true });

  if (!process.env.E2E_PASSWORD) {
    console.error(
      'E2E_PASSWORD is required for the browser gates. Use a run-scoped value; the published ' +
        'demo password is refused by e2e/support/fixture.ts.',
    );
    process.exit(2);
  }

  const runLabel = `run${runNumber}`;
  const startedAt = new Date();
  const gateResults = [];

  console.log(`Telestar CRM — full certification ladder, run ${runNumber}`);
  console.log(`candidate ${candidateSha}`);
  console.log('='.repeat(72));

  const record = (result) => {
    gateResults.push(result);
    const flag = result.status === 'PASS' ? 'PASS' : result.status === 'BLOCKED_EXTERNAL' ? 'BLOCKED' : 'FAIL';
    console.log(`[${flag.padEnd(7)}] ${result.gateId.padEnd(28)} ${(result.durationMs / 1000).toFixed(1)}s`);
  };

  record(gateSourceIdentity(candidateSha, { allowDirty }));
  record(gateEnvironment());

  // Static and test gates, straight from the catalogue.
  for (const gateId of [
    '03-typecheck',
    '04-lint',
    '05-test-discipline',
    '06-migration-validation',
    '07-database-integrity',
    '08-vitest',
    '09-redis-integration',
    '10-ai-certification',
    '11-email-safety',
    '12-import-fault-matrix',
  ]) {
    if (!GATES[gateId]) continue;
    record({ ...runGate(gateId, { runLabel }), gateId });
  }

  record(
    scriptGate(
      '13-queue-load',
      'IMPORT_SYSTEM_QUEUE_BENCHMARK over real Redis and BullMQ',
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'scripts/certification/queue-load-benchmark.ts',
        '--candidate',
        candidateSha,
        '--scales',
        '120,500,1000',
      ],
      { env: { IS_WORKER: 'true' } },
    ),
  );

  record({ ...runGate('14-security-suite', { runLabel }), gateId: '14-security-suite' });
  record({ ...runGate('15-production-build', { runLabel }), gateId: '15-production-build' });

  // Browser and runtime gates need the built app running.
  const browserGates = await withServer(async () => {
    const collected = [];

    collected.push(
      scriptGate(
        '16-playwright-roles',
        'six-role real browser acceptance',
        process.execPath,
        ['node_modules/@playwright/test/cli.js', 'test', '--project=certification-roles'],
        { env: { BASE_URL } },
      ),
    );
    collected.push(
      scriptGate(
        '16-playwright-roles-evidence',
        'aggregate six-role observations into EV-ROLE-BROWSER',
        process.execPath,
        ['scripts/certification/collect-role-evidence.mjs', '--candidate', candidateSha],
      ),
    );
    collected.push(
      scriptGate(
        '17-golden-browser-journey',
        'cross-role golden journey in a real browser',
        process.execPath,
        ['node_modules/@playwright/test/cli.js', 'test', '--project=certification-journey'],
        { env: { BASE_URL } },
      ),
    );
    collected.push(
      scriptGate(
        '18-worker-readiness',
        'worker healthcheck against real Redis',
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'scripts/worker-healthcheck.ts'],
      ),
    );
    collected.push(await gateHealthSmoke());
    return collected;
  });
  browserGates.forEach(record);

  // Image gates require a container runtime. Recorded as blocked, never as absent.
  record(
    blockedGate(
      '19-docker-build',
      'Docker image build from the candidate SHA',
      'no container runtime on the certification workstation; see TEL-P1-018',
    ),
  );
  record(
    blockedGate(
      '20-image-inspection',
      'image digest captured by digest, never by floating tag',
      'no image exists to inspect; see TEL-P1-018',
    ),
  );
  record({ ...runGate('21-compose-validation', { runLabel }), gateId: '21-compose-validation' });

  const finishedAt = new Date();

  // A gate that did not run is missing. Silence is never treated as success.
  const requiredGateIds = config.fullCertificationGates.map((gate) => gate.id);
  const executed = new Set(gateResults.map((result) => result.gateId));
  const missingGates = requiredGateIds.filter((gateId) => !executed.has(gateId));
  const failedGates = gateResults.filter((result) => result.status === 'FAIL').map((r) => r.gateId);
  const blockedGates = gateResults
    .filter((result) => result.status === 'BLOCKED_EXTERNAL')
    .map((result) => result.gateId);

  const vitest = parseVitest(path.join(REPO_ROOT, '.certification/vitest.json'));
  const redisGate = gateResults.find((result) => result.gateId === '09-redis-integration');
  const mandatorySkips = (vitest?.testsSkipped ?? 0) + (redisGate?.metrics?.skipped ?? 0);

  const gatesMap = {};
  for (const result of gateResults) {
    gatesMap[result.gateId] = {
      status: result.status,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      description: result.description,
      ...(result.metrics && Object.keys(result.metrics).length > 0 ? { metrics: result.metrics } : {}),
    };
  }

  const manifest = {
    runNumber,
    candidateSha,
    environment: describeEnvironment(),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt - startedAt,
    gates: gatesMap,
    missingGates,
    failedGates,
    blockedGates,
    mandatorySkips,
    vitest: vitest ?? null,
  };

  writeFileSync(
    path.join(RUN_MANIFEST_DIR, `run-${runNumber}.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  // Evidence records derived from this run.
  const artifacts = gateResults
    .filter((result) => result.logPath && existsSync(result.logPath))
    .map((result) => artifactOf(result.logPath));

  const runPassed = failedGates.length === 0 && missingGates.length === 0 && mandatorySkips === 0;

  writeFileSync(
    path.join(EVIDENCE_DIR, `EV-RUN-${runNumber}.json`),
    `${JSON.stringify(
      {
        evidenceId: `EV-RUN-${runNumber}`,
        kind: 'certification-run',
        candidateSha,
        environment: manifest.environment,
        command: `node scripts/certification/run-full-certification.mjs --candidate ${candidateSha} --run ${runNumber}`,
        startedAt: manifest.startedAt,
        finishedAt: manifest.finishedAt,
        exitCode: runPassed ? 0 : 1,
        status: runPassed ? 'PASS' : 'FAIL',
        metrics: {
          runNumber,
          gates: gatesMap,
          missingGates,
          failedGates,
          blockedGates,
          mandatorySkips,
        },
        artifacts,
      },
      null,
      2,
    )}\n`,
  );

  const vitestGate = gateResults.find((result) => result.gateId === '08-vitest');
  if (vitestGate && vitest) {
    writeGateEvidence(
      { ...vitestGate, metrics: vitest },
      {
        evidenceId: 'EV-VITEST',
        kind: 'vitest',
        candidateSha,
        environment: manifest.environment,
      },
    );
  }

  if (redisGate) {
    writeGateEvidence(redisGate, {
      evidenceId: 'EV-REDIS-INTEGRATION',
      kind: 'redis-integration',
      candidateSha,
      environment: manifest.environment,
    });
  }

  const disciplineGate = gateResults.find((result) => result.gateId === '05-test-discipline');
  if (disciplineGate) {
    writeGateEvidence(disciplineGate, {
      evidenceId: 'EV-GATE-TEST-DISCIPLINE',
      kind: 'gate',
      candidateSha,
      environment: manifest.environment,
    });
  }

  rmSync(path.join(REPO_ROOT, '.certification', 'vitest.json'), { force: true });

  console.log('='.repeat(72));
  console.log(`gates      : ${gateResults.length} executed, ${failedGates.length} failed, ${blockedGates.length} blocked`);
  console.log(`missing    : ${missingGates.length > 0 ? missingGates.join(', ') : 'none'}`);
  console.log(`vitest     : ${vitest ? `${vitest.testsPassed} passed, ${vitest.testsFailed} failed, ${vitest.testsSkipped} skipped` : 'not parsed'}`);
  console.log(`skips      : ${mandatorySkips}`);
  console.log(`RUN ${runNumber}      : ${runPassed ? 'PASS' : 'FAIL'}`);

  process.exit(runPassed ? 0 : 1);
}

void main();
