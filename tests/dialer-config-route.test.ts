import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { SessionUser } from '@/lib/auth';

/**
 * `/api/dialer/config` — the legacy SIP dialer's config route, retired (docs/dialer/TASKS.md D2.6).
 *
 * CHANGED 2026-10-05. It used to return the deployment-wide SIP password to any signed-in browser
 * that asked with `?withCredentials`, and before that it carried a hardcoded fallback
 * (`telestarPass123`) that made an unconfigured dialer simulate connected calls. The Telnyx softphone
 * logs in with a per-rep token instead, so this route now answers "not configured" with no credentials
 * whatever the environment holds — the old Call button stays disabled until the modal is deleted in
 * Phase 5.
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

beforeEach(() => {
  saved = Object.fromEntries(SIP_KEYS.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  for (const k of SIP_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
});

describe('GET /api/dialer/config (retired)', () => {
  it('never returns SIP credentials, even when the environment still holds them', async () => {
    process.env.SIP_WEBSOCKET_URL = 'wss://pbx.example.test:8089/ws';
    process.env.SIP_DOMAIN = 'pbx.example.test';
    process.env.SIP_DEFAULT_USERNAME = '202';
    process.env.SIP_DEFAULT_PASSWORD = 'not-in-git';

    const response = await GET();
    const body = await response.json();

    expect(body).toEqual({ configured: false, missing: [], retired: true });
    expect(JSON.stringify(body)).not.toMatch(/not-in-git|pbx\.example\.test|202/);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('keeps the old Call button disabled when nothing is configured', async () => {
    for (const k of SIP_KEYS) delete process.env[k];
    expect((await (await GET()).json()).configured).toBe(false);
  });
});
