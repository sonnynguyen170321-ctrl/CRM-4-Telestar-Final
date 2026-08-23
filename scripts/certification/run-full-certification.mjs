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
import { loadCertificationEnv, missingOperatorEnv } from './lib/loadEnv.mjs';
import { containerRuntime, gateDockerBuild, gateImageInspection } from './lib/imageGates.mjs';
import { HEALTH_ENDPOINTS, evaluateHealthGate } from './lib/healthGate.mjs';
import {
  probePort,
  describePortConflict,
  serverHasExited,
  describeServerExit,
} from './lib/serverGuard.mjs';
import {
  parsePlaywrightReport,
  unaccountedResults,
  describePlaywright,
} from './lib/playwrightReport.mjs';

// Before any `const` below reads process.env: CERT_PORT is read at module load, so loading
// configuration inside main() would be too late for it.
const ENV_FILES_LOADED = loadCertificationEnv();

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

/**
 * `git status --porcelain` without trimming.
 *
 * Its status field is fixed-width - two status characters then a space - so the path starts
 * at index 3. `trim()` strips the leading space of an unstaged line, which shifts the first
 * line by one and turns `docs/...` into `ocs/...`. That misread a metadata path as
 * application code and failed gate 01 for a file that was fine.
 */
function gitStatusLines() {
  const result = spawnSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (result.status !== 0) return [];
  return result.stdout.split('\n').filter((line) => line.trim().length > 0);
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

/** Certification metadata is produced *by* a run, so it cannot also be a precondition. */
const METADATA_PREFIX = 'docs/production-certification/';

/** `git status --porcelain` lines look like " M path" or "?? path". */
function isMetadataPath(line) {
  return line.slice(3).replace(/^"|"$/g, '').startsWith(METADATA_PREFIX);
}

/**
 * Gate 01: the application under test is exactly the frozen candidate.
 *
 * "Exactly" means the application source, not the paperwork. A run writes evidence,
 * manifests and rendered documents under `docs/production-certification/`, and the freeze is
 * deliberately followed by metadata commits. So HEAD may move past the candidate and the tree
 * may be dirty **only** where certification metadata lives. Anything else means the code being
 * tested is not the code that was frozen, which is the whole point of freezing it.
 *
 * This is the same boundary the validator's check N enforces on commits.
 */
function gateSourceIdentity(candidateSha, { allowDirty }) {
  const head = git(['rev-parse', 'HEAD']);
  const status = gitStatusLines();
  const problems = [];

  const dirtyNonMetadata = status.filter((line) => !isMetadataPath(line));
  if (dirtyNonMetadata.length > 0 && !allowDirty) {
    problems.push(
      `working tree has ${dirtyNonMetadata.length} uncommitted non-metadata path(s): ` +
        dirtyNonMetadata.slice(0, 5).map((line) => line.slice(3)).join(', '),
    );
  }

  let commitsSinceFreeze = [];
  if (head !== candidateSha) {
    const range = git(['log', '--format=%H', `${candidateSha}..HEAD`]);
    if (range === null) {
      problems.push(`candidate ${candidateSha.slice(0, 7)} is not reachable from HEAD`);
    } else {
      commitsSinceFreeze = range.split('\n').filter(Boolean);
      for (const commit of commitsSinceFreeze) {
        const files = (git(['show', '--name-only', '--format=', commit]) ?? '')
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
        const behaviourChanging = files.filter((file) => !file.startsWith(METADATA_PREFIX));
        if (behaviourChanging.length > 0) {
          problems.push(
            `commit ${commit.slice(0, 7)} after the freeze changes application code: ${behaviourChanging.slice(0, 3).join(', ')}`,
          );
        }
      }
    }
  }

  return {
    gateId: '01-source-identity',
    description: 'the application source is exactly the frozen candidate',
    command: 'git rev-parse HEAD; git status --porcelain; git log candidate..HEAD',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 0,
    exitCode: problems.length === 0 ? 0 : 1,
    status: problems.length === 0 ? 'PASS' : 'FAIL',
    metrics: {
      head,
      candidateSha,
      commitsSinceFreeze: commitsSinceFreeze.length,
      uncommittedNonMetadataPaths: dirtyNonMetadata.length,
      problems,
    },
    logPath: null,
  };
}

/** Gate 02: the services the ladder depends on are actually reachable. */
function gateEnvironment(runLabel) {
  const startedAt = new Date();
  const probe = shell(process.execPath, ['scripts/certification/probe-environment.mjs'], {
    timeoutMs: 60_000,
  });
  const finishedAt = new Date();
  const logPath = writeLog(`${runLabel}-02-environment`, 'environment probe', probe);

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

/**
 * `runLabel` is part of the log filename on purpose. Without it every run wrote
 * `gate-13-queue-load.log` to the same path, so run 2 overwrote the very file run 1's
 * evidence record had hashed - and the validator correctly reported thirteen artifact
 * mismatches. Evidence has to outlive the run after it.
 */
function scriptGate(gateId, description, command, args, { env = {}, timeoutMs, runLabel = 'run' } = {}) {
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
    logPath: writeLog(`${runLabel}-${gateId}`, description, result),
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
async function withServer(fn, { candidateSha } = {}) {
  // The port must be OURS. When a `next dev` already held 3000, `next start` died with
  // EADDRINUSE, the readiness probe below got a healthy 200 from that dev server, and the run
  // certified it: 30 Playwright tests passed against a development build. Refuse up front
  // rather than probing around whatever answers.
  const portProbe = await probePort(SERVER_PORT);
  const conflict = describePortConflict(SERVER_PORT, portProbe);
  if (conflict) throw new Error(conflict);

  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(SERVER_PORT)], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      // `APP_COMMIT` is baked into the image at build time by `--build-arg`, and `next build`
      // here does no such thing — so the locally started server reported `commit: "unknown"`
      // and gate 22 could never pass locally, however healthy the candidate was.
      //
      // Supplying it here is deliberately NOT the proof that the deployed release is the
      // candidate: that would be circular, since the ladder would be checking a value it just
      // handed over. What gate 22 verifies locally is the release-identity *plumbing* —
      // environment to `readReleaseInfo` to the health response — which is a real path that can
      // break. The non-circular check that the running bytes are the candidate is
      // `EV-RELEASE-IDENTITY`, recorded against the live deployment and enforced by the
      // validator's check S.
      ...(candidateSha ? { APP_COMMIT: candidateSha, APP_VERSION: candidateSha } : {}),
    },
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
      // Check liveness BEFORE the probe. A dead child with something else on the port answers
      // 200 forever, which is exactly how the dev server got certified.
      if (serverHasExited(server)) throw new Error(describeServerExit(server, output));
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
    // Re-check after the loop: the process can die between the last liveness check and a
    // successful probe, and then every gate runs against whoever took the port.
    if (serverHasExited(server)) throw new Error(describeServerExit(server, output));
    return await fn();
  } finally {
    server.kill();
    writeFileSync(path.join(RAW_DIR, 'certification-server.log'), output);
  }
}

