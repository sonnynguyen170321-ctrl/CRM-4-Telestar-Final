import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * A manager who triggers a cron route by hand reaches their own tenant and nothing else.
 *
 * Before: every cron route accepted any director/floor_manager session and then swept every
 * tenant on the platform — maintenance enqueued a repair for each, and returned the ids of the
 * ones that failed. With one tenant that was invisible; with two it is one customer's admin
 * running jobs against, and enumerating, the other.
 */
const mockAuth = vi.fn();
const mockTenantFindMany = vi.fn();
const mockEnqueue = vi.fn();
const mockAccountFindMany = vi.fn();

vi.mock('@/auth', () => ({ auth: () => mockAuth(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    tenant: { findMany: (...a: unknown[]) => mockTenantFindMany(...a) },
    emailAccount: { findMany: (...a: unknown[]) => mockAccountFindMany(...a) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
  },
  tenantStorage: { run: (_: unknown, fn: () => unknown) => fn() },
}));
vi.mock('@/lib/bullmq/enqueue', () => ({ enqueue: (...a: unknown[]) => mockEnqueue(...a) }));
vi.mock('@/lib/workflows/email', () => ({ enqueueEmailSyncWorkflow: vi.fn() }));

const { GET: maintenance } = await import('@/app/api/cron/maintenance/route');
const { GET: inboxSync } = await import('@/app/api/cron/inbox-sync/route');

function req(authorization?: string) {
  return new NextRequest(new Request('https://crm.test/api/cron/maintenance', { headers: authorization ? { authorization } : {} }));
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'sched-secret';
  mockTenantFindMany.mockResolvedValue([{ id: 't-acme' }, { id: 't-globex' }, { id: 't-initech' }]);
  mockAccountFindMany.mockResolvedValue([]);
  mockEnqueue.mockResolvedValue({});
});

describe('GET /api/cron/maintenance', () => {
  it('sweeps every tenant for the scheduler', async () => {
    mockAuth.mockResolvedValue(null);
    const res = await maintenance(req('Bearer sched-secret'));
    const body = await res.json();
    expect(body.tenants).toBe(3);
    expect(mockEnqueue).toHaveBeenCalledTimes(3);
  });

  it('sweeps only the caller\'s tenant for a manager session', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u1', role: 'director', tenantId: 't-globex' } });
    const res = await maintenance(req());
    const body = await res.json();
    expect(body.tenants).toBe(1);
    expect(mockTenantFindMany).not.toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue.mock.calls[0][2]).toEqual({ tenantId: 't-globex' });
  });

  it('never lists tenant ids in the response', async () => {
    mockAuth.mockResolvedValue(null);
    mockEnqueue.mockRejectedValueOnce(new Error('redis down'));
    const res = await maintenance(req('Bearer sched-secret'));
    const text = await res.text();
    expect(text).not.toContain('t-acme');
    expect(text).not.toContain('t-globex');
    expect(JSON.parse(text).failed).toBe(1);
  });

  it('rejects an SDR session and a bad secret', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u1', role: 'sdr', tenantId: 't-acme' } });
    expect((await maintenance(req())).status).toBe(401);
    expect((await maintenance(req('Bearer wrong'))).status).toBe(401);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});

describe('GET /api/cron/inbox-sync', () => {
  it('scopes the mailbox scan to the manager\'s tenant', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u1', role: 'team_lead', tenantId: 't-acme' } });
    await inboxSync(req());
    expect(mockAccountFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isActive: true, tenantId: 't-acme' } }));
  });

  it('scans every tenant for the scheduler', async () => {
    mockAuth.mockResolvedValue(null);
    await inboxSync(req('Bearer sched-secret'));
    expect(mockAccountFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isActive: true } }));
  });
});
