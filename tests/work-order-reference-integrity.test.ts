import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as createWorkOrderRoute } from '@/app/api/work-orders/route';
import { prisma, tenantStorage } from '@/lib/prisma';
import { auth } from '@/auth';
import type { SessionUser } from '@/lib/auth';

/**
 * Request-supplied relations on `POST /api/work-orders`.
 *
 * Written against the current implementation before changing anything, because the Lead finding
 * showed that reading a route is not the same as knowing what it does: there, a missing check
 * was real; here `lib/workorders/service.ts` has `resolveScope`, which claims to verify both
 * `leadId` and `campaignId` belong to the tenant. This establishes whether it does, and what it
 * does *not* cover.
 *
 * Two different questions, as with campaigns:
 *
 *   1. tenant — does the referenced row belong to the caller's tenant?
 *   2. authorization — may *this* caller reference it?
 *
 * `resolveScope` answers the first. The second is asserted here so that whatever the answer
 * turns out to be, it is a recorded decision rather than an accident.
 */

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));

const hasDb = Boolean(process.env.DATABASE_URL);

const T_A = 'worefint-tenant-a';
const T_B = 'worefint-tenant-b';
const SDR_A = 'worefint-sdr-a';
const SDR_OTHER = 'worefint-sdr-other';
const SDR_B = 'worefint-sdr-b';
const CAMPAIGN_A = 'worefint-campaign-a';
const CAMPAIGN_B = 'worefint-campaign-b';
const LEAD_OWN = 'worefint-lead-own';
const LEAD_WALLED = 'worefint-lead-walled';
const LEAD_B = 'worefint-lead-b';

const sdrA: SessionUser = {
  id: SDR_A,
  email: 'sdr@worefint.test',
  firstName: 'Sam',
  lastName: 'Rep',
  role: 'sdr',
  tenantId: T_A,
};

const runAs = <R>(tenantId: string, fn: () => Promise<R>) =>
  tenantStorage.run({ tenantId, bypassRls: true }, fn);
const runSystem = <R>(fn: () => Promise<R>) =>
  tenantStorage.run({ tenantId: 'system', bypassRls: true }, fn);

let seq = 0;
const post = (body: Record<string, unknown>) =>
  createWorkOrderRoute(
    new NextRequest('http://localhost/api/work-orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // `requestKey` is the idempotency key — a repeat returns the existing order rather than
      // creating one, so every case needs its own or later assertions measure the wrong thing.
      body: JSON.stringify({ requestKey: `worefint-${++seq}-${Date.now()}`, ...body }),
    })
  );

/** Everything a refused create could have written on its way to failing. */
async function counts(tenantId: string) {
  return runAs(tenantId, async () => ({
    workOrders: await prisma.workOrder.count({ where: { tenantId } }),
    agentActions: await prisma.agentAction.count({ where: { tenantId } }),
    activities: await prisma.activity.count({ where: { tenantId } }),
  }));
}

