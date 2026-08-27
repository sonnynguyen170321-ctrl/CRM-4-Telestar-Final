#!/usr/bin/env node
/**
 * Rehearse the whole RLS enablement sequence against a throwaway database.
 *
 *     node scripts/verify-rls-enablement.mjs
 *
 * The other two RLS scripts each test a piece. `verify-rls.mjs` proves the policies keep
 * tenants apart. `verify-rls-app-paths.mjs` proves the application still works when they are
 * enforced. Both create their own ad-hoc `NOSUPERUSER` role inline, because what they are
 * testing is the policy layer, not the deployment.
 *
 * That left `supabase/roles.sql` — step one of the documented enablement sequence — executed by
 * no script, no test and no CI job. Ninety-six lines of role creation, grants and default
 * privileges, never once run, standing between the current state and production. The first time
 * anyone would have found a defect in it is the night they enabled RLS.
 *
 * So this script runs the sequence as documented, end to end:
 *
 *   1. create the database, and `crm_migrator` to own the schema
 *   2. apply the Prisma datamodel AS crm_migrator — so the default privileges in roles.sql,
 *      which are scoped `FOR ROLE crm_migrator`, are actually exercised
 *   3. apply `supabase/roles.sql`
 *   4. apply `supabase/rls.sql`
 *   5. connect as the real `crm_app` role and assert the application can read, write and stay
 *      inside its tenant
 *
 * Exit 0 means the documented sequence produces a working, isolated system. A failure names
 * which step of the runbook is wrong — which is the entire point of rehearsing it somewhere
 * that does not matter.
 *
 * `psql` is not required and deliberately not used. The documented command is
 * `psql "$DIRECT_URL" -f supabase/roles.sql`, but psql is absent from the machines this project
 * is developed on, and `roles.sql` uses `\set` meta-commands only psql understands. Those are
 * substituted here before execution. That difference is itself worth knowing about: it means
 * nobody can apply the file as documented without installing psql first.
 *
 * Requires a superuser DSN for setup. Override with ADMIN_DATABASE_URL.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const ADMIN_URL =
  process.env.ADMIN_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
const DB_NAME = `crm_rls_enable_${randomBytes(4).toString('hex')}`;

/**
 * PostgreSQL roles are CLUSTER-wide, not per-database, so a rehearsal that used the literal
 * names would collide with any real deployment on the same server: it would find the roles
 * already present, skip creating them, fail to authenticate with its own generated password,
 * and — worse — its teardown would try to DROP roles a live database depends on. That happened
 * on the first run against a machine where roles.sql had genuinely been applied.
 *
 * Each run therefore gets its own namespace. The role NAMES are rewritten in both SQL files;
 * everything else about them — the CREATE options, the grants, the default privileges, the
 * superuser assertion, the policy targeting — is exercised exactly as written.
 */
const SUFFIX = randomBytes(3).toString('hex');
const BASE_ROLES = ['crm_migrator', 'crm_app', 'crm_maintenance'];
const roleName = (base) => `${base}_${SUFFIX}`;
const ROLES = BASE_ROLES.map(roleName);
const PASSWORDS = Object.fromEntries(ROLES.map((r) => [r, randomBytes(18).toString('base64url')]));

/** Rewrite the literal role names in a SQL file to this run's namespaced ones. */
const namespaceRoles = (sql) =>
  BASE_ROLES.reduce(
    (acc, base) => acc.replace(new RegExp(`\\b${base}\\b`, 'g'), roleName(base)),
    sql
  );

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
const pass = (m, d) => console.log(`  \x1b[32mPASS\x1b[0m  ${m}${d ? `\n        ${d}` : ''}`);
const fail = (m, d) => {
  console.log(`  \x1b[31mFAIL\x1b[0m  ${m}${d ? `\n        ${d}` : ''}`);
  failures++;
};

async function withClient(url, fn) {
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    return await fn(client);
  } finally {
    await client.$disconnect();
  }
}

