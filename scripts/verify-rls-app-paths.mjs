#!/usr/bin/env node
/**
 * Prove the APPLICATION still works when PostgreSQL is enforcing tenant isolation.
 *
 *     node scripts/verify-rls-app-paths.mjs
 *
 * `scripts/verify-rls.mjs` asks the opposite question. It proves the policies keep tenant A
 * out of tenant B's rows, using hand-written SQL that sets the tenant GUC itself. Every one of
 * its statements therefore arrives with a tenant context, which is precisely the case the
 * application cannot be relied on to produce.
 *
 * Two real code paths never set that context, and neither is reachable by that matrix:
 *
 *   - `lib/client-reports/shareLinks.ts` answers with no session at all, so there is no tenant
 *     to scope to. It holds an unextended client for that reason.
 *   - Every `$queryRaw` / `$executeRaw` call. The extension in `lib/prisma.ts` is
 *     `query.$allModels`, and raw queries are root client operations — structurally outside it.
 *
 * Under FORCE ROW LEVEL SECURITY a statement with no context matches no policy and returns
 * zero rows. It does not raise. So both failures are silent: an empty search result, a share
 * link that reads as revoked, a quota reservation that quietly declines. That is why this has
 * to be measured rather than reasoned about.
 *
 * Exit 0 means every probe in `verify-rls-app-paths.probe.ts` behaved. A non-zero exit names
 * which application path RLS would break.
 *
 * **This script exits 1 today, and that is the accurate answer.** The share-link probes pass;
 * the raw-SQL probe does not, because ~25 raw statements across `lib/ai/budget.ts`,
 * `lib/leadgen/qualification.ts`, `lib/research/cache.ts`, `lib/search/accentSearch.ts` and
 * `workers/email.ts` still run with no tenant context. Fixing that is a design decision rather
 * than a mechanical edit — see `docs/pre-domain-hardening/STATUS.md`, Finding 4 — so this is
 * deliberately NOT a CI gate. It is the gate on turning `DB_RLS_ENFORCED` on: it must reach 0
 * before enablement in any environment.
 *
 * Requires a superuser DSN for setup. Override with ADMIN_DATABASE_URL.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const ADMIN_URL =
  process.env.ADMIN_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';
const DB_NAME = `crm_rls_apppaths_${randomBytes(4).toString('hex')}`;
const APP_ROLE = `crm_rls_appuser_${randomBytes(3).toString('hex')}`;
/**
 * rls.sql targets its policies at `crm_app` and `crm_maintenance` by name, and PostgreSQL
 * roles are CLUSTER-wide — creating those literal names here would collide with a real
 * deployment on the same server and the teardown would drop the roles it authenticates as.
 * The names are rewritten to this run's throwaway roles instead.
 */
const MAINT_ROLE = `crm_rls_maintuser_${randomBytes(3).toString('hex')}`;
const namespaceRoles = (sql) =>
  sql
    .replace(/\bcrm_maintenance\b/g, MAINT_ROLE)
    .replace(/\bcrm_app\b/g, APP_ROLE);
const APP_PASSWORD = randomBytes(18).toString('base64url');

// The share token the probe will present. Only its SHA-256 hash is stored, exactly as
// `createShareLink` does — the point is to exercise the real lookup, not a shortcut.
const TOKEN = randomBytes(32).toString('base64url');
const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex');
const TENANT = 'tenant-a';

