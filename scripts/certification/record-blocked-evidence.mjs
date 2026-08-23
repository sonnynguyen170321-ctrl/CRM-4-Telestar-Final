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

import { CONFIG_PATH, EVIDENCE_DIR, RAW_DIR } from './lib/paths.mjs';
import { runCommand } from './lib/exec.mjs';
import { RPO_OUTCOME, probeRpo } from './lib/rpoProbe.mjs';
import { containerRuntime } from './lib/imageGates.mjs';

const SQL_INSTANCE = process.env.DEPLOY_SQL_INSTANCE || 'telestar-db';
const SQL_PROJECT = process.env.DEPLOY_SQL_PROJECT || 'telestar-crm-final';

const shell = runCommand;

/**
 * A blocker must be observed, never asserted.
 *
 * `EV-DR-ROLLBACK` was a constant here declaring "docker is not installed on this machine".
 * True when written, false by 2026-08-23 — docker 29.7.2 builds the candidate image in gates 19
 * and 20 of every ladder run. A constant cannot notice it has expired, so the record went on
 * reporting a blocker that no longer existed.
 *
 * That is the same defect `probeRpo` was added to fix for gcloud, in the sibling record of this
 * same file. Fixing one constant and leaving the other is precisely why this one went stale
 * unnoticed: a partial fix to a class of defect leaves the unfixed half looking maintained.
 *
 * So this asks `containerRuntime` — the probe gates 19 and 20 already use — rather than keeping
 * a second, staler opinion about the same machine.
 */
function buildBlockedRecords(shell) {
  const runtime = containerRuntime(shell);
  const reason = runtime
    ? `a container runtime is available (${runtime.command} ${runtime.version}), so this is not ` +
      'blocked on tooling. The drill has simply not been run against the frozen candidate: run ' +
      'scripts/certification/dr-rollback-drill.mjs on the deployment host, passing both ' +
      '--candidate-digest and --previous-digest explicitly.'
    : 'no container runtime answers on this machine (docker/podman), so no image can be built ' +
      'and no digest exists to roll between.';

  return [
    {
      evidenceId: 'EV-DR-ROLLBACK',
      kind: 'dr-rollback',
      command: '(not executed) rollback between two immutable image digests',
      status: 'NOT_EXECUTED',
      exitCode: 127,
      environment: runtime
        ? `certification workstation - ${runtime.command} ${runtime.version}`
        : 'certification workstation - no container runtime installed',
      metrics: {
        reason,
        rollbackSeconds: null,
        priorPublishedValueWithdrawn: '38 seconds - never measured',
        defect: 'TEL-P1-018',
        closesWhen:
          'a controlled rollback records candidate digest, previous digest, command, start, finish, web health, worker health, schema compatibility, and redeployment of the candidate',
      },
    },
  ];
}

/**
 * Refuse to overwrite a record that was actually executed.
 *
 * Every record written from here states that something did NOT happen. If a real run already
 * produced one, replacing it destroys the only proof of that run and substitutes a claim that is
 * false. `EV-DR-ROLLBACK` on disk carried a genuine PASS — real candidate and previous digests,
 * rollbackSeconds 35.39, restoreSeconds 25.79 — and re-running this script would have replaced it
 * with exitCode 127 and "no container runtime installed".
 *
 * A blocked record is an upgrade over nothing. It is never an upgrade over evidence.
 */
function executedRecordAt(filePath) {
  let existing;
  try {
    existing = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
  return existing.status === 'PASS' || existing.status === 'FAIL' ? existing : null;
}

function main() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  if (!config.candidateSha) {
    console.error('No candidate SHA is frozen; freeze one before binding evidence to it.');
    process.exit(2);
  }

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const now = new Date().toISOString();

  let refused = 0;
  for (const entry of buildBlockedRecords(shell)) {
    const target = path.join(EVIDENCE_DIR, `${entry.evidenceId}.json`);
    const real = executedRecordAt(target);
    if (real) {
      refused += 1;
      console.error(
        `${entry.evidenceId}: REFUSING to overwrite — on disk is ${real.status} for candidate ` +
          `${String(real.candidateSha).slice(0, 7)}. Writing NOT_EXECUTED here would destroy real ` +
          'evidence and replace it with a false statement. Re-run the drill instead.',
      );
      continue;
    }
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
    writeFileSync(target, `${JSON.stringify(record, null, 2)}
`);
    console.log(`${entry.evidenceId}: ${entry.status} — ${entry.metrics.reason}`);
  }

  writeRpoEvidence(config.candidateSha, now);

  if (refused > 0) {
    console.error(`
${refused} record(s) left untouched because real evidence already exists.`);
    process.exitCode = 3;
  }
}

/**
 * `EV-DR-RPO` used to be one of the constants above, permanently asserting that gcloud was not
 * installed. It now asks. Where the answer arrives, this is real evidence and DR-007 can pass;
 * where it does not, the record says precisely which door is shut — install, login, or scope —
 * because those need three different actions from three different people.
 */
function writeRpoEvidence(candidateSha, now) {
  const probe = probeRpo(shell, { instance: SQL_INSTANCE, project: SQL_PROJECT });
  const measured = probe.outcome === RPO_OUTCOME.MEASURED;
  const artifacts = [];

  if (probe.raw) {
    mkdirSync(RAW_DIR, { recursive: true });
    const rawPath = path.join(RAW_DIR, 'dr-rpo-gcloud.log');
    writeFileSync(rawPath, `${probe.raw}\n`);
    artifacts.push(path.relative(path.join(EVIDENCE_DIR, '..'), rawPath).split(path.sep).join('/'));
  }

  const record = {
    evidenceId: 'EV-DR-RPO',
    kind: 'dr-rpo',
    candidateSha,
    environment: `certification workstation - gcloud probe outcome ${probe.outcome}`,
    command: `gcloud sql instances describe ${SQL_INSTANCE} --project=${SQL_PROJECT} --format=json`,
    startedAt: now,
    finishedAt: new Date().toISOString(),
    exitCode: measured ? 0 : 127,
    status: measured ? 'PASS' : 'BLOCKED_EXTERNAL',
    metrics: {
      outcome: probe.outcome,
      reason: probe.reason,
      rpoSeconds: probe.rpoSeconds ?? null,
      rpoBound: probe.bound ?? null,
      databaseVersion: probe.databaseVersion ?? null,
      backupConfiguration: probe.backupConfiguration ?? null,
      priorPublishedValueWithdrawn:
        '15 minutes (BACKUP_RESTORE.md) and under 5 minutes (BACKUP_RESTORE_RUNBOOK.md) - neither was measured',
      contradiction:
        'docs/CLOUD_RUN_DEPLOY.md creates the instance with --no-backup and docs/DEPLOY.md records no backup schedule as of 2026-08-05, while docs/BACKUP_RESTORE_RUNBOOK.md claims automated backups and 7-day PITR are enabled',
      defect: 'TEL-P0-002',
      closesWhen:
        'raw gcloud output for backupConfiguration.enabled, pointInTimeRecoveryEnabled and transactionLogRetentionDays is attached as an artifact',
    },
    artifacts,
  };

  writeFileSync(path.join(EVIDENCE_DIR, 'EV-DR-RPO.json'), `${JSON.stringify(record, null, 2)}\n`);
  console.log(`EV-DR-RPO: ${record.status} — ${probe.reason}`);
}

main();
