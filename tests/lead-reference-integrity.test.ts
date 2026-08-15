import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as createLead } from '@/app/api/leads/route';
import { prisma, tenantStorage } from '@/lib/prisma';
import { auth } from '@/auth';
import type { SessionUser } from '@/lib/auth';

/**
 * A refused campaign reference must leave nothing behind.
 *
 * `POST /api/leads` creates or updates an **Account** and a **Contact** before it creates the
 * Lead. Validating the caller-supplied `campaignId` only at `lead.create` would still return an
 * error, but two durable rows would already be in the tenant — so every rejected attempt would
 * quietly pollute it, and a caller could seed arbitrary Accounts and Contacts using requests
 * that all "fail".
 *
 * The Playwright spec (`e2e/roles/body-parameter-spoofing.spec.ts`) proves the HTTP semantics:
 * a tenant A SDR naming tenant B's campaign gets 404 and no lead. It cannot prove this half —
 * there is no `/api/accounts` endpoint — so the row counts are asserted here, directly.
 *
 * The cross-tenant spoof was real: reproduced in CI at HTTP 201 before `canReferenceCampaign`
 * existed.
 */

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));

const hasDb = Boolean(process.env.DATABASE_URL);

const TENANT_A = 'refint-tenant-a';
const TENANT_B = 'refint-tenant-b';
const SDR_A = 'refint-sdr-a';
const CAMPAIGN_A = 'refint-campaign-a';
const CAMPAIGN_B = 'refint-campaign-b';
/** Same tenant as the caller, but the caller is not a member of it. */
const CAMPAIGN_A_WALLED = 'refint-campaign-a-walled';

const sdrA: SessionUser = {
  id: SDR_A,
  email: 'sdr@refint.test',
  firstName: 'Sam',
  lastName: 'Rep',
  role: 'sdr',
  tenantId: TENANT_A,
};

const runAs = <R>(tenantId: string, fn: () => Promise<R>) =>
  tenantStorage.run({ tenantId, bypassRls: true }, fn);
const runSystem = <R>(fn: () => Promise<R>) =>
  tenantStorage.run({ tenantId: 'system', bypassRls: true }, fn);

