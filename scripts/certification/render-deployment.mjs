#!/usr/bin/env node
/**
 * Renders DEPLOYMENT.md from the release-identity evidence record (TEL-P1-018).
 *
 * The release chain was previously asserted at source-SHA level only: there was no image
 * digest, no web digest, no worker digest, no health SHA and no CI run id anywhere. "We
 * deployed the candidate" was a belief, not a verifiable fact.
 *
 * This document is generated so it cannot claim a digest that no record contains. Where a
 * value has not been established it says so, and gives the command that would establish it.
 *
 *   node scripts/certification/render-deployment.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { CERT_DIR, CONFIG_PATH, EVIDENCE_DIR } from './lib/paths.mjs';

function loadRecord(evidenceId) {
  const file = path.join(EVIDENCE_DIR, `${evidenceId}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

function field(label, value, howTo) {
  const established = value !== undefined && value !== null && value !== '';
  return `| ${label} | ${established ? `\`${value}\`` : '**not established**'} | ${established ? '—' : howTo} |`;
}

function main() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const identity = loadRecord('EV-RELEASE-IDENTITY');
  const rollback = loadRecord('EV-DR-ROLLBACK');
  const metrics = identity?.metrics ?? {};

  const complete = Boolean(
    metrics.imageDigest && metrics.webDigest && metrics.workerDigest && metrics.healthSha && metrics.ciRunId,
  );

  const body = `# Telestar CRM — Deployment & Release Identity

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/evidence/EV-RELEASE-IDENTITY.json
  Regenerate: node scripts/certification/render-deployment.mjs
-->

**Requirement**: \`REL-001\`
**Defect**: \`TEL-P1-018\`
**Chain status**: ${complete ? '**COMPLETE**' : '**INCOMPLETE — see §2**'}
**Candidate SHA**: ${config.candidateSha ? `\`${config.candidateSha}\`` : '*(not frozen)*'}
**Release tag**: \`${config.releaseTag}\`

---

## 1. Why this document exists

A release is only traceable if every link is recorded: the source commit, the image built
from it **by digest**, the digests actually running as web and worker, and the SHA the
deployed application reports about itself. Certifying \`latest\`, \`main\`, or any floating tag
certifies whatever that tag pointed at when someone looked.

The previous certification asserted the chain at source-SHA level and stopped there. Nothing
tied the tested source to a built artefact, and nothing tied that artefact to what was
running.

## 2. The chain

| Link | Value | How to establish it |
|---|---|---|
${field('APPLICATION_SOURCE_SHA', config.candidateSha, 'freeze the candidate in `certification.config.json`')}
${field('CI_RUN_ID', metrics.ciRunId, '`gh run list --commit <sha> --json databaseId,conclusion,workflowName`')}
${field('IMAGE_DIGEST', metrics.imageDigest, '`docker buildx build --push` then `docker buildx imagetools inspect <ref>`')}
${field('WEB_DIGEST', metrics.webDigest, '`docker inspect --format {{index .RepoDigests 0}} <web container>`')}
${field('WORKER_DIGEST', metrics.workerDigest, '`docker inspect --format {{index .RepoDigests 0}} <worker container>`')}
${field('HEALTH_SHA', metrics.healthSha, '`curl -s https://<host>/api/health` and read the release SHA it reports')}
${field('Deployment timestamp', metrics.deployedAt, 'recorded by the deploy step')}
${field('Migration set', metrics.migrationCount, '`prisma migrate status` against the deployed database')}

${
  complete
    ? `## 3. Identity assertions

- \`APPLICATION_SOURCE_SHA == HEALTH_SHA\` — ${metrics.healthSha === config.candidateSha ? '**holds**' : '**FAILS**'}
- \`IMAGE_DIGEST == WEB_DIGEST\` — ${metrics.imageDigest === metrics.webDigest ? '**holds**' : '**FAILS**'}
- \`IMAGE_DIGEST == WORKER_DIGEST\` — ${metrics.imageDigest === metrics.workerDigest ? '**holds**' : metrics.separateImagesIntentional ? 'separate images, declared intentional' : '**FAILS**'}`
    : `## 3. Why the chain is incomplete

No container runtime is available on the certification workstation, so no image has been
built and no digest exists to record. This is a genuine external blocker, not an oversight,
and it is recorded as \`BLOCKED_EXTERNAL\` rather than omitted: the certificate reports the
chain as unestablished and the verdict cannot reach GO while \`REL-001\` is unverified.

To complete it, on a host with a container runtime and access to the registry:

\`\`\`bash
# 1. Build from the frozen candidate, and push by digest.
git checkout ${config.candidateSha ?? '<candidate-sha>'}
docker buildx build --platform linux/amd64 -t <registry>/telestar-crm:${config.releaseTag} --push .
IMAGE_DIGEST=$(docker buildx imagetools inspect <registry>/telestar-crm:${config.releaseTag} \\
  --format '{{json .Manifest.Digest}}')

# 2. Deploy that digest - never the tag.
#    Web and worker run the same image unless separateImagesIntentional is declared.

# 3. Read back what is actually running.
docker inspect --format '{{index .RepoDigests 0}}' <web container>
docker inspect --format '{{index .RepoDigests 0}}' <worker container>
curl -s https://<host>/api/health

# 4. Record it.
node scripts/certification/record-release-identity.mjs \\
  --candidate ${config.candidateSha ?? '<candidate-sha>'} \\
  --ci-run <run-id> --image <digest> --web <digest> --worker <digest> --health-sha <sha>
\`\`\``
}

## 4. Rollback

${
  rollback && rollback.status === 'PASS'
    ? `Executed. Rolled from \`${rollback.metrics?.candidateDigest}\` to \`${rollback.metrics?.previousDigest}\` in ${rollback.metrics?.rollbackSeconds}s.`
    : `**${rollback?.status ?? 'NOT_EXECUTED'}** — ${rollback?.metrics?.reason ?? 'no rollback evidence record exists'}

A rollback drill needs two immutable image digests to move between, so it is blocked by the
same gap as §2. The previously published "38 seconds" is withdrawn: it was never measured.`
}

## 5. Post-deployment gate

Not yet applicable — nothing has been deployed from a frozen candidate. When it is, the gate
is: DNS, TLS, login, health, Postgres, Redis, worker heartbeat, migration state, release SHA,
image digest; the six-role smoke; the golden workflow smoke; email safe mode confirmed; no
stuck queue jobs; no new fatal errors in logs.

No secret values appear in this document, by construction: the generator only ever reads
digests, identifiers and timestamps.
`;

  writeFileSync(path.join(CERT_DIR, 'DEPLOYMENT.md'), body);
  console.log(`rendered DEPLOYMENT.md — chain ${complete ? 'COMPLETE' : 'INCOMPLETE'}`);
}

main();
