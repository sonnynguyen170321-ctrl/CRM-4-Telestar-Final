#!/usr/bin/env node
/**
 * Renders EVIDENCE.md from the evidence manifest (TEL-P2-014).
 *
 * The previous ledger declared candidate `cf23182` and totals of 149 files / 1,880 tests
 * while the certificate declared `a6d8c0d` and 154 / 1,922 - and covered only a handful of
 * the active certification domains. It was hand-maintained, so it drifted, and nothing could
 * detect that it had.
 *
 * This lists every evidence record that exists, with its candidate SHA, status, command and
 * hash-verified artifacts. A record cannot appear here without existing, and cannot disappear
 * from here while it exists.
 *
 *   node scripts/certification/render-evidence-ledger.mjs
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { CERT_DIR, EVIDENCE_DIR } from './lib/paths.mjs';
import { validateCertification } from './validate-certification.mjs';

/** Every certification domain that must be represented, and which record covers it. */
const DOMAINS = [
  ['Static analysis', ['gate']],
  ['Production build', ['gate']],
  ['Database integrity', ['gate']],
  ['Unit and integration tests', ['vitest']],
  ['Redis integration', ['redis-integration']],
  ['Import load — handler', ['load-benchmark']],
  ['Import load — real queue', ['load-benchmark']],
  ['Six-role browser acceptance', ['role-browser']],
  ['Disaster recovery — backup', ['dr-backup']],
  ['Disaster recovery — restore', ['dr-restore']],
  ['Disaster recovery — integrity control', ['dr-negative-control']],
  ['Disaster recovery — RPO', ['dr-rpo']],
  ['Rollback', ['dr-rollback']],
  ['Release identity', ['release-identity']],
  ['Certification runs', ['certification-run']],
];

function loadRecords() {
  if (!existsSync(EVIDENCE_DIR)) return [];
  return readdirSync(EVIDENCE_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(readFileSync(path.join(EVIDENCE_DIR, file), 'utf8')))
    .sort((a, b) => String(a.evidenceId).localeCompare(String(b.evidenceId)));
}

function statusBadge(status) {
  if (status === 'PASS') return '**PASS**';
  if (status === 'BLOCKED_EXTERNAL') return 'BLOCKED_EXTERNAL';
  if (status === 'NOT_EXECUTED') return 'NOT_EXECUTED';
  return `**${status}**`;
}

function main() {
  const result = validateCertification();
  const records = loadRecords();
  const byKind = new Map();
  for (const record of records) {
    if (!byKind.has(record.kind)) byKind.set(record.kind, []);
    byKind.get(record.kind).push(record);
  }

  const coverage = DOMAINS.map(([domain, kinds]) => {
    const present = kinds.some((kind) => (byKind.get(kind) ?? []).length > 0);
    const covering = kinds
      .flatMap((kind) => byKind.get(kind) ?? [])
      .map((record) => `\`${record.evidenceId}\``)
      .join(', ');
    return `| ${domain} | ${present ? covering : '**no evidence**'} |`;
  });

  const rows = records.map((record) => {
    const sha = record.candidateSha ? `\`${String(record.candidateSha).slice(0, 7)}\`` : '—';
    const stale = result.candidateSha && record.candidateSha !== result.candidateSha ? ' ⚠' : '';
    return (
      `| \`${record.evidenceId}\` | \`${record.kind}\` | ${sha}${stale} | ${statusBadge(record.status)} | ` +
      `${record.exitCode} | ${record.artifacts?.length ?? 0} |`
    );
  });

  const detail = records
    .map((record) => {
      const artifacts = (record.artifacts ?? [])
        .map(
          (artifact) =>
            `  - \`${artifact.path}\` — ${artifact.sizeBytes} bytes, sha256 \`${artifact.sha256.slice(0, 16)}…\``,
        )
        .join('\n');

      return [
        `### \`${record.evidenceId}\``,
        '',
        `- **Kind**: \`${record.kind}\``,
        `- **Candidate**: ${record.candidateSha ? `\`${record.candidateSha}\`` : '—'}`,
        `- **Environment**: ${record.environment}`,
        `- **Command**: \`${record.command}\``,
        `- **Ran**: ${record.startedAt} → ${record.finishedAt}`,
        `- **Exit code**: ${record.exitCode} · **Status**: ${statusBadge(record.status)}`,
        record.metrics?.reason ? `- **Reason**: ${record.metrics.reason}` : null,
        record.metrics?.note ? `- **Note**: ${record.metrics.note}` : null,
        artifacts ? `- **Artifacts**:\n${artifacts}` : '- **Artifacts**: none',
        '',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  const body = `# Telestar CRM — Master Evidence Ledger

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/evidence/
  Regenerate: node scripts/certification/render-evidence-ledger.mjs
-->

**Candidate SHA**: ${result.candidateSha ? `\`${result.candidateSha}\`` : '*(not frozen)*'}
**Evidence records**: ${records.length}
**Requirements verified**: ${result.requirements.verified} / ${result.requirements.total}
**Verdict**: ${result.verdict}

> This ledger is generated. The previous one was maintained by hand and drifted: it declared
> a candidate SHA and test totals that the certificate contradicted, and nothing could detect
> that it had. A record cannot appear here without existing, and cannot vanish while it does.
>
> A ⚠ marks a record produced against a **superseded** candidate. Such a record does not
> satisfy any requirement — the validator only resolves evidence bound to the current
> candidate — and must be regenerated.

---

## 1. Domain coverage

| Certification domain | Evidence |
|---|---|
${coverage.join('\n')}

---

## 2. All records

| Evidence ID | Kind | Candidate | Status | Exit | Artifacts |
|---|---|---|---|---:|---:|
${rows.join('\n')}

---

## 3. Record detail

${detail}
---

## 4. Raw output

Every artifact above lives under \`evidence/raw/\` and is re-hashed on each validation run.
A drifted or missing artifact fails checks \`G\`/\`H\`. Raw logs are captured while the command
runs — never reconstructed afterwards, because a reconstructed log is a fabricated one.
`;

  writeFileSync(path.join(CERT_DIR, 'EVIDENCE.md'), body);
  console.log(`rendered EVIDENCE.md — ${records.length} record(s)`);
}

main();
