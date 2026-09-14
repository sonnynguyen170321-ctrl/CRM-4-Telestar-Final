import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The cron routes' shared authorization.
 *
 * Pinned: the scheduler's secret is compared in constant time; a manager's session reaches only
 * their own tenant; and a session without a manager role, or without a tenant, reaches nothing.
 */
const mockAuth = vi.fn();
vi.mock('@/auth', () => ({ auth: () => mockAuth(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));

const { authorizeCronRequest, tenantIdsFor } = await import('@/lib/cron/auth');

function req(authorization?: string) {
  return new NextRequest(new Request('https://crm.test/api/cron/x', { headers: authorization ? { authorization } : {} }));
}

describe('authorizeCronRequest', () => {
  const saved = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = 'correct-horse-battery-staple';
    mockAuth.mockResolvedValue(null);
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  });

  it('grants platform scope to the scheduler secret', async () => {
    expect(await authorizeCronRequest(req('Bearer correct-horse-battery-staple'))).toEqual({ scope: 'platform' });
  });

  it('refuses a wrong secret, a truncated secret, and a missing header', async () => {
    expect(await authorizeCronRequest(req('Bearer correct-horse-battery-stapl3'))).toBeNull();
    expect(await authorizeCronRequest(req('Bearer correct-horse'))).toBeNull();
    expect(await authorizeCronRequest(req())).toBeNull();
  });

  it('refuses every bearer when no secret is configured, rather than matching the empty string', async () => {
    delete process.env.CRON_SECRET;
    expect(await authorizeCronRequest(req('Bearer '))).toBeNull();
    expect(await authorizeCronRequest(req('Bearer undefined'))).toBeNull();
  });

  it('grants a manager session its own tenant only', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u1', role: 'director', tenantId: 't-acme' } });
    expect(await authorizeCronRequest(req())).toEqual({ scope: 'tenant', tenantId: 't-acme', userId: 'u1' });
  });

  it('refuses a non-manager session and a session with no tenant', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u1', role: 'sdr', tenantId: 't-acme' } });
    expect(await authorizeCronRequest(req())).toBeNull();
    mockAuth.mockResolvedValue({ user: { id: 'u1', role: 'director' } });
    expect(await authorizeCronRequest(req())).toBeNull();
  });

  it('does not consult the session when the secret matched', async () => {
    mockAuth.mockRejectedValue(new Error('session store down'));
    expect(await authorizeCronRequest(req('Bearer correct-horse-battery-staple'))).toEqual({ scope: 'platform' });
  });
});

describe('tenantIdsFor', () => {
  it('sweeps every tenant for the platform, and exactly one for a manager', async () => {
    const all = vi.fn(async () => ['t1', 't2', 't3']);
    expect(await tenantIdsFor({ scope: 'platform' }, all)).toEqual(['t1', 't2', 't3']);
    expect(await tenantIdsFor({ scope: 'tenant', tenantId: 't2', userId: 'u' }, all)).toEqual(['t2']);
    expect(all).toHaveBeenCalledTimes(1);
  });
});
