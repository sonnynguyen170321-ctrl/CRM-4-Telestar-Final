#!/usr/bin/env node
/**
 * Verify RLS against a real, populated database — the one case the other three scripts miss.
 *
 *     node scripts/verify-rls-live.mjs
 *
 * `verify-rls.mjs`, `verify-rls-app-paths.mjs` and `verify-rls-enablement.mjs` all build a
 * throwaway database with a handful of seeded rows. That is right for what they test, and it
 * leaves one thing unexamined: an existing database with real data volume, real tenant skew,
 * and tables created long before any of this. Production is that, not a fresh schema.
 *
 * This script changes nothing. Every statement is a read, except one UPDATE that is deliberately
 * rolled back — because "can the application still write the rows it owns" cannot be answered by
 * reading, and finding out during the change window is too late.
 *
 * It needs two connections and takes both from the environment rather than inventing them:
 *
 *   DATABASE_URL      a privileged connection, used only to pick a real tenant to test with and
 *                     as the control for the overhead measurement
 *   CRM_APP_URL       the unprivileged application role, from .env.rls.local — the thing under
 *                     test. Never falls back to DATABASE_URL: a run that silently tested the
 *                     superuser would pass every check while proving nothing, which is the exact
 *                     failure `supabase/roles.sql` was written to prevent.
 *
 * Exit 0 means the application role reads its own tenant, cannot reach another, is refused DDL,
 * and can write what it owns — on this database, at this size.
 */

import { readFileSync, existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
  );
}

const fileEnv = { ...loadEnvFile('.env.local'), ...loadEnvFile('.env.rls.local') };
const superUrl = process.env.DATABASE_URL || fileEnv.DATABASE_URL;
const appUrl = process.env.CRM_APP_URL || fileEnv.CRM_APP_URL;

if (!superUrl || !appUrl) {
  console.error(
    'verify-rls-live: needs DATABASE_URL (privileged) and CRM_APP_URL (the application role).\n' +
      'CRM_APP_URL is written to .env.rls.local when supabase/roles.sql is applied.'
  );
  process.exit(2);
}

let failures = 0;
const pass = (m, d) => console.log(`  \x1b[32mPASS\x1b[0m  ${m}${d ? `\n        ${d}` : ''}`);
const fail = (m, d) => {
  console.log(`  \x1b[31mFAIL\x1b[0m  ${m}${d ? `\n        ${d}` : ''}`);
  failures++;
};
const since = (t) => Number(process.hrtime.bigint() - t) / 1e6;

const app = new PrismaClient({ datasources: { db: { url: appUrl } } });
const sup = new PrismaClient({ datasources: { db: { url: superUrl } } });

