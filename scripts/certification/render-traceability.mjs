#!/usr/bin/env node
/**
 * Renders REQUIREMENT_TRACEABILITY.md from the requirement registry and the evidence
 * manifest.
 *
 * The previous document carried a hand-typed `VERIFIED` in every one of its 108 rows. That
 * is the exact failure this program exists to remove: a status column nobody computed, that
 * could never disagree with reality because nothing checked it.
 *
 * Status here is whatever `validate-certification.mjs` computes, and each unverified row
 * carries the reason it is unverified. When a requirement is not VERIFIED the document says
 * so, in the row, with the blocking reason attached.
 *
 *   node scripts/certification/render-traceability.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { CERT_DIR } from './lib/paths.mjs';
import { validateCertification } from './validate-certification.mjs';

function escapePipes(text) {
  return String(text).replace(/\|/g, '\\|');
}

function claimSummary(claim) {
  if (claim.kind === 'vitest') return `\`${claim.testFile}\``;
  if (claim.kind === 'role-browser') return `browser: ${claim.role}`;
  if (claim.kind === 'load-benchmark') return `load: ${claim.scale} rows`;
  if (claim.kind === 'certification-run') return `run ${claim.run}`;
  if (claim.kind === 'dr-restore' && claim.metric) return `dr-restore (${claim.metric})`;
  return claim.kind;
}

function main() {
  const result = validateCertification();
  const registry = JSON.parse(readFileSync(path.join(CERT_DIR, 'requirements.json'), 'utf8'));
  const byId = new Map(registry.requirements.map((requirement) => [requirement.id, requirement]));

  const domains = registry.domains;
  const grouped = new Map();
  for (const requirement of result.resolved) {
    if (!grouped.has(requirement.domain)) grouped.set(requirement.domain, []);
    grouped.get(requirement.domain).push(requirement);
  }

  const summaryRows = [...grouped.entries()].map(([code, requirements]) => {
    const verified = requirements.filter((entry) => entry.status === 'VERIFIED').length;
    return `| **${domains[code] ?? code}** | \`${code}\` | ${requirements.length} | ${verified} | ${requirements.length - verified} |`;
  });

  const sections = [...grouped.entries()].map(([code, requirements]) => {
    const rows = requirements.map((requirement) => {
      const source = byId.get(requirement.id);
      const evidence = source.evidence.map(claimSummary).join('<br>');
      const status = requirement.status === 'VERIFIED' ? '**VERIFIED**' : 'NOT_VERIFIED';
      const reason =
        requirement.status === 'VERIFIED' ? '—' : escapePipes(requirement.blockingReasons[0] ?? '');
      const defects = source.linkedDefects.length
        ? source.linkedDefects.map((defect) => `\`${defect}\``).join(', ')
        : '—';
      return `| \`${requirement.id}\` | ${escapePipes(requirement.description)} | ${requirement.severity} | ${evidence} | ${status} | ${reason} | ${defects} |`;
    });

    return [
      `### ${domains[code] ?? code} (\`${code}\` — ${requirements.length})`,
      '',
      '| ID | Requirement | Sev | Evidence claims | Status | Why not verified | Defects |',
      '|---|---|---|---|---|---|---|',
      ...rows,
      '',
    ].join('\n');
  });

  const body = `# Telestar CRM — Requirement Traceability

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/requirements.json + evidence/
  Regenerate: node scripts/certification/render-traceability.mjs
-->

**Candidate SHA**: ${result.candidateSha ? `\`${result.candidateSha}\`` : '*(not frozen)*'}
**Verified**: ${result.requirements.verified} / ${result.requirements.total}
**Verdict**: ${result.verdict}

> Status in this document is **computed**, never asserted. \`requirements.json\` has no status
> field to write one into, and a row reads VERIFIED only when every evidence claim it declares
> resolves against a record bound to the current candidate SHA. Where the evidence does not
> support it, the row says why.

---

## 1. Summary by domain

| Domain | Code | Total | Verified | Not verified |
|---|---|---:|---:|---:|
${summaryRows.join('\n')}
| **TOTAL** | | **${result.requirements.total}** | **${result.requirements.verified}** | **${result.requirements.notVerified}** |

---

## 2. Requirements

${sections.join('\n')}`;

  writeFileSync(path.join(CERT_DIR, 'REQUIREMENT_TRACEABILITY.md'), body);
  console.log(
    `rendered REQUIREMENT_TRACEABILITY.md — ${result.requirements.verified}/${result.requirements.total} verified`,
  );
}

main();
