#!/usr/bin/env node
/**
 * DR-003 — drive a real rollback and record what was observed.
 *
 * `scripts/certification/lib/rollbackDrill.mjs` already holds every rule a drill must satisfy
 * before it may record a pass, and those rules are tested exhaustively without a daemon. What
 * was missing (TEL-P1-026) is this: the orchestration that actually swaps images and reads the
 * results back. Writing it blind would have produced a script nobody had run, which is the same
 * class of defect DR-003 exists to close, so it was left until a container runtime was available.
 *
 * Three phases, each timed, each verified:
 *
 *   deploy-candidate      swap to the candidate digest, prove health reports the candidate SHA
 *   rollback-to-previous  swap to the previous digest,  prove health reports the previous SHA
 *   restore-candidate     swap back,                    prove health reports the candidate SHA
 *
 * Every swap goes through `scripts/rollback.sh`, which already refuses a mutable reference and
 * carries the DEPLOY-001/DEPLOY-003 guards. The drill drives that script rather than
 * reimplementing the swap, so what is exercised here is what an operator would actually run in
 * an incident.
 *
 * NOTHING in this file decides whether the drill passed. Observations go to
 * `buildRollbackEvidence`, which derives the verdict — the TEL-P0-001 failure mode was evidence
 * that asserted its own result.
 *
 * Usage:
 *   node scripts/certification/dr-rollback-drill.mjs \
 *     --candidate <40-char sha> --previous <40-char sha> \
 *     --host <ssh target> [--port 2223] [--identity <key>] [--root /opt/crm-4-u] \
 *     [--site crm.telestar.cloud] [--dry-run]
 *
 * Omit `--host` to drive a deployment root on this machine.
 *
 * `--dry-run` prints the exact commands and exits without touching anything, so the plan can be
 * reviewed before a production run.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { EVIDENCE_DIR, RAW_DIR } from './lib/paths.mjs';
import { buildRollbackEvidence } from './lib/rollbackDrill.mjs';
import { mayWriteEvidence } from './lib/evidenceGuard.mjs';

const SHA_RE = /^[0-9a-f]{40}$/;

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const candidateSha = arg('candidate');
// Evidence names the candidate it belongs to, and this one comes from argv, so it
// can be pointed at the wrong release. lib/evidenceGuard.mjs records the run that
// proved that, and why the frozen-candidate comparison is the guard that matters
// for a tool an operator runs by hand.
if (!mayWriteEvidence(candidateSha, { requireCertRun: false, toolName: 'dr-rollback-drill' })) {
  process.exit(2);
}
const previousSha = arg('previous');
const host = arg('host');
const port = arg('port', '2223');
const identity = arg('identity');
const root = arg('root', '/opt/crm-4-u');
const site = arg('site', 'crm.telestar.cloud');
const repo = arg('repo', 'ghcr.io/sonnynguyen170321-ctrl/crm-4-telestar-final');
const dryRun = flag('dry-run');

for (const [label, value] of [['--candidate', candidateSha], ['--previous', previousSha]]) {
  if (!value || !SHA_RE.test(value)) {
    console.error(`${label} must be a full 40-character commit SHA (got: ${value ?? 'nothing'})`);
    process.exit(2);
  }
}
if (candidateSha === previousSha) {
  console.error('candidate and previous are the same commit; a rollback onto itself proves nothing');
  process.exit(2);
}

/** Run a command on the deployment host — over SSH when `--host` is given, otherwise locally. */
function onHost(script, { timeoutMs = 20 * 60 * 1000 } = {}) {
  const full = `cd ${root} && ${script}`;
  if (dryRun) {
    console.log(`  [dry-run] ${full}`);
    return { status: 0, stdout: '', stderr: '' };
  }
  const result = host
    ? spawnSync(
        'ssh',
        [
          '-o', 'StrictHostKeyChecking=no',
          '-o', 'UserKnownHostsFile=/dev/null',
          '-o', 'BatchMode=yes',
          ...(identity ? ['-o', 'IdentitiesOnly=yes', '-i', identity] : []),
          '-p', String(port),
          host,
          full,
        ],
        { encoding: 'utf8', timeout: timeoutMs },
      )
    : spawnSync('bash', ['-lc', full], { encoding: 'utf8', timeout: timeoutMs });

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** The digest a compose service is currently running, read back off the container. */
function serviceDigest(service) {
  const out = onHost(
    `sudo docker inspect --format '{{index .Config.Image}}' crm-4-u-${service}-1 2>/dev/null`,
    { timeoutMs: 120_000 },
  );
  return out.stdout.trim() || null;
}

/**
 * The web service's own account of what it is.
 *
 * Resolved against the real hostname: Caddy serves a certificate for the site, so a request to
 * `localhost` fails TLS and a plain-HTTP request answers 308. Neither is a health check.
 */
function webHealth() {
  const out = onHost(
    `curl -s --max-time 20 --resolve ${site}:443:127.0.0.1 https://${site}/api/health`,
    { timeoutMs: 120_000 },
  );
  const body = out.stdout.trim();
  try {
    return JSON.parse(body);
  } catch {
    // Returned as-is. `evaluateHealth` refuses a non-object body rather than throwing, which is
    // exactly what should happen to a proxy's HTML error page.
    return body;
  }
}

/**
 * The worker's account of what it is.
 *
 * The worker has no HTTP endpoint, so identity comes from the environment the image baked in
 * (`APP_COMMIT` via Dockerfile ARG -> ENV) read out of the RUNNING container, and liveness from
 * the queue-registration line `scripts/post-deploy-smoke.sh` already relies on. Reading the
 * variable from the container rather than from the host's env file matters: the env file is
 * what we asked for, the container is what is running.
 */
function workerHealth() {
  const env = onHost(
    `sudo docker exec crm-4-u-worker-1 printenv APP_COMMIT APP_VERSION APP_BUILT_AT 2>/dev/null`,
    { timeoutMs: 120_000 },
  );
  const [commit = '', version = '', builtAt = ''] = env.stdout.trim().split('\n').map((s) => s.trim());

  const logs = onHost(
    `sudo docker logs --tail 200 crm-4-u-worker-1 2>&1 | grep -c 'all workers registered\\|registered:\\|\\[worker\\] ready' || true`,
    { timeoutMs: 120_000 },
  );
  const registered = Number(logs.stdout.trim() || '0') > 0;

  return {
    ok: registered && commit !== '',
    ...(registered ? {} : { reason: 'worker has not logged queue registration' }),
    ts: Date.now(),
    commit: commit || undefined,
    version: version || undefined,
    builtAt: builtAt || undefined,
  };
}

/** Wait for the web service to answer at all, so a phase is not measured mid-restart. */
function waitForWeb({ timeoutMs = 180_000 } = {}) {
  if (dryRun) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const probe = onHost(
      `curl -s -o /dev/null -w '%{http_code}' --max-time 10 --resolve ${site}:443:127.0.0.1 https://${site}/api/health`,
      { timeoutMs: 60_000 },
    );
    if (probe.stdout.trim() === '200') return true;
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},3000)'], { timeout: 5000 });
  }
  return false;
}