/** Runs `fn` with a real BullMQ worker attached, so queue-draining gates mean something. */
async function withWorker(fn) {
  const worker = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'workers/index.ts'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      IS_WORKER: 'true',
      DIRECT_URL: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  worker.stdout.on('data', (chunk) => {
    output += chunk;
  });
  worker.stderr.on('data', (chunk) => {
    output += chunk;
  });

  try {
    // Give the worker time to attach to its queues before anything is enqueued.
    await new Promise((resolve) => setTimeout(resolve, 8000));
    return await fn();
  } finally {
    worker.kill();
    writeFileSync(path.join(RAW_DIR, 'certification-worker.log'), output);
  }
}

/**
 * Gate 18. Needs a tenant id because this database holds many: the healthcheck refuses to
 * guess which one to enqueue against rather than picking one arbitrarily.
 */
function gateWorkerReadiness(runLabel) {
  const tenantId = process.env.CERT_WORKER_TENANT_ID || readFixtureTenant();
  return scriptGate(
    '18-worker-readiness',
    'worker healthcheck: a job is enqueued and a real worker drains it',
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'scripts/worker-healthcheck.ts'],
    {
      env: {
        CUTOVER_TENANT_ID: tenantId ?? '',
        IS_WORKER: 'true',
        DIRECT_URL: process.env.DIRECT_URL || process.env.DATABASE_URL,
      },
      timeoutMs: 180_000,
      runLabel,
    },
  );
}

