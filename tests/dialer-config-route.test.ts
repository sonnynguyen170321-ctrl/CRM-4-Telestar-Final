import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { SessionUser } from '@/lib/auth';

/**
 * `/api/dialer/config` must report telephony readiness, not invent it.
 *
 * Every field here used to carry a hardcoded fallback — a PBX hostname, extension `101`, and the
 * password `telestarPass123` committed to this repository and returned to any authenticated
 * browser. The leak was bad; the second-order effect was worse. Because the fallbacks were never
 * empty, the client could not distinguish *unconfigured* from *configured*, so on a host with no
 * SIP the dialer tried anyway, failed, and `CallDialerModal` caught the failure and **simulated a
 * connected call**. "Hang Up & Save Outcome" then wrote a real Activity, so the CRM accumulated
 * call records for calls that never happened.
 *
 * The split between readiness and credentials is deliberate and also tested: the lead panel asks
 * for readiness on every lead it opens, and it has no business receiving a SIP password to decide
 * whether a button is enabled.
 */

const ACTOR: SessionUser = {
  id: 'dialer-test-actor',
  email: 'rep@telestar.vn',
  firstName: 'Dialer',
  lastName: 'Tester',
  role: 'sdr',
  tenantId: 'default-tenant',
};

// A plain factory, not importActual: the real module pulls in next-auth, which fails to resolve
// under vitest. The route uses only `requireAuth`; `SessionUser` is a type and is erased.
vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => ACTOR),
}));

const { GET } = await import('@/app/api/dialer/config/route');

const SIP_KEYS = ['SIP_WEBSOCKET_URL', 'SIP_DOMAIN', 'SIP_DEFAULT_USERNAME', 'SIP_DEFAULT_PASSWORD'] as const;
let saved: Record<string, string | undefined> = {};

function req(url: string) {
  return new NextRequest(new Request(url));
}

beforeEach(() => {
  saved = Object.fromEntries(SIP_KEYS.map((k) => [k, process.env[k]]));
  for (const k of SIP_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of SIP_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
});

describe('GET /api/dialer/config', () => {
  it('reports not-configured instead of substituting a hardcoded PBX', async () => {
    const body = await (await GET(req('https://crm.telestar.cloud/api/dialer/config'))).json();

    expect(body.configured).toBe(false);
    expect(body.missing).toEqual([...SIP_KEYS]);
    // The specific regression: none of these may reappear as a default.
    expect(JSON.stringify(body)).not.toMatch(/pbx\.telestar\.vn|telestarPass123/);
  });

  it('names exactly the variables that are missing, not all of them', async () => {
    process.env.SIP_WEBSOCKET_URL = 'wss://pbx.example.test:8089/ws';
    process.env.SIP_DOMAIN = 'pbx.example.test';

    const body = await (await GET(req('https://crm.telestar.cloud/api/dialer/config'))).json();

    expect(body.configured).toBe(false);
    expect(body.missing).toEqual(['SIP_DEFAULT_USERNAME', 'SIP_DEFAULT_PASSWORD']);
  });

  it('treats a whitespace-only value as absent', async () => {
    for (const k of SIP_KEYS) process.env[k] = '   ';

    const body = await (await GET(req('https://crm.telestar.cloud/api/dialer/config'))).json();

    expect(body.configured).toBe(false);
    expect(body.missing).toEqual([...SIP_KEYS]);
  });

  it('withholds the SIP password from the readiness response even when fully configured', async () => {
    for (const k of SIP_KEYS) process.env[k] = 'set';

    const body = await (await GET(req('https://crm.telestar.cloud/api/dialer/config'))).json();

    expect(body.configured).toBe(true);
    expect(body).not.toHaveProperty('password');
    expect(body).not.toHaveProperty('username');
    expect(body).not.toHaveProperty('websocketUrl');
  });

  it('returns credentials only when they are asked for', async () => {
    process.env.SIP_WEBSOCKET_URL = 'wss://pbx.example.test:8089/ws';
    process.env.SIP_DOMAIN = 'pbx.example.test';
    process.env.SIP_DEFAULT_USERNAME = '202';
    process.env.SIP_DEFAULT_PASSWORD = 'not-in-git';

    const body = await (
      await GET(req('https://crm.telestar.cloud/api/dialer/config?withCredentials=1'))
    ).json();

    expect(body.configured).toBe(true);
    expect(body.websocketUrl).toBe('wss://pbx.example.test:8089/ws');
    expect(body.username).toBe('202');
    expect(body.password).toBe('not-in-git');
    expect(body.identity).toBe(ACTOR.id);
  });

  it('refuses credentials when SIP is not configured, rather than inventing them', async () => {
    const body = await (
      await GET(req('https://crm.telestar.cloud/api/dialer/config?withCredentials=1'))
    ).json();

    expect(body.configured).toBe(false);
    expect(body).not.toHaveProperty('password');
  });
});
