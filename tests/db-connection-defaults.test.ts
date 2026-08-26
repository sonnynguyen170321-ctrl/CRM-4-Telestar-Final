/**
 * Fallback database URLs must name 127.0.0.1, never `localhost`.
 *
 * Docker publishes 5432 on both stacks — `docker port` reports `0.0.0.0:5432` and `[::]:5432` —
 * but the IPv6 loopback answers ECONNREFUSED while 127.0.0.1 connects. Node resolves
 * `localhost` to `::1` first, so every connection is refused once and then depends on the IPv4
 * fallback. The fallback usually wins. Under the connection burst at suite startup it sometimes
 * does not, and the run dies with:
 *
 *     Can't reach database server at `localhost:5432`
 *
 * from whichever test file happened to start first — a different one each time, which is what
 * made it read as a flaky test rather than as a misconfigured hostname.
 *
 * The tell that it was never a timeout: the failure arrived at 2075ms, far short of Prisma's
 * 5s connect timeout. ECONNREFUSED is immediate.
 *
 * This is a text check on purpose. Asserting that `::1` is unreachable would encode one
 * machine's networking into the suite, and it is not true everywhere — a Linux CI runner
 * generally does listen on both. The rule that holds everywhere is the one asserted here:
 * a default DSN should not depend on which address family the resolver happens to prefer.
 *
 * Only fallbacks are covered. Assertion literals in other suites — seed-guard, the gitleaks
 * allowlist, restore-internal-users — contain `localhost:5432` as test data and must keep it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Files whose `||` fallbacks actually open a connection. */
const FILES_WITH_FALLBACK_DSNS = [
  'vitest.config.ts',
  join('scripts', 'verify-rls.mjs'),
  join('scripts', 'verify-rls-enablement.mjs'),
  join('scripts', 'verify-rls-app-paths.mjs'),
  join('scripts', 'audit-cross-tenant-rows.mjs'),
  join('tests', 'ai-durable-budget.test.ts'),
];

describe('fallback database URLs', () => {
  it.each(FILES_WITH_FALLBACK_DSNS)('%s does not fall back to localhost', (file) => {
    const source = readFileSync(join(process.cwd(), file), 'utf8');

    // Only quoted DSN literals. Prose in a comment may name localhost — the explanation of
    // this very defect does — and a comment opens no sockets.
    const dsns = [...source.matchAll(/['"`](postgres(?:ql)?:\/\/[^'"`]+)['"`]/g)].map((m) => m[1]);

    const viaLocalhost = dsns.filter((dsn) => /@localhost[:/]/.test(dsn));
    expect(
      viaLocalhost,
      `${file} falls back to a localhost DSN; use 127.0.0.1 so the connection does not ` +
        `depend on the resolver preferring IPv4 over an IPv6 loopback that refuses`,
    ).toEqual([]);
  });

  it('still finds DSNs to check, so the assertion cannot pass vacuously', () => {
    // Without this, deleting every DSN from every file above would read as success.
    const found = FILES_WITH_FALLBACK_DSNS.flatMap((file) => {
      const source = readFileSync(join(process.cwd(), file), 'utf8');
      return [...source.matchAll(/['"`](postgres(?:ql)?:\/\/[^'"`]+)['"`]/g)].map((m) => m[1]);
    });
    expect(found.length).toBeGreaterThanOrEqual(FILES_WITH_FALLBACK_DSNS.length);
  });
});
