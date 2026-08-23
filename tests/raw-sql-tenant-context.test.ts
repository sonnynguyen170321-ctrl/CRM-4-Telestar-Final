import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * Raw SQL is outside the tenant extension, and nothing about that is visible at the call site.
 *
 * `lib/prisma.ts` registers `query.$allModels`. `$queryRaw` and `$executeRaw` are **root client
 * operations**, so they are outside it by construction: no `set_config` runs and the statement
 * reaches PostgreSQL with no tenant context. Under `FORCE ROW LEVEL SECURITY` it then matches
 * no policy and touches zero rows — without raising, because an empty result is not an error.
 *
 * Measured on 2026-08-23 by `npm run verify:rls-app-paths`, same client and same tenant context:
 *
 *     prisma.lead.count()                    1     (extension sets app.current_tenant_id)
 *     prisma.$queryRaw ... FROM "Lead"       0     (nothing sets it)
 *     withTenantRaw(t, db => db.$queryRaw)   1
 *
 * That harness proves the *mechanism*. This file answers the different question of *coverage*:
 * whether any call site still reaches a tenant-owned table without one of the helpers. It is a
 * source-level check on purpose — it needs no database, so it runs on every commit, whereas the
 * harness needs PostgreSQL and a NOSUPERUSER role.
 *
 * A new bare raw call on a tenant-owned table is a latent outage the moment RLS is enabled, and
 * an ordinary passing test suite would say nothing about it: locally the role is a superuser,
 * and RLS never applies to a superuser.
 */

const ROOTS = ['app', 'lib', 'workers'] as const;

/**
 * Call sites that are correct as they are, each for a reason that is checked below rather than
 * asserted. An exemption list nobody re-verifies is how the hardcoded 24-table array in
 * `supabase/rls.sql` came to miss seventeen tables.
 */
const ALLOWED = new Map<string, string>([
  // No table at all — a reachability ping. No policy can apply.
  [join('app', 'api', 'health', 'route.ts'), 'SELECT 1'],
  [join('app', 'api', 'admin', 'worker-health', 'route.ts'), 'SELECT 1'],
  [join('workers', 'healthcheck.ts'), 'SELECT 1'],
  // `_prisma_migrations` has no `tenantId`, so `rls.sql` never gave it a policy.
  [join('lib', 'db', 'migrationStatus.ts'), '_prisma_migrations'],
  // The `tenantId`-less branch, kept deliberately: with no tenant to set, the only thing that
  // would "work" is a cross-tenant bypass, and silently widening a search to every tenant is
  // worse than returning nothing. Documented at the call site.
  [join('lib', 'search', 'accentSearch.ts'), 'optional tenantId'],
]);

/** `lib/prisma.ts` defines the helpers, so it is the one file that must contain bare raw calls. */
const HELPER_FILE = join('lib', 'prisma.ts');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      out.push(...walk(full));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

const files = ROOTS.flatMap((root) => walk(join(process.cwd(), root))).map((f) =>
  relative(process.cwd(), f)
);

const offenders = files.filter((file) => {
  const key = file.split('/').join(sep);
  if (key === HELPER_FILE || ALLOWED.has(key)) return false;
  const source = readFileSync(file, 'utf8');
  return /prisma\.\$(query|execute)Raw/.test(source);
});

describe('raw SQL carries a tenant context', () => {
  it('has no un-exempted bare prisma.$queryRaw / $executeRaw under app, lib or workers', () => {
    expect(offenders).toEqual([]);
  });

  it('exempts only call sites that touch no tenant-owned table', () => {
    // The exemption is the claim; this is the check. `SELECT 1` and `_prisma_migrations` must
    // actually be all these files do rawly — if one grows a real query, the exemption becomes
    // a hole and this fails.
    for (const [file, why] of ALLOWED) {
      if (why === 'optional tenantId') continue;
      const source = readFileSync(file, 'utf8');
      const rawCalls = source.match(/prisma\.\$(query|execute)Raw[\s\S]{0,200}?`[\s\S]*?`/g) ?? [];
      expect(rawCalls.length, `${file} has no raw call left to exempt`).toBeGreaterThan(0);
      for (const call of rawCalls) {
        expect(call, `${file} was exempted for ${why}`).toContain(why);
      }
    }
  });

  it('keeps the accentSearch exemption narrowed to the untenanted branch', () => {
    // The scoped branch must go through the helper. If the ternary is ever collapsed back to a
    // single bare call, every tenant-scoped search silently returns nothing under RLS.
    const source = readFileSync(join('lib', 'search', 'accentSearch.ts'), 'utf8');
    expect(source).toContain('withTenantRaw(tenantId');
    expect(source).toMatch(/tenantId\s*\?\s*await withTenantRaw/);
  });
});

describe('the helpers themselves', () => {
  const source = readFileSync(HELPER_FILE, 'utf8');

  it('sets the tenant transaction-locally, so it cannot leak across the pool', () => {
    // `true` is the is_local argument. Session-wide would leave the context set on a pooled
    // connection for whatever runs next on it — a cross-tenant read waiting to happen.
    expect(source).toMatch(/set_config\('app\.current_tenant_id', \$\{tenantId\}, true\)/);
    expect(source).toMatch(/set_config\('app\.bypass_rls', 'true', true\)/);
  });

  it('clears any inherited bypass when scoping to a tenant', () => {
    // Setting only `current_tenant_id` would leave a bypass from earlier in the same
    // transaction standing, and the policy is an OR — the bypass half would win.
    const fn = source.slice(source.indexOf('export async function withTenantRaw'));
    const clears = fn.indexOf("set_config('app.bypass_rls', 'false', true)");
    const scopes = fn.indexOf("set_config('app.current_tenant_id'");
    expect(clears).toBeGreaterThan(-1);
    expect(scopes).toBeGreaterThan(clears);
  });

  it('uses interactive transactions, not the array form', () => {
    // The array form takes UNEXECUTED PrismaPromises, so a callback handed to it would already
    // have started its query outside the transaction, where the GUC does not apply — and the
    // context would silently do nothing, which is the failure it exists to prevent.
    const helpers = source.slice(source.indexOf('export async function withTenantRaw'));
    expect(helpers).toMatch(/\$transaction\(async \(tx\) =>/);
    expect(helpers).not.toMatch(/\$transaction\(\[/);
  });

  it('pays nothing when RLS is not enforced', () => {
    // The ordinary deployment must not take extra round-trips per raw statement.
    expect(source).toMatch(/if \(!DB_RLS_ENFORCED\) return run\(basePrisma as PrismaClient\)/);
  });

  it('keeps the cross-tenant bypass a separate, deliberate call', () => {
    // Not a `tenantId === null` branch of withTenantRaw: that would turn a forgotten argument
    // into a silent cross-tenant read. Asking for the bypass has to be explicit.
    expect(source).toContain('export async function withBypassRaw');
    const scoped = source.slice(
      source.indexOf('export async function withTenantRaw'),
      source.indexOf('export async function withBypassRaw')
    );
    expect(scoped).not.toContain("set_config('app.bypass_rls', 'true'");
  });
});
