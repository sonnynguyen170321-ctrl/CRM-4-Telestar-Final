#!/usr/bin/env node
/**
 * Records the release identity chain as evidence (TEL-P1-018).
 *
 * Run on the host that built and deployed the image, because that is the only place the
 * digests actually exist. Every value is supplied by the caller from a real command's output;
 * this script validates their shape and writes the record. It invents nothing.
 *
 *   node scripts/certification/record-release-identity.mjs \
 *     --candidate <40-char sha> --ci-run <id> \
 *     --image sha256:… --web sha256:… --worker sha256:… --health-sha <sha> \
 *     [--separate-images-intentional] [--deployed-at <iso>] [--migrations <count>]
 *
 * Exits non-zero if the chain does not hold, so it cannot record an inconsistent release.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { EVIDENCE_DIR } from './lib/paths.mjs';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const SHA_RE = /^[0-9a-f]{40}$/;

function main() {
  const candidateSha = arg('candidate');
  const ciRunId = arg('ci-run');
  const imageDigest = arg('image');
  const webDigest = arg('web');
  const workerDigest = arg('worker');
  const healthSha = arg('health-sha');
  const deployedAt = arg('deployed-at', new Date().toISOString());
  const migrationCount = arg('migrations');
  const separateImagesIntentional = process.argv.includes('--separate-images-intentional');

  const problems = [];
  if (!SHA_RE.test(candidateSha ?? '')) problems.push('--candidate must be a full 40-character commit SHA');
  if (!ciRunId) problems.push('--ci-run is required; read it from `gh run list`, never invent it');
  for (const [flag, digest] of [
    ['--image', imageDigest],
    ['--web', webDigest],
    ['--worker', workerDigest],
  ]) {
    if (!DIGEST_RE.test(digest ?? '')) {
      problems.push(`${flag} must be a sha256: digest — a floating tag certifies whatever it pointed at`);
    }
  }
  if (!SHA_RE.test(healthSha ?? '')) {
    problems.push('--health-sha must be the full SHA the deployed app reports about itself');
  }

  if (problems.length > 0) {
    console.error('Cannot record release identity:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(2);
  }

  // The chain must actually hold. Recording an inconsistent release would be worse than
  // recording none: it would look like traceability.
  const chainProblems = [];
  if (healthSha !== candidateSha) {
    chainProblems.push(
      `deployed health SHA ${healthSha.slice(0, 7)} is not the candidate ${candidateSha.slice(0, 7)}`,
    );
  }
  if (webDigest !== imageDigest) {
    chainProblems.push('the running web image is not the image built from the candidate');
  }
  if (workerDigest !== imageDigest && !separateImagesIntentional) {
    chainProblems.push(
      'the running worker image differs from the web image; pass --separate-images-intentional if that is the architecture',
    );
  }

  const now = new Date().toISOString();
  const record = {
    evidenceId: 'EV-RELEASE-IDENTITY',
    kind: 'release-identity',
    candidateSha,
    environment: `${process.platform} / node ${process.versions.node} / deploy host`,
    command: 'docker buildx imagetools inspect; docker inspect; curl /api/health',
    startedAt: deployedAt,
    finishedAt: now,
    exitCode: chainProblems.length === 0 ? 0 : 1,
    status: chainProblems.length === 0 ? 'PASS' : 'FAIL',
    metrics: {
      ciRunId,
      imageDigest,
      webDigest,
      workerDigest,
      healthSha,
      deployedAt,
      migrationCount: migrationCount ? Number(migrationCount) : null,
      separateImagesIntentional,
      chainProblems,
    },
    artifacts: [],
  };

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(
    path.join(EVIDENCE_DIR, 'EV-RELEASE-IDENTITY.json'),
    `${JSON.stringify(record, null, 2)}\n`,
  );

  if (chainProblems.length > 0) {
    console.error('Release identity recorded as FAIL:');
    for (const problem of chainProblems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  console.log('EV-RELEASE-IDENTITY: PASS — chain holds');
  console.log(`  candidate ${candidateSha}`);
  console.log(`  image     ${imageDigest}`);
}

main();
