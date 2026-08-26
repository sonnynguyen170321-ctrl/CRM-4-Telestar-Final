#!/usr/bin/env node
/**
 * Probes the live deployment and records what it answered (TEL-P1-052).
 *
 * EV-DEPLOYED-STATE existed before this script did. Nothing produced it: it was
 * written by hand, it claimed `deployedSha` 9b2b44c and `deployedMatchesCandidate`
 * true, and the artifact it cited was a health probe returning c7bf639 from the day
 * before. Its timestamps — 21:50:00.000Z to 21:50:01.000Z — were typed. The claim
 * happened to be true; the evidence attached to it was not evidence of it.
 *
 * So this script does not accept the deployed SHA as an argument. It asks the
 * deployment, writes down what came back, and compares that to the frozen candidate.
 * The operator cannot tell it the answer.
 *
 *   node scripts/certification/record-deployed-state.mjs [--url <health url>]
 *
 * Exits non-zero when the deployment is unreachable, answers with something other
 * than a health document, or reports a SHA that is not the candidate. A deployment
 * running the wrong release is the finding, so it must not be recordable as a PASS.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { CONFIG_PATH, EVIDENCE_DIR, RAW_DIR, repoRelative } from './lib/paths.mjs';
import { readFileSync } from 'node:fs';

const DEFAULT_URL = 'https://crm.telestar.cloud/api/health';
const SHA_RE = /^[0-9a-f]{40}$/;
const TIMEOUT_MS = 30_000;

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

async function main() {
  const url = arg('url', DEFAULT_URL);
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const candidateSha = config.candidateSha;

  if (!SHA_RE.test(candidateSha ?? '')) {
    console.error('certification.config.json has no frozen candidate SHA to compare against.');
    process.exit(2);
  }

  const startedAt = new Date().toISOString();
  let body = '';
  let httpStatus = 0;
  let transportError = null;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    httpStatus = response.status;
    body = await response.text();
  } catch (error) {
    transportError = error instanceof Error ? error.message : String(error);
  }
  const finishedAt = new Date().toISOString();

  if (transportError !== null) {
    console.error(`Deployment unreachable at ${url}: ${transportError}`);
    console.error('BLOCKED_EXTERNAL is not a pass. Nothing recorded.');
    process.exit(3);
  }

  // The raw response is the artifact. Whatever this script concludes, the next
  // reader can re-derive it from the bytes the deployment actually sent.
  mkdirSync(RAW_DIR, { recursive: true });
  const artifactPath = path.join(RAW_DIR, 'deployed-health-probe.log');
  const artifactBody = body.endsWith('\n') ? body : `${body}\n`;
  writeFileSync(artifactPath, artifactBody);
  const sha256 = createHash('sha256').update(artifactBody).digest('hex');

  let health = null;
  try {
    health = JSON.parse(body);
  } catch {
    console.error(`Health endpoint did not answer with JSON (HTTP ${httpStatus}).`);
    process.exit(4);
  }

  const deployedSha = health.commit ?? health.version ?? null;
  const matches = deployedSha === candidateSha;

  const record = {
    evidenceId: 'EV-DEPLOYED-STATE',
    kind: 'deployed-state',
    candidateSha,
    environment: `read-only probe of ${url} from the certification workstation`,
    command: `node scripts/certification/record-deployed-state.mjs --url ${url}`,
    startedAt,
    finishedAt,
    exitCode: matches ? 0 : 1,
    status: matches ? 'PASS' : 'FAIL',
    metrics: {
      url,
      httpStatus,
      reachable: true,
      ok: health.ok === true,
      schema: health.schema ?? null,
      deployedSha,
      deployedBuiltAt: health.builtAt ?? null,
      candidateSha,
      deployedMatchesCandidate: matches,
    },
    artifacts: [
      {
        path: repoRelative(artifactPath),
        sizeBytes: Buffer.byteLength(artifactBody),
        sha256,
      },
    ],
  };

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(
    path.join(EVIDENCE_DIR, 'EV-DEPLOYED-STATE.json'),
    `${JSON.stringify(record, null, 2)}\n`,
  );

  console.log(`probed        : ${url}`);
  console.log(`http status   : ${httpStatus}`);
  console.log(`deployed SHA  : ${deployedSha}`);
  console.log(`candidate SHA : ${candidateSha}`);
  console.log(`schema        : ${health.schema ?? '(absent)'}`);
  console.log(`built at      : ${health.builtAt ?? '(absent)'}`);
  console.log(`artifact      : ${repoRelative(artifactPath)}  sha256 ${sha256.slice(0, 16)}…`);
  console.log(`status        : ${record.status}`);

  if (!matches) {
    console.error('');
    console.error('The deployment is not running the frozen candidate. Recorded as FAIL.');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(5);
});
