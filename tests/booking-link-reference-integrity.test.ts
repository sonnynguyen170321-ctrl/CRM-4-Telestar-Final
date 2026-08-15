import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as createBookingLink } from '@/app/api/booking-links/route';
import { prisma, tenantStorage } from '@/lib/prisma';
import { auth } from '@/auth';
import type { SessionUser } from '@/lib/auth';

/**
 * Request-supplied relations on `POST /api/booking-links`.
 *
 * Written against current code before changing anything. Booking links are client-facing: the
 * URL a prospect is sent to book a meeting, scoped to a client and optionally a campaign. A link
 * attached to the wrong client is a prospect sent to another company's calendar.
 *
 * The route already gates on role (`requireRole('floor_manager')`, so director and floor manager
 * only), which the lead route did not. That answers "may you create booking links at all"; it
 * does not answer "may you attach one to *this* client", and `clientId` / `campaignId` come
 * straight from the body.
 *
 * Two things are under test:
 *
 *   1. the created row's relations — can a manager in tenant A name tenant B's client?
 *   2. the `isDefault` side effect — the route runs an `updateMany` clearing other defaults for
 *      the same scope *before* creating, and that write is the one that can reach rows the
 *      caller never named.
 */

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));

const hasDb = Boolean(process.env.DATABASE_URL);

const T_A = 'blref-tenant-a';
const T_B = 'blref-tenant-b';
const FM_A = 'blref-fm-a';
const CLIENT_A = 'blref-client-a';
const CLIENT_B = 'blref-client-b';
const CAMPAIGN_A = 'blref-campaign-a';
const CAMPAIGN_B = 'blref-campaign-b';
/** Tenant A, but no campaign of theirs is visible to the caller — the authorization axis. */
const CLIENT_A2 = 'blref-client-a2';
const CAMPAIGN_A2 = 'blref-campaign-a2';
/** Tenant A, and visible to the caller — used to isolate hierarchy from authorization. */
const CLIENT_A3 = 'blref-client-a3';
const CAMPAIGN_A3 = 'blref-campaign-a3';
const LINK_B_DEFAULT = 'blref-link-b-default';

const fmA: SessionUser = {
  id: FM_A,
  email: 'fm@blref.test',
  firstName: 'Fay',
  lastName: 'Manager',
  role: 'floor_manager',
  tenantId: T_A,
};

const runAs = <R>(tenantId: string, fn: () => Promise<R>) =>
  tenantStorage.run({ tenantId, bypassRls: true }, fn);
const runSystem = <R>(fn: () => Promise<R>) =>
  tenantStorage.run({ tenantId: 'system', bypassRls: true }, fn);

let seq = 0;
const post = (body: Record<string, unknown>) =>
  createBookingLink(
    new NextRequest('http://localhost/api/booking-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: `Link ${++seq}`,
        url: `https://cal.example.test/blref-${seq}`,
        ...body,
      }),
    })
  );

const counts = (tenantId: string) =>
  runAs(tenantId, async () => ({
    links: await prisma.bookingLink.count({ where: { tenantId } }),
  }));

/**
 * Prove the fixture is actually multi-tenant before any attack runs.
 *
 * `lib/tenant-inject.ts` `applyScopedTenant()` makes the **active context tenant win** over
 * `data.tenantId`, so creating a "tenant B" row while tenant-A context is active silently
 * produces a **tenant-A** row. A cross-tenant test built that way is not testing anything: both
 * sides live in one tenant, and it will report whatever the code does as though it were a
 * boundary result. That is exactly how an earlier probe produced a false cross-tenant finding
 * that a raw-SQL experiment later disproved.
 *
 * Read with `$queryRaw` on purpose. The extended client is the layer under test here, so using
 * it to verify its own effect would let the same mistake pass twice.
 */
async function assertFixtureTenancy(): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ kind: string; id: string; tenantId: string }>>`
    SELECT 'client' AS kind, id, "tenantId" FROM "Client"      WHERE id IN (${CLIENT_A}, ${CLIENT_B})
    UNION ALL
    SELECT 'campaign',        id, "tenantId" FROM "Campaign"   WHERE id IN (${CAMPAIGN_A}, ${CAMPAIGN_B})
    UNION ALL
    SELECT 'link',            id, "tenantId" FROM "BookingLink" WHERE id = ${LINK_B_DEFAULT}
  `;

  const expected: Record<string, string> = {
    [CLIENT_A]: T_A,
    [CAMPAIGN_A]: T_A,
    [CLIENT_B]: T_B,
    [CAMPAIGN_B]: T_B,
    [LINK_B_DEFAULT]: T_B,
  };

  const seen = new Map(rows.map((r) => [r.id, r.tenantId]));
  const problems: string[] = [];
  for (const [id, tenantId] of Object.entries(expected)) {
    const actual = seen.get(id);
    if (actual === undefined) problems.push(`${id} was never persisted`);
    else if (actual !== tenantId) problems.push(`${id} persisted as ${actual}, expected ${tenantId}`);
  }

  if (problems.length > 0) {
    throw new Error(
      `Multi-tenant fixture is not multi-tenant — every assertion below would be meaningless:\n` +
        problems.map((p) => `  - ${p}`).join('\n') +
        `\nCreate each tenant's rows inside that tenant's own context, or with raw SQL.`
    );
  }
}