const post = (body: Record<string, unknown>) =>
  createLead(
    new NextRequest('http://localhost/api/leads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );

/** Everything the route could durably write on its way to failing. */
async function sideEffectCounts(tenantId: string) {
  return runAs(tenantId, async () => ({
    leads: await prisma.lead.count({ where: { tenantId } }),
    accounts: await prisma.account.count({ where: { tenantId } }),
    contacts: await prisma.contact.count({ where: { tenantId } }),
    activities: await prisma.activity.count({ where: { tenantId } }),
  }));
}

describe.skipIf(!hasDb)('a caller-supplied campaignId cannot cross a tenant boundary', () => {
  beforeAll(async () => {
    for (const t of [TENANT_A, TENANT_B]) {
      await runAs(t, async () => {
        await prisma.activity.deleteMany({ where: { tenantId: t } });
        await prisma.lead.deleteMany({ where: { tenantId: t } });
        await prisma.contact.deleteMany({ where: { tenantId: t } });
        await prisma.account.deleteMany({ where: { tenantId: t } });
        await prisma.campaignSdr.deleteMany({ where: { tenantId: t } });
        await prisma.campaign.deleteMany({ where: { tenantId: t } });
        await prisma.client.deleteMany({ where: { tenantId: t } });
        await prisma.user.deleteMany({ where: { tenantId: t } });
        await prisma.tenant.deleteMany({ where: { id: t } });
      });
    }

    await runSystem(async () => {
      await prisma.tenant.createMany({
        data: [
          { id: TENANT_A, name: 'Ref Integrity A' },
          { id: TENANT_B, name: 'Ref Integrity B' },
        ],
      });
      await prisma.user.create({
        data: {
          id: SDR_A,
          tenantId: TENANT_A,
          email: 'sdr@refint.test',
          password: 'x',
          firstName: 'Sam',
          lastName: 'Rep',
          role: 'sdr',
        },
      });
    });

    for (const [t, clientId, campaignId] of [
      [TENANT_A, 'refint-client-a', CAMPAIGN_A],
      [TENANT_B, 'refint-client-b', CAMPAIGN_B],
    ] as const) {
      await runAs(t, async () => {
        await prisma.client.create({
          data: {
            id: clientId,
            tenantId: t,
            name: `Client ${t}`,
            industry: 'Logistics',
            contactName: 'Ops',
            contactEmail: `ops@${t}.test`,
          },
        });
        await prisma.campaign.create({
          data: {
            id: campaignId,
            tenantId: t,
            clientId,
            name: `Campaign ${t}`,
            startDate: new Date('2026-08-12T00:00:00Z'),
          },
        });
      });
    }

    // A second campaign inside the caller's own tenant that the caller has no membership in.
    // This is the axis a tenant check alone cannot see.
    await runAs(TENANT_A, () =>
      prisma.campaign.create({
        data: {
          id: CAMPAIGN_A_WALLED,
          tenantId: TENANT_A,
          clientId: 'refint-client-a',
          name: 'Campaign A (walled)',
          startDate: new Date('2026-08-12T00:00:00Z'),
        },
      })
    );

    // The SDR is a member of their own campaign, so the positive control is genuinely allowed.
    await runAs(TENANT_A, () =>
      prisma.campaignSdr.create({
        data: { tenantId: TENANT_A, campaignId: CAMPAIGN_A, userId: SDR_A },
      })
    );
  });

  beforeEach(() => {
    vi.mocked(auth).mockResolvedValue({ user: sdrA } as never);
  });

  it('refuses a campaign in another tenant with 404, creating nothing at all', async () => {
    const before = await sideEffectCounts(TENANT_A);

    const res = await runAs(TENANT_A, () =>
      post({
        firstName: 'Mallory',
        lastName: 'Spoof',
        company: 'REFINT_SPOOF_CO',
        email: 'mallory@refint-spoof.test',
        campaignId: CAMPAIGN_B,
      })
    );

    // 404 rather than 403: a foreign-tenant campaign must be indistinguishable from one that
    // does not exist, or the status code confirms foreign rows to anyone guessing ids.
    expect(res.status).toBe(404);

    const after = await sideEffectCounts(TENANT_A);
    expect(after, 'a refused request wrote durable rows on its way to failing').toEqual(before);

    // And nothing landed in the tenant whose campaign was named, either.
    const inB = await sideEffectCounts(TENANT_B);
    expect(inB.leads).toBe(0);
    expect(inB.accounts).toBe(0);
    expect(inB.contacts).toBe(0);
  });

  it('refuses a campaign id that does not exist with the same 404', async () => {
    const before = await sideEffectCounts(TENANT_A);

    const res = await runAs(TENANT_A, () =>
      post({
        firstName: 'Ghost',
        lastName: 'Campaign',
        company: 'REFINT_GHOST_CO',
        email: 'ghost@refint-spoof.test',
        campaignId: 'refint-campaign-that-never-existed',
      })
    );

    expect(res.status).toBe(404);
    expect(await sideEffectCounts(TENANT_A)).toEqual(before);
  });

  it('refuses an in-tenant campaign the caller is not a member of with 403, creating nothing', async () => {
    // The authorization half. The campaign is real and in the caller's own tenant, so a check
    // that only compared tenants would let this through — and an SDR would be able to attach
    // prospects to any campaign in the company, including another client's.
    //
    // 403 rather than 404 on purpose: the caller is entitled to know this campaign exists, so
    // hiding it would be misleading. Only *foreign* existence has to stay concealed.
    const before = await sideEffectCounts(TENANT_A);

    const res = await runAs(TENANT_A, () =>
      post({
        firstName: 'Nosy',
        lastName: 'Neighbour',
        company: 'REFINT_WALLED_CO',
        email: 'nosy@refint-spoof.test',
        campaignId: CAMPAIGN_A_WALLED,
      })
    );

    expect(res.status).toBe(403);
    expect(await sideEffectCounts(TENANT_A)).toEqual(before);
  });

  it('still creates a lead in the caller own campaign', async () => {
    // Without this the two refusals above would pass just as well against a route that rejects
    // every campaign reference.
    const before = await sideEffectCounts(TENANT_A);

    const res = await runAs(TENANT_A, () =>
      post({
        firstName: 'Ilse',
        lastName: 'Bakker',
        company: 'REFINT_LEGIT_CO',
        email: 'ilse@refint-legit.test',
        campaignId: CAMPAIGN_A,
      })
    );

    expect(res.status).toBeLessThan(300);

    const after = await sideEffectCounts(TENANT_A);
    expect(after.leads).toBe(before.leads + 1);
    expect(after.accounts).toBe(before.accounts + 1);
    expect(after.contacts).toBe(before.contacts + 1);
  });
});
