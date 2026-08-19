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

// ── A second, self-contained floor ────────────────────────────────────────────
// The cases below mutate reporting lines and deactivate a manager. They run on
// their own branch so they cannot perturb the shared fixture above, which the
// existing tests mutate in place without reseeding.
const xfm: SessionUser = {
  id: 'org-x-fm',
  email: 'org-x-fm@telestar.vn',
  firstName: 'Xavier',
  lastName: 'Floor',
  role: 'floor_manager',
  tenantId,
};
const xmgr: SessionUser = {
  id: 'org-x-mgr',
  email: 'org-x-mgr@telestar.vn',
  firstName: 'Xena',
  lastName: 'Lead',
  role: 'team_lead',
  tenantId,
};
const xrep1: SessionUser = {
  id: 'org-x-rep1',
  email: 'org-x-rep1@telestar.vn',
  firstName: 'Rita',
  lastName: 'One',
  role: 'sdr',
  tenantId,
};
const xrep2: SessionUser = {
  id: 'org-x-rep2',
  email: 'org-x-rep2@telestar.vn',
  firstName: 'Rory',
  lastName: 'Two',
  role: 'sdr',
  tenantId,
};

// A pre-existing corrupt reporting chain: each node names the other as manager.
// Unreachable through the API (the role rule forbids every downward edge), but
// reachable through a bad migration or a manual DB edit — which is exactly the
// case `wouldCreateManagerCycle` refuses to extend.
const cycleTl: SessionUser = {
  id: 'org-x-cycle-tl',
  email: 'org-x-cycle-tl@telestar.vn',
  firstName: 'Cyrus',
  lastName: 'Lead',
  role: 'team_lead',
  tenantId,
};
const cycleFm: SessionUser = {
  id: 'org-x-cycle-fm',
  email: 'org-x-cycle-fm@telestar.vn',
  firstName: 'Cybil',
  lastName: 'Floor',
  role: 'floor_manager',
  tenantId,
};
const cycleTarget: SessionUser = {
  id: 'org-x-cycle-target',
  email: 'org-x-cycle-target@telestar.vn',
  firstName: 'Tara',
  lastName: 'Target',
  role: 'sdr',
  tenantId,
};

const ALL_USER_IDS = [
  director.id, fm.id, tl.id, sdr.id, sdrOut.id, leadgen.id, mgr.id, sdr2.id, zombie.id,
  xfm.id, xmgr.id, xrep1.id, xrep2.id, cycleTl.id, cycleFm.id, cycleTarget.id,
];

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
    await prisma.emailAccount.deleteMany({ where: { tenantId } });
    await prisma.activity.deleteMany({ where: { tenantId } });
    await prisma.lead.deleteMany({ where: { tenantId } });
    await prisma.task.deleteMany({ where: { tenantId } });
    await prisma.meeting.deleteMany({ where: { tenantId } });
    await prisma.opportunity.deleteMany({ where: { tenantId } });
    await prisma.campaignSdr.deleteMany({ where: { tenantId } });
    await prisma.campaign.deleteMany({ where: { tenantId } });
    await prisma.client.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { id: { in: ALL_USER_IDS } } });
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
      // Second floor — see the block comment on `xfm`.
      { u: xfm },
      { u: xmgr, managerId: xfm.id },
      { u: xrep1, managerId: xmgr.id },
      { u: xrep2, managerId: xmgr.id },
      { u: cycleTl },
      { u: cycleFm },
      { u: cycleTarget, managerId: xmgr.id },
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

    // Close the corrupt loop in a second pass — neither node can be created first.
    // Detached from the director's tree on purpose, so it widens nobody's visible set.
    // `tenantId` is spelled out because the seeding context is `bypassRls` under the
    // synthetic 'system' tenant: `applyBypassTenant` stamps that onto any write payload
    // that omits it, and no Tenant row by that name exists.
    await prisma.user.update({
      where: { id: cycleTl.id },
      data: { managerId: cycleFm.id, tenantId },
    });
    await prisma.user.update({
      where: { id: cycleFm.id },
      data: { managerId: cycleTl.id, tenantId },
    });

    // The mailbox whose send-pause is asserted below.
    await prisma.emailAccount.create({
      data: {
        id: 'org-x-mgr-mailbox',
        userId: xmgr.id,
        email: xmgr.email,
        provider: 'imap_smtp',
        tenantId,
      },
    });
  });
}, 60_000);

