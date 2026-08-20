#!/usr/bin/env node
/**
 * Prove tenant isolation is actually enforced by PostgreSQL — not by the application.
 *
 *     node scripts/verify-rls.mjs
 *
 * Why this is a standalone script and not a Vitest suite:
 *
 *  1. It must run against an ISOLATED database. Enabling FORCE ROW LEVEL SECURITY on the
 *     shared test database would make every row invisible to whichever suite is running
 *     in parallel. This script creates its own database and drops it at the end.
 *
 *  2. It must connect as a NON-SUPERUSER. Superusers bypass RLS entirely — `FORCE` closes
 *     the table-owner loophole, not the superuser one. Measured on 2026-08-08: with
 *     policies on all 41 tenant-owned tables, `SELECT count(*) FROM "User"` as `postgres`
 *     still returned every row. A test that connects as the default local superuser would
 *     pass while proving nothing, which is worse than having no test.
 *
 * Exit code 0 means: a connection holding tenant A's context cannot read, update or delete
 * tenant B's rows, and cannot insert rows attributed to tenant B.
 *
 * Requires a superuser DSN to do the setup (create database, create role, apply schema).
 * Override with ADMIN_DATABASE_URL; defaults to the local development superuser.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const ADMIN_URL =
  process.env.ADMIN_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';
const DB_NAME = `crm_rls_verify_${randomBytes(4).toString('hex')}`;
const APP_ROLE = `crm_rls_app_${randomBytes(3).toString('hex')}`;
const APP_PASSWORD = randomBytes(18).toString('base64url');

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
const pass = (m) => console.log(`  \x1b[32mPASS\x1b[0m  ${m}`);
const fail = (m) => {
  console.log(`  \x1b[31mFAIL\x1b[0m  ${m}`);
  failures++;
};

/** Run SQL as the admin/superuser against a given database. */
async function admin(dbName, fn) {
  const client = new PrismaClient({ datasources: { db: { url: dbUrl(dbName) } } });
  try {
    return await fn(client);
  } finally {
    await client.$disconnect();
  }
}

