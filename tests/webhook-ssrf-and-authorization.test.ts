import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  blockedAddressReason,
  checkDestinationShape,
  assertPublicDestination,
  type LookupFn,
} from '@/lib/webhooks/ssrfGuard';

/**
 * TEL-P1-030 (SSRF) and TEL-P1-031 (webhook administration authorization).
 *
 * `deliverWebhook` called `fetch(url)` with no validation beyond the route checking
 * `url.startsWith('http')`. Any authenticated user could make the production VM POST a body
 * they controlled to any address it could reach, and read back the status code, the latency and
 * the error string — server-side request forgery with a response oracle.
 *
 * The address check is on RESOLVED addresses, not hostname text, which is why the exotic
 * encodings need no special cases: 2130706433, 0x7f000001 and a DNS name pointing at 10.0.0.5
 * all resolve to something blocked.
 */

/** A lookup that answers from a table, so no test touches real DNS. */
function lookupReturning(map: Record<string, Array<{ address: string; family: number }>>): LookupFn {
  return async (hostname: string) => {
    const hit = map[hostname];
    if (!hit) throw new Error(`no such host ${hostname}`);
    return hit;
  };
}

const PUBLIC = lookupReturning({
  'hooks.example.com': [{ address: '93.184.216.34', family: 4 }],
});

describe('blockedAddressReason — IPv4', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.1.2.3', 'loopback'],
    ['0.0.0.0', 'unspecified'],
    ['10.0.0.5', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.254', 'private'],
    ['192.168.1.1', 'private'],
    ['169.254.169.254', 'link-local'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['224.0.0.1', 'multicast'],
  ])('blocks %s', (ip, fragment) => {
    expect(blockedAddressReason(ip)).toContain(fragment);
  });

  it.each(['93.184.216.34', '8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1'])(
    'allows the public address %s',
    (ip) => {
      // 172.15 and 172.32 sit just outside 172.16/12 — the boundary is easy to get wrong.
      expect(blockedAddressReason(ip)).toBeNull();
    },
  );
});

describe('blockedAddressReason — IPv6', () => {
  it.each([
    ['::1', 'loopback'],
    ['::', 'unspecified'],
    ['fc00::1', 'unique local'],
    ['fd12:3456::1', 'unique local'],
    ['fe80::1', 'link-local'],
    ['ff02::1', 'multicast'],
    ['::ffff:127.0.0.1', 'IPv4-mapped'],
    ['::ffff:10.0.0.1', 'IPv4-mapped'],
  ])('blocks %s', (ip, fragment) => {
    expect(blockedAddressReason(ip, 6)).toContain(fragment);
  });

  it('allows a public IPv6 address', () => {
    expect(blockedAddressReason('2606:4700:4700::1111', 6)).toBeNull();
  });

  it('ignores a zone index when classifying', () => {
    expect(blockedAddressReason('fe80::1%eth0', 6)).toContain('link-local');
  });
});

describe('checkDestinationShape', () => {
  it('accepts a normal https endpoint', () => {
    expect(checkDestinationShape('https://hooks.example.com/x')).toEqual({ ok: true });
  });

  it('rejects a scheme that merely starts with http', () => {
    // The original check was url.startsWith('http'), which this satisfies.
    const verdict = checkDestinationShape('httpx://hooks.example.com');
    expect(verdict.ok).toBe(false);
  });

  it.each(['file:///etc/passwd', 'gopher://x', 'ftp://x', 'data:text/plain,hi'])(
    'rejects %s',
    (url) => {
      expect(checkDestinationShape(url).ok).toBe(false);
    },
  );

  it('rejects credentials embedded in the URL', () => {
    const verdict = checkDestinationShape('https://user:pass@hooks.example.com/x');
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain('credentials');
  });

  it('rejects a malformed URL rather than throwing', () => {
    expect(checkDestinationShape('not a url').ok).toBe(false);
    expect(checkDestinationShape('').ok).toBe(false);
  });
});

describe('assertPublicDestination', () => {
  it('allows a public destination', async () => {
    expect(await assertPublicDestination('https://hooks.example.com/x', PUBLIC)).toEqual({ ok: true });
  });

  it.each([
    ['http://127.0.0.1/x', '127.0.0.1'],
    ['http://localhost/x', '127.0.0.1'],
    ['http://0.0.0.0/x', '0.0.0.0'],
    ['http://10.1.2.3/x', '10.1.2.3'],
    ['http://172.16.9.9/x', '172.16.9.9'],
    ['http://192.168.0.5/x', '192.168.0.5'],
    ['http://169.254.169.254/computeMetadata/v1/', '169.254.169.254'],
  ])('blocks %s', async (url, resolved) => {
    const host = new URL(url).hostname;
    const guard = lookupReturning({ [host]: [{ address: resolved, family: 4 }] });
    const verdict = await assertPublicDestination(url, guard);
    expect(verdict.ok).toBe(false);
  });

  it('blocks the cloud metadata address by name as well as by literal', async () => {
    const guard = lookupReturning({ 'metadata.google.internal': [{ address: '169.254.169.254', family: 4 }] });
    const verdict = await assertPublicDestination('http://metadata.google.internal/x', guard);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain('metadata');
  });

  it('blocks an integer-encoded loopback address', async () => {
    // http://2130706433/ is 127.0.0.1. No special case handles this — the resolver does.
    const guard = lookupReturning({ '2130706433': [{ address: '127.0.0.1', family: 4 }] });
    expect((await assertPublicDestination('http://2130706433/x', guard)).ok).toBe(false);
  });

  it('blocks a hex-encoded loopback address', async () => {
    const guard = lookupReturning({ '0x7f000001': [{ address: '127.0.0.1', family: 4 }] });
    expect((await assertPublicDestination('http://0x7f000001/x', guard)).ok).toBe(false);
  });

  it('blocks IPv6 loopback in bracket form', async () => {
    const guard = lookupReturning({ '::1': [{ address: '::1', family: 6 }] });
    expect((await assertPublicDestination('http://[::1]/x', guard)).ok).toBe(false);
  });

  it('blocks a public hostname whose DNS answer is private', async () => {
    // The rebinding-shaped case: the name looks fine, the record does not.
    const guard = lookupReturning({ 'evil.example.com': [{ address: '10.0.0.7', family: 4 }] });
    const verdict = await assertPublicDestination('https://evil.example.com/x', guard);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain('10.0.0.7');
  });

  it('blocks when ANY resolved address is private, not just the first', async () => {
    // Which address fetch picks is not ours to choose, so one bad record poisons the name.
    const guard = lookupReturning({
      'mixed.example.com': [
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ],
    });
    expect((await assertPublicDestination('https://mixed.example.com/x', guard)).ok).toBe(false);
  });

  it('refuses a host that does not resolve', async () => {
    expect((await assertPublicDestination('https://nowhere.invalid/x', PUBLIC)).ok).toBe(false);
  });

  it('refuses a host that resolves to nothing', async () => {
    const guard = lookupReturning({ 'empty.example.com': [] });
    expect((await assertPublicDestination('https://empty.example.com/x', guard)).ok).toBe(false);
  });
});

