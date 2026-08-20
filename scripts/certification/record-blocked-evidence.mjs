#!/usr/bin/env node
/**
 * Records the things that genuinely could not be done, bound to the frozen candidate.
 *
 * An honest blocker is acceptable; fabricated evidence is a certification failure. These
 * records exist so that a gap is *visible* in the manifest rather than merely absent — the
 * validator counts a missing record and a blocked one very differently from a passing one,
 * and the certificate reports both.
 *
 * Re-run after a re-freeze: evidence is bound to a candidate SHA, and a record carrying a
 * superseded SHA satisfies nothing.
 *
 *   node scripts/certification/record-blocked-evidence.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { CONFIG_PATH, EVIDENCE_DIR } from './lib/paths.mjs';

const BLOCKED = [
  {
    evidenceId: 'EV-DR-RPO',
    kind: 'dr-rpo',
    command: 'gcloud sql instances describe telestar-crm-db --project=telestar-crm-final',
    status: 'BLOCKED_EXTERNAL',
    exitCode: 127,
    environment: 'certification workstation - gcloud CLI not installed',
    metrics: {
      reason:
        'gcloud is not installed on this machine, so the live Cloud SQL backup configuration cannot be inspected.',
      rpoSeconds: null,
      priorPublishedValueWithdrawn:
        '15 minutes (BACKUP_RESTORE.md) and under 5 minutes (BACKUP_RESTORE_RUNBOOK.md) - neither was measured',
      contradiction:
        'docs/CLOUD_RUN_DEPLOY.md creates the instance with --no-backup and docs/DEPLOY.md records no backup schedule as of 2026-08-05, while docs/BACKUP_RESTORE_RUNBOOK.md claims automated backups and 7-day PITR are enabled',
      defect: 'TEL-P0-002',
      closesWhen:
        'raw gcloud output for backupConfiguration.enabled, pointInTimeRecoveryEnabled and transactionLogRetentionDays is attached as an artifact',
    },
  },
  {
    evidenceId: 'EV-DR-ROLLBACK',
    kind: 'dr-rollback',
    command: '(not executed) rollback between two immutable image digests',
    status: 'NOT_EXECUTED',
    exitCode: 127,
    environment: 'certification workstation - no container runtime installed',
    metrics: {
      reason:
        'docker is not installed on this machine, so no image has been built and no digest exists to roll between.',
      rollbackSeconds: null,
      priorPublishedValueWithdrawn: '38 seconds - never measured',
      defect: 'TEL-P1-018',
      closesWhen:
        'a controlled rollback records candidate digest, previous digest, command, start, finish, web health, worker health, schema compatibility, and redeployment of the candidate',
    },
  },
];

function main() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  if (!config.candidateSha) {
    console.error('No candidate SHA is frozen; freeze one before binding evidence to it.');
    process.exit(2);
  }

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const now = new Date().toISOString();

  for (const entry of BLOCKED) {
    const record = {
      evidenceId: entry.evidenceId,
      kind: entry.kind,
      candidateSha: config.candidateSha,
      environment: entry.environment,
      command: entry.command,
      startedAt: now,
      finishedAt: now,
      exitCode: entry.exitCode,
      status: entry.status,
      metrics: entry.metrics,
      artifacts: [],
    };
    writeFileSync(
      path.join(EVIDENCE_DIR, `${entry.evidenceId}.json`),
      `${JSON.stringify(record, null, 2)}\n`,
    );
    console.log(`${entry.evidenceId}: ${entry.status} — ${entry.metrics.reason}`);
  }
}

main();
