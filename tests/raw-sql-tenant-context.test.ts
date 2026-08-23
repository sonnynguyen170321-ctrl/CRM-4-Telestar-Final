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

/**
 * The same question for the other client that sets no GUCs: a bare `new PrismaClient()`.
 *
 * Tooling holds one on purpose — it is cross-tenant admin work and opts out of the extension
 * deliberately. Under enforcement `DATABASE_URL` points at `crm_app`, which is `NOSUPERUSER`
 * and therefore subject to `FORCE`, so a bare client reads zero rows and an audit reports a
 * clean, empty, wrong answer. `createAdminClient` sets `app.bypass_rls` at connection start.
 */
describe('operational tooling uses the admin client', () => {
  /**
   * The ones that must NOT be converted, each because a bypass would defeat what they exist
   * to do. This list is the dangerous one to get wrong in the *other* direction, so each entry
   * says what would break.
   */
  const MUST_STAY_BARE = new Map<string, string>([
    // Exists to prove the policies keep tenants apart. A bypassed client would pass every
    // assertion in it while proving nothing at all.
    [join('scripts', 'verify-rls.mjs'), 'verifies enforcement'],
    [join('tests', 'rls-policy-coverage.test.ts'), 'verifies enforcement'],
    // Rehearses the enablement sequence by connecting as the real crm_migrator and crm_app
    // with their own credentials. Routing it through the admin client would set the bypass on
    // every connection and the isolation checks would pass without isolation.
    [join('scripts', 'verify-rls-enablement.mjs'), 'verifies enforcement'],
    [join('scripts', 'verify-rls-live.mjs'), 'verifies enforcement'],
    // The harness. Its bare clients are deliberate red controls — probes 3, 5 and the last one
    // assert that an unbypassed client sees nothing.
    [join('scripts', 'verify-rls-app-paths.probe.ts'), 'red controls'],
    [join('scripts', 'verify-rls-app-paths.mjs'), 'superuser setup'],
    // The tenant extension and the helper itself.
    [join('lib', 'prisma.ts'), 'defines the extension'],
    [join('lib', 'db', 'adminClient.mjs'), 'defines the helper'],
    // A request path, not tooling. It gets its bypass per statement, scoped to a validated
    // share token — see lib/client-reports/shareLinks.ts.
    [join('lib', 'client-reports', 'shareLinks.ts'), 'request path, bypasses per statement'],
  ]);

  const TOOLING_ROOTS = ['scripts', 'prisma', 'tests', 'lib', 'workers', 'app'] as const;

  const toolingFiles = TOOLING_ROOTS.flatMap((root) => {
    try {
      return walk(join(process.cwd(), root));
    } catch {
      return [];
    }
  })
    .concat(
      // `.mjs` tooling is not picked up by `walk`, which only collects TypeScript.
      ['scripts', join('scripts', 'certification'), join('lib', 'db')].flatMap((dir) => {
        try {
          return readdirSync(dir)
            .filter((f) => f.endsWith('.mjs'))
            .map((f) => join(process.cwd(), dir, f));
        } catch {
          return [];
        }
      })
    )
    .concat(
      // The repository root, non-recursively. Nothing lives here today — `inspect_policies.ts`
      // was deleted on 2026-08-23 — but a stray script landed at the root once and no
      // directory scan reached it, so the root is swept rather than assumed empty.
      readdirSync(process.cwd())
        .filter((f) => f.endsWith('.ts') || f.endsWith('.mjs'))
        .map((f) => join(process.cwd(), f))
    )
    .map((f) => relative(process.cwd(), f));

  /**
   * Comments are stripped before matching. `lib/seed-guard.ts` explains at length why the seed
   * uses a bare client and would otherwise be reported for describing the thing it guards —
   * and a check that cannot tell prose from code trains people to add exemptions, which is how
   * an exemption list stops meaning anything.
   */
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const bare = toolingFiles.filter((file) => {
    const key = file.split('/').join(sep);
    if (MUST_STAY_BARE.has(key) || key === join('tests', 'raw-sql-tenant-context.test.ts')) {
      return false;
    }
    return /new PrismaClient\(/.test(stripComments(readFileSync(file, 'utf8')));
  });

  it('has no un-exempted bare new PrismaClient()', () => {
    expect(bare).toEqual([]);
  });

  it('still has the enforcement verifiers using a bare client', () => {
    // The inverse failure, and the worse one. If `verify-rls.mjs` ever gained the bypass it
    // would pass every assertion while proving nothing — a green light on isolation that was
    // never tested. Same for the harness red controls.
    for (const [file, why] of MUST_STAY_BARE) {
      if (why !== 'verifies enforcement' && why !== 'red controls') continue;
      const source = readFileSync(file, 'utf8');
      expect(source, `${file} must keep a bare client — it ${why}`).toMatch(/new PrismaClient\(/);
      // The harness is the one place both belong: it holds bare clients as red controls AND
      // exercises `createAdminClient` as the thing under test. Only the pure verifiers must be
      // free of it — a bypass there would turn every assertion green while proving nothing.
      if (why === 'verifies enforcement') {
        expect(source, `${file} must not use createAdminClient — it ${why}`).not.toContain(
          'createAdminClient('
        );
      }
    }
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
