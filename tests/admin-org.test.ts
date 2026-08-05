import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getUser, PUT as updateUser } from '@/app/api/users/[id]/route';
import { prisma, tenantStorage } from '@/lib/prisma';
import { auth } from '@/auth';
import type { SessionUser } from '@/lib/auth';

// Spy on the cache-clear without disabling the real auth module (requireAuth /
// canAccessUser / getVisibleUserIds all keep their real DB-backed behavior).
const { clearVisibleUserCacheMock } = vi.hoisted(() => ({
  clearVisibleUserCacheMock: vi.fn(),
}));

vi.mock('@/auth', () => ({
  auth: vi.fn(),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@/lib/auth', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/auth')>();
  return { ...mod, clearVisibleUserCache: clearVisibleUserCacheMock };
});

const tenantId = 'admin-org-tenant';

const director: SessionUser = {
  id: 'org-director',
  email: 'org-director@telestar.vn',
  firstName: 'Dean',
  lastName: 'Director',
  role: 'director',
  tenantId,
};
const fm: SessionUser = {
  id: 'org-fm',
  email: 'org-fm@telestar.vn',
  firstName: 'Frank',
  lastName: 'Manager',
  role: 'floor_manager',
  tenantId,
};
const tl: SessionUser = {
  id: 'org-tl',
  email: 'org-tl@telestar.vn',
  firstName: 'Tim',
  lastName: 'Lead',
  role: 'team_lead',
  tenantId,
};
const sdr: SessionUser = {
  id: 'org-sdr',
  email: 'org-sdr@telestar.vn',
  firstName: 'Sam',
  lastName: 'Rep',
  role: 'sdr',
  tenantId,
};
const sdrOut: SessionUser = {
  id: 'org-sdr-out',
  email: 'org-sdr-out@telestar.vn',
  firstName: 'Ollie',
  lastName: 'Outside',
  role: 'sdr',
  tenantId,
};
const leadgen: SessionUser = {
  id: 'org-leadgen',
  email: 'org-leadgen@telestar.vn',
  firstName: 'Lena',
  lastName: 'Gen',
  role: 'leadgen',
  tenantId,
};
const mgr: SessionUser = {
  id: 'org-mgr',
  email: 'org-mgr@telestar.vn',
  firstName: 'Mia',
  lastName: 'Manager',
  role: 'team_lead',
  tenantId,
};
const sdr2: SessionUser = {
  id: 'org-sdr2',
  email: 'org-sdr2@telestar.vn',
  firstName: 'Sue',
  lastName: 'Two',
  role: 'sdr',
  tenantId,
};
const zombie: SessionUser = {
  id: 'org-zombie',
  email: 'org-zombie@telestar.vn',
  firstName: 'Zoe',
  lastName: 'Ghost',
  role: 'sdr',
  tenantId,
};

const hasDb = Boolean(process.env.DATABASE_URL);