/**
 * One phase: swap to `digest`, wait for the service back, and record what is observed.
 *
 * `expectedSha` is deliberately NOT recorded on the phase. The evaluator derives what each phase
 * should be running from the frozen release identity; a phase that carries its own expectation
 * is refused, because a caller that defines "correct" can never be wrong.
 */
function runPhase({ name, label, digest }) {
  console.log(`\n==> ${name} — swapping to ${digest}`);
  const startedAt = Date.now();

  const swap = onHost(`sudo ./scripts/rollback.sh ${digest}`);
  if (!dryRun && swap.status !== 0) {
    console.error(`  rollback.sh exited ${swap.status}`);
    console.error(swap.stderr.split('\n').slice(-8).join('\n'));
  }

  const back = waitForWeb();
  const durationMs = Date.now() - startedAt;
  console.log(`  ${back ? 'web answered' : 'web DID NOT answer'} after ${(durationMs / 1000).toFixed(1)}s`);

  const phase = {
    name,
    label,
    webDigest: serviceDigest('web'),
    workerDigest: serviceDigest('worker'),
    webHealth: webHealth(),
    workerHealth: workerHealth(),
    durationMs,
  };

  // A dry run must leave the tree exactly as it found it. The first version wrote these logs
  // unconditionally, so reviewing the plan created three artifacts describing a drill that
  // never happened — small, but it is the same species as evidence for work not done.
  if (dryRun) return phase;

  writeFileSync(
    path.join(RAW_DIR, `dr-rollback-${name}.log`),
    [
      `# phase: ${name} (${label})`,
      `# target digest: ${digest}`,
      `# rollback.sh exit: ${swap.status}`,
      `# durationMs: ${durationMs}`,
      '',
      '--- rollback.sh stdout ---',
      swap.stdout,
      '--- rollback.sh stderr ---',
      swap.stderr,
      '--- observed ---',
      JSON.stringify(phase, null, 2),
      '',
    ].join('\n'),
    'utf8',
  );

  return phase;
}

