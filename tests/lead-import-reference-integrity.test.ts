import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Request-supplied `campaignId` on `POST /api/leads/import`.
 *
 * `canImportExport` admits **sdr** upward, so the widest exposure is an ordinary rep, and the
 * campaign the import is filed under arrives in the body. `validateContext` checked the campaign
 * only for the `leadgen` role; every other role's `campaignId` went straight into
 * `ImportBatch.create` and then into the worker payload that stamps it onto every Lead.
 *
 * The foreign-key constraint is not a tenancy check. `Campaign` ids are unique globally, so a
 * campaign belonging to another tenant satisfies the FK perfectly — the row is accepted, and the
 * result is an ImportBatch owned by tenant A pointing at tenant B's campaign, with leads to match.
 * `lead -> campaign -> client` is the chain every report and client-facing export walks.
 *
 * Ordering is as much the subject as the verdict. The batch, its rows and the job are created up
 * front, so a refusal that arrives late still leaves the residue behind — every negative case
 * therefore asserts the durable counts are untouched, not merely that the status was 4xx.
 *
 * The queue is the only substitution: `isQueueReachable` is pinned true and the workflow start is
 * stubbed, so the assertions are about what the route persists before handing off, not about
 * import mechanics (covered by `import-concurrency.test.ts` against the real worker).
 *
 * Written against current code before any change, and the fixture asserts its own tenancy first:
 * `applyScopedTenant` makes the active context tenant win over `data.tenantId`, so a "tenant B"
 * row built under tenant-A context is silently a tenant-A row and the whole file proves nothing.
 */

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/bullmq/health', () => ({ isQueueReachable: () => Promise.resolve(true) }));
vi.mock('@/lib/workflows/import', () => ({ startImportWorkflow: () => Promise.resolve('job-1') }));

const { POST: importLeads } = await import('@/app/api/leads/import/route');
const { prisma, tenantStorage } = await import('@/lib/prisma');
const { auth } = await import('@/auth');
type SessionUser = import('@/lib/auth').SessionUser;

const hasDb = Boolean(process.env.DATABASE_URL);

const T_A = 'impref-tenant-a';
const T_B = 'impref-tenant-b';
const SDR_A = 'impref-sdr-a';
const CLIENT_A = 'impref-client-a';
const CAMPAIGN_A = 'impref-campaign-a';
const CLIENT_B = 'impref-client-b';
const CAMPAIGN_B = 'impref-campaign-b';
/** Tenant A, invisible to the caller — the authorization axis, distinct from tenancy. */
const CLIENT_A2 = 'impref-client-a2';
const CAMPAIGN_A2 = 'impref-campaign-a2';

const sdrA: SessionUser = {
  id: SDR_A,
  email: 'sdr@impref.test',
  firstName: 'Sam',
  lastName: 'Rep',
  role: 'sdr',
  tenantId: T_A,
};

const runAs = <R>(t: string, fn: () => Promise<R>) => tenantStorage.run({ tenantId: t, bypassRls: true }, fn);
const runSystem = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId: 'system', bypassRls: true }, fn);

let seq = 0;
const post = (body: Record<string, unknown>) => {
  const n = ++seq;
  return importLeads(
    new NextRequest('http://localhost/api/leads/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        filename: `impref-${n}.csv`,
        leads: [
          {
            firstName: 'Dana',
            lastName: `Prospect${n}`,
            company: 'Northwind Freight',
            title: 'Head of Logistics',
            email: `dana.prospect${n}@northwind-impref.test`,
          },
        ],
        ...body,
      }),
    })
  );
};

