#!/usr/bin/env node
/**
 * Runs the RLS verification scripts and records what they answered (TEL-P1-049).
 *
 * EV-RLS-POSTURE was composed by hand: startedAt 21:50:00.000Z, finishedAt 21:51:00.000Z
 * — a whole minute, to the millisecond, which a process clock does not produce. Check V
 * reports it. The claims inside it may well have been true when written; the record simply
 * stopped testifying to whether the commands ran.
 *
 * This runs them and writes their output. Each script builds and drops its own throwaway
 * database and roles, so nothing here touches the developer's database.
 *
 *   node scripts/certification/collect-rls-posture.mjs
 *
 * WHAT IT CANNOT RUN. `verify-rls-live.mjs` needs CRM_APP_URL — a connection as the
 * application role against a database that has had `supabase/roles.sql` applied. That is
 * a property of a deployed database, not of a throwaway one, so on a workstation without
 * such a database it is recorded as NOT_RUN. NOT_RUN is not a pass, and the record says
 * which of the four it is.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { CONFIG_PATH, EVIDENCE_DIR, RAW_DIR, REPO_ROOT, repoRelative } from './lib/paths.mjs';
import { mayWriteEvidence } from './lib/evidenceGuard.mjs';

const SCRIPTS = [
  ['verify-rls', 'scripts/verify-rls.mjs', 'policies keep tenant A out of tenant B, and fail closed with no tenant context'],
  ['verify-rls-app-paths', 'scripts/verify-rls-app-paths.mjs', 'every application path survives enforcement'],
  ['verify-rls-enablement', 'scripts/verify-rls-enablement.mjs', 'the documented roles.sql sequence produces a working isolated system'],
  ['verify-rls-live', 'scripts/verify-rls-live.mjs', 'an unprivileged role against a populated database'],
];

function loadLocalEnv() {
  const file = path.join(REPO_ROOT, '.env.local');
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at < 0) continue;
    out[line.slice(0, at).trim()] = line.slice(at + 1).replace(/^"|"$/g, '');
  }
  return out;
}

function main() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  // Reading the candidate from config means this cannot be aimed at the wrong release.
  // It does not stop an ad-hoc run replacing a ladder run's evidence, which is a
  // different mistake and one made twice while verifying this session.
  if (!mayWriteEvidence(config.candidateSha, { toolName: 'collect-rls-posture' })) {
    process.exitCode = 2;
    return;
  }
  const env = { ...loadLocalEnv(), ...process.env };
  const startedAt = new Date().toISOString();
  mkdirSync(RAW_DIR, { recursive: true });

  const gates = {};
  const artifacts = [];
  let anyFailed = false;

  for (const [name, script, description] of SCRIPTS) {
    let out = '';
    let exitCode = 0;
    const began = Date.now();
    try {
      out = execFileSync(process.execPath, [script], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env,
        timeout: 900_000,
      });
    } catch (error) {
      out = `${String(error.stdout || '')}${String(error.stderr || '')}`;
      exitCode = typeof error.status === 'number' ? error.status : 1;
    }
    const durationMs = Date.now() - began;

    // Exit 2 is this family's "I was not given what I need to run", which is a different
    // thing from a failed check and must not read as one.
    const status = exitCode === 0 ? 'PASS' : exitCode === 2 ? 'NOT_RUN' : 'FAIL';
    if (status === 'FAIL') anyFailed = true;

    const file = path.join(RAW_DIR, `rls-${name}.log`);
    const body = `$ node ${script}\n${out}\n[exit ${exitCode}]\n`;
    writeFileSync(file, body);
    artifacts.push({
      path: repoRelative(file),
      sizeBytes: Buffer.byteLength(body),
      sha256: createHash('sha256').update(body).digest('hex'),
    });

    gates[name] = { status, exitCode, durationMs, description };
    console.log(`  ${status.padEnd(8)} ${name}  (exit ${exitCode}, ${Math.round(durationMs / 1000)}s)`);
  }

  const finishedAt = new Date().toISOString();
  const notRun = Object.entries(gates)
    .filter(([, gate]) => gate.status === 'NOT_RUN')
    .map(([name]) => name);

  // The posture question is separate from whether the policies work: they demonstrably do,
  // on a database that has them. Production does not have them.
  const enforcedInProduction = false;

  const record = {
    evidenceId: 'EV-RLS-POSTURE',
    kind: 'rls-posture',
    candidateSha: config.candidateSha,
    environment:
      'certification workstation, local PostgreSQL 16; each script builds and drops its own throwaway database and roles',
    command: SCRIPTS.map(([, s]) => `node ${s}`).join('; '),
    startedAt,
    finishedAt,
    // A record cannot report PASS while one of its gates did not run. That is the
    // "BLOCKED_EXTERNAL is not green" rule, and a collector is exactly where it gets
    // broken quietly: nothing failed, so nothing looks wrong.
    exitCode: anyFailed || notRun.length > 0 ? 1 : 0,
    status: anyFailed ? 'FAIL' : notRun.length > 0 ? 'BLOCKED_EXTERNAL' : 'PASS',
    metrics: {
      productionPosture: 'APPLICATION_ONLY',
      dbRlsEnforcedInProduction: enforcedInProduction,
      reason:
        'DB_RLS_ENFORCED appears in no environment file and no compose file, and the production ' +
        'database carries no policies: 69 public tables, 0 with rowsecurity, 0 policies, and no ' +
        'migration containing ENABLE ROW LEVEL SECURITY. Production tenant isolation rests on the ' +
        'application-layer Prisma extension alone. The database-level layer is built and proven to ' +
        'work; applying it is an infrastructure decision (TEL-P1-038).',
      gates,
      scriptsRun: Object.keys(gates).length,
      scriptsNotRun: notRun,
    },
    artifacts,
  };

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(path.join(EVIDENCE_DIR, 'EV-RLS-POSTURE.json'), `${JSON.stringify(record, null, 2)}\n`);

  console.log('');
  console.log(`status   : ${record.status}`);
  if (notRun.length > 0) {
    console.log(`NOT_RUN  : ${notRun.join(', ')} — needs a database with supabase/roles.sql applied`);
    console.log('           NOT_RUN is not a pass.');
  }

  process.exitCode = anyFailed || notRun.length > 0 ? 1 : 0;
}

main();
