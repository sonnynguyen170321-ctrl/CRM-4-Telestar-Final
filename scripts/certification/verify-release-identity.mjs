#!/usr/bin/env node
/**
 * Verifies the release identity chain by observing it (TEL-P1-018, REL-001).
 *
 * `record-release-identity.mjs` says of itself: "Every value is supplied by the caller
 * from a real command's output; this script validates their shape and writes the record.
 * It invents nothing." That is honest, and it is also why EV-RELEASE-IDENTITY carried
 * zero artifacts and claimed a digest — sha256:99fbfe... — that appeared nowhere else in
 * the evidence tree. Shape-checking what an operator typed is not observation.
 *
 * This script types nothing in. It asks:
 *
 *   1. the registry, for the image at the claimed digest, and reads
 *      org.opencontainers.image.revision off it
 *   2. GitHub, for the CI run, and reads its headSha
 *   3. the deployment, for /api/health, and reads the SHA it reports about itself
 *
 * and compares all three to the frozen candidate. Every answer is written to disk as an
 * artifact before it is judged, so the next reader can re-derive the verdict.
 *
 *   node scripts/certification/verify-release-identity.mjs \
 *     --image sha256:… [--ci-run <id>] [--url <health url>] \
 *     [--via "<command that runs a shell on the deployment host>"]
 *
 * THE FIFTH AND SIXTH LINKS. Whether the running web and worker containers were started
 * from that digest is a question only the deployment host can answer. It used to be
 * unanswerable here, so those fields were null and the chain was honestly incomplete.
 *
 * `--via` closes that by *observing* rather than accepting. It takes a command prefix that
 * opens a shell on the host — on this project, ssh through an IAP tunnel, because port 22
 * is reachable only from 35.235.240.0/20:
 *
 *   --via "ssh -i ~/.ssh/google_compute_engine -p 2223 -o BatchMode=yes user@localhost"
 *
 * The tool appends its own `docker inspect` to that prefix, writes the raw answer to an
 * artifact before judging it, and records the transport it used. What it will not do is
 * take a digest typed on the command line: `record-release-identity.mjs` already did that,
 * and shape-checking what an operator typed is how EV-RELEASE-IDENTITY came to claim a
 * digest that appeared nowhere else in the evidence tree. Without `--via`, or when the
 * probe fails, the two fields stay null and the chain stays incomplete — which is the
 * truth. A chain that reports itself complete on four links out of six is what this
 * replaces.
 */
import { createHash } from 'node:crypto';
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONFIG_PATH, EVIDENCE_DIR, RAW_DIR, repoRelative } from './lib/paths.mjs';
import { parseHostProbe } from './lib/repoDigest.mjs';
import { mayWriteEvidence } from './lib/evidenceGuard.mjs';

const SHA_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const DEFAULT_URL = 'https://crm.telestar.cloud/api/health';
const IMAGE_REPO = 'ghcr.io/sonnynguyen170321-ctrl/crm-4-telestar-final';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

function writeArtifact(name, body) {
  mkdirSync(RAW_DIR, { recursive: true });
  const text = body.endsWith('\n') ? body : `${body}\n`;
  const file = path.join(RAW_DIR, name);
  writeFileSync(file, text);
  return {
    path: repoRelative(file),
    sizeBytes: Buffer.byteLength(text),
    sha256: createHash('sha256').update(text).digest('hex'),
  };
}

function run(command, args) {
  try {
    return { ok: true, out: execFileSync(command, args, { encoding: 'utf8', timeout: 180_000 }) };
  } catch (error) {
    return { ok: false, out: String(error.stdout || '') + String(error.stderr || error.message) };
  }
}

/**
 * The command sent to the deployment host.
 *
 * It resolves each container's image id, then asks the image store for that image's
 * RepoDigests and its `org.opencontainers.image.revision` label. RepoDigests is the
 * registry digest — the thing that ties a running container back to a published artifact.
 * The container's own `.Image` field is a local image id and is printed too, because when
 * the two differ that difference is itself worth seeing rather than silently normalising.
 */
function hostProbeScript(webContainer, workerContainer) {
  // One line, joined with spaces: the whole script travels as a single argument to a remote
  // shell, so every statement carries its own terminator rather than relying on newlines.
  return [
    'set -e;',
    `for pair in "web ${webContainer}" "worker ${workerContainer}"; do`,
    '  role=${pair%% *}; name=${pair#* };',
    '  img=$(docker inspect "$name" --format "{{.Image}}");',
    '  digests=$(docker image inspect "$img" --format "{{json .RepoDigests}}");',
    '  rev=$(docker image inspect "$img" --format "{{index .Config.Labels \\"org.opencontainers.image.revision\\"}}");',
    '  echo "$role imageId=$img repoDigests=$digests revision=$rev";',
    'done',
  ].join(' ');
}