/** Everything the route can persist before it hands the batch to the worker. */
const counts = (tenantId: string) =>
  runAs(tenantId, async () => ({
    batches: await prisma.importBatch.count({ where: { tenantId } }),
    rows: await prisma.importRow.count({ where: { tenantId } }),
    leads: await prisma.lead.count({ where: { tenantId } }),
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

describe.skipIf(!hasDb)('lead import request-supplied campaign', () => {
  beforeAll(async () => {
    for (const t of [T_A, T_B]) {
      await runAs(t, async () => {
        await prisma.importRow.deleteMany({ where: { tenantId: t } });
        await prisma.importBatch.deleteMany({ where: { tenantId: t } });
        await prisma.lead.deleteMany({ where: { tenantId: t } });
        await prisma.campaignSdr.deleteMany({ where: { tenantId: t } });
        await prisma.campaign.deleteMany({ where: { tenantId: t } });
        await prisma.client.deleteMany({ where: { tenantId: t } });
        await prisma.user.deleteMany({ where: { tenantId: t } });
        await prisma.tenant.deleteMany({ where: { id: t } });
      });
    }

    await runSystem(async () => {
      await prisma.tenant.createMany({ data: [{ id: T_A, name: 'Imp A' }, { id: T_B, name: 'Imp B' }] });
      await prisma.user.create({
        data: { id: SDR_A, tenantId: T_A, email: 'sdr@impref.test', password: 'x', firstName: 'Sam', lastName: 'Rep', role: 'sdr' },
      });
    });

    for (const [t, clientId, campaignId, label] of [
      [T_A, CLIENT_A, CAMPAIGN_A, 'A'],
      [T_B, CLIENT_B, CAMPAIGN_B, 'B'],
      [T_A, CLIENT_A2, CAMPAIGN_A2, 'A2'],
    ] as const) {
      await runAs(t, async () => {
        await prisma.client.create({
          data: { id: clientId, tenantId: t, name: `ImpClient ${label}`, industry: 'Logistics', contactName: 'Ops', contactEmail: `ops-${label}@impref.test` },
        });
        await prisma.campaign.create({
          data: { id: campaignId, tenantId: t, clientId, name: `ImpCamp ${label}`, startDate: new Date('2026-08-01T00:00:00Z') },
        });
      });
    }

    // Visible to the caller: campaign A only. A2 stays invisible, B is another tenant entirely.
    await runAs(T_A, () =>
      prisma.campaignSdr.create({ data: { tenantId: T_A, campaignId: CAMPAIGN_A, userId: SDR_A } })
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
    // The batch, its rows and the leads are all written before the handoff, so a refusal that
    // arrives after any of them is not a refusal.
    expect(await counts(T_A), `${label} left a partial import behind`).toEqual(before);
    expect(text, `${label} disclosed a foreign campaign`).not.toContain('ImpCamp B');
  };

  it('refuses a campaign in another tenant', () =>
    refuses('foreign campaign', { campaignId: CAMPAIGN_B }, 404));

  it('refuses a campaign that does not exist', () =>
    refuses('missing campaign', { campaignId: 'impref-no-such-campaign' }, 404));

  it('refuses an in-tenant campaign the caller cannot see', () =>
    refuses('invisible campaign', { campaignId: CAMPAIGN_A2 }, 403));

  it('still refuses a lead import with no campaign at all', () =>
    refuses('absent campaign', {}, 400));

  it('accepts an import into the caller own campaign', async () => {
    const before = await counts(T_A);
    const res = await runAs(T_A, () => post({ campaignId: CAMPAIGN_A }));
    const text = await res.text();

    expect(res.status, `own-campaign import failed: ${text.slice(0, 200)}`).toBeLessThan(300);
    expect((await counts(T_A)).batches, 'own-campaign import wrote no batch').toBe(before.batches + 1);
  });

  it('leaves pool imports alone, where no campaign is required', async () => {
    const before = await counts(T_A);
    const res = await runAs(T_A, () => post({ targetType: 'pool' }));
    const text = await res.text();

    expect(res.status, `pool import failed: ${text.slice(0, 200)}`).toBeLessThan(300);
    expect((await counts(T_A)).batches, 'pool import wrote no batch').toBe(before.batches + 1);
  });

  it('files the batch under the campaign that was authorized', async () => {
    const res = await runAs(T_A, () => post({ campaignId: CAMPAIGN_A }));
    expect(res.status).toBeLessThan(300);

    const { batchId } = (await res.json()) as { batchId: string };
    const [row] = await prisma.$queryRaw<Array<{ tenantId: string; campaignId: string | null }>>`
      SELECT "tenantId", "campaignId" FROM "ImportBatch" WHERE id = ${batchId}
    `;
    expect(row.tenantId, 'the body chose the tenant').toBe(T_A);
    expect(row.campaignId, 'the batch was filed under a different campaign').toBe(CAMPAIGN_A);
  });
});
