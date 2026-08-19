#!/usr/bin/env node
/**
 * Generates FINAL_CERTIFICATE.md from the evidence manifest.
 *
 * The certificate is no longer written by hand. The generator computes eligibility from the
 * same validator that gates everything else, and emits either
 *
 *   GO — READY FOR TELESTAR INTERNAL LAUNCH
 *
 * or
 *
 *   NO-GO — BLOCKERS REMAIN
 *
 * There is no third verdict. "Essentially ready", "99%", "certified except" and "done
 * locally" are not outcomes this program can express, which is the point: the previous
 * certificate reached APPROVED because a person typed it.
 *
 *   node scripts/certification/generate-certificate.mjs
 */
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { CERTIFICATE_PATH, CERT_DIR, EVIDENCE_DIR } from './lib/paths.mjs';
import { validateCertification } from './validate-certification.mjs';

function loadRecord(evidenceId) {
  const file = path.join(EVIDENCE_DIR, `${evidenceId}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

function loadAll() {
  if (!existsSync(EVIDENCE_DIR)) return [];
  return readdirSync(EVIDENCE_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(readFileSync(path.join(EVIDENCE_DIR, file), 'utf8')));
}

function value(record, pathParts, fallback = 'not established') {
  let current = record;
  for (const part of pathParts) {
    if (current === null || current === undefined) return fallback;
    current = current[part];
  }
  return current === null || current === undefined ? fallback : current;
}

function openDefects() {
  const defectsPath = path.join(CERT_DIR, 'DEFECTS.md');
  if (!existsSync(defectsPath)) return { counts: {}, ids: [] };
  const text = readFileSync(defectsPath, 'utf8');

  const ids = [];
  const sectionRe = /### `(TEL-P\d-\d+)`[\s\S]*?- \*\*Status\*\*: `([A-Z_]+)`/g;
  for (const match of text.matchAll(sectionRe)) {
    const [, id, status] = match;
    if (status !== 'VERIFIED') ids.push({ id, status });
  }

  const counts = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const entry of ids) {
    const severity = entry.id.split('-')[1];
    if (counts[severity] !== undefined) counts[severity] += 1;
  }
  return { counts, ids };
}

function line(label, text) {
  return `| ${label} | ${text} |`;
}

function main() {
  const result = validateCertification();
  const records = loadAll();
  const defects = openDefects();

  const vitest = loadRecord('EV-VITEST');
  const redis = loadRecord('EV-REDIS-INTEGRATION');
  const roles = loadRecord('EV-ROLE-BROWSER');
  const handler = loadRecord('EV-LOAD-HANDLER');
  const queue = loadRecord('EV-LOAD-QUEUE');
  const backup = loadRecord('EV-DR-BACKUP');
  const restore = loadRecord('EV-DR-RESTORE');
  const rpo = loadRecord('EV-DR-RPO');
  const rollback = loadRecord('EV-DR-ROLLBACK');
  const identity = loadRecord('EV-RELEASE-IDENTITY');

  const runs = [1, 2, 3].map((number) => loadRecord(`EV-RUN-${number}`));

  const blockers = result.findings
    .filter((finding) => finding.severity === 'FAIL')
    .reduce((grouped, finding) => {
      if (!grouped.has(finding.check)) grouped.set(finding.check, []);
      grouped.get(finding.check).push(finding.message);
      return grouped;
    }, new Map());

  const verdict = result.eligible
    ? 'GO — READY FOR TELESTAR INTERNAL LAUNCH'
    : 'NO-GO — BLOCKERS REMAIN';

  const queueScales = queue ? Object.values(queue.metrics.scales) : [];
  const handlerScales = handler ? Object.values(handler.metrics.scales) : [];

  const body = `# Telestar CRM — Production Readiness Certificate

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/evidence/ + certification.config.json
  Regenerate: npm run certify:generate
  Eligibility is computed by npm run certify:validate. Nobody types the verdict.
-->

**Verdict**: **${verdict}**
**Generated**: ${new Date().toISOString()}
**Candidate SHA**: ${result.candidateSha ? `\`${result.candidateSha}\`` : '*(not frozen)*'}
**Release tag**: \`${result.releaseTag}\`
**Evidence records**: ${result.evidenceRecordCount}

---

## 1. Release identity

| Field | Value |
|---|---|
${line('APPLICATION_SOURCE_SHA', result.candidateSha ? `\`${result.candidateSha}\`` : '**not frozen**')}
${line('CI_RUN_ID', `\`${value(identity, ['metrics', 'ciRunId'])}\``)}
${line('IMAGE_DIGEST', `\`${value(identity, ['metrics', 'imageDigest'])}\``)}
${line('WEB_DIGEST', `\`${value(identity, ['metrics', 'webDigest'])}\``)}
${line('WORKER_DIGEST', `\`${value(identity, ['metrics', 'workerDigest'])}\``)}
${line('HEALTH_SHA', `\`${value(identity, ['metrics', 'healthSha'])}\``)}