/** One statement holding a tenant context, pinned to a single connection. */
const scoped = (tenantId, sql) =>
  app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.bypass_rls','false',true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id',$$${tenantId}$$,true)`);
    return tx.$queryRawUnsafe(sql);
  });

async function main() {
  const appUser = new URL(appUrl).username;
  console.log(`Verifying RLS on a populated database as ${appUser}\n`);

  // Refuse to run as a superuser. RLS does not apply to one, so every check below would pass
  // while proving nothing — the precise trap roles.sql exists to close.
  const [who] = await app.$queryRawUnsafe(
    `SELECT current_user AS name, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS super`
  );
  if (who.super) {
    console.error(
      `verify-rls-live: CRM_APP_URL connects as ${who.name}, which is a SUPERUSER.\n` +
        'RLS does not apply to superusers, so this run would be vacuous. Refusing.'
    );
    process.exit(2);
  }
  pass('the role under test is not a superuser', `${who.name}, rolsuper=false`);

  // Pick the busiest real tenant. Skew matters: the largest tenant is where a policy that
  // defeats an index shows up first.
  const [seed] = await sup.$queryRawUnsafe(
    `SELECT "tenantId", count(*)::int AS n FROM "Lead" GROUP BY "tenantId" ORDER BY n DESC LIMIT 1`
  );
  if (!seed) {
    console.error('verify-rls-live: no Lead rows to test against.');
    process.exit(2);
  }
  const [{ total }] = await sup.$queryRawUnsafe(`SELECT count(*)::int AS total FROM "Lead"`);
  console.log(`  busiest tenant ${seed.tenantId}: ${seed.n} of ${total} leads\n`);

  // ── 1. no context: must fail closed ────────────────────────────────────────
  try {
    const [{ n }] = await app.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "Lead"`);
    n === 0
      ? pass('no tenant context sees nothing', `0 of ${total} leads`)
      : fail('no tenant context sees nothing', `saw ${n} rows — RLS is not being enforced here`);
  } catch (e) {
    fail('no tenant context sees nothing', e.message.split('\n')[0]);
  }

  // ── 2. scoped read returns exactly that tenant ─────────────────────────────
  try {
    const t0 = process.hrtime.bigint();
    const [{ n }] = await scoped(seed.tenantId, `SELECT count(*)::int AS n FROM "Lead"`);
    const took = since(t0);
    n === seed.n
      ? pass('a scoped read returns exactly its tenant', `${n} leads in ${took.toFixed(0)}ms`)
      : fail('a scoped read returns exactly its tenant', `expected ${seed.n}, saw ${n}`);
  } catch (e) {
    fail('a scoped read returns exactly its tenant', e.message.split('\n')[0]);
  }

  // ── 3. another tenant's row, by direct id ──────────────────────────────────
  try {
    const [other] = await sup.$queryRawUnsafe(
      `SELECT id FROM "Lead" WHERE "tenantId" <> $$${seed.tenantId}$$ LIMIT 1`
    );
    if (!other) {
      console.log('  SKIP  only one tenant holds leads; cross-tenant read not exercised');
    } else {
      const rows = await scoped(seed.tenantId, `SELECT id FROM "Lead" WHERE id = $$${other.id}$$`);
      rows.length === 0
        ? pass('another tenant is unreachable by direct id', 'no rows, as the policy requires')
        : fail('another tenant is unreachable by direct id', `saw ${rows.length} row(s)`);
    }
  } catch (e) {
    fail('another tenant is unreachable by direct id', e.message.split('\n')[0]);
  }

  // ── 4. DDL must be refused ─────────────────────────────────────────────────
  // An application role that can drop a policy is not constrained by one.
  try {
    await app.$executeRawUnsafe(`CREATE TABLE "rls_live_probe_should_fail" (id text)`);
    fail('DDL is refused', 'CREATE TABLE succeeded — this role could drop its own policies');
    await app.$executeRawUnsafe(`DROP TABLE IF EXISTS "rls_live_probe_should_fail"`).catch(() => {});
  } catch {
    pass('DDL is refused', 'CREATE TABLE rejected');
  }

  // ── 5. writes reach every row the tenant owns, then roll back ──────────────
  // A no-op UPDATE: it sets updatedAt to its own value, so even a failure to roll back would
  // change nothing. What is being measured is how many rows the policy lets the statement see.
  try {
    await app
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.bypass_rls','false',true)`);
        await tx.$executeRawUnsafe(
          `SELECT set_config('app.current_tenant_id',$$${seed.tenantId}$$,true)`
        );
        const n = await tx.$executeRawUnsafe(
          `UPDATE "Lead" SET "updatedAt" = "updatedAt" WHERE "tenantId" = $$${seed.tenantId}$$`
        );
        if (n !== seed.n) throw new Error(`policy exposed ${n} rows to UPDATE, expected ${seed.n}`);
        throw new Error('ROLLBACK_SENTINEL');
      })
      .catch((e) => {
        if (e.message !== 'ROLLBACK_SENTINEL') throw e;
      });
    pass('writes reach every row the tenant owns', `${seed.n} rows, rolled back`);
  } catch (e) {
    fail('writes reach every row the tenant owns', e.message.split('\n')[0]);
  }

  // ── 6. the cost of enforcement, measured ───────────────────────────────────
  // Not a pass/fail: a number, so the decision to enable is made against evidence rather than
  // a guess. The comparison is deliberately like for like — the policy's own predicate, written
  // out by hand for the control.
  try {
    const t0 = process.hrtime.bigint();
    await scoped(seed.tenantId, `SELECT id FROM "Lead" LIMIT 1000`);
    const enforced = since(t0);
    const t1 = process.hrtime.bigint();
    await sup.$queryRawUnsafe(
      `SELECT id FROM "Lead" WHERE "tenantId" = $$${seed.tenantId}$$ LIMIT 1000`
    );
    const control = since(t1);
    pass(
      'enforcement overhead is measured, not assumed',
      `1000 rows — ${enforced.toFixed(0)}ms under policy, ${control.toFixed(0)}ms as the control`
    );
  } catch (e) {
    fail('enforcement overhead is measured, not assumed', e.message.split('\n')[0]);
  }
}

main()
  .catch((err) => {
    console.error(err);
    failures++;
  })
  .finally(async () => {
    await app.$disconnect();
    await sup.$disconnect();
    if (failures > 0) {
      console.error(`\n${failures} check(s) FAILED against the populated database.`);
      process.exit(1);
    }
    console.log('\nThe application role behaves correctly against the populated database.');
  });