describe.skipIf(!hasDb)('work order request-supplied relations', () => {
  beforeAll(async () => {
    for (const t of [T_A, T_B]) {
      await runAs(t, async () => {
        await prisma.agentAction.deleteMany({ where: { tenantId: t } });
        await prisma.workOrderLease.deleteMany({ where: { tenantId: t } });
        await prisma.workOrder.deleteMany({ where: { tenantId: t } });
        await prisma.activity.deleteMany({ where: { tenantId: t } });
        await prisma.lead.deleteMany({ where: { tenantId: t } });
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
          { id: T_A, name: 'WO Ref A' },
          { id: T_B, name: 'WO Ref B' },
        ],
      });
      await prisma.user.createMany({
        data: [
          { id: SDR_A, tenantId: T_A, email: 'sdr@worefint.test', password: 'x', firstName: 'Sam', lastName: 'Rep', role: 'sdr' },
          { id: SDR_OTHER, tenantId: T_A, email: 'other@worefint.test', password: 'x', firstName: 'Otto', lastName: 'Peer', role: 'sdr' },
          { id: SDR_B, tenantId: T_B, email: 'sdrb@worefint.test', password: 'x', firstName: 'Bea', lastName: 'Other', role: 'sdr' },
        ],
      });
    });

    for (const [t, clientId, campaignId] of [
      [T_A, 'worefint-client-a', CAMPAIGN_A],
      [T_B, 'worefint-client-b', CAMPAIGN_B],
    ] as const) {
      await runAs(t, async () => {
        await prisma.client.create({
          data: { id: clientId, tenantId: t, name: `C ${t}`, industry: 'Logistics', contactName: 'Ops', contactEmail: `ops@${t}.test` },
        });
        await prisma.campaign.create({
          data: { id: campaignId, tenantId: t, clientId, name: `Camp ${t}`, startDate: new Date('2026-08-12T00:00:00Z') },
        });
      });
    }

    await runAs(T_A, async () => {
      await prisma.lead.createMany({
        data: [
          { id: LEAD_OWN, tenantId: T_A, campaignId: CAMPAIGN_A, assignedToId: SDR_A, firstName: 'Own', lastName: 'Lead', company: 'Own Co', email: 'own@worefint.test', stage: 'new' },
          // Same tenant, owned by a peer this SDR has no access to — the authorization axis.
          { id: LEAD_WALLED, tenantId: T_A, campaignId: CAMPAIGN_A, assignedToId: SDR_OTHER, firstName: 'Walled', lastName: 'Lead', company: 'Walled Co', email: 'walled@worefint.test', stage: 'new' },
        ],
      });
    });
    await runAs(T_B, () =>
      prisma.lead.create({
        data: { id: LEAD_B, tenantId: T_B, campaignId: CAMPAIGN_B, assignedToId: SDR_B, firstName: 'Foreign', lastName: 'Lead', company: 'Foreign Co', email: 'foreign@worefint.test', stage: 'new' },
      })
    );
  });

  beforeEach(() => {
    vi.mocked(auth).mockResolvedValue({ user: sdrA } as never);
  });

  // ── tenant axis: resolveScope's stated job ────────────────────────────────
  it('refuses a lead in another tenant, and writes nothing', async () => {
    const before = await counts(T_A);
    const res = await runAs(T_A, () => post({ type: 'research_batch', leadId: LEAD_B }));

    expect(res.status, 'a cross-tenant leadId was accepted').toBeGreaterThanOrEqual(400);
    expect(await counts(T_A), 'a refused create wrote durable rows').toEqual(before);
    expect((await counts(T_B)).workOrders, 'a work order landed in the foreign tenant').toBe(0);
  });

  it('refuses a campaign in another tenant, and writes nothing', async () => {
    const before = await counts(T_A);
    const res = await runAs(T_A, () => post({ type: 'research_batch', campaignId: CAMPAIGN_B }));

    expect(res.status, 'a cross-tenant campaignId was accepted').toBeGreaterThanOrEqual(400);
    expect(await counts(T_A)).toEqual(before);
    expect((await counts(T_B)).workOrders).toBe(0);
  });

  it('refuses ids that do not exist without distinguishing them from foreign ones', async () => {
    // The message must not tell a caller whether the id exists somewhere else — that is the
    // difference between "not found" and "found, but not yours", and only one of them is safe
    // to disclose.
    const foreign = await runAs(T_A, () => post({ type: 'research_batch', leadId: LEAD_B }));
    const missing = await runAs(T_A, () => post({ type: 'research_batch', leadId: 'worefint-no-such-lead' }));

    expect(missing.status).toBeGreaterThanOrEqual(400);
    expect(missing.status, 'a nonexistent id answers differently from a foreign one').toBe(
      foreign.status
    );
  });

  // ── authorization axis: not resolveScope's job, and asserted on purpose ────
  it('refuses an in-tenant lead the caller cannot access, and leaks nothing by doing so', async () => {
    // Previously 201, recorded as deliberate on the reasoning that a work order is draft-only.
    // That reasoning does not survive the detail: a real-but-hidden lead answered 201 while a
    // nonexistent one answered 422, so the status code alone told a caller whether a guessed id
    // exists. An existence oracle over another rep's prospects is a disclosure, however inert the
    // row it creates.
    //
    // `canAccessLead` is already the CRM's object authority — dispatch uses it too — so applying
    // it here is the existing rule reaching one boundary earlier, not a second permission model.
    const before = await counts(T_A);
    const walled = await runAs(T_A, () => post({ type: 'research_batch', leadId: LEAD_WALLED }));
    expect(walled.status, 'created a work order against a peer hidden lead').toBe(403);
    expect(await counts(T_A), 'a refused create wrote durable rows').toEqual(before);

    // The refusal must be indistinguishable from the one a guessed id produces, or the oracle
    // survives the fix.
    const missing = await runAs(T_A, () => post({ type: 'research_batch', leadId: 'worefint-no-such-lead-2' }));
    expect(
      missing.status,
      'a hidden lead and a nonexistent one answer differently — the status still reveals existence'
    ).toBe(walled.status);
  });

  it('creates for the caller own lead', async () => {
    const before = await counts(T_A);
    const res = await runAs(T_A, () => post({ type: 'research_batch', leadId: LEAD_OWN }));

    expect(res.status).toBe(201);
    expect((await counts(T_A)).workOrders).toBe(before.workOrders + 1);
  });

  it('does not let the body choose a tenant or a creator', async () => {
    const res = await runAs(T_A, () =>
      post({
        type: 'research_batch',
        leadId: LEAD_OWN,
        tenantId: T_B,
        createdById: SDR_OTHER,
      })
    );
    expect(res.status).toBe(201);

    const order = (await res.json()).workOrder as { tenantId: string; createdById: string };
    expect(order.tenantId, 'the body chose the tenant').toBe(T_A);
    expect(order.createdById, 'the body chose the creator').toBe(SDR_A);
  });
});
