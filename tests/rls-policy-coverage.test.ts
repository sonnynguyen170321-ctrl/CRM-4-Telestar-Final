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

/**
 * The same file with `--` comment lines removed.
 *
 * These assertions used to run against the raw text, and one of them checked that the policy
 * reads `current_setting('app.bypass_rls', true)`. That stopped being true when the policies
 * became role-targeted — the flag was removed from the policy deliberately — and the test kept
 * passing anyway, because the header still *describes* the old form in prose. A test that can
 * be satisfied by a comment is not testing the file.
 */
const rlsCode = rlsSql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

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

  it('reads the same GUC the application sets', () => {
    // lib/prisma.ts sets app.current_tenant_id per transaction. If these names drift apart the
    // policy silently denies everything, or allows it.
    expect(rlsCode).toMatch(/current_setting\('app\.current_tenant_id', true\)/);
  });

  it('grants the application role a predicate with no bypass in it', () => {
    // Two properties in one assertion, and both were paid for.
    //
    // Security: `supabase/roles.sql` wanted `crm_app` to be unable to set `app.bypass_rls` and
    // read across tenants, and admitted nothing enforced it — "Postgres has no per-GUC
    // permission for custom settings". A policy that does not mention the flag cannot be
    // tricked by it, so the privilege now lives in which role you connect as.
    //
    // Performance: the previous single policy was `bypass = 'true' OR "tenantId" = ...`, and the
    // first branch references no column, so PostgreSQL could not turn the predicate into an
    // index condition. Measured against 417,472 leads on 2026-08-23, the same 1,000-row read
    // took 10 ms as a Bitmap Index Scan and 1,296 ms as a Parallel Seq Scan discarding 138,805
    // rows per worker. Every tenantId index in the product went dead the moment RLS was on.
    //
    // Reverting either property means putting `app.bypass_rls` back into this policy, so its
    // absence is the thing worth asserting.
    const tenantPolicy = rlsCode.slice(
      rlsCode.indexOf('CREATE POLICY tenant_isolation'),
      rlsCode.indexOf('CREATE POLICY maintenance_bypass')
    );
    expect(tenantPolicy).toContain('TO crm_app');
    expect(tenantPolicy).toMatch(/USING \("tenantId" = current_setting\('app\.current_tenant_id', true\)\)/);
    expect(tenantPolicy).not.toContain('app.bypass_rls');
    expect(tenantPolicy).not.toMatch(/\bOR\b/);
  });

  it('gives cross-tenant access its own role-targeted policy', () => {
    // Workers, seeds, scripts and the public share-link lookup legitimately cross tenants. They
    // connect as crm_maintenance now rather than raising a flag the application could raise too.
    expect(rlsCode).toContain('CREATE POLICY maintenance_bypass');
    expect(rlsCode).toContain('TO crm_maintenance');
  });

  it('refuses to run before the roles its policies target exist', () => {
    // CREATE POLICY ... TO <role> fails per table if the role is missing. Failing once, up
    // front, with the name of the file to apply first, beats forty confusing failures.
    expect(rlsCode).toMatch(/pg_roles/);
    expect(rlsCode).toMatch(/roles\.sql/);
  });

  it('refuses to report success against an unmigrated database', () => {
    // Zero tables found would otherwise look like a clean apply.
    expect(rlsSql).toMatch(/RAISE EXCEPTION/);
  });
});

