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
 *     [--web sha256:…] [--worker sha256:…]
 *
 * WHAT IT CANNOT SEE. Whether the running web and worker containers were started from
 * that digest is a question only the deployment host can answer, and this workstation has
 * no access to it. Those two fields are recorded as observed only when the caller supplies
 * them AND says where they came from; otherwise they are left null and the chain is
 * incomplete, which is the truth. A chain that reports itself complete on four links out
 * of six is the failure this replaces.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { CONFIG_PATH, EVIDENCE_DIR, RAW_DIR, repoRelative } from './lib/paths.mjs';

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

async function main() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const candidateSha = config.candidateSha;
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
  const webDigest = arg('web');
  const workerDigest = arg('worker');

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

  // ── 4. the two links this machine cannot see ─────────────────────────────
  const containerDigestsObserved = Boolean(webDigest && workerDigest);
  if (!containerDigestsObserved) {
    problems.push(
      'web and worker container digests were not observed: only the deployment host can report ' +
        'which digest each running container was started from, and this workstation has no access to it',
    );
  } else {
    for (const [label, digest] of [['web', webDigest], ['worker', workerDigest]]) {
      if (!DIGEST_RE.test(digest)) problems.push(`--${label} is not a sha256: digest`);
      else if (digest !== imageDigest) problems.push(`${label} digest differs from the image digest`);
    }
  }

  const finishedAt = new Date().toISOString();
  const status = problems.length === 0 ? 'PASS' : 'FAIL';

  const record = {
    evidenceId: 'EV-RELEASE-IDENTITY',
    kind: 'release-identity',
    candidateSha,
    environment: 'read-only observation from the certification workstation: container registry, GitHub API, live health endpoint',
    command: `node scripts/certification/verify-release-identity.mjs --image ${imageDigest}${ciRunId ? ` --ci-run ${ciRunId}` : ''} --url ${url}`,
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
      webDigest: containerDigestsObserved ? webDigest : null,
      workerDigest: containerDigestsObserved ? workerDigest : null,
      containerDigestsObserved,
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 5;
});
