#!/usr/bin/env node
/**
 * Negative control for scripts/verify-db-integrity.ts.
 *
 * A verification script that always exits 0 is indistinguishable from no verification at
 * all, and that is precisely the failure mode TEL-P0-001 was about. This deliberately
 * breaks a database in three specific ways and asserts the integrity script FAILS each
 * time - and passes once the damage is repaired.
 *
 * Everything happens in a throwaway database created and dropped by this script. It never
 * touches the source or development database.
 *
 *   node scripts/certification/dr-negative-fixture.mjs --candidate <40-char sha>
 *
 * Exit code is non-zero if the integrity script fails to detect any injected fault.
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
const FIXTURE_DB = 'telestar_dr_negative_fixture';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

function pgTool(name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const candidate = path.join(PG_BIN, exe);
  return existsSync(candidate) ? candidate : name;
}

function psql(database, sql) {
  return spawnSync(pgTool('psql'), ['-h', PGHOST, '-p', PGPORT, '-U', PGUSER, '-d', database, '-v', 'ON_ERROR_STOP=1', '-tAc', sql], {
    encoding: 'utf8',
    env: { ...process.env, PGPASSWORD },
  });
}

function verifyIntegrity(database, extraEnv = {}) {
  const result = spawnSync(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'scripts/verify-db-integrity.ts'],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        DATABASE_URL: `postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${database}`,
        ...extraEnv,
      },
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  return { exitCode: result.status, output: `${result.stdout || ''}${result.stderr || ''}` };
}

const transcript = [];
function record(title, detail) {
  transcript.push(`\n### ${title}\n${detail}`);
  console.log(`  ${title}`);
}

async function main() {
  const candidateSha = arg('candidate');
  if (!candidateSha || !/^[0-9a-f]{40}$/.test(candidateSha)) {
    console.error('--candidate <40-char commit sha> is required');
    process.exit(2);
  }

  mkdirSync(RAW_DIR, { recursive: true });
  const cases = [];
  const startedAt = new Date().toISOString();

  // Always start from a clean slate.
  spawnSync(pgTool('dropdb'), ['-h', PGHOST, '-p', PGPORT, '-U', PGUSER, '--if-exists', FIXTURE_DB], {
    encoding: 'utf8',
    env: { ...process.env, PGPASSWORD },
  });
  const created = spawnSync(pgTool('createdb'), ['-h', PGHOST, '-p', PGPORT, '-U', PGUSER, FIXTURE_DB], {
    encoding: 'utf8',
    env: { ...process.env, PGPASSWORD },
  });
  if (created.status !== 0) {
    console.error(`createdb failed: ${created.stderr}`);
    process.exit(1);
  }

  try {
    // ---- Case 1: an empty database. A restore that silently produced nothing. ----
    console.log('[case 1] empty database (no tables at all)');
    const empty = verifyIntegrity(FIXTURE_DB);
    const case1Detected = empty.exitCode !== 0 && /missing table/.test(empty.output);
    cases.push({ name: 'empty-database', expected: 'FAIL', detected: case1Detected, exitCode: empty.exitCode });
    record('case 1', `exit ${empty.exitCode}; detected=${case1Detected}`);
    transcript.push(empty.output);

    // ---- Apply the real schema so the remaining cases start from a sound database. ----
    console.log('[setup ] applying migrations to the fixture');
    const migrate = spawnSync(
      process.execPath,
      ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          DATABASE_URL: `postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${FIXTURE_DB}`,
          DIRECT_URL: `postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${FIXTURE_DB}`,
        },
        maxBuffer: 32 * 1024 * 1024,
      },
    );
    if (migrate.status !== 0) {
      console.error(`migrate deploy failed:\n${migrate.stdout}\n${migrate.stderr}`);
      process.exit(1);
    }

    const healthy = verifyIntegrity(FIXTURE_DB);
    cases.push({
      name: 'migrated-database-baseline',
      expected: 'PASS',
      detected: healthy.exitCode === 0,
      exitCode: healthy.exitCode,
    });
    record('baseline', `migrated fixture verifies clean: exit ${healthy.exitCode}`);
    if (healthy.exitCode !== 0) {
      transcript.push(healthy.output);
      console.error('baseline fixture did not verify clean; the negative control is inconclusive');
      process.exit(1);
    }

    // ---- Case 2: an orphaned foreign key, written with FK enforcement bypassed. ----
    // session_replication_role = replica is exactly how a bad restore loads data
    // without validating constraints, so this reproduces the real failure mode.
    console.log('[case 2] orphaned foreign key row');
    const orphan = psql(
      FIXTURE_DB,
      `SET session_replication_role = replica;
       INSERT INTO "Client" (id, "tenantId", name, industry, "contactName", "contactEmail", "createdAt", "updatedAt")
       VALUES ('dr-neg-client', 'tenant-that-does-not-exist', 'Orphan Client', 'QA', 'DR Negative Control', 'dr-negative@example.invalid', NOW(), NOW());`,
    );
    if (orphan.status !== 0) {
      record('case 2 setup', `could not inject orphan: ${orphan.stderr.trim()}`);
      cases.push({ name: 'orphaned-foreign-key', expected: 'FAIL', detected: null, skipped: true });
    } else {
      const broken = verifyIntegrity(FIXTURE_DB);
      const detected = broken.exitCode !== 0 && /no matching/.test(broken.output);
      cases.push({ name: 'orphaned-foreign-key', expected: 'FAIL', detected, exitCode: broken.exitCode });
      record('case 2', `exit ${broken.exitCode}; detected=${detected}`);
      transcript.push(broken.output);

      psql(FIXTURE_DB, `SET session_replication_role = replica; DELETE FROM "Client" WHERE id = 'dr-neg-client';`);
    }

    // ---- Case 4: a verifier that RLS has blinded. ----
    //
    // Every other case here breaks the DATA and asks whether the verifier notices. This one
    // leaves the data intact and breaks the VERIFIER'S VIEW of it, which is the failure this
    // fixture most needs to cover and the only one that produces a clean, empty, wrong PASS.
    //
    // The policies in supabase/rls.sql are role-targeted, so `app.bypass_rls` grants the
    // application role nothing. A tool connecting through DATABASE_URL with DB_RLS_ENFORCED=true
    // and no maintenance DSN therefore reads zero rows from every table — and zero orphaned
    // foreign keys, zero null tenantIds, zero of everything the other cases look for. It would
    // report PASS on a database it cannot see. `prod-certify.mjs` would certify an empty result.
    //
    // `createAdminClient` guards that with `assertRlsContract()`. Nothing exercised the guard
    // from here, so this asserts the guard fires rather than trusting that it exists: a guard
    // no test drives is indistinguishable from a guard that was refactored away.
    //
    // Run before case 3, which drops a table and leaves the fixture genuinely broken.
    console.log('[case 4] RLS-blinded verifier');
    const blinded = verifyIntegrity(FIXTURE_DB, {
      DB_RLS_ENFORCED: 'true',
      CRM_MAINTENANCE_URL: '',
    });
    {
      const detected =
        blinded.exitCode !== 0 && /CRM_MAINTENANCE_URL is not set/.test(blinded.output);
      cases.push({
        name: 'rls-blinded-verifier',
        expected: 'FAIL',
        detected,
        exitCode: blinded.exitCode,
      });
      record('case 4', `exit ${blinded.exitCode}; detected=${detected}`);
      transcript.push(blinded.output);
    }

    // ---- Case 3: a dropped table. A partial restore. ----
    console.log('[case 3] dropped table');
    const dropped = psql(FIXTURE_DB, `DROP TABLE IF EXISTS "Activity" CASCADE;`);
    if (dropped.status !== 0) {
      record('case 3 setup', `could not drop table: ${dropped.stderr.trim()}`);
      cases.push({ name: 'dropped-table', expected: 'FAIL', detected: null, skipped: true });
    } else {
      const broken = verifyIntegrity(FIXTURE_DB);
      const detected = broken.exitCode !== 0 && /missing table "Activity"/.test(broken.output);
      cases.push({ name: 'dropped-table', expected: 'FAIL', detected, exitCode: broken.exitCode });
      record('case 3', `exit ${broken.exitCode}; detected=${detected}`);
      transcript.push(broken.output);
    }
  } finally {
    spawnSync(pgTool('dropdb'), ['-h', PGHOST, '-p', PGPORT, '-U', PGUSER, '--if-exists', FIXTURE_DB], {
      encoding: 'utf8',
      env: { ...process.env, PGPASSWORD },
    });
  }

  const finishedAt = new Date().toISOString();
  const undetected = cases.filter((entry) => !entry.skipped && entry.detected !== true);
  const logPath = path.join(RAW_DIR, 'dr-negative-fixture.log');
  writeFileSync(
    logPath,
    [
      '# verify-db-integrity.ts negative control',
      `# startedAt: ${startedAt}`,
      `# finishedAt: ${finishedAt}`,
      `# cases: ${JSON.stringify(cases, null, 2)}`,
      ...transcript,
    ].join('\n'),
  );

  const record_ = {
    evidenceId: 'EV-DR-NEGATIVE-CONTROL',
    kind: 'dr-negative-control',
    candidateSha,
    environment: `${process.platform} / node ${process.versions.node} / postgres 16`,
    command: 'node scripts/certification/dr-negative-fixture.mjs',
    startedAt,
    finishedAt,
    exitCode: undetected.length === 0 ? 0 : 1,
    status: undetected.length === 0 ? 'PASS' : 'FAIL',
    metrics: {
      note: 'Proves verify-db-integrity.ts is not a rubber stamp: it fails on deliberately broken databases and passes on a sound one.',
      cases,
      faultsInjected: cases.filter((entry) => entry.expected === 'FAIL' && !entry.skipped).length,
      faultsDetected: cases.filter((entry) => entry.expected === 'FAIL' && entry.detected === true).length,
    },
    artifacts: [
      {
        path: repoRelative(logPath),
        sizeBytes: statSync(logPath).size,
        sha256: createHash('sha256').update(readFileSync(logPath)).digest('hex'),
      },
    ],
  };

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(
    path.join(EVIDENCE_DIR, 'EV-DR-NEGATIVE-CONTROL.json'),
    `${JSON.stringify(record_, null, 2)}\n`,
  );

  console.log('');
  console.log(`RESULT: ${undetected.length === 0 ? 'PASS' : 'FAIL'}`);
  for (const entry of cases) {
    const verdict = entry.skipped ? 'SKIPPED' : entry.detected ? 'detected' : 'NOT DETECTED';
    console.log(`  ${entry.name.padEnd(28)} expected ${entry.expected.padEnd(4)} ${verdict}`);
  }
  process.exit(undetected.length === 0 ? 0 : 1);
}

void main();
