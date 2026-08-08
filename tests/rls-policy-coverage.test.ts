import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
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