async function main() {
  console.log(`Verifying RLS enforcement in throwaway database ${DB_NAME}`);
  console.log(`Admin host: ${base.hostname}:${base.port || 5432}\n`);

  // ── Setup ─────────────────────────────────────────────────────────────────
  await admin(base.pathname.replace('/', '') || 'postgres', async (c) => {
    await c.$executeRawUnsafe(`CREATE DATABASE "${DB_NAME}"`);
  });

  try {
    // Schema, straight from the Prisma datamodel — no migration history needed.
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
      // $executeRawUnsafe refuses multi-statement scripts ("cannot insert multiple
      // commands into a prepared statement"), so the generated schema is applied one
      // statement at a time. Safe to split on `;` + newline here because `migrate diff`
      // emits plain DDL with no dollar-quoted bodies — unlike rls.sql below, which is a
      // single DO block and must stay whole.
      for (const stmt of schemaSql.split(/;\s*\r?\n/).map((s) => s.trim()).filter(Boolean)) {
        await c.$executeRawUnsafe(stmt);
      }
      // The policies under test, applied as the one statement they are.
      await c.$executeRawUnsafe(readFileSync('supabase/rls.sql', 'utf8'));

      // A deliberately unprivileged role. NOSUPERUSER is the entire point.
      await c.$executeRawUnsafe(
        `CREATE ROLE "${APP_ROLE}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${APP_PASSWORD}'`
      );
      await c.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "${APP_ROLE}"`);
      await c.$executeRawUnsafe(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${APP_ROLE}"`
      );
      await c.$executeRawUnsafe(
        `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${APP_ROLE}"`
      );

      // Two tenants, one lead each, seeded with RLS bypassed.
      await c.$executeRawUnsafe(`SELECT set_config('app.bypass_rls','true',false)`);
      await c.$executeRawUnsafe(
        `INSERT INTO "Tenant" (id, name, "createdAt", "updatedAt")
         VALUES ('tenant-a','A',now(),now()), ('tenant-b','B',now(),now())`
      );
      // Lead has NOT NULL foreign keys to User and Campaign, so each tenant needs a
      // full little object graph of its own. Everything is tenant-local: no row in
      // tenant A references anything in tenant B.
      for (const t of ['a', 'b']) {
        await c.$executeRawUnsafe(
          `INSERT INTO "User" (id,email,password,"firstName","lastName",role,timezone,"isActive","tenantId","createdAt","updatedAt")
           VALUES ('user-${t}','u${t}@example.test','x','U','${t.toUpperCase()}','sdr','UTC',true,'tenant-${t}',now(),now())`
        );
        await c.$executeRawUnsafe(
          `INSERT INTO "Client" (id,name,industry,"contactName","contactEmail",status,"tenantId","createdAt","updatedAt")
           VALUES ('client-${t}','Client ${t}','Testing','C','c${t}@example.test','active','tenant-${t}',now(),now())`
        );
        await c.$executeRawUnsafe(
          `INSERT INTO "Campaign" (id,"clientId",name,status,"startDate","tenantId","createdAt","updatedAt")
           VALUES ('camp-${t}','client-${t}','Campaign ${t}','active',now(),'tenant-${t}',now(),now())`
        );
        await c.$executeRawUnsafe(
          `INSERT INTO "Lead" (id,"firstName","lastName",company,email,stage,"assignedToId","campaignId","tenantId","createdAt","updatedAt")
           VALUES ('lead-${t}','L','${t.toUpperCase()}','Co ${t}','l${t}@example.test','new','user-${t}','camp-${t}','tenant-${t}',now(),now())`
        );
        // Meeting requires its own client, campaign and SDR — all NOT NULL, all tenant-local.
        await c.$executeRawUnsafe(
          `INSERT INTO "Meeting" (id,"leadId","clientId","campaignId","sdrId","title","scheduledAt",status,"tenantId","createdAt","updatedAt")
           VALUES ('meet-${t}','lead-${t}','client-${t}','camp-${t}','user-${t}','Discovery ${t}',now(),'scheduled','tenant-${t}',now(),now())`
        );
        await c.$executeRawUnsafe(
          `INSERT INTO "Opportunity" (id,"leadId","clientId","campaignId",title,company,"ownerId","createdById",value,stage,"tenantId","createdAt","updatedAt")
           VALUES ('opp-${t}','lead-${t}','client-${t}','camp-${t}','Deal ${t}','Co ${t}','user-${t}','user-${t}',10000,'pending_client_review','tenant-${t}',now(),now())`
        );
        await c.$executeRawUnsafe(
          `INSERT INTO "CampaignPlaybook" (id,"campaignId",name,"createdById","tenantId","createdAt","updatedAt")
           VALUES ('pb-${t}','camp-${t}','Playbook ${t}','user-${t}','tenant-${t}',now(),now())`
        );
        await c.$executeRawUnsafe(
          `INSERT INTO "PlaybookProposal" (id,"playbookId","campaignId","proposalKey",title,observation,"suggestedChange","proposedRules",status,"tenantId","createdAt","updatedAt")
           VALUES ('prop-${t}','pb-${t}','camp-${t}','wait-longer-${t}','Wait longer','Replies arrive late.','Raise the threshold.','{}'::jsonb,'proposed','tenant-${t}',now(),now())`
        );
        await c.$executeRawUnsafe(
          `INSERT INTO "OutcomeSignal" (id,"signalKey",kind,direction,"leadId","campaignId","occurredAt","tenantId","createdAt")
           VALUES ('sig-${t}','reply-${t}','positive_reply',1,'lead-${t}','camp-${t}',now(),'tenant-${t}',now())`
        );
        // The approved-copy row is the prospect-facing content itself, so a leak here would be a
        // leak of another tenant's outreach wording. It needs an enrollment to hang off.
        await c.$executeRawUnsafe(
          `INSERT INTO "Sequence" (id,name,"isActive","isArchived","createdById","tenantId","createdAt","updatedAt")
           VALUES ('seq-${t}','Sequence ${t}',true,false,'user-${t}','tenant-${t}',now(),now())`
        );
        await c.$executeRawUnsafe(
          `INSERT INTO "SequenceEnrollment" (id,"leadId","sequenceId",status,"currentStep","occupancyKey","tenantId","startedAt")
           VALUES ('enr-${t}','lead-${t}','seq-${t}','active',1,'tenant-${t}:lead-${t}','tenant-${t}',now())`
        );
        await c.$executeRawUnsafe(
          `INSERT INTO "SequenceStepCopy" (id,"enrollmentId","stepOrder",subject,body,"citedEvidenceIds","aiGenerated","approvedAt","tenantId","createdAt")
           VALUES ('copy-${t}','enr-${t}',1,'Subject ${t}','Approved body ${t}',ARRAY[]::text[],true,now(),'tenant-${t}',now())`
        );
      }
    });

    // ── The matrix, as the unprivileged role holding tenant A's context ──────
    const appClient = new PrismaClient({
      datasources: { db: { url: dbUrl(DB_NAME, APP_ROLE, APP_PASSWORD) } },
    });

    /**
     * Runs one statement holding tenant A's context.
     *
     * The context and the statement have to share a connection, and issuing them as separate
     * client calls does not guarantee that: Prisma hands each call whichever pooled connection
     * is free, so the `set_config` can land on one connection and the query on another that
     * has no tenant context at all. The policy then correctly hides everything and the check
     * reports "expected 1 own row, saw 0" — the verifier failing, not RLS.
     *
     * That is exactly what happened on CI while every run on the developer machine passed,
     * because a quiet pool tends to reuse a single connection and a busy one does not.
     *
     * An interactive transaction pins both to the same connection. The settings are
     * transaction-scoped (`true`), so they also cannot leak into a later check.
     */
    const asTenantA = (sql) =>
      appClient.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id','tenant-a',true)`);
        await tx.$executeRawUnsafe(`SELECT set_config('app.bypass_rls','false',true)`);
        return tx.$queryRawUnsafe(sql);
      });

    try {
      console.log('Connected as an unprivileged role holding tenant A context:\n');

      const own = await asTenantA(`SELECT id FROM "Lead" WHERE "tenantId" = 'tenant-a'`);
      if (own.length === 1) {
        pass('reads its own tenant\'s rows');
      } else {
        fail(`expected 1 own row, saw ${own.length}`);
      }

      const other = await asTenantA(`SELECT id FROM "Lead" WHERE "tenantId" = 'tenant-b'`);
      if (other.length === 0) {
        pass('cannot read another tenant\'s rows');
      } else {
        fail(`LEAKED ${other.length} row(s) from tenant B`);
      }

      const byId = await asTenantA(`SELECT id FROM "Lead" WHERE id = 'lead-b'`);
      if (byId.length === 0) {
        pass('cannot read another tenant\'s row by direct id');
      } else {
        fail('LEAKED tenant B row via direct id lookup');
      }

      // The models added after the original matrix was written. `SequenceStepCopy` matters most
      // of all: it holds the approved prospect-facing wording, so a leak there is a leak of
      // another tenant's outreach copy rather than of a name and a company.
      for (const [tbl, id] of [
        ['Meeting', 'meet-b'],
        ['Opportunity', 'opp-b'],
        ['CampaignPlaybook', 'pb-b'],
        ['PlaybookProposal', 'prop-b'],
        ['OutcomeSignal', 'sig-b'],
        ['SequenceEnrollment', 'enr-b'],
        ['SequenceStepCopy', 'copy-b'],
      ]) {
        const check = await asTenantA(`SELECT id FROM "${tbl}" WHERE id = '${id}'`);
        if (check.length === 0) {
          pass(`cannot read tenant B ${tbl} by direct id`);
        } else {
          fail(`LEAKED tenant B ${tbl} row via direct id lookup`);
        }
      }

      const updated = await asTenantA(
        `WITH u AS (UPDATE "Lead" SET company='hijacked' WHERE id='lead-b' RETURNING 1) SELECT count(*)::int AS n FROM u`
      );
      if (Number(updated[0].n) === 0) {
        pass('cannot update another tenant\'s row');
      } else {
        fail('UPDATED a tenant B row');
      }

      const deleted = await asTenantA(
        `WITH d AS (DELETE FROM "Lead" WHERE id='lead-b' RETURNING 1) SELECT count(*)::int AS n FROM d`
      );
      if (Number(deleted[0].n) === 0) {
        pass('cannot delete another tenant\'s row');
      } else {
        fail('DELETED a tenant B row');
      }

      try {
        await asTenantA(
          `INSERT INTO "Lead" (id,"firstName","lastName",company,email,stage,"tenantId","createdAt","updatedAt")
           VALUES ('lead-x','X','X','X','x@example.test','new','tenant-b',now(),now())`
        );
        fail('INSERTED a row attributed to tenant B (WITH CHECK not enforced)');
      } catch {
        pass('cannot insert a row attributed to another tenant');
      }

      // Missing context must fail closed, not open.
      // Same pinning requirement: without it this can read on a connection that still holds
      // a tenant context from an earlier statement, and "fails closed" would pass for the
      // wrong reason.
      const noCtx = await appClient.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id','',true)`);
        await tx.$executeRawUnsafe(`SELECT set_config('app.bypass_rls','false',true)`);
        return tx.$queryRawUnsafe(`SELECT id FROM "Lead"`);
      });
      if (noCtx.length === 0) {
        pass('fails closed with no tenant context');
      } else {
        fail(`returned ${noCtx.length} row(s) with no tenant context — fails OPEN`);
      }
    } finally {
      await appClient.$disconnect();
    }

    // ── Control ──────────────────────────────────────────────────────────────
    // A suite that cannot fail proves nothing. The same query as the superuser must
    // still see both tenants: that confirms the assertions above are actually
    // detecting the policy rather than an empty table or a broken connection, and it
    // demonstrates the finding that superusers bypass RLS no matter what the policies
    // say. If this ever starts returning 1, the checks above have gone vacuous.
    console.log('\nControl — the same read as a superuser:');
    await admin(DB_NAME, async (c) => {
      await c.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id','tenant-a',false)`);
      await c.$executeRawUnsafe(`SELECT set_config('app.bypass_rls','false',false)`);
      const rows = await c.$queryRawUnsafe(`SELECT id FROM "Lead"`);
      if (rows.length === 2) {
        pass(`superuser sees both tenants (${rows.length} rows) — RLS does not apply to superusers`);
      } else {
        fail(
          `expected a superuser to see 2 rows, saw ${rows.length} — the checks above may be passing vacuously`
        );
      }
    });
  } finally {
    // ── Teardown ────────────────────────────────────────────────────────────
    await admin(base.pathname.replace('/', '') || 'postgres', async (c) => {
      await c.$executeRawUnsafe(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}'`
      );
      await c.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DB_NAME}"`);
      await c.$executeRawUnsafe(`DROP ROLE IF EXISTS "${APP_ROLE}"`);
    });
    console.log(`\nCleaned up ${DB_NAME} and ${APP_ROLE}.`);
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED — tenant isolation is not enforced.`);
    process.exit(1);
  }
  console.log('\nAll checks passed — PostgreSQL enforces tenant isolation.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