afterAll(async () => {
  if (!hasDb) return;
  await tenantStorage.run({ tenantId: 'system', bypassRls: true }, async () => {
    await prisma.auditLog.deleteMany({ where: { tenantId } });
    await prisma.emailAccount.deleteMany({ where: { tenantId } });
    await prisma.activity.deleteMany({ where: { tenantId } });
    await prisma.lead.deleteMany({ where: { tenantId } });
    await prisma.task.deleteMany({ where: { tenantId } });
    await prisma.meeting.deleteMany({ where: { tenantId } });
    await prisma.opportunity.deleteMany({ where: { tenantId } });
    await prisma.campaignSdr.deleteMany({ where: { tenantId } });
    await prisma.campaign.deleteMany({ where: { tenantId } });
    await prisma.client.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { id: { in: ALL_USER_IDS } } });
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

describe.skipIf(!hasDb)('PUT /api/users/[id] — cycle guard is wired into the route', () => {
  it('refuses to attach a user to an already-corrupt reporting chain', async () => {
    // Role-valid (sdr → team_lead), so this gets past `isValidManagerRole` and
    // actually reaches the cycle walk. `tests/podScoping.test.ts` proves
    // `wouldCreateManagerCycle` in isolation; nothing proved the route calls it.
    const res = await updateUser(putReq(cycleTarget.id, { managerId: cycleTl.id }), {
      params: Promise.resolve({ id: cycleTarget.id }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('circular reporting chain');

    // And the write was refused, not merely reported.
    const after = await tenantStorage.run({ tenantId: 'system', bypassRls: true }, () =>
      prisma.user.findUnique({ where: { id: cycleTarget.id }, select: { managerId: true } })
    );
    expect(after?.managerId).toBe(xmgr.id);
  });
});

describe.skipIf(!hasDb)('PUT /api/users/[id] — Floor Manager scoped role administration', () => {
  it('rejects promoting to Director when a Floor Manager sends it', async () => {
    mockAuth(xfm);
    const res = await updateUser(putReq(xrep1.id, { role: 'director' }), {
      params: Promise.resolve({ id: xrep1.id }),
    });
    expect(res.status).toBe(403);
  });

  it('allows a Floor Manager to promote an in-scope SDR to Team Lead', async () => {
    mockAuth(xfm);
    const res = await updateUser(putReq(xrep1.id, { role: 'team_lead', managerId: xfm.id }), {
      params: Promise.resolve({ id: xrep1.id }),
    });
    expect(res.status).toBe(200);

    const after = await tenantStorage.run({ tenantId: 'system', bypassRls: true }, () =>
      prisma.user.findUnique({
        where: { id: xrep1.id },
        select: { role: true, managerId: true },
      })
    );
    expect(after?.role).toBe('team_lead');
    expect(after?.managerId).toBe(xfm.id);

    // Restore back to SDR
    await updateUser(putReq(xrep1.id, { role: 'sdr', managerId: xmgr.id }), {
      params: Promise.resolve({ id: xrep1.id }),
    });
  });
});

describe.skipIf(!hasDb)('PUT /api/users/[id] — reassignReportsTo', () => {
  it('refuses to hand the reports to the user being deactivated', async () => {
    const res = await updateUser(
      putReq(xmgr.id, { isActive: false, reassignReportsTo: xmgr.id }),
      { params: Promise.resolve({ id: xmgr.id }) }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('being deactivated');
  });

  it('refuses a deactivated replacement manager', async () => {
    const res = await updateUser(
      putReq(xmgr.id, { isActive: false, reassignReportsTo: zombie.id }),
      { params: Promise.resolve({ id: xmgr.id }) }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('must be an active user');
  });

  it('refuses a replacement whose role cannot manage the reports', async () => {
    // The reports are SDRs; an SDR may not manage an SDR. `xrep2` is used rather
    // than a shared-fixture SDR because the earlier blocks promote `sdrOut` to
    // team_lead mid-run, which would silently make this a valid reassignment.
    const res = await updateUser(
      putReq(xmgr.id, { isActive: false, reassignReportsTo: xrep2.id }),
      { params: Promise.resolve({ id: xmgr.id }) }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('cannot report to a');
  });

  it('moves the reports and pauses the deactivated owner mailbox on success', async () => {
    const res = await updateUser(
      putReq(xmgr.id, { isActive: false, reassignReportsTo: xfm.id }),
      { params: Promise.resolve({ id: xmgr.id }) }
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ isActive: false });

    const { reports, mailbox } = await tenantStorage.run(
      { tenantId: 'system', bypassRls: true },
      async () => ({
        reports: await prisma.user.findMany({
          where: { id: { in: [xrep1.id, xrep2.id, cycleTarget.id] } },
          select: { id: true, managerId: true },
        }),
        mailbox: await prisma.emailAccount.findUnique({
          where: { id: 'org-x-mgr-mailbox' },
          select: { sendPausedAt: true, sendPausedById: true, sendPauseReason: true },
        }),
      })
    );

    expect(reports.every((r) => r.managerId === xfm.id)).toBe(true);

    // The regression guard this suite was missing. `workers/email.ts` gates on
    // `EmailAccount.isActive` / `sendPausedAt` and never reads `User.isActive`,
    // so without this stamp a deactivated rep's mailbox keeps sending sequence
    // email. The 200 above says nothing about it.
    expect(mailbox?.sendPausedAt).toBeInstanceOf(Date);
    expect(mailbox?.sendPausedById).toBe(director.id);
    expect(mailbox?.sendPauseReason).toBe('Owner deactivated');
  });
});