describe('deliverWebhook refuses every SSRF vector end to end', () => {
  // Through the real function, not the helpers. Each of these is refused before any socket is
  // opened, so none of them performs network I/O.
  it.each([
    ['loopback literal', 'http://127.0.0.1:8081/'],
    ['loopback by name', 'http://localhost:8081/'],
    ['cloud metadata', 'http://169.254.169.254/computeMetadata/v1/'],
    ['private 10/8', 'http://10.0.0.5:8081/'],
    ['private 192.168/16', 'http://192.168.1.1:8081/'],
    ['integer-encoded loopback', 'http://2130706433:8081/'],
    ['IPv6 loopback', 'http://[::1]:8081/'],
    ['credentials in the URL', 'https://user:pass@example.com/'],
    ['file scheme', 'file:///etc/passwd'],
    ['unsupported scheme', 'httpx://example.com/'],
  ])('refuses %s', async (_label, url) => {
    const { deliverWebhook } = await import('@/lib/webhooks/dispatcher');
    const result = await deliverWebhook(url, 'whsec_x', 'test.ping', { ping: true }, 'tenant-a');
    expect(result.success).toBe(false);
    expect(result.error ?? '').toContain('Refused webhook destination');
  });

  it('reports the refusal without a status code, because nothing was contacted', async () => {
    const { deliverWebhook } = await import('@/lib/webhooks/dispatcher');
    const result = await deliverWebhook(
      'http://169.254.169.254/',
      'whsec_x',
      'test.ping',
      {},
      'tenant-a',
    );
    expect(result.statusCode).toBeUndefined();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe('the guard is wired where it cannot be bypassed', () => {
  const dispatcher = readFileSync(join(process.cwd(), 'lib', 'webhooks', 'dispatcher.ts'), 'utf8');

  it('deliverWebhook validates the destination itself', () => {
    // Both the test ping and the real dispatcher go through deliverWebhook, so guarding here
    // covers both by construction rather than by remembering to guard two routes.
    expect(dispatcher).toContain('assertPublicDestination');
  });

  it('validates before the request, not after', () => {
    const check = dispatcher.indexOf('assertPublicDestination');
    const request = dispatcher.indexOf('undiciFetch(');
    expect(check).toBeGreaterThan(-1);
    expect(request).toBeGreaterThan(-1);
    expect(check).toBeLessThan(request);
  });

  it('re-checks the address at connect time, closing the rebinding window', () => {
    // assertPublicDestination is a check-then-use; the connector's own lookup is what makes it
    // authoritative. CodeQL's js/request-forgery alert was correct about the difference.
    expect(dispatcher).toContain('guardedDispatcher');
    expect(dispatcher).toMatch(/dispatcher: guardedDispatcher/);
  });

  it('does not follow redirects', () => {
    // A validated public URL answering 302 to 169.254.169.254 would otherwise defeat the check.
    expect(dispatcher).toContain("redirect: 'manual'");
  });

  it('treats a redirect as a failed delivery', () => {
    expect(dispatcher).toMatch(/status >= 300 && response\.status < 400/);
  });
});

describe('webhook administration requires a management capability', () => {
  const route = readFileSync(join(process.cwd(), 'app', 'api', 'webhooks', 'route.ts'), 'utf8');

  it('no verb is gated on mere authentication', () => {
    // Match the call, not the word: the file's own comment explains what it used to do.
    expect(route).not.toMatch(/await requireAuth\(\)/);
  });

  it('every verb requires a manager', () => {
    const managerGates = route.match(/await requireManager\(\)/g) ?? [];
    expect(managerGates.length).toBe(3); // GET, POST, DELETE
  });

  it('never returns a webhook signing secret on read', () => {
    // The secret is enough to forge payloads the client's systems accept as ours.
    expect(route).toContain('redactSecret');
    expect(route).toMatch(/webhooks: \(cached \|\| \[\]\)\.map\(redactSecret\)/);
  });

  it('validates the destination shape on create', () => {
    expect(route).toContain('checkDestinationShape');
    expect(route).not.toMatch(/url\.startsWith\('http'\)/);
  });
});
