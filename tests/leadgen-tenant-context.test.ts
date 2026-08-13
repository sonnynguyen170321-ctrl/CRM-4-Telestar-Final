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

describe('the leadgen surface never invents a tenant', () => {
  const dirs = ['app/api/leadgen', 'app/api/leadgen-pool', 'lib/leadgen'];
  const files = dirs.flatMap((dir) => walk(path.join(ROOT, dir)));

  it('reads more than a handful of files, or it is proving nothing', () => {
    expect(files.length).toBeGreaterThan(8);
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