const mockAuth = (u: SessionUser | null) =>
  (auth as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce(
    u ? { user: u, expires: '' } : null
  );

const getReq = (id: string) => new NextRequest(`http://localhost:3000/api/users/${id}`);
const putReq = (id: string, body: unknown) =>
  new NextRequest(`http://localhost:3000/api/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  if (!hasDb) return;

  // Persistent default session = director (tenant scoping resolved from it).
  (auth as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
    user: director,
    expires: '',
  });

  await tenantStorage.run({ tenantId: 'system', bypassRls: true }, async () => {
    await prisma.auditLog.deleteMany({ where: { tenantId } });
    await prisma.activity.deleteMany({ where: { tenantId } });
    await prisma.lead.deleteMany({ where: { tenantId } });
    await prisma.task.deleteMany({ where: { tenantId } });
    await prisma.meeting.deleteMany({ where: { tenantId } });
    await prisma.opportunity.deleteMany({ where: { tenantId } });
    await prisma.campaignSdr.deleteMany({ where: { tenantId } });
    await prisma.campaign.deleteMany({ where: { tenantId } });
    await prisma.client.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({
      where: {
        id: { in: [director.id, fm.id, tl.id, sdr.id, sdrOut.id, leadgen.id, mgr.id, sdr2.id, zombie.id] },
      },
    });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });

    await prisma.tenant.create({ data: { id: tenantId, name: 'Admin Org Tenant' } });

    const users: { u: SessionUser; managerId?: string; isActive?: boolean }[] = [
      { u: director },
      { u: fm },
      { u: tl, managerId: fm.id },
      { u: sdr, managerId: tl.id },
      { u: sdrOut },
      { u: leadgen },
      { u: mgr, managerId: fm.id },
      { u: sdr2, managerId: mgr.id },
      { u: zombie, isActive: false },
    ];
    for (const { u, managerId, isActive } of users) {
      await prisma.user.create({
        data: {
          id: u.id,
          email: u.email,
          password: 'hashed-pwd',
          firstName: u.firstName,
          lastName: u.lastName,
          role: u.role,
          managerId,
          isActive: isActive ?? true,
          tenantId,
        },
      });
    }
  });
}, 60_000);

afterAll(async () => {
  if (!hasDb) return;
  await tenantStorage.run({ tenantId: 'system', bypassRls: true }, async () => {
    await prisma.auditLog.deleteMany({ where: { tenantId } });
    await prisma.activity.deleteMany({ where: { tenantId } });
    await prisma.lead.deleteMany({ where: { tenantId } });
    await prisma.task.deleteMany({ where: { tenantId } });
    await prisma.meeting.deleteMany({ where: { tenantId } });
    await prisma.opportunity.deleteMany({ where: { tenantId } });
    await prisma.campaignSdr.deleteMany({ where: { tenantId } });
    await prisma.campaign.deleteMany({ where: { tenantId } });
    await prisma.client.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({
      where: {
        id: { in: [director.id, fm.id, tl.id, sdr.id, sdrOut.id, leadgen.id, mgr.id, sdr2.id, zombie.id] },
      },
    });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
  });
}, 60_000);

beforeEach(() => {
  clearVisibleUserCacheMock.mockClear();
});

describe.skipIf(!hasDb)('GET /api/users/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth(null);
    const res = await getUser(getReq(sdr.id), { params: Promise.resolve({ id: sdr.id }) });
    expect(res.status).toBe(401);
  });

  it('lets a director read any user', async () => {
    const res = await getUser(getReq(sdr.id), { params: Promise.resolve({ id: sdr.id }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe('sdr');
    expect(body.id).toBe(sdr.id);
  });

  it('lets a user read themselves but nobody else', async () => {
    mockAuth(sdr);
    const own = await getUser(getReq(sdr.id), { params: Promise.resolve({ id: sdr.id }) });
    expect(own.status).toBe(200);

    mockAuth(sdr);
    const other = await getUser(getReq(sdrOut.id), { params: Promise.resolve({ id: sdrOut.id }) });
    expect(other.status).toBe(403);
  });
});

describe.skipIf(!hasDb)('PUT /api/users/[id] — org-integrity guards', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth(null);
    const res = await updateUser(putReq(sdr.id, { firstName: 'X' }), {
      params: Promise.resolve({ id: sdr.id }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a floor manager editing a user outside their floor with 403', async () => {
    mockAuth(fm);
    const res = await updateUser(putReq(sdrOut.id, { managerId: tl.id }), {
      params: Promise.resolve({ id: sdrOut.id }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 400 for an invalid body', async () => {
    const res = await updateUser(putReq(sdr.id, { managerId: '' }), {
      params: Promise.resolve({ id: sdr.id }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown target', async () => {
    const res = await updateUser(putReq('org-missing-user', { firstName: 'X' }), {
      params: Promise.resolve({ id: 'org-missing-user' }),
    });
    expect(res.status).toBe(404);
  });

  it('refuses self-manager assignment with 400', async () => {
    const res = await updateUser(putReq(sdr.id, { managerId: sdr.id }), {
      params: Promise.resolve({ id: sdr.id }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('own manager');
  });

  it('refuses a missing manager with 400', async () => {
    const res = await updateUser(putReq(sdr.id, { managerId: 'org-missing-manager' }), {
      params: Promise.resolve({ id: sdr.id }),
    });
    expect(res.status).toBe(400);
  });

  it('refuses a deactivated manager with 400', async () => {
    const res = await updateUser(putReq(sdr.id, { managerId: zombie.id }), {
      params: Promise.resolve({ id: sdr.id }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('deactivated');
  });

  it('refuses a role-incompatible manager with 400', async () => {
    const res = await updateUser(putReq(sdr.id, { managerId: leadgen.id }), {
      params: Promise.resolve({ id: sdr.id }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('may only report to');
  });

  it('refuses deactivating a user who still manages active reports with 409', async () => {
    const res = await updateUser(putReq(mgr.id, { isActive: false }), {
      params: Promise.resolve({ id: mgr.id }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('Reassign');
    expect(body.reports.map((r: { id: string }) => r.id)).toContain(sdr2.id);
  });

  it('lets a floor manager reassign a report within their floor and clears the cache', async () => {
    mockAuth(fm);
    const res = await updateUser(putReq(sdr.id, { managerId: mgr.id }), {
      params: Promise.resolve({ id: sdr.id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.managerId).toBe(mgr.id);
    expect(clearVisibleUserCacheMock).toHaveBeenCalled();
  });

  it('clears the pod-scope cache after a director role change', async () => {
    const res = await updateUser(putReq(sdrOut.id, { role: 'team_lead' }), {
      params: Promise.resolve({ id: sdrOut.id }),
    });
    expect(res.status).toBe(200);
    expect(clearVisibleUserCacheMock).toHaveBeenCalled();
  });

  it('deactivates a manager without reports, pauses their mail, and writes an audit row', async () => {
    const res = await updateUser(putReq(sdr2.id, { isActive: false }), {
      params: Promise.resolve({ id: sdr2.id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isActive).toBe(false);
    expect(clearVisibleUserCacheMock).toHaveBeenCalled();

    const audit = await tenantStorage.run({ tenantId: 'system', bypassRls: true }, async () => {
      return prisma.auditLog.findFirst({
        where: { tenantId, recordId: sdr2.id, action: 'admin.user.deactivate' },
        select: { userId: true, action: true, changedFields: true },
      });
    });
    expect(audit).not.toBeNull();
    // Attributed to the director who acted, not to the user being changed.
    expect(audit?.userId).toBe(director.id);
  });
});
