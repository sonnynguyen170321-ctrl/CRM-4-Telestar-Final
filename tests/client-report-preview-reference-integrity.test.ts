import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as previewClientReport } from '@/app/api/client-reports/preview/route';
import { prisma, tenantStorage } from '@/lib/prisma';
import { auth } from '@/auth';
import type { SessionUser } from '@/lib/auth';

/**
 * Request-supplied relations on `POST /api/client-reports/preview`.
 *
 * The sibling of `client-report-reference-integrity.test.ts`, and the reason that file was not
 * enough. `POST /api/client-reports` validates `clientId` and `campaignId` before
 * `buildReportMetrics` runs; preview called the *same* metrics builder with the *same*
 * request-controlled ids and validated nothing at all — no role gate, no reference check, no
 * client/campaign consistency check.
 *
 * That the row is never persisted is not the mitigation it sounds like. The disclosure is the
 * response body: `buildReportMetrics` computes real aggregates — leads, activities, meetings,
 * pipeline — over whichever client was named and hands them back. A preview is a read of exactly
 * the numbers the stored report would have contained, so every negative case asserts on the body,
 * not merely the status.
 *
 * Two axes, deliberately separated:
 *
 *   - tenancy    — another tenant's client/campaign must be indistinguishable from a typo (404)
 *   - visibility — an in-tenant client the caller cannot see is a real object they may not use (403)
 *
 * Written against current code before any change. The fixture asserts its own tenancy first:
 * `applyScopedTenant` makes the active context tenant win over `data.tenantId`, so a "tenant B"
 * row built under tenant-A context is silently a tenant-A row and the whole file proves nothing.
 */

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));

const hasDb = Boolean(process.env.DATABASE_URL);

const T_A = 'crprev-tenant-a';
const T_B = 'crprev-tenant-b';
const SDR_A = 'crprev-sdr-a';
/** A role that cannot create a report at all — preview must not be the way around that. */
const LEADGEN_A = 'crprev-leadgen-a';
const CLIENT_A = 'crprev-client-a';
const CAMPAIGN_A = 'crprev-campaign-a';
const CLIENT_B = 'crprev-client-b';
const CAMPAIGN_B = 'crprev-campaign-b';
/** Tenant A, invisible to the caller — the authorization axis. */
const CLIENT_A2 = 'crprev-client-a2';
const CAMPAIGN_A2 = 'crprev-campaign-a2';
/** Tenant A, visible — isolates hierarchy mismatch from authorization. */
const CLIENT_A3 = 'crprev-client-a3';
const CAMPAIGN_A3 = 'crprev-campaign-a3';

const sdrA: SessionUser = {
  id: SDR_A,
  email: 'sdr@crprev.test',
  firstName: 'Sam',
  lastName: 'Rep',
  role: 'sdr',
  tenantId: T_A,
};

const leadgenA: SessionUser = {
  id: LEADGEN_A,
  email: 'leadgen@crprev.test',
  firstName: 'Lee',
  lastName: 'Gen',
  role: 'leadgen',
  tenantId: T_A,
};

const runAs = <R>(t: string, fn: () => Promise<R>) => tenantStorage.run({ tenantId: t, bypassRls: true }, fn);
const runSystem = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId: 'system', bypassRls: true }, fn);

const post = (body: Record<string, unknown>) =>
  previewClientReport(
    new NextRequest('http://localhost/api/client-reports/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        periodStart: '2026-08-01',
        periodEnd: '2026-08-07',
        ...body,
      }),
    })
  );

/** A preview must stay a read. Anything durable appearing here is a bug on its own. */
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

describe.skipIf(!hasDb)('client report preview request-supplied relations', () => {
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
      await prisma.tenant.createMany({ data: [{ id: T_A, name: 'CRPrev A' }, { id: T_B, name: 'CRPrev B' }] });
      await prisma.user.createMany({
        data: [
          { id: SDR_A, tenantId: T_A, email: 'sdr@crprev.test', password: 'x', firstName: 'Sam', lastName: 'Rep', role: 'sdr' },
          { id: LEADGEN_A, tenantId: T_A, email: 'leadgen@crprev.test', password: 'x', firstName: 'Lee', lastName: 'Gen', role: 'leadgen' },
        ],
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
          data: { id: clientId, tenantId: t, name: `CRPrevClient ${label}`, industry: 'Logistics', contactName: 'Ops', contactEmail: `ops-${label}@crprev.test` },
        });
        await prisma.campaign.create({
          data: { id: campaignId, tenantId: t, clientId, name: `CRPrevCamp ${label}`, startDate: new Date('2026-08-01T00:00:00Z') },
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
    expect(await counts(T_A), `${label} left a durable record behind`).toEqual(before);
    // The refusal must not have computed and returned the foreign tenant's numbers.
    expect(text, `${label} disclosed a foreign client`).not.toContain('CRPrevClient B');
    expect(text, `${label} disclosed a foreign campaign`).not.toContain('CRPrevCamp B');
    // A snapshot in the body means the metrics builder ran on an unauthorized reference.
    expect(text, `${label} returned a metrics snapshot anyway`).not.toContain('"snapshot"');
  };

  it('refuses a client in another tenant', () => refuses('foreign client', { clientId: CLIENT_B }, 404));

  it('refuses a campaign in another tenant', () =>
    refuses('foreign campaign', { clientId: CLIENT_A, campaignId: CAMPAIGN_B }, 404));

  it('refuses a client that does not exist', () =>
    refuses('missing client', { clientId: 'crprev-no-such-client' }, 404));

  it('refuses a campaign that does not exist', () =>
    refuses('missing campaign', { clientId: CLIENT_A, campaignId: 'crprev-no-such-campaign' }, 404));

  it('refuses an in-tenant client the caller cannot see', () =>
    refuses('invisible client', { clientId: CLIENT_A2 }, 403));

  it('refuses an in-tenant campaign the caller cannot see', () =>
    refuses('invisible campaign', { clientId: CLIENT_A2, campaignId: CAMPAIGN_A2 }, 403));

  it('refuses a campaign belonging to a different client', () =>
    refuses('hierarchy mismatch', { clientId: CLIENT_A, campaignId: CAMPAIGN_A3 }, 422));

  it('refuses a role that cannot generate reports', async () => {
    vi.mocked(auth).mockResolvedValue({ user: leadgenA } as never);
    const res = await runAs(T_A, () => post({ clientId: CLIENT_A }));
    const text = await res.text();
    expect(res.status, `leadgen preview: ${text.slice(0, 200)}`).toBe(403);
    expect(text, 'leadgen got a metrics snapshot').not.toContain('"snapshot"');
  });

  it('previews the caller own client', async () => {
    const res = await runAs(T_A, () => post({ clientId: CLIENT_A, campaignId: CAMPAIGN_A }));
    const text = await res.text();

    expect(res.status, `own-client preview failed: ${text.slice(0, 200)}`).toBe(200);
    expect(text, 'own-client preview returned no snapshot').toContain('"snapshot"');
  });
});
