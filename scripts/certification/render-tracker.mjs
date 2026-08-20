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
import path from 'node:path';

import { CERT_DIR, PROGRESS_PATH } from './lib/paths.mjs';
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

function main() {
  const result = validateCertification();
  const defects = defectSummary();

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
    verdict: result.verdict,
    eligible: result.eligible,
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
  };
  writeFileSync(PROGRESS_PATH, `${JSON.stringify(progress, null, 2)}\n`);

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

**Verdict**: **${result.verdict}**
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

  writeFileSync(path.join(CERT_DIR, 'MASTER_TRACKER.md'), body);
  console.log(
    `rendered MASTER_TRACKER.md + progress.json — ${result.requirements.verified}/${result.requirements.total} verified, verdict ${result.verdict}`,
  );
}

main();