/** The audit fixture's tenant A, so the healthcheck runs against a known-good tenant. */
function readFixtureTenant() {
  const manifest = path.join(REPO_ROOT, 'e2e', '.fixture.json');
  if (!existsSync(manifest)) return null;
  try {
    return JSON.parse(readFileSync(manifest, 'utf8')).tenants?.a ?? null;
  } catch {
    return null;
  }
}

async function gateHealthSmoke(runLabel, candidateSha) {
  const startedAt = new Date();
  const probes = [];

  for (const endpoint of HEALTH_ENDPOINTS) {
    try {
      const response = await fetch(`${BASE_URL}${endpoint}`);
      probes.push({ endpoint, status: response.status, body: await response.text() });
    } catch (error) {
      probes.push({ endpoint, status: null, body: '', error: String(error) });
    }
  }

  // The expected SHA is the frozen candidate, never a value read back from the response.
  const result = evaluateHealthGate(probes, candidateSha);
  const finishedAt = new Date();

  // The log filename carries runLabel, and the recorded logPath is the file that was actually
  // written. These were two different paths, so the recorded artifact did not exist and each
  // run overwrote the previous run's log (TEL-P1-034).
  const logPath = path.join(RAW_DIR, `${runLabel}-22-health-smoke.log`);
  writeFileSync(
    logPath,
    [
      '# health smoke',
      `# candidate: ${candidateSha}`,
      `# findings: ${result.findings.length ? result.findings.join('; ') : 'none'}`,
      '',
      JSON.stringify(result.byEndpoint, null, 2),
      '',
    ].join('\n'),
  );

  return {
    gateId: '22-health-smoke',
    description: 'web health endpoints answer 200 with ok=true and report the candidate SHA',
    command: `GET ${BASE_URL}${HEALTH_ENDPOINTS.join(' , ')}`,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt - startedAt,
    exitCode: result.ok ? 0 : 1,
    status: result.ok ? 'PASS' : 'FAIL',
    metrics: { endpoints: result.byEndpoint, findings: result.findings },
    logPath,
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

  const missingEnv = missingOperatorEnv();
  if (missingEnv.length > 0) {
    console.error(
      `${missingEnv.join(', ')} is required for the browser gates. Use a run-scoped value; the ` +
        'published demo password is refused by e2e/support/fixture.ts.',
    );
    console.error(
      `Configuration loaded from: ${ENV_FILES_LOADED.length > 0 ? ENV_FILES_LOADED.join(', ') : 'no env file found'}.`,
    );
    process.exit(2);
  }

  const fixtureResult = shell(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/e2e-audit-fixture.ts'], {
    env: { ALLOW_E2E_FIXTURE: '1', E2E_PASSWORD: process.env.E2E_PASSWORD },
  });
  if (fixtureResult.status !== 0) {
    console.error(`Failed to seed e2e audit fixture: ${fixtureResult.stderr || fixtureResult.stdout}`);
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
  record(gateEnvironment(runLabel));

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
    record({
      ...runGate(gateId, { runLabel, extraEnv: { CERT_CANDIDATE_SHA: candidateSha } }),
      gateId,
    });
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
      { env: { IS_WORKER: 'true' }, runLabel },
    ),
  );

  record({ ...runGate('14-security-suite', { runLabel }), gateId: '14-security-suite' });
  record({ ...runGate('15-production-build', { runLabel }), gateId: '15-production-build' });

  /**
   * A Playwright gate, counted rather than inferred from the exit code.
   *
   * Playwright exits 0 when tests are skipped, and the project reporter is `list`, which writes
   * nothing machine-readable. So a run with skipped browser tests passed its gate and
   * contributed nothing to `mandatorySkips` (TEL-P1-035). The JSON reporter is requested here
   * rather than in playwright.config.ts so CI and local runs are unaffected.
   */
  const playwrightGate = (gateId, description, project) => {
    const reportPath = path.join(REPO_ROOT, '.certification', `playwright-${project}-${runLabel}.json`);
    const gate = scriptGate(
      gateId,
      description,
      process.execPath,
      ['node_modules/@playwright/test/cli.js', 'test', `--project=${project}`, '--reporter=list,json'],
      { env: { BASE_URL, PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath }, runLabel },
    );

    const counts = parsePlaywrightReport(reportPath);
    const unaccounted = unaccountedResults(counts);

    return {
      ...gate,
      // A gate that exited 0 while skipping tests is not a pass.
      status: gate.status === 'PASS' && counts.parsed && unaccounted === 0 ? 'PASS' : 'FAIL',
      metrics: { ...(gate.metrics ?? {}), playwright: counts, unaccounted },
    };
  };

  // Browser and runtime gates need the built app running.
  const browserGates = await withServer(async () => {
    const collected = [];

    collected.push(
      playwrightGate('16-playwright-roles', 'six-role real browser acceptance', 'certification-roles'),
    );
    collected.push(
      scriptGate(
        '16-playwright-roles-evidence',
        'aggregate six-role observations into EV-ROLE-BROWSER',
        process.execPath,
        ['scripts/certification/collect-role-evidence.mjs', '--candidate', candidateSha],
        { runLabel },
      ),
    );
    collected.push(
      playwrightGate(
        '17-golden-browser-journey',
        'cross-role golden journey in a real browser',
        'certification-journey',
      ),
    );
    // The healthcheck enqueues a job and waits for a worker to complete it, so a worker has
    // to be attached. Without one it reports "is a worker running?" - which is the check
    // doing its job, not a product failure, and is exactly the stranded-queue condition it
    // exists to catch.
    collected.push(await withWorker(() => gateWorkerReadiness(runLabel)));
    collected.push(await gateHealthSmoke(runLabel, candidateSha));
    return collected;
  }, { candidateSha });
  browserGates.forEach(record);

  // Image gates need a container runtime. They RUN wherever one answers, and are recorded as
  // blocked only where one genuinely does not — never as absent, and never as a pass.
  const runtime = containerRuntime(shell);
  if (runtime) {
    console.log(`  container runtime: ${runtime.command} ${runtime.version}`);
  } else {
    console.log('  container runtime: none — gates 19 and 20 will record BLOCKED_EXTERNAL');
  }
  const dockerBuild = gateDockerBuild({ runtime, candidateSha, runLabel, scriptGate, blockedGate });
  record(dockerBuild);
  record(
    gateImageInspection({
      runtime,
      candidateSha,
      buildStatus: dockerBuild.status,
      runLabel,
      shell,
      writeLog,
      blockedGate,
    }),
  );
  record({ ...runGate('21-compose-validation', { runLabel }), gateId: '21-compose-validation' });

  // The validator has to be shown failing, or it proves nothing (order section 31).
  record(
    scriptGate(
      '23-validator-selftest',
      'the validator rejects every injected false-green state',
      process.execPath,
      ['scripts/certification/validator-selftest.mjs'],
      { runLabel },
    ),
  );

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
  // Playwright skips were previously invisible here, so a run with skipped browser tests
  // reported zero mandatory skips and satisfied the validator's check K (TEL-P1-035).
  const playwrightUnaccounted = gateResults
    .filter((result) => result.metrics?.playwright)
    .reduce((sum, result) => sum + (result.metrics.unaccounted ?? 0), 0);
  const mandatorySkips =
    (vitest?.testsSkipped ?? 0) + (redisGate?.metrics?.skipped ?? 0) + playwrightUnaccounted;

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

  // A blocked gate is honest, but it still means this is not a complete certification run.
  // Recording it as a pass would be the same class of claim the program exists to remove.
  const runPassed =
    failedGates.length === 0 &&
    missingGates.length === 0 &&
    mandatorySkips === 0 &&
    blockedGates.length === 0;

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

  // Several requirements are satisfied by a specific suite rather than by the run as a whole.
  // Deriving those records from the Vitest per-file results keeps one source of truth: a
  // record can only claim a suite passed if that suite actually appears in the run output.
  if (vitest) {
    const suitePassed = (file) => {
      const entry = vitest.files[file];
      return Boolean(entry && entry.status === 'passed' && entry.tests > 0 && entry.skipped === 0);
    };
    const derive = (evidenceId, kind, files, extraMetrics = {}) => {
      const allPassed = files.every(suitePassed);
      writeFileSync(
        path.join(EVIDENCE_DIR, `${evidenceId}.json`),
        `${JSON.stringify(
          {
            evidenceId,
            kind,
            candidateSha,
            environment: manifest.environment,
            command: `derived from ${vitestGate?.command ?? 'the Vitest gate'}`,
            startedAt: vitestGate?.startedAt ?? manifest.startedAt,
            finishedAt: vitestGate?.finishedAt ?? manifest.finishedAt,
            exitCode: allPassed ? 0 : 1,
            status: allPassed ? 'PASS' : 'FAIL',
            metrics: {
              suites: Object.fromEntries(files.map((file) => [file, vitest.files[file] ?? null])),
              ...extraMetrics,
            },
            artifacts: vitestGate && existsSync(vitestGate.logPath) ? [artifactOf(vitestGate.logPath)] : [],
          },
          null,
          2,
        )}
`,
      );
    };

    derive('EV-AI-CAPABILITY-ROUTING', 'ai-capability-routing', ['tests/ai-capability-routing.test.ts']);
    derive('EV-AI-DURABLE-BUDGET', 'ai-durable-budget', ['tests/ai-durable-budget.test.ts']);
    derive('EV-AI-SHARED-CIRCUIT', 'ai-shared-circuit', ['tests/ai-shared-circuit.test.ts']);
    derive('EV-AI-STREAM-GOVERNANCE', 'ai-stream-governance', ['tests/ai-stream-governance.test.ts']);
    derive(
      'EV-SECURITY-INVENTORY',
      'security-inventory',
      ['tests/tenant-inject.test.ts', 'tests/object-auth-red-team.test.ts', 'tests/mass-assignment.test.ts'],
      { inventory: 'docs/production-certification/RLS_BYPASS_INVENTORY.md' },
    );
    derive('EV-FAILURE-MATRIX', 'failure-matrix', ['tests/failure-matrix.test.ts'], {
      scenarios: {
        'database-connection-drop': suitePassed('tests/failure-matrix.test.ts') ? 'PASS' : 'FAIL',
        'sigterm-shutdown': suitePassed('tests/failure-matrix.test.ts') ? 'PASS' : 'FAIL',
      },
    });
  }

  const selftestGate = gateResults.find((result) => result.gateId === '23-validator-selftest');
  if (selftestGate) {
    writeGateEvidence(selftestGate, {
      evidenceId: 'EV-VALIDATOR-SELFTEST',
      kind: 'validator-self',
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
  for (const result of gateResults.filter((r) => r.metrics?.playwright)) {
    console.log(`playwright : ${result.gateId} — ${describePlaywright(result.metrics.playwright)}`);
  }
  console.log(`RUN ${runNumber}      : ${runPassed ? 'PASS' : 'FAIL'}`);

  process.exit(runPassed ? 0 : 1);
}

void main();
