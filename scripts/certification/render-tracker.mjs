#!/usr/bin/env node
/**
 * Renders MASTER_TRACKER.md and progress.json from computed state.
 *
 * Both were hand-maintained and both drifted: the tracker declared 108/108 VERIFIED and
 * CERTIFIED_APPROVED, and progress.json agreed with it, because each was typed to match the
 * other rather than derived from anything. Two documents agreeing proves only that someone
 * copied a number.
 *
 *   node scripts/certification/render-tracker.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { CERT_DIR, PROGRESS_PATH, RELEASE_IDENTITY_PATH } from './lib/paths.mjs';
import { validateCertification } from './validate-certification.mjs';

/** Counts unclosed defects straight out of DEFECTS.md, by severity. */
function defectSummary() {
  const file = path.join(CERT_DIR, 'DEFECTS.md');
  if (!existsSync(file)) return { open: [], counts: { P0: 0, P1: 0, P2: 0, P3: 0 } };

  const text = readFileSync(file, 'utf8');
  const open = [];
  const re = /### `(TEL-P\d-\d+)`[\s\S]*?- \*\*Status\*\*: `([A-Z_]+)`/g;
  for (const match of text.matchAll(re)) {
    const [, id, status] = match;
    if (status !== 'VERIFIED') open.push({ id, status });
  }

  const counts = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const entry of open) {
    const severity = entry.id.split('-')[1];
    if (counts[severity] !== undefined) counts[severity] += 1;
  }
  return { open, counts };
}

/**
 * Assemble the identities that must all name the same release, and say which SHA each one
 * actually belongs to.
 *
 * Every fact here already existed — in `EV-CI-RUN`, in `EV-RELEASE-IDENTITY`, in git — but only
 * separately, so nothing compared them. That is how the repository came to hold three documents
 * claiming to be current while naming three disjoint sets of SHAs, and how a certificate could
 * be assembled from a CI run for one commit, an image built from a second and a deployment
 * serving a third.
 *
 * `matchesCandidate` is computed, never typed. A `false` here is the honest state of the
 * release, not a defect in this file: at the time of writing the deployed commit and the CI run
 * both predate the candidate, and that is exactly what a reader needs to see.
 */
function releaseIdentity(candidateSha) {
  const readEvidence = (id) => {
    const file = path.join(CERT_DIR, 'evidence', `${id}.json`);
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  };

  const gitSha = (ref) => {
    const result = spawnSync('git', ['rev-parse', ref], { encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : null;
  };

  const ci = readEvidence('EV-CI-RUN');
  const identity = readEvidence('EV-RELEASE-IDENTITY');

  const belongsTo = (sha) => ({
    matchesCandidate: Boolean(sha && candidateSha && sha === candidateSha),
  });

  return {
    $comment:
      'Every identity that must name the same release. matchesCandidate is computed; a false ' +
      'value is a fact about the release, not an error in this file.',
    candidateSha: candidateSha ?? null,
    repository: {
      mainSha: gitSha('origin/main'),
      localHeadSha: gitSha('HEAD'),
    },
    ci: ci
      ? {
          runId: ci.metrics?.runId ?? null,
          headSha: ci.metrics?.headSha ?? null,
          conclusion: ci.metrics?.conclusion ?? null,
          ...belongsTo(ci.metrics?.headSha),
        }
      : null,
    image: identity
      ? {
          digest: identity.metrics?.imageDigest ?? null,
          builtFromSha: identity.candidateSha ?? null,
          ...belongsTo(identity.candidateSha),
        }
      : null,
    deployment: identity
      ? {
          healthSha: identity.metrics?.healthSha ?? null,
          webDigest: identity.metrics?.webDigest ?? null,
          workerDigest: identity.metrics?.workerDigest ?? null,
          deployedAt: identity.metrics?.deployedAt ?? null,
          digestsAgree:
            Boolean(identity.metrics?.webDigest) &&
            identity.metrics?.webDigest === identity.metrics?.workerDigest,
          ...belongsTo(identity.metrics?.healthSha),
        }
      : null,
  };
}

function main() {
  const result = validateCertification();
  const defects = defectSummary();

  // One verdict engine (directive section 14). See generate-certificate.mjs for
  // why stripping VERDICT_MISMATCH here was the exclusion the directive forbids.
  const eligible = result.eligible;
  const verdict = eligible ? 'GO' : 'NO-GO';

  const failuresByCheck = new Map();
  for (const finding of result.findings.filter((entry) => entry.severity === 'FAIL')) {
    failuresByCheck.set(finding.check, (failuresByCheck.get(finding.check) ?? 0) + 1);
  }

  const progress = {
    $comment:
      'GENERATED FILE. Regenerate with node scripts/certification/render-tracker.mjs. Counts are computed by the validator from the evidence manifest; nothing here is typed.',
    program: 'Telestar Production Certification',
    candidateSourceSha: result.candidateSha,
    releaseTag: result.releaseTag,
    generatedAt: new Date().toISOString(),
    verdict,
    eligible,
    requirements: {
      total: result.requirements.total,
      verified: result.requirements.verified,
      notVerified: result.requirements.notVerified,
      byDomain: result.requirements.byDomain,
    },
    defects: {
      open: defects.open.length,
      openP0: defects.counts.P0,
      openP1: defects.counts.P1,
      openP2: defects.counts.P2,
      openP3: defects.counts.P3,
      ids: defects.open,
    },
    evidenceRecords: result.evidenceRecordCount,
    validationFailures: Object.fromEntries(failuresByCheck),
    releaseIdentity: 'release-identity.json',
  };
  writeFileSync(PROGRESS_PATH, `${JSON.stringify(progress, null, 2)}\n`);

  // Written separately because it names SHAs that are deliberately NOT the candidate. See
  // RELEASE_IDENTITY_PATH in lib/paths.mjs for why that cannot live in a declaring file.
  writeFileSync(
    RELEASE_IDENTITY_PATH,
    `${JSON.stringify(releaseIdentity(result.candidateSha), null, 2)}\n`,
  );

  const domainRows = Object.entries(result.requirements.byDomain)
    .map(([domain, counts]) => `| \`${domain}\` | ${counts.total} | ${counts.verified} | ${counts.total - counts.verified} |`)
    .join('\n');

  const blockerRows = [...failuresByCheck.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([check, count]) => `| \`${check}\` | ${count} |`)
    .join('\n');

  const body = `# Telestar CRM — Master Certification Tracker

<!--
  GENERATED FILE. Do not edit by hand.
  Source: computed by npm run certify:validate
  Regenerate: node scripts/certification/render-tracker.mjs
-->

**Verdict**: **${verdict}**
**Candidate SHA**: ${result.candidateSha ? `\`${result.candidateSha}\`` : '*(not frozen)*'}
**Requirements verified**: ${result.requirements.verified} / ${result.requirements.total}
**Evidence records**: ${result.evidenceRecordCount}
**Generated**: ${progress.generatedAt}

> This file and \`progress.json\` are rendered from the same computation. They used to be
> maintained by hand, and both said 108/108 VERIFIED and CERTIFIED_APPROVED — which proved
> only that the numbers had been copied from one to the other.

---

## 1. Requirements by domain

| Domain | Total | Verified | Not verified |
|---|---:|---:|---:|
${domainRows}
| **TOTAL** | **${result.requirements.total}** | **${result.requirements.verified}** | **${result.requirements.notVerified}** |

Detail, with the blocking reason on every unverified row:
[REQUIREMENT_TRACEABILITY.md](REQUIREMENT_TRACEABILITY.md).

## 2. Open defects

| Severity | Open |
|---|---:|
| P0 | ${defects.counts.P0} |
| P1 | ${defects.counts.P1} |
| P2 | ${defects.counts.P2} |
| P3 | ${defects.counts.P3} |
| **Total** | **${defects.open.length}** |

${defects.open.map((entry) => `- \`${entry.id}\` — ${entry.status}`).join('\n') || '_None._'}