const base = new URL(ADMIN_URL);
const dbUrl = (name, user, password) => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${name}`;
  if (user) {
    u.username = user;
    u.password = password;
  }
  return u.toString();
};

let failures = 0;
const pass = (m, d) => console.log(`  \x1b[32mPASS\x1b[0m  ${m}\n        ${d}`);
const fail = (m, d) => {
  console.log(`  \x1b[31mFAIL\x1b[0m  ${m}\n        ${d}`);
  failures++;
};

async function admin(dbName, fn) {
  const client = new PrismaClient({ datasources: { db: { url: dbUrl(dbName) } } });
  try {
    return await fn(client);
  } finally {
    await client.$disconnect();
  }
}

async function main() {
  console.log(`Verifying application paths under RLS in throwaway database ${DB_NAME}`);
  console.log(`Admin host: ${base.hostname}:${base.port || 5432}\n`);

  await admin(base.pathname.replace('/', '') || 'postgres', async (c) => {
    await c.$executeRawUnsafe(`CREATE DATABASE "${DB_NAME}"`);
  });

  try {
    // Schema from the datamodel, not from migration history — same reasoning as verify-rls.mjs.
    const schemaSql = execFileSync(
      process.execPath,
      [
        'node_modules/prisma/build/index.js',
        'migrate',
        'diff',
        '--from-empty',
        '--to-schema-datamodel',
        './prisma/schema.prisma',
        '--script',
      ],
      { encoding: 'utf8', maxBuffer: 1 << 28 }
    );

    await admin(DB_NAME, async (c) => {
      // Split on `;` + newline: `migrate diff` emits plain DDL with no dollar-quoted bodies.
      // `rls.sql` below is one DO block and must stay whole.
      for (const stmt of schemaSql.split(/;\s*\r?\n/).map((s) => s.trim()).filter(Boolean)) {
        await c.$executeRawUnsafe(stmt);
      }
      // NOSUPERUSER is the whole point: FORCE closes the table-owner loophole, nothing
      // closes the superuser one. A probe run as `postgres` would pass while proving nothing.
      // Created BEFORE rls.sql, which refuses to run until the roles it targets exist.
      for (const role of [APP_ROLE, MAINT_ROLE]) {
        await c.$executeRawUnsafe(
          `CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${APP_PASSWORD}'`
        );
        await c.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "${role}"`);
        await c.$executeRawUnsafe(
          `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${role}"`
        );
        await c.$executeRawUnsafe(
          `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${role}"`
        );
      }

      await c.$executeRawUnsafe(namespaceRoles(readFileSync('supabase/rls.sql', 'utf8')));

      // One tenant with one shared report. Seeded with the bypass on, session-wide, because
      // this connection is doing nothing else.
      await c.$executeRawUnsafe(`SELECT set_config('app.bypass_rls','true',false)`);
      await c.$executeRawUnsafe(
        `INSERT INTO "Tenant" (id, name, "createdAt", "updatedAt") VALUES ('${TENANT}','A',now(),now())`
      );
      await c.$executeRawUnsafe(
        `INSERT INTO "User" (id,email,password,"firstName","lastName",role,timezone,"isActive","tenantId","createdAt","updatedAt")
         VALUES ('user-a','ua@example.test','x','U','A','sdr','UTC',true,'${TENANT}',now(),now())`
      );
      await c.$executeRawUnsafe(
        `INSERT INTO "Client" (id,name,industry,"contactName","contactEmail",status,"tenantId","createdAt","updatedAt")
         VALUES ('client-a','Acme','Testing','C','ca@example.test','active','${TENANT}',now(),now())`
      );
      await c.$executeRawUnsafe(
        `INSERT INTO "Campaign" (id,"clientId",name,status,"startDate","tenantId","createdAt","updatedAt")
         VALUES ('camp-a','client-a','Campaign A','active',now(),'${TENANT}',now(),now())`
      );
      await c.$executeRawUnsafe(
        `INSERT INTO "Lead" (id,"firstName","lastName",company,email,stage,"assignedToId","campaignId","tenantId","createdAt","updatedAt")
         VALUES ('lead-a','L','A','Co A','la@example.test','new','user-a','camp-a','${TENANT}',now(),now())`
      );
      await c.$executeRawUnsafe(
        `INSERT INTO "ClientReport"
           (id,"clientId","campaignId",title,"periodStart","periodEnd","keyWins",blockers,recommendations,"clientActions","snapshotJson","generatedById","tenantId","createdAt","updatedAt")
         VALUES ('report-a','client-a','camp-a','Weekly report',now(),now(),
                 ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[],
                 '{}'::jsonb,'user-a','${TENANT}',now(),now())`
      );
      await c.$executeRawUnsafe(
        `INSERT INTO "ClientReportShareLink" (id,"reportId","tokenHash","viewCount","createdById","tenantId","createdAt")
         VALUES ('share-a','report-a','${TOKEN_HASH}',0,'user-a','${TENANT}',now())`
      );
    });

    // ── The probes, in a child process holding the unprivileged DSN ────────────
    console.log('Application paths, as a NOSUPERUSER role with DB_RLS_ENFORCED=true:\n');
    const child = spawnSync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'scripts/verify-rls-app-paths.probe.ts'],
      {
        encoding: 'utf8',
        maxBuffer: 1 << 28,
        env: {
          ...process.env,
          DATABASE_URL: dbUrl(DB_NAME, APP_ROLE, APP_PASSWORD),
          DIRECT_URL: dbUrl(DB_NAME, APP_ROLE, APP_PASSWORD),
          // The cross-tenant role. Since the policies became role-targeted, `app.bypass_rls`
          // grants nothing to the application role — the worker, seed, script and public
          // share-link paths have to connect as this one instead.
          CRM_MAINTENANCE_URL: dbUrl(DB_NAME, MAINT_ROLE, APP_PASSWORD),
          DB_RLS_ENFORCED: 'true',
          // Anything other than production makes `isLocalOrScript` true, which grants a
          // blanket bypass and would make probes 4 and 5 measure nothing.
          NODE_ENV: 'production',
          BYPASS_RLS: '',
          IS_WORKER: '',
          PROBE_TOKEN: TOKEN,
          PROBE_TENANT: TENANT,
        },
      }
    );

    const out = child.stdout || '';
    const start = out.indexOf('---PROBE-JSON-START---');
    const end = out.indexOf('---PROBE-JSON-END---');
    if (start === -1 || end === -1) {
      fail('the probe process produced a result', 'no JSON payload on stdout');
      console.log('\n--- probe stdout ---\n' + out);
      console.log('\n--- probe stderr ---\n' + (child.stderr || ''));
    } else {
      const probes = JSON.parse(out.slice(start + '---PROBE-JSON-START---'.length, end).trim());
      for (const p of probes) (p.ok ? pass : fail)(p.name, p.detail);
      if (child.stderr && failures > 0) console.log('\n--- probe stderr ---\n' + child.stderr);
    }
  } finally {
    await admin(base.pathname.replace('/', '') || 'postgres', async (c) => {
      await c.$executeRawUnsafe(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}'`
      );
      await c.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DB_NAME}"`);
      for (const role of [APP_ROLE, MAINT_ROLE]) {
        await c.$executeRawUnsafe(`DROP OWNED BY "${role}" CASCADE`).catch(() => {});
        await c.$executeRawUnsafe(`DROP ROLE IF EXISTS "${role}"`);
      }
    });
    console.log(`\nCleaned up ${DB_NAME} and ${APP_ROLE}.`);
  }

  if (failures > 0) {
    console.error(`\n${failures} application path(s) would BREAK under DB-level RLS.`);
    console.error('Do not set DB_RLS_ENFORCED=true anywhere until this reaches 0.');
    process.exit(1);
  }
  console.log('\nAll application paths survive DB-level RLS.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