describe.skipIf(!hasDb)('booking link request-supplied relations', () => {
  beforeAll(async () => {
    for (const t of [T_A, T_B]) {
      await runAs(t, async () => {
        await prisma.bookingLink.deleteMany({ where: { tenantId: t } });
        // Membership rows point at the campaign with no cascade, so they go first.
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
          { id: T_A, name: 'BL Ref A' },
          { id: T_B, name: 'BL Ref B' },
        ],
      });
      await prisma.user.create({
        data: {
          id: FM_A,
          tenantId: T_A,
          email: 'fm@blref.test',
          password: 'x',
          firstName: 'Fay',
          lastName: 'Manager',
          role: 'floor_manager',
        },
      });
    });

    for (const [t, clientId, campaignId] of [
      [T_A, CLIENT_A, CAMPAIGN_A],
      [T_B, CLIENT_B, CAMPAIGN_B],
    ] as const) {
      await runAs(t, async () => {
        await prisma.client.create({
          data: { id: clientId, tenantId: t, name: `Client ${t}`, industry: 'Logistics', contactName: 'Ops', contactEmail: `ops@${t}.test` },
        });
        await prisma.campaign.create({
          data: { id: campaignId, tenantId: t, clientId, name: `Camp ${t}`, startDate: new Date('2026-08-12T00:00:00Z') },
        });
      });
    }

    // A second tenant-A client whose campaign the floor manager cannot see. Client visibility
    // follows `app/api/clients/route.ts`: "you see a client if you can see at least one of its
    // campaigns", resolved through `getVisibleCampaignIds`.
    await runAs(T_A, async () => {
      await prisma.client.create({
        data: { id: CLIENT_A2, tenantId: T_A, name: 'Client A2', industry: 'Logistics', contactName: 'Ops', contactEmail: 'ops-a2@blref.test' },
      });
      await prisma.campaign.create({
        data: { id: CAMPAIGN_A2, tenantId: T_A, clientId: CLIENT_A2, name: 'Camp A2', startDate: new Date('2026-08-12T00:00:00Z') },
      });
      // A third client the caller *can* see. Without it the hierarchy case is untestable: the
      // only other client is invisible, so `canReferenceCampaign` refuses first and the answer is
      // 403 — which is correct for that input, and says nothing about hierarchy.
      await prisma.client.create({
        data: { id: CLIENT_A3, tenantId: T_A, name: 'Client A3', industry: 'Logistics', contactName: 'Ops', contactEmail: 'ops-a3@blref.test' },
      });
      await prisma.campaign.create({
        data: { id: CAMPAIGN_A3, tenantId: T_A, clientId: CLIENT_A3, name: 'Camp A3', startDate: new Date('2026-08-12T00:00:00Z') },
      });
      // Member of campaign A and campaign A3 only. Campaign A2 stays invisible, which is what
      // makes the positive control a genuine authorization rather than an absent check.
      await prisma.campaignSdr.createMany({
        data: [
          { tenantId: T_A, campaignId: CAMPAIGN_A, userId: FM_A },
          { tenantId: T_A, campaignId: CAMPAIGN_A3, userId: FM_A },
        ],
      });
    });

    // Tenant B already has a default link. The `isDefault` clearing write must never touch it.
    await runAs(T_B, () =>
      prisma.bookingLink.create({
        data: {
          id: LINK_B_DEFAULT,
          tenantId: T_B,
          clientId: CLIENT_B,
          campaignId: CAMPAIGN_B,
          name: 'B default',
          url: 'https://cal.example.test/tenant-b',
          isDefault: true,
        },
      })
    );

    await assertFixtureTenancy();
  });

  beforeEach(() => {
    vi.mocked(auth).mockResolvedValue({ user: fmA } as never);
  });

  it('refuses a client in another tenant, creating nothing', async () => {
    const before = await counts(T_A);
    const res = await runAs(T_A, () => post({ clientId: CLIENT_B }));

    expect(res.status, 'a tenant A manager attached a booking link to tenant B client').toBeGreaterThanOrEqual(400);
    expect(await counts(T_A)).toEqual(before);
    expect((await counts(T_B)).links, 'a link landed in the foreign tenant').toBe(1);
  });

  it('refuses a campaign in another tenant, creating nothing', async () => {
    const before = await counts(T_A);
    const res = await runAs(T_A, () => post({ clientId: CLIENT_A, campaignId: CAMPAIGN_B }));

    expect(res.status, 'a cross-tenant campaignId was accepted').toBeGreaterThanOrEqual(400);
    expect(await counts(T_A)).toEqual(before);
  });

  it('refuses a client id that does not exist the same way as a foreign one', async () => {
    const foreign = await runAs(T_A, () => post({ clientId: CLIENT_B }));
    const missing = await runAs(T_A, () => post({ clientId: 'blref-no-such-client' }));

    expect(missing.status).toBeGreaterThanOrEqual(400);
    expect(missing.status, 'a nonexistent id answers differently from a foreign one').toBe(
      foreign.status
    );
  });

  it('the isDefault clearing write cannot reach another tenant links', async () => {
    // This is the write that does not need a valid reference to do damage: it targets rows by
    // `clientId` + `campaignId` + `isDefault`, so if tenant scoping is not applied it can clear
    // another tenant's default booking link — silently, on a request that otherwise looks
    // ordinary. A prospect then gets no booking link where the client expected one.
    await runAs(T_A, () => post({ clientId: CLIENT_A, campaignId: CAMPAIGN_A, isDefault: true }));

    // Read raw. The extended client is the thing whose scoping is in question, so asking it
    // whether it scoped correctly is circular — and it answered `undefined` here for a row that
    // raw SQL shows present and untouched, which is precisely why this assertion is not routed
    // through it.
    const [foreignDefault] = await prisma.$queryRaw<Array<{ tenantId: string; isDefault: boolean }>>`
      SELECT "tenantId", "isDefault" FROM "BookingLink" WHERE id = ${LINK_B_DEFAULT}
    `;

    expect(foreignDefault, 'tenant B default booking link vanished').toBeDefined();
    expect(foreignDefault.tenantId, 'tenant B link was moved into another tenant').toBe(T_B);
    expect(
      foreignDefault.isDefault,
      'a tenant A request cleared tenant B default booking link'
    ).toBe(true);
  });

  it('refuses a campaign id that does not exist', async () => {
    const before = await counts(T_A);
    const res = await runAs(T_A, () => post({ clientId: CLIENT_A, campaignId: 'blref-no-such-campaign' }));

    expect(res.status).toBe(404);
    expect(await counts(T_A)).toEqual(before);
  });

  it('refuses an in-tenant client the caller cannot see', async () => {
    // Real, same tenant, and none of its campaigns are visible to this manager. A tenant-only
    // check would let this through, and a floor manager could attach a booking link to another
    // floor's client.
    const before = await counts(T_A);
    const res = await runAs(T_A, () => post({ clientId: CLIENT_A2 }));

    expect(res.status).toBe(403);
    expect(await counts(T_A)).toEqual(before);
  });

  it('refuses an in-tenant campaign the caller cannot see', async () => {
    const before = await counts(T_A);
    const res = await runAs(T_A, () => post({ clientId: CLIENT_A2, campaignId: CAMPAIGN_A2 }));

    expect(res.status).toBe(403);
    expect(await counts(T_A)).toEqual(before);
  });

  it('refuses a campaign that belongs to a different client', async () => {
    // Relational consistency, not RBAC: both references are in-tenant, and the caller is
    // entitled to name the client. The pair is simply incoherent — a booking link claiming
    // client A while its campaign belongs to client A2 describes two different hierarchies, and
    // every report walking `lead -> campaign -> client` would disagree with it.
    //
    // 422 rather than 403 for exactly that reason: nothing here is forbidden, it is malformed.
    const before = await counts(T_A);
    const res = await runAs(T_A, () => post({ clientId: CLIENT_A, campaignId: CAMPAIGN_A3 }));

    expect(res.status, 'a booking link joined a client to another client campaign').toBe(422);
    expect(await counts(T_A)).toEqual(before);
  });

  it('creates a link for the caller own client', async () => {
    const before = await counts(T_A);
    const res = await runAs(T_A, () => post({ clientId: CLIENT_A, campaignId: CAMPAIGN_A }));

    expect(res.status, `own-client create failed: ${await res.text()}`).toBeLessThan(300);
    expect((await counts(T_A)).links).toBe(before.links + 1);
  });

  it('does not let the body choose the tenant or the creator', async () => {
    const res = await runAs(T_A, () =>
      post({ clientId: CLIENT_A, tenantId: T_B, createdById: 'someone-else' })
    );
    expect(res.status).toBeLessThan(300);

    const created = (await res.json()) as { id: string };
    const row = await runAs(T_A, () =>
      prisma.bookingLink.findUnique({
        where: { id: created.id },
        select: { tenantId: true, createdById: true },
      })
    );
    expect(row?.tenantId, 'the body chose the tenant').toBe(T_A);
    expect(row?.createdById, 'the body chose the creator').toBe(FM_A);
  });
});
