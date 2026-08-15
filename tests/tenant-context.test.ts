import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/api/tenant';

/**
 * A request without a tenant is refused, not defaulted.
 *
 * The leadgen surface resolved its tenant as `user.tenantId || 'default-tenant'` in eleven places.
 * The fallback never fires in normal operation, which is what made it worth removing: on the day a
 * session arrived without a tenant, the request would not fail — it would read and write **a real
 * tenant named `default-tenant`**, and every log line would look like ordinary traffic.
 *
 * `lib/prisma.ts` stamps and filters `tenantId` itself, so a route either passes a tenant that was
 * actually resolved or refuses. `docs/../runtime-hardening` lists blind tenant defaults in runtime
 * writes as forbidden; this test is what makes that enforceable rather than aspirational.
 */

const ROOT = process.cwd();

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

describe('requireTenantId', () => {
  it('returns the tenant when the session carries one', () => {
    expect(requireTenantId({ tenantId: 'tenant-1' } as never)).toBe('tenant-1');
  });

  it('refuses with 403 when it does not', () => {
    for (const missing of [undefined, null, '']) {
      const result = requireTenantId({ tenantId: missing } as never);
      expect(result).toBeInstanceOf(NextResponse);
      expect((result as NextResponse).status).toBe(403);
    }
  });
});

describe('production code never invents a tenant', () => {
  /**
   * The whole request/auth/data-access surface, not just leadgen.
   *
   * `lib/prisma.ts` is the one legitimate use of the literal: it runs the session lookup itself
   * inside a bypass context, because the tenant is exactly what that call is trying to discover.
   * It is excluded by path rather than by pattern so the exemption is visible.
   */
  const dirs = ['app/api', 'lib', 'workers'];
  const EXEMPT = [
    path.join('lib', 'prisma.ts'),        // resolves the session; the placeholder never scopes data
    path.join('lib', 'bullmq', 'workerUtils.ts'), // same, for the JobRun lookup that finds the tenant
  ];
  const files = dirs
    .flatMap((dir) => walk(path.join(ROOT, dir)))
    .filter((file) => !EXEMPT.some((exempt) => file.endsWith(exempt)));

  it('reads the whole surface, or it is proving nothing', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('contains no `|| \'default-tenant\'` fallback', () => {
    const offenders = files.filter((file) => {
      const source = readFileSync(file, 'utf8');
      // Comments explaining the removed pattern are fine; code that reintroduces it is not.
      return source
        .split('\n')
        .some((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//') && /\|\|\s*'default-tenant'/.test(line));
    });

    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it('does not reach for the literal tenant name at all', () => {
    const offenders = files.filter((file) => /tenantId\s*[:=]\s*'default-tenant'/.test(readFileSync(file, 'utf8')));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});
