import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as createClientReport } from '@/app/api/client-reports/route';
import { prisma, tenantStorage } from '@/lib/prisma';
import { auth } from '@/auth';
import type { SessionUser } from '@/lib/auth';

/**
 * Request-supplied relations on `POST /api/client-reports`.
 *
 * A client report is the artefact a BPO hands its customer: campaign metrics, meetings booked,
 * SDR activity, narrative. `canCreateClientReport` admits **sdr** upward, so the widest exposure
 * is an ordinary rep, and `clientId` / `campaignId` arrive in the body.
 *
 * Worse than the booking-link shape in one respect. `buildReportMetrics({ clientId, campaignId,
 * … })` runs *before* the row is created, computing aggregates over whatever client was named —
 * so a foreign reference does not merely mislabel a row, it can pull another tenant's numbers
 * into the stored snapshot and the response. Every negative case therefore checks the response
 * body for foreign identifiers, not just the status code.
 *
 * Written against current code before any change, and the fixture asserts its own tenancy first:
 * `applyScopedTenant` makes the active context tenant win over `data.tenantId`, so a "tenant B"
 * row built under tenant-A context is silently a tenant-A row and the whole test proves nothing.
 */

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));

const hasDb = Boolean(process.env.DATABASE_URL);

const T_A = 'crref-tenant-a';
const T_B = 'crref-tenant-b';
const SDR_A = 'crref-sdr-a';
const CLIENT_A = 'crref-client-a';
const CAMPAIGN_A = 'crref-campaign-a';
const CLIENT_B = 'crref-client-b';
const CAMPAIGN_B = 'crref-campaign-b';
/** Tenant A, invisible to the caller — the authorization axis. */
const CLIENT_A2 = 'crref-client-a2';
const CAMPAIGN_A2 = 'crref-campaign-a2';
/** Tenant A, visible — isolates hierarchy from authorization. */
const CLIENT_A3 = 'crref-client-a3';
const CAMPAIGN_A3 = 'crref-campaign-a3';

const sdrA: SessionUser = {
  id: SDR_A,
  email: 'sdr@crref.test',
  firstName: 'Sam',
  lastName: 'Rep',
  role: 'sdr',
  tenantId: T_A,
};

const runAs = <R>(t: string, fn: () => Promise<R>) => tenantStorage.run({ tenantId: t, bypassRls: true }, fn);
const runSystem = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId: 'system', bypassRls: true }, fn);

let seq = 0;
const post = (body: Record<string, unknown>) =>
  createClientReport(
    new NextRequest('http://localhost/api/client-reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: `Report ${++seq}`,
        periodStart: '2026-08-01',
        periodEnd: '2026-08-07',
        ...body,
      }),
    })
  );

const counts = (tenantId: string) =>
  runAs(tenantId, async () => ({
    reports: await prisma.clientReport.count({ where: { tenantId } }),
  }));

/** See the module comment: a fixture that is not multi-tenant makes every assertion meaningless. */
async function assertFixtureTenancy(): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ id: string; tenantId: string }>>`
    SELECT id, "tenantId" FROM "Client"   WHERE id IN (${CLIENT_A}, ${CLIENT_B})
    UNION ALL
    SELECT id, "tenantId" FROM "Campaign" WHERE id IN (${CAMPAIGN_A}, ${CAMPAIGN_B})
  `;
  const expected: Record<string, string> = {
    [CLIENT_A]: T_A,
    [CAMPAIGN_A]: T_A,
    [CLIENT_B]: T_B,
    [CAMPAIGN_B]: T_B,
  };
  const seen = new Map(rows.map((r) => [r.id, r.tenantId]));
  const problems = Object.entries(expected)
    .map(([id, t]) => {
      const actual = seen.get(id);
      if (actual === undefined) return `${id} was never persisted`;
      if (actual !== t) return `${id} persisted as ${actual}, expected ${t}`;
      return null;
    })
    .filter(Boolean);

  if (problems.length > 0) {
    throw new Error(
      `Multi-tenant fixture is not multi-tenant:\n${problems.map((p) => `  - ${p}`).join('\n')}`
    );
  }
}