## 2. Test execution

| Measure | Value | Source |
|---|---|---|
${line('Vitest files passed', `${value(vitest, ['metrics', 'testFilesPassed'])} / ${value(vitest, ['metrics', 'testFiles'])}`)} ${vitest ? '| `EV-VITEST` |' : '| — |'}
${line('Vitest tests passed', value(vitest, ['metrics', 'testsPassed']))} ${vitest ? '| `EV-VITEST` |' : '| — |'}
${line('Vitest tests failed', value(vitest, ['metrics', 'testsFailed']))} ${vitest ? '| `EV-VITEST` |' : '| — |'}
${line('Vitest tests skipped', value(vitest, ['metrics', 'testsSkipped']))} ${vitest ? '| `EV-VITEST` |' : '| — |'}
${line('Redis integration executed', String(value(redis, ['metrics', 'executed'], false)))} ${redis ? '| `EV-REDIS-INTEGRATION` |' : '| — |'}
${line('Redis integration skips', value(redis, ['metrics', 'skipped']))} ${redis ? '| `EV-REDIS-INTEGRATION` |' : '| — |'}

All counts are machine-derived from the Vitest JSON reporter. None is typed.

## 3. Six-role browser acceptance

${
  roles
    ? `Status **${roles.status}** — ${roles.metrics.observedRoles.length}/${roles.metrics.requiredRoles.length} roles observed, ${roles.metrics.failingRoles.length} failing.

| Role | Verdict | Console errors | Network failures |
|---|---|---:|---:|
${Object.entries(roles.metrics.roles)
  .map(
    ([role, verdict_]) =>
      `| \`${role}\` | ${verdict_.status} | ${verdict_.consoleErrors} | ${verdict_.networkFailures} |`,
  )
  .join('\n')}

Detail: [ROLE_BROWSER_EVIDENCE.md](ROLE_BROWSER_EVIDENCE.md).`
    : '_No `EV-ROLE-BROWSER` record. Six-role browser acceptance has not been executed._'
}

## 4. Import load

${
  handlerScales.length > 0 || queueScales.length > 0
    ? `Two benchmarks, named for what they exercise. Detail: [LOAD_TEST.md](LOAD_TEST.md).

| Benchmark | Scales | Lost rows | Duplicate rows |
|---|---|---:|---:|
| \`IMPORT_HANDLER_BENCHMARK\` (BullMQ mocked) | ${handlerScales.map((s) => s.batchSize).join(', ') || '—'} | ${handlerScales.reduce((sum, s) => sum + s.lostRows, 0)} | ${handlerScales.reduce((sum, s) => sum + s.duplicateRows, 0)} |
| \`IMPORT_SYSTEM_QUEUE_BENCHMARK\` (real Redis and BullMQ) | ${queueScales.map((s) => s.rows).join(', ') || '—'} | ${queueScales.reduce((sum, s) => sum + s.lostRows, 0)} | ${queueScales.reduce((sum, s) => sum + s.duplicateRows, 0)} |`
    : '_No load evidence records._'
}

## 5. Disaster recovery

