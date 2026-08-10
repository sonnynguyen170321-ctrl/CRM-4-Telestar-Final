#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectEnv } from './with-env.mjs';

/**
 * Report every environment fact this project depends on, on whichever machine you are sitting at.
 *
 *     npm run doctor
 *
 * ## Why this exists
 *
 * `CLAUDE.md` used to assert machine-specific facts as universal — which Postgres install you
 * have, whether `.env` exists, what the shadow database is called — and it was accurate for
 * whichever machine last edited it and wrong for the other. The file already carries three
 * "an earlier note here claimed X — that was wrong" corrections, all from that.
 *
 * Documentation cannot fix this, because the facts genuinely differ per machine. What fixes it is
 * *checking* rather than asserting. Machine specifics now live in a gitignored
 * `docs/LOCAL_SETUP.md`, and this reports reality in about five seconds.
 *
 * ## Exit code
 *
 * Non-zero only when a **required** check fails. Optional checks warn — a missing `GROQ_API_KEY`
 * should not stop you running the test suite, and a doctor that fails on everything is one people
 * stop running.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PASS = 'PASS';
const WARN = 'WARN';
const FAIL = 'FAIL';

/** Values the app cannot boot or be tested without. */
const REQUIRED_ENV = ['DATABASE_URL', 'DIRECT_URL', 'AUTH_SECRET', 'ENCRYPTION_KEY'];

/** Values that gate a feature but not the app. Absent is a warning, never an error. */
const OPTIONAL_ENV = [
  'REDIS_URL',
  'NEXTAUTH_URL',
  'CRON_SECRET',
  'SHADOW_DATABASE_URL',
  'GROQ_API_KEY',
  'GEMINI_API_KEY',
];

const results = [];
const record = (name, status, detail, fix) => results.push({ name, status, detail, fix });

