import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Enabling database-level RLS would have broken every client report share link.
 *
 * `lib/client-reports/shareLinks.ts` uses a deliberately unextended `PrismaClient`. Its header
 * explains why: the public share endpoint is the one route in the product that answers with no
 * session, so there is no tenant context, and `tenantStorage.run({ bypassRls: true })` does not
 * work there because Next splits the `AsyncLocalStorage` across chunks.
 *
 * That client sets none of the GUCs `supabase/rls.sql` reads. Under `FORCE ROW LEVEL SECURITY`
 * the policy is:
 *
 *     USING (current_setting('app.bypass_rls', true) = 'true'
 *         OR "tenantId" = current_setting('app.current_tenant_id', true))
 *
 * With neither set, both `current_setting(..., true)` calls return NULL, both halves are false,
 * and every query returns zero rows — reproducing "Invalid or expired report link" for valid
 * tokens, which is the exact bug that header records as already fixed once.
 *
 * Measured against a non-superuser on a database with the policies applied, before any of this
 * shipped:
 *
 *     no GUCs set          Lead visible:       0
 *     app.bypass_rls=true  Lead visible: 362,018   (identical to the superuser control)
 *
 * A passing local suite proves nothing about this: the local role is a superuser, and RLS never
 * applies to a superuser. `scripts/verify-rls.mjs` connects as a non-superuser for that reason.
 */

/**
 * Comments are stripped before any of these assertions run.
 *
 * `tests/rls-policy-coverage.test.ts` asserted that `supabase/rls.sql` reads
 * `current_setting('app.bypass_rls', true)`. The role-targeted rewrite removed that flag from
 * the policy entirely, and the test kept passing — because the file's header comment still
 * *described* the old form while explaining why it changed. It asserted a property that had
 * stopped being true, and nothing would have caught a revert to the policy shape that turned
 * every tenantId index into a sequential scan.
 *
 * Every assertion below was checked against comment-stripped source when this was written, and
 * all of them hold against code rather than prose. Stripping keeps it that way: a source-level
 * test is only worth anything if a comment can neither satisfy it nor break it.
 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const source = stripComments(
  readFileSync(join(process.cwd(), 'lib', 'client-reports', 'shareLinks.ts'), 'utf8')
);

describe('the public share path survives database-level RLS', () => {
  it('routes every unextended query through the bypass helper', () => {
    // The failure is silent — zero rows, not an error — so a missed call site would look like
    // a revoked link rather than a bug.
    expect(source).not.toMatch(/await publicShareDb\.clientReportShareLink\./);
    expect(source).toContain('withPublicShareBypass');
  });

  it('covers both the lookup and the view-counter write', () => {
    // Call sites only — the definition is generic (`withPublicShareBypass<T>(`) and would not
    // be counted by a bare-paren match anyway, which is how the first version of this
    // assertion managed to be wrong about a file that was already correct.
    const calls = source.match(/await withPublicShareBypass\(/g) ?? [];
    expect(calls).toHaveLength(2);
    expect(source).toMatch(/withPublicShareBypass\(\(db\) =>\s*\n?\s*db\.clientReportShareLink\.findUnique/);
    expect(source).toMatch(/withPublicShareBypass\(\(db\) =>\s*\n?\s*db\.clientReportShareLink\.update/);
  });

  it('sets the bypass transaction-locally, so it cannot leak across the pool', () => {
    // `true` is the is_local argument. Session-wide would leave the bypass set on a pooled
    // connection for whatever runs next on it.
    expect(source).toMatch(/set_config\('app\.bypass_rls', 'true', true\)/);
  });

  it('uses an interactive transaction, not the array form', () => {
    // The array form takes UNEXECUTED PrismaPromises. A callback passed to it would already
    // have started its query outside the transaction, where the GUC does not apply — and the
    // bypass would silently do nothing, which is the same failure it exists to prevent.
    expect(source).toMatch(/\$transaction\(async \(tx\) =>/);
    expect(source).not.toMatch(/\$transaction\(\[/);
  });

  it('pays nothing when RLS is not enforced', () => {
    // The ordinary deployment must not take an extra round-trip per public share view.
    expect(source).toMatch(/if \(!DB_RLS_ENFORCED\) return run\(publicShareDb\)/);
  });

  it('reads the same switch lib/prisma.ts reads', () => {
    // Two different switches would let the application enter RLS mode while this file did not.
    expect(source).toContain("process.env.DB_RLS_ENFORCED === 'true'");
    const prismaSource = stripComments(readFileSync(join(process.cwd(), 'lib', 'prisma.ts'), 'utf8'));
    expect(prismaSource).toContain("process.env.DB_RLS_ENFORCED === 'true'");
  });

  it('still validates the token before returning anything', () => {
    // The bypass is only defensible because the token IS the credential and is checked
    // immediately. If that ordering ever inverts, this becomes an unauthenticated read of any
    // tenant's report.
    const fn = source.slice(source.indexOf('export async function verifyAndFetchSharedReport'));
    const lookup = fn.indexOf('findUnique');
    const revoked = fn.indexOf('shareLink.revokedAt');
    const expired = fn.indexOf('shareLink.expiresAt');
    const returned = fn.indexOf('toClientSafeSnapshot');
    expect(lookup).toBeGreaterThan(-1);
    expect(revoked).toBeGreaterThan(lookup);
    expect(expired).toBeGreaterThan(lookup);
    expect(returned).toBeGreaterThan(expired);
  });
});

describe('the RLS policy itself is what makes this necessary', () => {
  const rls = readFileSync(join(process.cwd(), 'supabase', 'rls.sql'), 'utf8');

  it('reads exactly the two settings this file sets', () => {
    expect(rls).toContain("current_setting('app.bypass_rls', true) = 'true'");
    expect(rls).toContain(`"tenantId" = current_setting('app.current_tenant_id', true)`);
  });

  it('forces the policy on the table owner, which is why a bare client is not exempt', () => {
    // Owners bypass RLS by default; the app connects as the owner. Without FORCE none of this
    // would apply — and the isolation would be theatre.
    expect(rls).toContain('FORCE ROW LEVEL SECURITY');
  });

  it('derives its table list rather than hardcoding one', () => {
    // A hardcoded array is how seventeen tenant-owned tables, including Opportunity and
    // Meeting, ended up with no policy at all.
    expect(rls).toContain("a.attname = 'tenantId'");
    expect(rls).not.toMatch(/tables\s*:=\s*ARRAY\[/);
  });
});
