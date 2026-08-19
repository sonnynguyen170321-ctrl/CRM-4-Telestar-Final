#!/usr/bin/env node
/**
 * Disaster recovery drill: backup, checksum, isolated restore, integrity verification.
 *
 * This exists because the previous DR evidence was authored rather than measured - it
 * documented a 48.2 MB dump whose SHA-256 was the digest of an empty file, and a
 * verification script that did not exist (TEL-P0-001). Every number this script reports
 * is observed, and every raw log it references is written while the command runs.
 *
 * It never touches the source database beyond reading it, and never drops a database it
 * did not create in this run.
 *
 * Usage:
 *   node scripts/certification/dr-drill.mjs --source telestar_crm --candidate <40-char sha>
 *   node scripts/certification/dr-drill.mjs --source telestar_crm --candidate <sha> --keep
 *
 * Exit code is non-zero if any stage fails.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { EVIDENCE_DIR, RAW_DIR, REPO_ROOT, repoRelative } from './lib/paths.mjs';

const PG_BIN = process.env.PG_BIN || 'C:/Program Files/PostgreSQL/16/bin';
const PGHOST = process.env.PGHOST || '127.0.0.1';
const PGPORT = process.env.PGPORT || '5432';
const PGUSER = process.env.PGUSER || 'postgres';
const PGPASSWORD = process.env.PGPASSWORD || 'postgres';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function pgTool(name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const candidate = path.join(PG_BIN, exe);
  return existsSync(candidate) ? candidate : name;
}

function run(label, command, args, logPath, { env: extraEnv = {}, cwd } = {}) {
  const startedAt = new Date();
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    cwd: cwd || REPO_ROOT,
    env: { ...process.env, PGPASSWORD, ...extraEnv },
    maxBuffer: 64 * 1024 * 1024,
  });
  const finishedAt = new Date();
  const body = [
    `# ${label}`,
    `# command: ${command} ${args.join(' ')}`,
    `# startedAt: ${startedAt.toISOString()}`,
    `# finishedAt: ${finishedAt.toISOString()}`,
    `# exitCode: ${result.status}`,
    '',
    '--- stdout ---',
    result.stdout || '(empty)',
    '--- stderr ---',
    result.stderr || '(empty)',
    '',
  ].join('\n');
  writeFileSync(logPath, body);

  return {
    label,
    command: `${command} ${args.join(' ')}`,
    exitCode: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt - startedAt,
    log: repoRelative(logPath),
  };
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function artifact(file) {
  return { path: repoRelative(file), sizeBytes: statSync(file).size, sha256: sha256(file) };
}

function fail(message) {
  console.error(`\nDR DRILL FAILED: ${message}`);
  process.exit(1);
}

async function main() {
  const source = arg('source', 'telestar_crm');
  const candidateSha = arg('candidate');
  const keep = process.argv.includes('--keep');

  if (!candidateSha || !/^[0-9a-f]{40}$/.test(candidateSha)) {
    fail('--candidate <40-char commit sha> is required so the evidence is bound to a candidate');
  }

  mkdirSync(RAW_DIR, { recursive: true });
  const backupDir = path.join(REPO_ROOT, '.dr-artifacts');
  mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = `telestar_dr_drill_${stamp.slice(0, 19).replace(/-/g, '')}`.toLowerCase().slice(0, 60);
  const dumpFile = path.join(backupDir, `telestar_${stamp}.dump`);
  const checksumFile = `${dumpFile}.sha256`;
  const countsFile = path.join(backupDir, `counts-${stamp}.json`);

  const stages = [];
  const sourceUrl = `postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${source}`;
  const targetUrl = `postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${target}`;

  console.log(`source database : ${source}`);
  console.log(`restore target  : ${target}`);
  console.log(`backup artifact : ${repoRelative(dumpFile)}`);
  console.log('');

  // 1. Pre-backup record counts - the reconciliation baseline.
  console.log('[1/6] capturing pre-backup record counts');
  const preCounts = run(
    'pre-backup record counts',
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'scripts/verify-db-integrity.ts', '--json'],
    path.join(RAW_DIR, 'dr-pre-backup-counts.log'),
    { env: { DATABASE_URL: sourceUrl } },
  );
  stages.push(preCounts);
  if (preCounts.exitCode !== 0) fail('source database failed its own integrity check before backup');

  const preReport = JSON.parse(preCounts.stdout.slice(preCounts.stdout.indexOf('{')));
  writeFileSync(countsFile, JSON.stringify(preReport.counts, null, 2));
  console.log(`      ${Object.keys(preReport.counts).length} models counted`);

  // 2. Real backup.
  console.log('[2/6] running pg_dump');
  const dump = run(
    'pg_dump',
    pgTool('pg_dump'),
    ['-h', PGHOST, '-p', PGPORT, '-U', PGUSER, '-d', source, '--format=custom', '--no-owner', '--no-acl', '--file', dumpFile],
    path.join(RAW_DIR, 'dr-backup-command.log'),
  );
  stages.push(dump);
  if (dump.exitCode !== 0) fail(`pg_dump exited ${dump.exitCode}`);
  if (!existsSync(dumpFile) || statSync(dumpFile).size === 0) fail('pg_dump produced an empty artifact');

  const backupSizeBytes = statSync(dumpFile).size;
  const backupSha256 = sha256(dumpFile);
  writeFileSync(checksumFile, `${backupSha256}  ${path.basename(dumpFile)}\n`);
  console.log(`      ${(backupSizeBytes / 1_048_576).toFixed(2)} MB, sha256 ${backupSha256.slice(0, 16)}...`);

  // 3. Independent checksum verification.
  console.log('[3/6] verifying checksum with sha256sum -c');
  // sha256sum resolves the filename in the checksum file relative to its own cwd,
  // so it runs from the artifact directory.
  const checksum = run(
    'sha256sum -c',
    'sha256sum',
    ['-c', path.basename(checksumFile)],
    path.join(RAW_DIR, 'dr-backup-sha256.log'),
    { cwd: backupDir },
  );
  stages.push(checksum);
  if (checksum.exitCode !== 0) {
    fail(`checksum verification failed: ${checksum.stderr || checksum.stdout}`);
  }
  console.log('      checksum OK');

  // 4. Isolated restore, measured.
  console.log('[4/6] creating isolated target and restoring');
  const create = run(
    'createdb',
    pgTool('createdb'),
    ['-h', PGHOST, '-p', PGPORT, '-U', PGUSER, target],
    path.join(RAW_DIR, 'dr-createdb.log'),
  );
  stages.push(create);
  if (create.exitCode !== 0) fail(`createdb exited ${create.exitCode}`);

  const restoreStartedAt = Date.now();
  const restore = run(
    'pg_restore',
    pgTool('pg_restore'),
    ['-h', PGHOST, '-p', PGPORT, '-U', PGUSER, '-d', target, '--no-owner', '--no-acl', '--exit-on-error', dumpFile],
    path.join(RAW_DIR, 'dr-restore-command.log'),
  );
  stages.push(restore);
  const restoreFinishedAt = Date.now();
  if (restore.exitCode !== 0) fail(`pg_restore exited ${restore.exitCode} - see the raw log`);

  // 5. Integrity verification of the RESTORED database, reconciled against the baseline.
  console.log('[5/6] verifying restored database integrity');
  const verify = run(
    'verify-db-integrity',
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'scripts/verify-db-integrity.ts', '--json', '--expect-counts', countsFile],
    path.join(RAW_DIR, 'dr-restore-integrity.log'),
    { env: { DATABASE_URL: targetUrl } },
  );
  stages.push(verify);
  const integrityCheckPassed = verify.exitCode === 0;
  const rtoSeconds = Number(((restoreFinishedAt - restoreStartedAt) / 1000).toFixed(2));
  console.log(`      integrity ${integrityCheckPassed ? 'PASS' : 'FAIL'}, restore took ${rtoSeconds}s`);

  // 6. Evidence record.
  console.log('[6/6] writing evidence records');
  const environment = `${process.platform} / node ${process.versions.node} / postgres 16 / source ${source}`;

  const rawArtifacts = stages.map((stage) => artifact(path.join(REPO_ROOT, stage.log)));

  const backupRecord = {
    evidenceId: 'EV-DR-BACKUP',
    kind: 'dr-backup',
    candidateSha,
    environment,
    command: dump.command,
    startedAt: dump.startedAt,
    finishedAt: dump.finishedAt,
    exitCode: dump.exitCode,
    status: 'PASS',
    metrics: {
      sourceDatabase: source,
      backupArtifact: repoRelative(dumpFile),
      backupSizeBytes,
      backupSha256,
      checksumVerified: true,
      checksumCommand: 'sha256sum -c',
      backupDurationSeconds: Number((dump.durationMs / 1000).toFixed(2)),
      preBackupCounts: preReport.counts,
    },
    artifacts: rawArtifacts.filter((entry) => /backup|counts/.test(entry.path)),
  };

  const restoreRecord = {
    evidenceId: 'EV-DR-RESTORE',
    kind: 'dr-restore',
    candidateSha,
    environment,
    command: restore.command,
    startedAt: restore.startedAt,
    finishedAt: restore.finishedAt,
    exitCode: restore.exitCode,
    status: integrityCheckPassed ? 'PASS' : 'FAIL',
    metrics: {
      targetDatabase: target,
      backupArtifact: repoRelative(dumpFile),
      backupSha256,
      rtoSeconds,
      rtoMeasuredFrom: 'pg_restore invocation to pg_restore exit',
      integrityCheckPassed,
      integrityCommand: verify.command,
      countsReconciled: integrityCheckPassed,
      restoredCounts: integrityCheckPassed
        ? JSON.parse(verify.stdout.slice(verify.stdout.indexOf('{'))).counts
        : null,
    },
    artifacts: rawArtifacts.filter((entry) => /restore|createdb/.test(entry.path)),
  };

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(path.join(EVIDENCE_DIR, 'EV-DR-BACKUP.json'), `${JSON.stringify(backupRecord, null, 2)}\n`);
  writeFileSync(path.join(EVIDENCE_DIR, 'EV-DR-RESTORE.json'), `${JSON.stringify(restoreRecord, null, 2)}\n`);

  if (!keep) {
    run('dropdb', pgTool('dropdb'), ['-h', PGHOST, '-p', PGPORT, '-U', PGUSER, target], path.join(RAW_DIR, 'dr-dropdb.log'));
    console.log(`      dropped isolated target ${target}`);
  }

  console.log('');
  console.log(`RESULT: ${integrityCheckPassed ? 'PASS' : 'FAIL'}`);
  console.log(`  backup   ${(backupSizeBytes / 1_048_576).toFixed(2)} MB  sha256 ${backupSha256}`);
  console.log(`  RTO      ${rtoSeconds}s (measured)`);
  process.exit(integrityCheckPassed ? 0 : 1);
}

void main();
