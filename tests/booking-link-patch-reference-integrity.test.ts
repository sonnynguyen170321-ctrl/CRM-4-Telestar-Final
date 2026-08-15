import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma, tenantStorage } from '@/lib/prisma';
import { auth } from '@/auth';
import type { SessionUser } from '@/lib/auth';

/**
 * `PATCH /api/booking-links/[id]` must refuse a caller-supplied `campaignId` it may not name.
 *
 * `POST` gained `canReferenceCampaign`; `PATCH` did not, and the two accept the same field. That
 * left the creation path closed and the update path open, which is worse than either being open
 * alone: the read side had just been hardened against relations pointing outside the tenant, and
 * this was the vector that could still produce one.
 *
 * Measured before the fix, against real Postgres, through this exact handler:
 *
 *   PATCH { campaignId: <tenant B campaign> }  ->  HTTP 200, and the tenant A link's campaignId
 *                                                  was tenant B's campaign afterwards
 *   PATCH { campaignId: <nonexistent> }        ->  HTTP 500 (foreign-key error surfaced raw)
 *
 * Both are asserted here so neither can come back. The nonexistent case matters on its own: a
 * 500 tells a caller the id was structurally accepted and failed at the database, which is a
 * different disclosure from a flat "not found".
 */

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));

const TENANT_A = 'blpatch-tenant-a';
const TENANT_B = 'blpatch-tenant-b';
const CLIENT_A = 'blpatch-client-a';
const CLIENT_B = 'blpatch-client-b';
const CAMPAIGN_B = 'blpatch-campaign-b';
const LINK_A = 'blpatch-link-a';

const hasDb = Boolean(process.env.DATABASE_URL);

const floorManagerA: SessionUser = {
  id: 'blpatch-fm-a',
  email: 'fm@blpatch.test',
  firstName: 'Fay',
  lastName: 'Marsh',
  role: 'floor_manager',
  managerId: null,
  tenantId: TENANT_A,
} as unknown as SessionUser;

const inTenant = <R,>(tenantId: string, fn: () => Promise<R>) =>
  tenantStorage.run({ tenantId, bypassRls: true }, fn);

async function patchLink(campaignId: string) {
  const { PATCH } = await import('@/app/api/booking-links/[id]/route');
  return PATCH(
    new NextRequest(`http://localhost/api/booking-links/${LINK_A}`, {
      method: 'PATCH',
      body: JSON.stringify({ campaignId }),
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ id: LINK_A }) }
  );
}

describe.skipIf(!hasDb)('PATCH /api/booking-links/[id] — campaign reference integrity', () => {
  beforeAll(async () => {
    for (const t of [TENANT_A, TENANT_B]) {
      await inTenant(t, async () => {
        await prisma.tenant.upsert({ where: { id: t }, create: { id: t, name: t }, update: {} });
      });
    }

    await inTenant(TENANT_A, async () => {
      await prisma.user.upsert({
        where: { id: floorManagerA.id },
        create: {
          id: floorManagerA.id,
          email: floorManagerA.email,
          password: 'x',
          firstName: 'Fay',
          lastName: 'Marsh',
          role: 'floor_manager',
          tenantId: TENANT_A,
        },
        update: {},
      });
      await prisma.client.upsert({
        where: { id: CLIENT_A },
        create: {
          id: CLIENT_A,
          name: 'Tenant A Client',
          industry: 'x',
          contactName: 'x',
          contactEmail: 'a@blpatch.test',
          tenantId: TENANT_A,
        },
        update: {},
      });
      await prisma.bookingLink.upsert({
        where: { id: LINK_A },
        create: {
          id: LINK_A,
          clientId: CLIENT_A,
          name: 'Tenant A link',
          url: 'https://example.test/a',
          tenantId: TENANT_A,
          isActive: true,
        },
        update: { campaignId: null },
      });
    });

    await inTenant(TENANT_B, async () => {
      await prisma.client.upsert({
        where: { id: CLIENT_B },
        create: {
          id: CLIENT_B,
          name: 'Tenant B Client',
          industry: 'x',
          contactName: 'x',
          contactEmail: 'b@blpatch.test',
          tenantId: TENANT_B,
        },
        update: {},
      });
      await prisma.campaign.upsert({
        where: { id: CAMPAIGN_B },
        create: {
          id: CAMPAIGN_B,
          clientId: CLIENT_B,
          name: 'Tenant B campaign',
          startDate: new Date(),
          tenantId: TENANT_B,
        },
        update: {},
      });
    });
  });

  afterAll(async () => {
    await inTenant(TENANT_A, async () => {
      await prisma.bookingLink.deleteMany({ where: { tenantId: TENANT_A } });
      await prisma.client.deleteMany({ where: { tenantId: TENANT_A } });
      await prisma.user.deleteMany({ where: { id: floorManagerA.id } });
    });
    await inTenant(TENANT_B, async () => {
      await prisma.campaign.deleteMany({ where: { tenantId: TENANT_B } });
      await prisma.client.deleteMany({ where: { tenantId: TENANT_B } });
    });
    for (const t of [TENANT_B, TENANT_A]) {
      await inTenant(t, async () => {
        await prisma.tenant.deleteMany({ where: { id: t } });
      });
    }
  });

  it('refuses a campaign in another tenant, and leaves the link unchanged', async () => {
    vi.mocked(auth).mockResolvedValue({ user: floorManagerA } as never);

    const res = await patchLink(CAMPAIGN_B);
    expect(res.status).toBe(404);

    // The assertion that matters: not merely that the response was an error, but that nothing
    // durable moved. A refusal that still wrote the reference would be the whole defect.
    const after = await inTenant(TENANT_A, () =>
      prisma.bookingLink.findUnique({ where: { id: LINK_A }, select: { campaignId: true } })
    );
    expect(after?.campaignId ?? null).toBeNull();
  });

  it('answers a nonexistent campaign with the same 404, not a database error', async () => {
    vi.mocked(auth).mockResolvedValue({ user: floorManagerA } as never);

    const res = await patchLink('blpatch-campaign-does-not-exist');
    expect(res.status).toBe(404);

    const after = await inTenant(TENANT_A, () =>
      prisma.bookingLink.findUnique({ where: { id: LINK_A }, select: { campaignId: true } })
    );
    expect(after?.campaignId ?? null).toBeNull();
  });
});