| Measure | Value |
|---|---|
${line('Backup artifact size', backup ? `${value(backup, ['metrics', 'backupSizeBytes'])} bytes` : 'not established')}
${line('Backup SHA-256', backup ? `\`${value(backup, ['metrics', 'backupSha256'])}\`` : 'not established')}
${line('Checksum verified', String(value(backup, ['metrics', 'checksumVerified'], false)))}
${line('Restore integrity', String(value(restore, ['metrics', 'integrityCheckPassed'], false)))}
${line('Measured RTO', restore ? `${value(restore, ['metrics', 'rtoSeconds'])} s` : 'not measured')}
${line('RPO', rpo ? `${rpo.status} — ${value(rpo, ['metrics', 'reason'], '')}` : 'not established')}
${line('Rollback drill', rollback ? `${rollback.status} — ${value(rollback, ['metrics', 'reason'], '')}` : 'not executed')}

Detail: [BACKUP_RESTORE.md](BACKUP_RESTORE.md).

## 6. Requirements

**${result.requirements.verified} of ${result.requirements.total} verified.**

| Domain | Verified | Total |
|---|---:|---:|
${Object.entries(result.requirements.byDomain)
  .map(([domain, counts]) => `| \`${domain}\` | ${counts.verified} | ${counts.total} |`)
  .join('\n')}

Status is computed per requirement from the evidence manifest, never asserted. Detail:
[REQUIREMENT_TRACEABILITY.md](REQUIREMENT_TRACEABILITY.md).

## 7. Multi-run qualification

| Run | Status | Failed gates | Missing gates | Mandatory skips |
|---|---|---|---|---:|
${runs
  .map((run, index) =>
    run
      ? `| ${index + 1} | ${run.status} | ${(run.metrics.failedGates ?? []).join(', ') || 'none'} | ${(run.metrics.missingGates ?? []).join(', ') || 'none'} | ${run.metrics.mandatorySkips} |`
      : `| ${index + 1} | **not executed** | — | — | — |`,
  )
  .join('\n')}

## 8. Open defects

| Severity | Open |
|---|---:|
| P0 | ${defects.counts.P0 ?? 0} |
| P1 | ${defects.counts.P1 ?? 0} |
| P2 | ${defects.counts.P2 ?? 0} |
| P3 | ${defects.counts.P3 ?? 0} |

${
  defects.ids.length > 0
    ? `${defects.ids.map((entry) => `- \`${entry.id}\` — ${entry.status}`).join('\n')}`
    : '_No unclosed defects._'
}

Detail: [DEFECTS.md](DEFECTS.md).

## 9. What stands between this and GO

${
  result.eligible
    ? '_Nothing. Every mandatory requirement is verified and every consistency check passes._'
    : [...blockers.entries()]
        .map(([check, messages]) => {
          const shown = messages.slice(0, 6).map((message) => `  - ${message}`);
          const more = messages.length > 6 ? [`  - …and ${messages.length - 6} more`] : [];
          return [`**Check \`${check}\`** — ${messages.length} finding(s)`, ...shown, ...more].join('\n');
        })
        .join('\n\n')
}

---

## 10. Scope of these claims

Every figure above was produced by a command whose raw output is stored under
\`evidence/raw/\` and whose artifacts are hash-verified on every validation run. Where a thing
was not done, this document says it was not done rather than omitting it.

Specifically: no claim is made about behaviour under production traffic, about infrastructure
this workstation cannot reach, or about any scenario not listed in
[REQUIREMENT_TRACEABILITY.md](REQUIREMENT_TRACEABILITY.md). Security findings are scoped to
the specific tests named there — "no cross-tenant access was observed in the cases tested" is
what the evidence supports, and is not the same claim as "the system is secure".

**Verdict: ${verdict}**
`;

  writeFileSync(CERTIFICATE_PATH, body);
  console.log(`FINAL_CERTIFICATE.md generated — ${verdict}`);
  console.log(`requirements ${result.requirements.verified}/${result.requirements.total}, records ${records.length}`);
  process.exit(result.eligible ? 0 : 1);
}

main();