## 3. What the validator is currently reporting

${
  blockerRows
    ? `| Check | Failures |
|---|---:|
${blockerRows}

Check meanings are in [PROTOCOL.md](PROTOCOL.md) §6.`
    : '_No validation failures. Every consistency check passes._'
}

## 4. Document map

| Document | Generated from |
|---|---|
| [FINAL_CERTIFICATE.md](FINAL_CERTIFICATE.md) | evidence manifest + validator |
| [REQUIREMENT_TRACEABILITY.md](REQUIREMENT_TRACEABILITY.md) | \`requirements.json\` + evidence |
| [EVIDENCE.md](EVIDENCE.md) | \`evidence/*.json\` |
| [LOAD_TEST.md](LOAD_TEST.md) | \`EV-LOAD-HANDLER\`, \`EV-LOAD-QUEUE\` |
| [ROLE_BROWSER_EVIDENCE.md](ROLE_BROWSER_EVIDENCE.md) | \`EV-ROLE-BROWSER\` |
| [DEPLOYMENT.md](DEPLOYMENT.md) | \`EV-RELEASE-IDENTITY\` |
| [runs/RUN_N.md](runs/) | \`runs/manifests/run-N.json\` |
| [DEFECTS.md](DEFECTS.md) | hand-maintained — the one narrative document |
| [PROTOCOL.md](PROTOCOL.md) | hand-maintained — the rules themselves |
`;

  // The classification is emitted by the generator, never stamped by hand. A generated file
  // carrying a hand-added header loses it on the next render — the same defect that let a
  // hand-redacted evidence artifact be republished in full.
  const frontMatter = `---
classification: GENERATED
note: |
  Generated by scripts/certification/render-tracker.mjs from evidence and
  certification.config.json. Do not hand-edit: the next render overwrites it. Verdict and
  requirement counts are computed, never asserted.
generatedAt: ${new Date().toISOString()}
---

`;

  writeFileSync(path.join(CERT_DIR, 'MASTER_TRACKER.md'), frontMatter + body);
  console.log(
    `rendered MASTER_TRACKER.md + progress.json — ${result.requirements.verified}/${result.requirements.total} verified, verdict ${result.verdict}`,
  );
}

main();