function run(command, args, env) {
  return spawnSync(command, args, {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
}

/** TCP reachability. Deliberately not a query — this separates "nothing listening" from "bad credentials". */
function probeTcp(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

function parsePostgresUrl(url) {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: Number(parsed.port || 5432),
      database: parsed.pathname.replace(/^\//, ''),
    };
  } catch {
    return null;
  }
}

async function main() {
  const { env, sources } = loadProjectEnv(ROOT);

  // ── Node ────────────────────────────────────────────────────────────────
  const nvmrcPath = path.join(ROOT, '.nvmrc');
  const wanted = existsSync(nvmrcPath) ? readFileSync(nvmrcPath, 'utf8').trim() : null;
  const actualMajor = process.versions.node.split('.')[0];
  if (!wanted) {
    record('node version', WARN, `running ${process.version}, repo pins nothing`, 'add a .nvmrc');
  } else if (actualMajor === wanted.replace(/^v/, '').split('.')[0]) {
    record('node version', PASS, `${process.version} matches .nvmrc (${wanted})`);
  } else {
    record(
      'node version',
      FAIL,
      `running ${process.version}, repo pins ${wanted}`,
      `install Node ${wanted} — CI builds on it, and a version split changes behaviour silently`
    );
  }

  // ── Env files ───────────────────────────────────────────────────────────
  if (sources.length === 0) {
    record(
      'env file',
      FAIL,
      'neither .env.local nor .env found',
      'cp .env.example .env.local, then fill in DATABASE_URL and the rest'
    );
  } else {
    record('env file', PASS, `loaded ${sources.join(' then ')}`);
  }

  const missingRequired = REQUIRED_ENV.filter((key) => !env[key]);
  if (missingRequired.length === 0) {
    record('required env vars', PASS, `all ${REQUIRED_ENV.length} present`);
  } else {
    record(
      'required env vars',
      FAIL,
      `missing ${missingRequired.join(', ')}`,
      'see .env.example — values are never printed here, only presence'
    );
  }

  const missingOptional = OPTIONAL_ENV.filter((key) => !env[key]);
  if (missingOptional.length === 0) {
    record('optional env vars', PASS, 'all present');
  } else {
    record(
      'optional env vars',
      WARN,
      `not set: ${missingOptional.join(', ')}`,
      'each gates one feature (queues, cron, AI, the drift gate) — fine to leave unset'
    );
  }

  // ── Postgres ────────────────────────────────────────────────────────────
  const db = env.DATABASE_URL ? parsePostgresUrl(env.DATABASE_URL) : null;
  if (!db) {
    record('postgres reachable', FAIL, 'DATABASE_URL missing or unparseable', 'set it in .env.local');
  } else if (await probeTcp(db.host, db.port)) {
    record('postgres reachable', PASS, `${db.host}:${db.port} (database "${db.database}")`);
  } else {
    record(
      'postgres reachable',
      FAIL,
      `nothing listening on ${db.host}:${db.port}`,
      'start your Postgres — the how differs per machine, so record yours in docs/LOCAL_SETUP.md'
    );
  }

  // ── Prisma ──────────────────────────────────────────────────────────────
  const clientGenerated = existsSync(path.join(ROOT, 'node_modules', '.prisma', 'client'));
  record(
    'prisma client generated',
    clientGenerated ? PASS : FAIL,
    clientGenerated ? 'node_modules/.prisma/client present' : 'not generated',
    clientGenerated ? undefined : 'npm run db:generate'
  );

  if (db && clientGenerated) {
    const status = run('npx', ['prisma', 'migrate', 'status'], env);
    const out = `${status.stdout ?? ''}${status.stderr ?? ''}`;
    if (out.includes('Database schema is up to date')) {
      const count = /(\d+) migrations? found/.exec(out)?.[1] ?? '?';
      record('migrations applied', PASS, `up to date, ${count} migrations`);
    } else if (out.includes('have not yet been applied')) {
      record('migrations applied', FAIL, 'pending migrations', 'npm run db:deploy');
    } else {
      record('migrations applied', WARN, 'could not determine', 'run npm run db:status by hand');
    }
  }

  // Migration ordering — the fault Prisma produced three times in Phase 6.
  const order = run('node', ['scripts/check-migration-order.mjs', 'origin/main'], env);
  record(
    'migration order',
    order.status === 0 ? PASS : FAIL,
    (order.stdout ?? '').trim().split('\n').at(-1) ?? '',
    order.status === 0 ? undefined : 'rename the migration to sort after the tail'
  );

  // ── Shadow database (the drift gate's dependency) ───────────────────────
  const shadow = env.SHADOW_DATABASE_URL ? parsePostgresUrl(env.SHADOW_DATABASE_URL) : null;
  if (!shadow) {
    record(
      'shadow database',
      WARN,
      'SHADOW_DATABASE_URL not set',
      'needed only for the local drift gate — see docs/LOCAL_SETUP.example.md'
    );
  } else {
    const probe = run(
      'npx',
      ['prisma', 'db', 'execute', '--url', env.SHADOW_DATABASE_URL, '--stdin'],
      { ...env, PRISMA_HIDE_UPDATE_MESSAGE: '1' }
    );
    // `db execute --stdin` with no stdin is an empty script: it connects and does nothing, which
    // is exactly the question being asked.
    record(
      'shadow database',
      probe.status === 0 ? PASS : WARN,
      probe.status === 0
        ? `"${shadow.database}" reachable`
        : `"${shadow.database}" unreachable`,
      probe.status === 0 ? undefined : `CREATE DATABASE ${shadow.database};`
    );
  }

  // ── Redis (optional — BullMQ) ───────────────────────────────────────────
  if (env.REDIS_URL) {
    const redis = parsePostgresUrl(env.REDIS_URL);
    const ok = redis ? await probeTcp(redis.host, redis.port || 6379) : false;
    record(
      'redis reachable',
      ok ? PASS : WARN,
      ok ? `${redis.host}:${redis.port || 6379}` : 'not reachable',
      ok ? undefined : 'only the BullMQ integration test needs it; every other queue suite mocks'
    );
  }

  // ── Line endings ────────────────────────────────────────────────────────
  // Not cosmetic. `core.autocrlf=true` (the Git for Windows default) rewrites committed LF blobs
  // to CRLF on checkout, so one commit yields different bytes per machine. That made
  // `tests/migration-order.test.ts` fail to parse entirely — Vitest's transform met a shebang
  // ending in `\r\n` — while Node imported the same file happily, which sent the diagnosis
  // toward the test runner instead of the checkout.
  const attributesPath = path.join(ROOT, '.gitattributes');
  const hasEolRule =
    existsSync(attributesPath) && /^\*\s+text=auto\s+eol=lf/m.test(readFileSync(attributesPath, 'utf8'));
  const sample = path.join(ROOT, 'scripts', 'check-migration-order.mjs');
  const sampleHasCrlf = existsSync(sample) && readFileSync(sample, 'utf8').includes('\r\n');

  if (hasEolRule && !sampleHasCrlf) {
    record('line endings', PASS, '.gitattributes pins LF and the working tree matches');
  } else if (!hasEolRule) {
    record('line endings', FAIL, '.gitattributes does not pin eol=lf', 'add `* text=auto eol=lf`');
  } else {
    record(
      'line endings',
      FAIL,
      'working tree still has CRLF despite the eol=lf rule',
      'git rm --cached -r . && git reset --hard   (commit or stash your work first)'
    );
  }

  // ── Tooling ─────────────────────────────────────────────────────────────
  const gh = run('gh', ['--version'], env);
  record(
    'gh cli',
    gh.status === 0 ? PASS : WARN,
    gh.status === 0 ? (gh.stdout ?? '').split('\n')[0].trim() : 'not on PATH in this shell',
    gh.status === 0
      ? undefined
      : 'only needed to open or inspect PRs. If you just installed it, open a new terminal — PATH changes do not reach an already-running shell'
  );

  // ── Report ──────────────────────────────────────────────────────────────
  const width = Math.max(...results.map((r) => r.name.length));
  console.log('\nEnvironment doctor\n');
  for (const r of results) {
    console.log(`  ${r.status.padEnd(4)}  ${r.name.padEnd(width)}  ${r.detail}`);
  }

  const failures = results.filter((r) => r.status === FAIL);
  const warnings = results.filter((r) => r.status === WARN);

  const withFixes = [...failures, ...warnings].filter((r) => r.fix);
  if (withFixes.length > 0) {
    console.log('\nFixes:');
    for (const r of withFixes) console.log(`  ${r.name}: ${r.fix}`);
  }

  console.log(
    `\n${results.length} checks — ${results.length - failures.length - warnings.length} pass, ${warnings.length} warn, ${failures.length} fail\n`
  );

  if (failures.length > 0) {
    console.log('Machine-specific setup belongs in docs/LOCAL_SETUP.md (gitignored).');
    console.log('Copy docs/LOCAL_SETUP.example.md and record how *this* machine is wired.\n');
  }

  return failures.length > 0 ? 1 : 0;
}

main().then((code) => process.exit(code));