/**
 * Observes the two container digests on the deployment host.
 *
 * Returns the raw transcript whatever happens, so a failed probe is as inspectable as a
 * successful one. A probe that cannot run yields nulls; it never guesses.
 */
function probeDeploymentHost(via, webContainer, workerContainer) {
  const remote = hostProbeScript(webContainer, workerContainer);
  const composed = `${via} ${JSON.stringify(remote)}`;
  let out;
  let ok = true;
  try {
    out = execSync(composed, { encoding: 'utf8', timeout: 180_000, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (error) {
    ok = false;
    out = String(error.stdout || '') + String(error.stderr || error.message || '');
  }

  return { ok, transcript: out, ...parseHostProbe(out, IMAGE_REPO) };
}

async function main() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const candidateSha = config.candidateSha;
  // Reading the candidate from config means this cannot be aimed at the wrong release.
  // It does not stop an ad-hoc run replacing a ladder run's evidence, which is a
  // different mistake and one made twice while verifying this session.
  if (!mayWriteEvidence(candidateSha, { toolName: 'verify-release-identity' })) {
    process.exitCode = 2;
    return;
  }
  if (!SHA_RE.test(candidateSha ?? '')) {
    console.error('certification.config.json has no frozen candidate SHA.');
    process.exit(2);
  }

  const imageDigest = arg('image');
  if (!DIGEST_RE.test(imageDigest ?? '')) {
    console.error('--image must be a sha256: digest. A floating tag certifies whatever it pointed at.');
    process.exit(2);
  }
  const ciRunId = arg('ci-run');
  const url = arg('url', DEFAULT_URL);
  const via = arg('via');
  const resources = config.productionResources ?? {};
  const webContainer = arg('web-container', resources.webContainer ?? 'crm-4-u-web-1');
  const workerContainer = arg('worker-container', resources.workerContainer ?? 'crm-4-u-worker-1');

  // A digest typed on the command line is not an observation, and accepting one is the
  // defect this tool exists to remove. Refuse loudly rather than quietly ignoring it.
  for (const rejected of ['web', 'worker']) {
    if (arg(rejected) !== null) {
      console.error(
        `--${rejected} no longer accepts a digest. A digest supplied by the caller is not an ` +
          'observation of the deployment. Use --via to let this tool read the host itself.',
      );
      process.exit(2);
    }
  }

  const startedAt = new Date().toISOString();
  const artifacts = [];
  const problems = [];

  // ── 1. the registry ──────────────────────────────────────────────────────
  const reference = `${IMAGE_REPO}@${imageDigest}`;
  const inspect = run('docker', ['buildx', 'imagetools', 'inspect', reference, '--format', '{{json .Image}}']);
  artifacts.push(writeArtifact('release-identity-imagetools.log', `$ docker buildx imagetools inspect ${reference}\n${inspect.out}`));

  let imageRevision = null;
  let imageCreated = null;
  if (!inspect.ok) {
    problems.push(`registry did not answer for ${imageDigest.slice(0, 20)}…`);
  } else {
    try {
      const parsed = JSON.parse(inspect.out);
      const image = parsed['linux/amd64'] || parsed;
      const labels = (image.config && image.config.Labels) || {};
      imageRevision = labels['org.opencontainers.image.revision'] ?? null;
      imageCreated = image.created ?? null;
    } catch (error) {
      problems.push(`could not read the image config: ${error.message}`);
    }
    if (imageRevision !== candidateSha) {
      problems.push(
        `image revision label ${imageRevision ?? '(absent)'} is not the candidate ${candidateSha.slice(0, 7)}`,
      );
    }
  }

  // ── 2. the CI run ────────────────────────────────────────────────────────
  let ciHeadSha = null;
  let ciConclusion = null;
  if (ciRunId) {
    const ci = run('gh', ['run', 'view', String(ciRunId), '--json', 'databaseId,headSha,conclusion,workflowName,createdAt']);
    artifacts.push(writeArtifact('release-identity-ci-run.log', `$ gh run view ${ciRunId}\n${ci.out}`));
    if (!ci.ok) {
      problems.push(`could not read CI run ${ciRunId}`);
    } else {
      try {
        const parsed = JSON.parse(ci.out);
        ciHeadSha = parsed.headSha ?? null;
        ciConclusion = parsed.conclusion ?? null;
      } catch (error) {
        problems.push(`could not parse the CI run: ${error.message}`);
      }
      if (ciHeadSha !== candidateSha) {
        problems.push(`CI run ${ciRunId} ran on ${String(ciHeadSha).slice(0, 7)}, not the candidate`);
      }
      if (ciConclusion !== 'success') {
        problems.push(`CI run ${ciRunId} concluded ${ciConclusion}`);
      }
    }
  } else {
    problems.push('no --ci-run given: the link from commit to build is unproven');
  }

  // ── 3. the deployment ────────────────────────────────────────────────────
  let healthSha = null;
  let healthBody = '';
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { accept: 'application/json' } });
    healthBody = await response.text();
    artifacts.push(writeArtifact('release-identity-health.log', `$ curl -s ${url}\n${healthBody}`));
    const health = JSON.parse(healthBody);
    healthSha = health.commit ?? health.version ?? null;
    if (healthSha !== candidateSha) {
      problems.push(`deployment reports ${String(healthSha).slice(0, 7)}, not the candidate`);
    }
  } catch (error) {
    problems.push(`deployment unreachable at ${url}: ${error instanceof Error ? error.message : error}`);
  }

  // ── 4. the two links only the deployment host can answer ─────────────────
  let webDigest = null;
  let workerDigest = null;
  let hostRevisions = {};

  if (!via) {
    problems.push(
      'web and worker container digests were not observed: no --via was given, so nothing asked ' +
        'the deployment host which digest each running container was started from',
    );
  } else {
    const probe = probeDeploymentHost(via, webContainer, workerContainer);
    artifacts.push(
      writeArtifact(
        `deployment-host-probe-${candidateSha.slice(0, 7)}.log`,
        [
          `# transport: ${via}`,
          `# containers: ${webContainer}, ${workerContainer}`,
          `# exit: ${probe.ok ? 'ok' : 'failed'}`,
          '',
          probe.transcript,
        ].join('\n'),
      ),
    );
    webDigest = probe.web;
    workerDigest = probe.worker;
    hostRevisions = probe.revisions;
    if (!probe.ok) {
      problems.push(`deployment host probe failed over ${via.split(' ')[0]}; digests not observed`);
    }
  }

  const containerDigestsObserved = Boolean(webDigest && workerDigest);
  if (via && !containerDigestsObserved) {
    problems.push(
      `the host probe returned no registry digest for ${!webDigest ? webContainer : workerContainer}: ` +
        'a container running an image with no RepoDigests was not started from a published artifact',
    );
  }
  for (const [label, digest] of [['web', webDigest], ['worker', workerDigest]]) {
    if (!digest) continue;
    if (digest !== imageDigest) {
      problems.push(`${label} container runs ${digest.slice(0, 14)}…, not the candidate image digest`);
    }
    const revision = hostRevisions[label];
    if (revision && revision !== candidateSha) {
      problems.push(`${label} container's image carries revision ${revision.slice(0, 7)}, not the candidate`);
    }
  }

  const finishedAt = new Date().toISOString();
  const status = problems.length === 0 ? 'PASS' : 'FAIL';

  const record = {
    evidenceId: 'EV-RELEASE-IDENTITY',
    kind: 'release-identity',
    candidateSha,
    environment: 'read-only observation from the certification workstation: container registry, GitHub API, live health endpoint',
    command:
      `node scripts/certification/verify-release-identity.mjs --image ${imageDigest}` +
      `${ciRunId ? ` --ci-run ${ciRunId}` : ''} --url ${url}${via ? ` --via ${JSON.stringify(via)}` : ''}`,
    startedAt,
    finishedAt,
    exitCode: status === 'PASS' ? 0 : 1,
    status,
    metrics: {
      ciRunId: ciRunId ?? null,
      ciHeadSha,
      ciConclusion,
      imageDigest,
      imageRevisionLabel: imageRevision,
      imageCreated,
      imageRevisionMatchesCandidate: imageRevision === candidateSha,
      webDigest,
      workerDigest,
      containerDigestsObserved,
      containerDigestSource: via ? 'observed on the deployment host' : null,
      containerImageRevisions: hostRevisions,
      healthSha,
      healthMatchesCandidate: healthSha === candidateSha,
      separateImagesIntentional: false,
      chainProblems: problems,
    },
    artifacts,
  };

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(path.join(EVIDENCE_DIR, 'EV-RELEASE-IDENTITY.json'), `${JSON.stringify(record, null, 2)}\n`);

  console.log(`candidate        : ${candidateSha}`);
  console.log(`image digest     : ${imageDigest}`);
  console.log(`image revision   : ${imageRevision ?? '(absent)'}`);
  console.log(`CI run ${ciRunId ?? '(none)'}  : headSha ${ciHeadSha ?? '(none)'} / ${ciConclusion ?? '(none)'}`);
  console.log(`health SHA       : ${healthSha ?? '(none)'}`);
  console.log(`web/worker seen  : ${containerDigestsObserved}`);
  console.log(`status           : ${status}`);
  for (const problem of problems) console.log(`  - ${problem}`);

  // Setting exitCode rather than calling process.exit(): fetch leaves undici handles
  // closing, and exiting on top of them trips a libuv assertion on Windows
  // ("!(handle->flags & UV_HANDLE_CLOSING)") which reports 127 — a crash dressed up as
  // a verdict. Letting the loop drain returns the status this script actually decided.
  process.exitCode = status === 'PASS' ? 0 : 1;
}

// Importing this module must not verify anything: the parser below is unit-tested, and a
// test run that silently probed production would be a surprising thing for `vitest` to do.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 5;
  });
}
