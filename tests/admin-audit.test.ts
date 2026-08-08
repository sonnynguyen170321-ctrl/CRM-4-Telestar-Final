import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeUserFindUnique } from './helpers/mockDbUser';
import { NextRequest } from 'next/server';
import { GET as getAuditLog } from '@/app/api/admin/audit-log/route';
import { auth } from '@/auth';
import type { SessionUser } from '@/lib/auth';

// Prisma delegates cannot be spied on (the extended client is not spy-able and
// `$on` is unavailable), so this suite mocks the module and asserts on the call
// arguments instead — the route logic is what matters, not the driver.
const {
  auditLogFindMany,
  userFindMany,
  campaignFindMany,
  clientFindMany,
  leadFindMany,
} = vi.hoisted(() => ({
  auditLogFindMany: vi.fn(),
  userFindMany: vi.fn(),
  campaignFindMany: vi.fn(),
  clientFindMany: vi.fn(),
  leadFindMany: vi.fn(),
}));

vi.mock('@/auth', () => ({
  auth: vi.fn(),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

// tenantId must match the fixtures' own tenant: getSessionUser rejects a session whose
// token tenant differs from the row's, which is the cross-tenant check doing its job.
const userFindUnique = makeUserFindUnique([
  { id: 'aud-director', role: 'director', tenantId: 'admin-audit-tenant' },
  { id: 'aud-fm', role: 'floor_manager', tenantId: 'admin-audit-tenant', reports: 1 },
  { id: 'aud-sdr', role: 'sdr', tenantId: 'admin-audit-tenant' },
  { id: 'aud-tl', role: 'team_lead', tenantId: 'admin-audit-tenant', reports: 1 },
]);

vi.mock('@/lib/prisma', () => ({
  prisma: {
    auditLog: { findMany: auditLogFindMany },
    // getSessionUser revalidates the session against the database on every request,
    // so this mock has to answer findUnique or every route 401s before its role check.
    user: {
      findMany: userFindMany,
      // Lazy arrow, not a direct reference: vi.mock's factory is hoisted above the
      // const below, so naming it directly throws 'Cannot access before initialization'.
      findUnique: (...args: unknown[]) => userFindUnique(...(args as [never])),
    },
    campaign: { findMany: campaignFindMany },
    client: { findMany: clientFindMany },
    lead: { findMany: leadFindMany },
  },
  tenantStorage: {
    run: async (_ctx: unknown, fn: () => unknown) => fn(),
  },
}));

const tenantId = 'admin-audit-tenant';

const director: SessionUser = {
  id: 'aud-director',
  email: 'aud-director@telestar.vn',
  firstName: 'Dean',
  lastName: 'Director',
  role: 'director',
  tenantId,
};
const fm: SessionUser = {
  id: 'aud-fm',
  email: 'aud-fm@telestar.vn',
  firstName: 'Frank',
  lastName: 'Manager',
  role: 'floor_manager',
  tenantId,
};
const sdr: SessionUser = {
  id: 'aud-sdr',
  email: 'aud-sdr@telestar.vn',
  firstName: 'Sam',
  lastName: 'Rep',
  role: 'sdr',
  tenantId,
};

const ORG_USERS = [
  { id: fm.id, role: 'floor_manager', managerId: null },
  { id: 'aud-tl', role: 'team_lead', managerId: fm.id },
  { id: sdr.id, role: 'sdr', managerId: 'aud-tl' },
];

const mockAuth = (u: SessionUser | null) =>
  (auth as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce(
    u ? { user: u, expires: '' } : null
  );

// The route asks for org rows (select.managerId) via getVisibleUserIds and for
// name rows (id + names) via resolveLabels. Route by shape so one fake serves both.
userFindMany.mockImplementation((args: { where?: { id?: { in?: string[] } }; select?: { managerId?: boolean } }) => {
  if (args?.select?.managerId) return Promise.resolve(ORG_USERS);
  const wanted = new Set(args?.where?.id?.in ?? []);
  const NAME_ROWS = [
    { id: 'u-1', firstName: 'First', lastName: 'A' },
    { id: 'u-2', firstName: 'First', lastName: 'B' },
    { id: fm.id, firstName: 'Frank', lastName: 'Manager' },
  ];
  return Promise.resolve(NAME_ROWS.filter((u) => wanted.has(u.id)));
});

campaignFindMany.mockImplementation((args: { where?: { id?: { in?: string[] } } }) => {
  const wanted = new Set(args?.where?.id?.in ?? []);
  return Promise.resolve([{ id: 'c-1', name: 'Acme Campaign' }].filter((c) => wanted.has(c.id)));
});

clientFindMany.mockResolvedValue([]);
leadFindMany.mockResolvedValue([]);

beforeEach(() => {
  vi.clearAllMocks();
  auditLogFindMany.mockResolvedValue([]);
  // Persistent default session = director, so window/paging tests don't 401.
  (auth as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
    user: director,
    expires: '',
  });
});

const url = (query = '') => new NextRequest(`http://localhost:3000/api/admin/audit-log${query}`);

describe('GET /api/admin/audit-log — guards', () => {
  it('returns 401 unauthenticated and 403 for an SDR', async () => {
    mockAuth(null);
    expect((await getAuditLog(url())).status).toBe(401);

    mockAuth(sdr);
    expect((await getAuditLog(url())).status).toBe(403);
  });
});

describe('GET /api/admin/audit-log — window and paging', () => {
  it('applies a 30-day default window and the admin scope filter', async () => {
    const res = await getAuditLog(url());
    expect(res.status).toBe(200);

    expect(auditLogFindMany).toHaveBeenCalledTimes(1);
    const args = auditLogFindMany.mock.calls[0][0];
    expect(args.where.action).toEqual({ startsWith: 'admin.' });
    // Director → no actor scoping on the where.
    expect(args.where.userId).toBeUndefined();

    const gte = args.where.createdAt.gte as Date;
    expect(gte).toBeInstanceOf(Date);
    const now = Date.now();
    expect(gte.getTime()).toBeGreaterThanOrEqual(now - 30 * 86_400_000 - 60_000);
    expect(gte.getTime()).toBeLessThanOrEqual(now);
    expect(args.where.createdAt.lte).toBeUndefined();

    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(args.take).toBe(51); // limit 50 + 1 to detect hasMore
  });

  it('honors from/to/actorId/action/scope params', async () => {
    const res = await getAuditLog(
      url('?scope=all&from=2026-01-01T00:00:00.000Z&to=2026-01-10T00:00:00.000Z&actorId=u-1&action=admin.user.deactivate')
    );
    expect(res.status).toBe(200);

    const args = auditLogFindMany.mock.calls[0][0];
    expect(args.where.userId).toBe('u-1');
    expect(args.where.action).toBe('admin.user.deactivate');
    expect(args.where.createdAt.gte).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    expect(args.where.createdAt.lte).toEqual(new Date('2026-01-10T00:00:00.000Z'));

    const body = await res.json();
    expect(body.window.to).toBe('2026-01-10T00:00:00.000Z');
  });

  it('scopes an FM to their visible users plus themselves', async () => {
    mockAuth(fm);
    const res = await getAuditLog(url());
    expect(res.status).toBe(200);

    const args = auditLogFindMany.mock.calls[0][0];
    const inList = args.where.userId.in as string[];
    expect(inList).toContain(fm.id);
    expect(inList).toContain('aud-tl');
    expect(inList).toContain(sdr.id);

    // getVisibleUserIds ran one org query (select.managerId shape).
    const orgCall = userFindMany.mock.calls.find((c) => (c[0] as { select?: object })?.select);
    expect(orgCall).toBeDefined();
  });

  it('pages with a cursor and returns hasMore + nextCursor', async () => {
    auditLogFindMany.mockResolvedValue([
      { id: 'r1', userId: fm.id, action: 'admin.user.deactivate', tableName: 'User', recordId: 'u-1', changedFields: { isActive: { old: true, new: false } }, createdAt: new Date('2026-01-05T00:00:00.000Z') },
      { id: 'r2', userId: fm.id, action: 'admin.user.role_change', tableName: 'User', recordId: 'u-2', changedFields: {}, createdAt: new Date('2026-01-04T00:00:00.000Z') },
      { id: 'r3', userId: fm.id, action: 'admin.user.role_change', tableName: 'User', recordId: 'u-3', changedFields: {}, createdAt: new Date('2026-01-03T00:00:00.000Z') },
    ]);

    const res = await getAuditLog(url('?limit=2'));
    const body = await res.json();

    expect(auditLogFindMany.mock.calls[0][0].take).toBe(3);
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0].id).toBe('r1');
    expect(body.entries[1].id).toBe('r2');
    expect(body.nextCursor).toBe('2026-01-04T00:00:00.000Z');
  });

  it('passes a cursor param through as createdAt.lt', async () => {
    await getAuditLog(url('?cursor=2026-01-05T00:00:00.000Z'));
    const args = auditLogFindMany.mock.calls[0][0];
    expect(args.where.createdAt.lt).toEqual(new Date('2026-01-05T00:00:00.000Z'));
  });
});

describe('GET /api/admin/audit-log — batched name resolution', () => {
  it('resolves names in one query per table, never one per row', async () => {
    auditLogFindMany.mockResolvedValue([
      { id: 'r1', userId: 'u-1', action: 'admin.user.deactivate', tableName: 'User', recordId: 'u-1', changedFields: { isActive: { old: true, new: false } }, createdAt: new Date('2026-01-05T00:00:00.000Z') },
      { id: 'r2', userId: 'u-2', action: 'admin.campaign.member_add', tableName: 'Campaign', recordId: 'c-1', changedFields: {}, createdAt: new Date('2026-01-04T00:00:00.000Z') },
      { id: 'r3', userId: null, action: 'note.added', tableName: 'Activity', recordId: 'a-1', changedFields: {}, createdAt: new Date('2026-01-03T00:00:00.000Z') },
    ]);

    const res = await getAuditLog(url());
    const body = await res.json();
    const entries = body.entries;

    expect(entries[0].actorName).toBe('First A');
    expect(entries[0].targetLabel).toBe('First A');
    expect(entries[0].changedFields.isActive.old).toBe(true);
    expect(entries[1].actorName).toBe('First B');
    expect(entries[1].targetLabel).toBe('Acme Campaign');
    expect(entries[2].actorName).toBeNull();
    expect(entries[2].targetLabel).toBeNull();

    // One name query for every user id on the page — not one per row.
    expect(userFindMany).toHaveBeenCalledTimes(1);
    const nameCall = userFindMany.mock.calls[0][0];
    expect(nameCall.where.id.in.sort()).toEqual(['u-1', 'u-2']);
    expect(campaignFindMany).toHaveBeenCalledTimes(1);
  });
});