describe.skipIf(!hasDb)('client report request-supplied relations', () => {
  beforeAll(async () => {
    for (const t of [T_A, T_B]) {
      await runAs(t, async () => {
        await prisma.clientReport.deleteMany({ where: { tenantId: t } });
        await prisma.campaignSdr.deleteMany({ where: { tenantId: t } });
        await prisma.campaign.deleteMany({ where: { tenantId: t } });
        await prisma.client.deleteMany({ where: { tenantId: t } });
        await prisma.user.deleteMany({ where: { tenantId: t } });
        await prisma.tenant.deleteMany({ where: { id: t } });
      });
    }

    await runSystem(async () => {
      await prisma.tenant.createMany({ data: [{ id: T_A, name: 'CR A' }, { id: T_B, name: 'CR B' }] });
      await prisma.user.create({
        data: { id: SDR_A, tenantId: T_A, email: 'sdr@crref.test', password: 'x', firstName: 'Sam', lastName: 'Rep', role: 'sdr' },
      });
    });

    for (const [t, clientId, campaignId, label] of [
      [T_A, CLIENT_A, CAMPAIGN_A, 'A'],
      [T_B, CLIENT_B, CAMPAIGN_B, 'B'],
      [T_A, CLIENT_A2, CAMPAIGN_A2, 'A2'],
      [T_A, CLIENT_A3, CAMPAIGN_A3, 'A3'],
    ] as const) {
      await runAs(t, async () => {
        await prisma.client.create({
          data: { id: clientId, tenantId: t, name: `CRClient ${label}`, industry: 'Logistics', contactName: 'Ops', contactEmail: `ops-${label}@crref.test` },
        });
        await prisma.campaign.create({
          data: { id: campaignId, tenantId: t, clientId, name: `CRCamp ${label}`, startDate: new Date('2026-08-01T00:00:00Z') },
        });
      });
    }

    // Visible to the caller: campaign A and campaign A3. A2 stays invisible.
    await runAs(T_A, () =>
      prisma.campaignSdr.createMany({
        data: [
          { tenantId: T_A, campaignId: CAMPAIGN_A, userId: SDR_A },
          { tenantId: T_A, campaignId: CAMPAIGN_A3, userId: SDR_A },
        ],
      })
    );

    await assertFixtureTenancy();
  });

  beforeEach(() => {
    vi.mocked(auth).mockResolvedValue({ user: sdrA } as never);
  });

  const refuses = async (label: string, body: Record<string, unknown>, status: number) => {
    const before = await counts(T_A);
    const res = await runAs(T_A, () => post(body));
    const text = await res.text();

    expect(res.status, `${label}: ${text.slice(0, 200)}`).toBe(status);
    expect(await counts(T_A), `${label} wrote a report anyway`).toEqual(before);
    // The metrics builder runs on the supplied client before the row is created, so a refusal
    // must also not have returned another tenant's identifiers.
    expect(text, `${label} disclosed a foreign client`).not.toContain('CRClient B');
    expect(text, `${label} disclosed a foreign campaign`).not.toContain('CRCamp B');
  };

  it('refuses a client in another tenant', () => refuses('foreign client', { clientId: CLIENT_B }, 404));

  it('refuses a campaign in another tenant', () =>
    refuses('foreign campaign', { clientId: CLIENT_A, campaignId: CAMPAIGN_B }, 404));

  it('refuses a client that does not exist', () =>
    refuses('missing client', { clientId: 'crref-no-such-client' }, 404));

  it('refuses a campaign that does not exist', () =>
    refuses('missing campaign', { clientId: CLIENT_A, campaignId: 'crref-no-such-campaign' }, 404));

  it('refuses an in-tenant client the caller cannot see', () =>
    refuses('invisible client', { clientId: CLIENT_A2 }, 403));

  it('refuses an in-tenant campaign the caller cannot see', () =>
    refuses('invisible campaign', { clientId: CLIENT_A2, campaignId: CAMPAIGN_A2 }, 403));

  it('refuses a campaign belonging to a different client', () =>
    refuses('hierarchy mismatch', { clientId: CLIENT_A, campaignId: CAMPAIGN_A3 }, 422));

  it('creates a report for the caller own client', async () => {
    const before = await counts(T_A);
    const res = await runAs(T_A, () => post({ clientId: CLIENT_A, campaignId: CAMPAIGN_A }));

    expect(res.status, `own-client create failed: ${await res.text()}`).toBeLessThan(300);
    expect((await counts(T_A)).reports).toBe(before.reports + 1);
  });

  it('does not let the body choose the tenant or the generator', async () => {
    const res = await runAs(T_A, () =>
      post({ clientId: CLIENT_A, tenantId: T_B, generatedById: 'someone-else' })
    );
    expect(res.status).toBeLessThan(300);

    // The route answers `{ report: … }` rather than the row itself.
    const created = ((await res.json()) as { report: { id: string } }).report;
    const [row] = await prisma.$queryRaw<Array<{ tenantId: string; generatedById: string }>>`
      SELECT "tenantId", "generatedById" FROM "ClientReport" WHERE id = ${created.id}
    `;
    expect(row.tenantId, 'the body chose the tenant').toBe(T_A);
    expect(row.generatedById, 'the body chose the generator').toBe(SDR_A);
  });
});