describe.skipIf(!process.env.DATABASE_URL)('RLS coverage against the live catalog', () => {
  /**
   * Every tenant-owned model in the schema has a table the policy loop will reach.
   *
   * This asserted set *equality* with the catalog, which also caught a table in the database that
   * the schema does not know about. That half cannot hold against this database: the local
   * Postgres is shared between worktrees, so a branch with extra migrations applied leaves its
   * tables behind and the equality fails for a reason that has nothing to do with this branch's
   * coverage — as it does today, with two tables from a Phase 10 branch sitting in `public`.
   *
   * The property that matters — no model of *ours* sits outside tenant isolation — is asserted in
   * full below, and names the offender rather than printing two truncated arrays. "No unknown
   * extras" is checked properly by the migration drift gate, which runs against a fresh shadow
   * database where a stray table cannot exist in the first place.
   */
  it('protects every tenant-owned model in the schema', async () => {
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
      const catalog = new Set(rows.map((r: { relname: string }) => r.relname));
      const missing = expected.filter((model) => !catalog.has(model));

      // Named, not counted: a failure here has to say which model would sit outside isolation.
      expect(missing).toEqual([]);
      // Sanity floor: a passing empty comparison would be meaningless.
      expect(expected.length).toBeGreaterThan(30);
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

      // `rls.sql` refuses to run unless the roles its policies name already exist, and this
      // test used to depend on someone having applied `supabase/roles.sql` to the cluster by
      // hand. That is true on a developer machine and false on a fresh Postgres service
      // container, so CI failed here — with a message about roles — while every developer clone
      // passed. A test that only works on a machine already configured by hand is not testing
      // the file, it is testing the machine.
      //
      // The roles are created here instead, and NAMESPACED, for the reason
      // `scripts/verify-rls-enablement.mjs` records: PostgreSQL roles are CLUSTER-wide, not
      // per-database. Using the literal names would find `crm_app` already present on a real
      // deployment sharing the server, and the teardown below would then DROP a role live
      // databases depend on. A per-run suffix cannot collide, so creating and dropping it is
      // safe anywhere.
      //
      // NOLOGIN deliberately: the policies only need the roles to *exist* and to be nameable as
      // policy targets. Nothing here connects as them, so no test-created credential exists.
      const roleSuffix = randomBytes(3).toString('hex');
      const BASE_ROLES = ['crm_app', 'crm_maintenance'] as const;
      const roleName = (base: string) => `${base}_${roleSuffix}`;
      const namespaceRoles = (sql: string) =>
        BASE_ROLES.reduce(
          (acc, base) => acc.replace(new RegExp(`\\b${base}\\b`, 'g'), roleName(base)),
          sql
        );

      // The one thing this test must never do.
      //
      // It applies `supabase/rls.sql`, which ENABLEs and FORCEs row-level security on every
      // tenant-owned table. Against the *shared* database that would make every row invisible to
      // every other suite running beside it — which looks exactly like the symptom this harness
      // has shown before: dozens of unrelated files failing at once, then passing on a rerun.
      //
      // A misread env var or a future edit to `urlFor` is all it would take, so the separation is
      // asserted rather than assumed.
      const targetUrl = urlFor(dbName);
      expect(new URL(targetUrl).pathname).not.toBe(new URL(adminUrl).pathname);
      expect(dbName).toMatch(/^crm_rls_cover_/);

      const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
      try {
        await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
        for (const base of BASE_ROLES) {
          await admin.$executeRawUnsafe(
            `CREATE ROLE "${roleName(base)}" NOLOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOINHERIT`
          );
        }
      } finally {
        await admin.$disconnect();
      }

      const target = new PrismaClient({ datasources: { db: { url: targetUrl } } });
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

        await target.$executeRawUnsafe(namespaceRoles(readFileSync('supabase/rls.sql', 'utf8')));

        const rows = await target.$queryRawUnsafe<
          Array<{
            relname: string;
            relrowsecurity: boolean;
            relforcerowsecurity: boolean;
            policies: bigint;
            bypass_policies: bigint;
          }>
        >(
          `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
                  (SELECT count(*) FROM pg_policy p
                     WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation') AS policies,
                  (SELECT count(*) FROM pg_policy p
                     WHERE p.polrelid = c.oid AND p.polname = 'maintenance_bypass') AS bypass_policies
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
          // Both, not just the first. A table that got tenant_isolation without
          // maintenance_bypass is unreachable by workers, seeds, scripts and the public
          // share-link lookup — and unreachable silently, as zero rows rather than an error.
          expect(
            Number(row.bypass_policies),
            `${row.relname} maintenance_bypass policies`
          ).toBe(1);
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
          // After the database, never before: the policies inside it depend on these roles, and
          // the suffix guarantees they belong to this run alone.
          for (const base of BASE_ROLES) {
            await cleanup.$executeRawUnsafe(`DROP ROLE IF EXISTS "${roleName(base)}"`);
          }
        } finally {
          await cleanup.$disconnect();
        }
      }
    },
    180_000
  );
});