/**
 * Split SQL into executable statements, keeping dollar-quoted bodies whole.
 *
 * `$executeRawUnsafe` refuses multi-statement strings, and `roles.sql` mixes plain statements
 * with `DO $$ ... $$` blocks whose bodies contain semicolons. Splitting naively on `;` cuts
 * those blocks in half and the errors that follow are baffling.
 */
function splitStatements(sql) {
  const out = [];
  let current = '';
  let inDollar = false;
  for (const line of sql.split('\n')) {
    const dollars = (line.match(/\$\$/g) || []).length;
    current += line + '\n';
    if (dollars % 2 === 1) inDollar = !inDollar;
    if (!inDollar && /;\s*$/.test(line)) {
      const stmt = current.trim();
      if (stmt && !stmt.split('\n').every((l) => l.trim().startsWith('--'))) out.push(stmt);
      current = '';
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** Strip psql meta-commands and substitute the variables they would have set. */
function preparePsqlScript(sql) {
  const withoutMeta = sql
    .split('\n')
    .filter((line) => !/^\s*\\/.test(line))
    .join('\n');
  return namespaceRoles(withoutMeta)
    .replace(/:'app_password'/g, `'${PASSWORDS[roleName('crm_app')]}'`)
    .replace(/:'migrator_password'/g, `'${PASSWORDS[roleName('crm_migrator')]}'`)
    .replace(/:'maintenance_password'/g, `'${PASSWORDS[roleName('crm_maintenance')]}'`);
}

async function main() {
  console.log(`Rehearsing the RLS enablement sequence in throwaway database ${DB_NAME}`);
  console.log(`Admin host: ${base.hostname}:${base.port || 5432}\n`);

  const adminDb = base.pathname.replace('/', '') || 'postgres';

  await withClient(dbUrl(adminDb), async (c) => {
    // crm_migrator has to exist before it can own anything. roles.sql creates it too and is
    // idempotent about it, which this proves by creating it first and letting roles.sql run
    // over the top — the same thing that happens on a second application in production.
    // Namespaced, so this cannot collide with a real crm_migrator on the same cluster.
    await c.$executeRawUnsafe(
      `CREATE ROLE ${roleName('crm_migrator')} LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB
       PASSWORD '${PASSWORDS[roleName('crm_migrator')]}'`
    );
    await c.$executeRawUnsafe(`CREATE DATABASE "${DB_NAME}" OWNER ${roleName('crm_migrator')}`);
  });

  try {
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

    // ── Step 2: the schema, owned by crm_migrator ────────────────────────────
    // Applied AS crm_migrator on purpose. `ALTER DEFAULT PRIVILEGES FOR ROLE crm_migrator` in
    // roles.sql only reaches objects that role creates; applying the schema as the superuser
    // instead would leave that clause untested and quietly meaningless.
    await withClient(dbUrl(DB_NAME, roleName('crm_migrator'), PASSWORDS[roleName('crm_migrator')]), async (c) => {
      for (const stmt of schemaSql.split(/;\s*\r?\n/).map((s) => s.trim()).filter(Boolean)) {
        await c.$executeRawUnsafe(stmt);
      }
    });
    pass('the datamodel applies as crm_migrator', 'DDL only, no superuser');

    // ── Step 3: roles.sql, for the first time ────────────────────────────────
    const rolesSql = preparePsqlScript(readFileSync('supabase/roles.sql', 'utf8'));
    // roles.sql creates crm_migrator too; it already exists here, so let the idempotent
    // guard in that file prove itself rather than tripping over it.
    await withClient(dbUrl(DB_NAME), async (c) => {
      for (const stmt of splitStatements(rolesSql)) {
        await c.$executeRawUnsafe(stmt);
      }
    });
    pass('supabase/roles.sql applies cleanly', `${ROLES.join(', ')} created and granted`);

    // Its own verification block should have refused a superuser application role; confirm the
    // roles really are unprivileged rather than trusting that the block ran.
    await withClient(dbUrl(DB_NAME), async (c) => {
      const rows = await c.$queryRawUnsafe(
        `SELECT rolname, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles
         WHERE rolname IN (${ROLES.map((r) => `'${r}'`).join(',')}) ORDER BY rolname`
      );
      const privileged = rows.filter((r) => r.rolsuper || r.rolcreatedb || r.rolcreaterole);
      if (rows.length !== 3) {
        fail('all three roles exist', `saw ${rows.map((r) => r.rolname).join(', ') || 'none'}`);
      } else if (privileged.length > 0) {
        fail(
          'no application role is privileged',
          `${privileged.map((r) => r.rolname).join(', ')} carry superuser/createdb/createrole`
        );
      } else {
        pass('all three roles exist and none is privileged', 'RLS can actually apply to them');
      }
    });

    // ── Step 4: the policies ─────────────────────────────────────────────────
    await withClient(dbUrl(DB_NAME), async (c) => {
      await c.$executeRawUnsafe(namespaceRoles(readFileSync('supabase/rls.sql', 'utf8')));
    });
    pass('supabase/rls.sql applies cleanly', 'policies derived from the catalog');

    // ── Step 5: the application role, doing application things ───────────────
    // Seeded as crm_maintenance, the role rls.sql grants the cross-tenant policy to. It is
    // NOT seeded as crm_app with a bypass GUC: since the policies became role-targeted,
    // crm_app has no policy that consults `app.bypass_rls`, so setting it does nothing —
    // which is the point, and is asserted separately below.
    const appUrl = dbUrl(DB_NAME, roleName('crm_app'), PASSWORDS[roleName('crm_app')]);
    const maintUrl = dbUrl(
      DB_NAME,
      roleName('crm_maintenance'),
      PASSWORDS[roleName('crm_maintenance')]
    );
    await withClient(maintUrl, async (c) => {
      try {
        await c.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `INSERT INTO "Tenant" (id,name,"createdAt","updatedAt")
             VALUES ('tenant-a','A',now(),now()), ('tenant-b','B',now(),now())`
          );
          for (const t of ['a', 'b']) {
            await tx.$executeRawUnsafe(
              `INSERT INTO "User" (id,email,password,"firstName","lastName",role,timezone,"isActive","tenantId","createdAt","updatedAt")
               VALUES ('user-${t}','u${t}@example.test','x','U','${t}','sdr','UTC',true,'tenant-${t}',now(),now())`
            );
            await tx.$executeRawUnsafe(
              `INSERT INTO "Client" (id,name,industry,"contactName","contactEmail",status,"tenantId","createdAt","updatedAt")
               VALUES ('client-${t}','C${t}','T','C','c${t}@example.test','active','tenant-${t}',now(),now())`
            );
            await tx.$executeRawUnsafe(
              `INSERT INTO "Campaign" (id,"clientId",name,status,"startDate","tenantId","createdAt","updatedAt")
               VALUES ('camp-${t}','client-${t}','C${t}','active',now(),'tenant-${t}',now(),now())`
            );
            await tx.$executeRawUnsafe(
              `INSERT INTO "Lead" (id,"firstName","lastName",company,email,stage,"assignedToId","campaignId","tenantId","createdAt","updatedAt")
               VALUES ('lead-${t}','L','${t}','Co','l${t}@example.test','new','user-${t}','camp-${t}','tenant-${t}',now(),now())`
            );
          }
        });
        pass('crm_maintenance writes across tenants', 'the seed, worker and script path');
      } catch (err) {
        fail('crm_maintenance writes across tenants', err.message.split('\n')[0]);
      }
    });

    await withClient(appUrl, async (c) => {
      // The property the role-targeted policies buy, and the reason they exist. roles.sql
      // could only ask the application not to bypass — "Postgres has no per-GUC permission
      // for custom settings, so the separation is by connection string". Now the database
      // enforces it: crm_app has no policy that reads app.bypass_rls, so setting it is inert.
      try {
        const rows = await c.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SELECT set_config('app.bypass_rls','true',true)`);
          return tx.$queryRawUnsafe(`SELECT id FROM "Lead"`);
        });
        if (rows.length === 0) {
          pass(
            'crm_app cannot bypass, even setting the GUC itself',
            'no rows — the flag is inert for this role'
          );
        } else {
          fail(
            'crm_app cannot bypass, even setting the GUC itself',
            `saw ${rows.length} row(s) — the application can still read across tenants`
          );
        }
      } catch (err) {
        fail('crm_app cannot bypass, even setting the GUC itself', err.message.split('\n')[0]);
      }

      // The isolation itself, as the deployment will experience it.
      const asTenantA = (sql) =>
        c.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id','tenant-a',true)`);
          await tx.$executeRawUnsafe(`SELECT set_config('app.bypass_rls','false',true)`);
          return tx.$queryRawUnsafe(sql);
        });

      try {
        const own = await asTenantA(`SELECT id FROM "Lead"`);
        if (own.length === 1 && own[0].id === 'lead-a') {
          pass('crm_app reads its own tenant', `1 row, ${own[0].id}`);
        } else {
          fail('crm_app reads its own tenant', `expected 1 row (lead-a), saw ${own.length}`);
        }
      } catch (err) {
        fail('crm_app reads its own tenant', err.message.split('\n')[0]);
      }

      try {
        const other = await asTenantA(`SELECT id FROM "Lead" WHERE id = 'lead-b'`);
        if (other.length === 0) {
          pass('crm_app cannot read another tenant by direct id', 'no rows, as the policy requires');
        } else {
          fail('crm_app cannot read another tenant by direct id', `saw ${other.length} row(s)`);
        }
      } catch (err) {
        fail('crm_app cannot read another tenant by direct id', err.message.split('\n')[0]);
      }

      // DDL must be refused. An application role that can drop a policy is not constrained by it.
      try {
        await c.$executeRawUnsafe(`CREATE TABLE "rehearsal_should_fail" (id text)`);
        fail('crm_app is refused DDL', 'CREATE TABLE succeeded — the app could drop its own policies');
      } catch {
        pass('crm_app is refused DDL', 'CREATE TABLE rejected');
      }
    });

    // ── The clause nothing has ever exercised ────────────────────────────────
    // A future migration creates a table as crm_migrator. Without the default privileges in
    // roles.sql the app cannot read it, and the usual "fix" is to hand someone a superuser DSN.
    await withClient(dbUrl(DB_NAME, roleName('crm_migrator'), PASSWORDS[roleName('crm_migrator')]), async (c) => {
      await c.$executeRawUnsafe(`CREATE TABLE "FutureModel" (id text PRIMARY KEY, "tenantId" text)`);
    });
    await withClient(appUrl, async (c) => {
      try {
        await c.$queryRawUnsafe(`SELECT id FROM "FutureModel"`);
        pass(
          'a table a later migration creates is readable by crm_app',
          'ALTER DEFAULT PRIVILEGES carries the grant forward'
        );
      } catch (err) {
        fail(
          'a table a later migration creates is readable by crm_app',
          `${err.message.split('\n')[0]} — every new model would need a manual GRANT`
        );
      }
    });
  } finally {
    await withClient(dbUrl(adminDb), async (c) => {
      await c.$executeRawUnsafe(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}'`
      );
      await c.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DB_NAME}"`);
      // Only this run's namespaced roles are dropped. The earlier version dropped the
      // literal crm_* names, which on a machine with a real deployment would have deleted
      // the roles that deployment authenticates as.
      for (const role of ROLES) {
        await c.$executeRawUnsafe(`DROP OWNED BY ${role} CASCADE`).catch(() => {});
        await c.$executeRawUnsafe(`DROP ROLE IF EXISTS ${role}`).catch(() => {});
      }
    });
    console.log(`\nCleaned up ${DB_NAME} and ${ROLES.join(', ')}.`);
  }

  if (failures > 0) {
    console.error(`\n${failures} step(s) of the documented enablement sequence FAILED.`);
    process.exit(1);
  }
  console.log('\nThe documented enablement sequence produces a working, isolated system.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
