import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import { PrismaClient } from '@prisma/client';

/**
 * Guards the *coverage* of `supabase/rls.sql` — that it would protect every tenant-owned
 * table — without applying it.
 *
 * Applying it here is not an option: several suites share one database, and enabling
 * FORCE ROW LEVEL SECURITY mid-run would make every row invisible to whichever file is
 * executing alongside this one. Proving enforcement needs an isolated database and a
 * non-superuser role; see `docs/pre-domain-hardening/STATUS.md`.
 *
 * What this does prove is the property that actually regressed: the file used to hardcode
 * a 24-name array against a schema with 41 tenant-owned models, so seventeen tables —
 * Opportunity, Meeting, Contact, Attachment, every ClientReport* — had no policy at all.
 * The list is now derived from the catalog, and these tests fail if anyone reverts that or
 * if the derivation stops matching the schema.
 */

const rlsSql = readFileSync('supabase/rls.sql', 'utf8');

/** Tenant-owned models, straight from the schema. `Tenant` itself carries no tenantId. */
function tenantModelsFromSchema(): string[] {
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  return [...schema.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)]
    .filter((m) => /\n\s+tenantId\s+String/.test(m[2]))
    .map((m) => m[1])
    .sort();
}

describe('supabase/rls.sql', () => {
  it('derives its table list from the catalog rather than hardcoding it', () => {
    // The specific regression: `tables TEXT[] := ARRAY[ 'User', 'Client', ... ]`.
    expect(rlsSql).not.toMatch(/tables\s+TEXT\[\]\s*:=\s*ARRAY\s*\[/);
    expect(rlsSql).toMatch(/FROM pg_class/);
    expect(rlsSql).toMatch(/a\.attname = 'tenantId'/);
  });

  it('forces RLS, so the table owner cannot bypass the policy', () => {
    // Without FORCE, the owner — which is who the app connects as — ignores the policy
    // entirely and the whole file protects nothing.
    expect(rlsSql).toMatch(/FORCE ROW LEVEL SECURITY/);
    expect(rlsSql).toMatch(/ENABLE ROW LEVEL SECURITY/);
  });

  it('reads the same GUCs the application sets', () => {
    // lib/prisma.ts sets app.bypass_rls and app.current_tenant_id per transaction. If
    // these names drift apart the policy silently denies everything, or allows it.
    expect(rlsSql).toMatch(/current_setting\('app\.bypass_rls', true\)/);
    expect(rlsSql).toMatch(/current_setting\('app\.current_tenant_id', true\)/);
  });

  it('refuses to report success against an unmigrated database', () => {
    // Zero tables found would otherwise look like a clean apply.
    expect(rlsSql).toMatch(/RAISE EXCEPTION/);
  });
});

describe.skipIf(!process.env.DATABASE_URL)('RLS coverage against the live catalog', () => {
  it('protects exactly the tenant-owned models — no more, no fewer', async () => {
    const expected = tenantModelsFromSchema();

    // The same predicate rls.sql loops over. If this drifts from the schema, a model has
    // been added whose table would silently sit outside tenant isolation.
    const raw = new PrismaClient();
    try {
      const rows = await raw.$queryRaw<Array<{ relname: string }>>`
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND a.attname = 'tenantId'
          AND NOT a.attisdropped
        ORDER BY c.relname
      `;
      const actual = rows.map((r) => r.relname).sort();

      expect(actual).toEqual(expected);
      // Sanity floor: a passing empty comparison would be meaningless.
      expect(actual.length).toBeGreaterThan(30);
    } finally {
      await raw.$disconnect();
    }
  });
});

/**
 * The other half of the story: what an RLS-enabled deployment actually gets.
 *
 * Prisma migrations deliberately contain no RLS statements, so a table only comes under
 * `tenant_isolation` when `supabase/rls.sql` is (re)applied — see `docs/DEPLOY.md`. This
 * applies it the way `scripts/verify-rls.mjs` does, against a throwaway database, and asserts
 * the catalog result: ENABLE + FORCE + exactly one `tenant_isolation` policy per tenant-owned
 * table, the newest ones included.
 *
 * It builds its own database because enabling FORCE on the shared test database would hide
 * every row from whichever suite is running alongside this one. Set `SKIP_ISOLATED_RLS=1` if
 * the connecting role cannot CREATE DATABASE.
 */
const PHASE7_TABLES = [
  'AccountResearchCache',
  'ContactResearchCache',
  'CompanySignal',
  'AccountPainHypothesis',
  'PersonalizationHook',
];

const isolatedRlsEnabled = !!process.env.DATABASE_URL && process.env.SKIP_ISOLATED_RLS !== '1';

describe.skipIf(!isolatedRlsEnabled)('supabase/rls.sql applied to an isolated database', () => {
  it(
    'puts every tenant-owned table — including the Phase 7 ones — under ENABLE + FORCE + one tenant_isolation policy',
    async () => {
      const adminUrl = process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL!;
      const dbName = `crm_rls_cover_${randomBytes(4).toString('hex')}`;
      const urlFor = (name: string) => {
        const u = new URL(adminUrl);
        u.pathname = `/${name}`;
        return u.toString();
      };

      const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
      try {
        await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
      } finally {
        await admin.$disconnect();
      }

      const target = new PrismaClient({ datasources: { db: { url: urlFor(dbName) } } });
      try {
        // Schema straight from the datamodel — the same source the migrations converge on,
        // and the same technique scripts/verify-rls.mjs uses.
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

        for (const stmt of schemaSql.split(/;\s*\r?\n/).map((s) => s.trim()).filter(Boolean)) {
          await target.$executeRawUnsafe(stmt);
        }

        // Before rls.sql: the schema alone protects nothing at the database layer.
        const before = await target.$queryRawUnsafe<Array<{ relrowsecurity: boolean }>>(
          `SELECT c.relrowsecurity FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname = 'CompanySignal'`
        );
        expect(before[0]?.relrowsecurity).toBe(false);

        await target.$executeRawUnsafe(readFileSync('supabase/rls.sql', 'utf8'));

        const rows = await target.$queryRawUnsafe<
          Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean; policies: bigint }>
        >(
          `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
                  (SELECT count(*) FROM pg_policy p
                     WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation') AS policies
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             JOIN pg_attribute a ON a.attrelid = c.oid
            WHERE n.nspname = 'public' AND c.relkind = 'r'
              AND a.attname = 'tenantId' AND NOT a.attisdropped
            ORDER BY c.relname`
        );

        expect(rows.length).toBeGreaterThan(30);
        for (const row of rows) {
          expect(row.relrowsecurity, `${row.relname} ENABLE`).toBe(true);
          expect(row.relforcerowsecurity, `${row.relname} FORCE`).toBe(true);
          expect(Number(row.policies), `${row.relname} tenant_isolation policies`).toBe(1);
        }

        // The five Phase 7 tables specifically, named so a silent omission cannot pass.
        const covered = rows.map((r) => r.relname);
        for (const table of PHASE7_TABLES) {
          expect(covered).toContain(table);
        }
      } finally {
        await target.$disconnect();
        const cleanup = new PrismaClient({ datasources: { db: { url: adminUrl } } });
        try {
          await cleanup.$executeRawUnsafe(
            `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbName}'`
          );
          await cleanup.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
        } finally {
          await cleanup.$disconnect();
        }
      }
    },
    180_000
  );
});