/**
 * Both digests must be content-addressed, and this tool will not invent one.
 *
 * These defaulted to `${repo}:${sha}` — a TAG. `scripts/rollback.sh:36` accepts either
 * `@sha256:<64>` or `:<40-char sha>`, so the fallback sailed through the guard written to
 * prevent exactly this and recorded a mutable reference as the release identity. A tag can be
 * repointed; a digest cannot. REL-001 and the release-identity invariant both require the
 * immutable form, and a rollback target that can move is not a rollback target.
 *
 * A guard that accepts two forms will be fed the weaker one by any default that does not think
 * about it. The mitigation until now was "remember to pass two flags by hand" — a runbook line,
 * relied upon during the single production action of the whole programme, performed at a console
 * during an incident, with nothing watching the argv. That is the mitigation this codebase has
 * been burned by repeatedly, so the tool now refuses instead of assuming.
 *
 * Digests are recoverable without a registry call: EV-RELEASE-IDENTITY carries imageDigest for
 * the deployed release, and EV-DR-ROLLBACK carries candidateDigest and previousDigest for the
 * last drill. Two independent writers agreeing on a value is better provenance than a lookup.
 */
function requireContentAddressed(flag, value, sha) {
  if (!value) {
    console.error(`${flag} is required — this drill will not synthesise an image reference.`);
    console.error(`  No default is applied for ${sha.slice(0, 7)}: the old fallback was`);
    console.error(`  ${repo}:<sha>, a tag, which rollback.sh accepts and which can be repointed.`);
    console.error('  Recover the digest from EV-RELEASE-IDENTITY (imageDigest) or EV-DR-ROLLBACK');
    console.error('  (candidateDigest / previousDigest), then pass it explicitly.');
    process.exit(2);
  }
  if (!/@sha256:[0-9a-f]{64}$/.test(value)) {
    console.error(`${flag} must be content-addressed, ending @sha256:<64 hex>.`);
    console.error(`  got: ${value}`);
    console.error('  A tag can be repointed after the drill records it, so the evidence would');
    console.error('  attest to an artifact that no longer exists at that reference.');
    process.exit(2);
  }
  return value;
}

const candidateDigest = requireContentAddressed(
  '--candidate-digest',
  arg('candidate-digest'),
  candidateSha,
);
const previousDigest = requireContentAddressed(
  '--previous-digest',
  arg('previous-digest'),
  previousSha,
);

const command = `node scripts/certification/dr-rollback-drill.mjs --candidate ${candidateSha} --previous ${previousSha}`;
const startedAt = new Date().toISOString();

console.log('DR-003 rollback drill');
console.log(`  candidate : ${candidateSha}  ${candidateDigest}`);
console.log(`  previous  : ${previousSha}  ${previousDigest}`);
console.log(`  host      : ${host ? `${host}:${port}` : '(local)'}  root ${root}`);
if (dryRun) console.log('  MODE      : dry run — nothing will be changed\n');

const phases = [
  runPhase({ name: 'deploy-candidate', label: 'candidate', digest: candidateDigest }),
  runPhase({ name: 'rollback-to-previous', label: 'rollback', digest: previousDigest }),
  runPhase({ name: 'restore-candidate', label: 'restore', digest: candidateDigest }),
];

if (dryRun) {
  console.log('\nDry run complete. No evidence written.');
  process.exit(0);
}

const evidence = buildRollbackEvidence({
  candidateSha,
  previousSha,
  candidateDigest,
  previousDigest,
  phases,
  environment: host ? `production (${host})` : 'local deployment root',
  command,
  startedAt,
  finishedAt: new Date().toISOString(),
});

writeFileSync(
  path.join(EVIDENCE_DIR, 'EV-DR-ROLLBACK.json'),
  `${JSON.stringify(evidence, null, 2)}\n`,
  'utf8',
);

console.log('\n========================================================================');
console.log(`rollback : ${evidence.metrics.rollbackSeconds ?? 'not measured'}s`);
console.log(`restore  : ${evidence.metrics.restoreSeconds ?? 'not measured'}s`);
for (const finding of evidence.metrics.findings) console.log(`  - ${finding}`);
console.log(`DR-003   : ${evidence.status}`);

process.exit(evidence.status === 'PASS' ? 0 : 1);
