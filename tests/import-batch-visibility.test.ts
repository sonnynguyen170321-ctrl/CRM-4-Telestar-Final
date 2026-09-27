import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Whoever started an import can see what became of it.
 *
 * `canImportExport` admits sdr upward, and both import-status routes were gated on
 * `requireRole('floor_manager')`. Four of the six roles that can start an import — sdr, leadgen,
 * leadgen_manager, team_lead — could therefore queue one and never learn the outcome: the POST
 * answers 202 with a batchId, the rows are processed by a worker, and the per-row errors live only
 * on `ImportRow` behind a door those roles cannot open. An import that dropped half a file looked
 * exactly like one that worked.
 *
 * Widening the gate is only safe if it widens it to the caller's *own* imports, so the negative
 * case is the point of this file: `importRows` carry prospect names, emails and phone numbers, and
 * a colleague's upload is not the caller's to read. It answers 404 rather than 403, so whether a
 * given batch id exists is not confirmable either — the rule the import POST already applies to a
 * campaign id.
 */

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));

const { GET: listImports } = await import('@/app/api/admin/imports/route');
const { GET: getImport } = await import('@/app/api/admin/imports/[id]/route');
const { prisma, tenantStorage } = await import('@/lib/prisma');
const { auth } = await import('@/auth');
type SessionUser = import('@/lib/auth').SessionUser;

const hasDb = Boolean(process.env.DATABASE_URL);

const TENANT = 'impvis-tenant';
const SDR = 'impvis-sdr';
const OTHER_SDR = 'impvis-sdr-other';
const MANAGER = 'impvis-floor-manager';
const CLIENT = 'impvis-client';
const CAMPAIGN = 'impvis-campaign';
const OWN_BATCH = 'impvis-batch-own';
const OTHER_BATCH = 'impvis-batch-other';

const user = (id: string, role: SessionUser['role']): SessionUser => ({
  id,
  email: `${id}@impvis.test`,
  firstName: 'Test',
  lastName: 'User',
  role,
  tenantId: TENANT,
});

const runAs = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId: TENANT, bypassRls: true }, fn);
const runSystem = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId: 'system', bypassRls: true }, fn);

const actAs = (u: SessionUser) => vi.mocked(auth).mockResolvedValue({ user: u } as never);

const list = async () => {
  const res = await runAs(() => listImports());
  return { status: res.status, body: await res.json().catch(() => null) };
};

const detail = async (id: string) => {
  const res = await runAs(() =>
    getImport(new NextRequest(`http://localhost/api/admin/imports/${id}`), {
      params: Promise.resolve({ id }),
    })
  );
  return { status: res.status, body: await res.json().catch(() => null) };
};

describe.skipIf(!hasDb)('import batch visibility', () => {
  beforeAll(async () => {
    await runAs(async () => {
      await prisma.importRow.deleteMany({ where: { tenantId: TENANT } });
      await prisma.importBatch.deleteMany({ where: { tenantId: TENANT } });
      await prisma.campaign.deleteMany({ where: { tenantId: TENANT } });
      await prisma.client.deleteMany({ where: { tenantId: TENANT } });
      await prisma.user.deleteMany({ where: { tenantId: TENANT } });
      await prisma.tenant.deleteMany({ where: { id: TENANT } });
    });

    await runSystem(async () => {
      await prisma.tenant.create({ data: { id: TENANT, name: 'ImpVis' } });
      await prisma.user.createMany({
        data: [
          { id: SDR, tenantId: TENANT, email: `${SDR}@impvis.test`, password: 'x', firstName: 'Sam', lastName: 'Rep', role: 'sdr' },
          { id: OTHER_SDR, tenantId: TENANT, email: `${OTHER_SDR}@impvis.test`, password: 'x', firstName: 'Other', lastName: 'Rep', role: 'sdr' },
          { id: MANAGER, tenantId: TENANT, email: `${MANAGER}@impvis.test`, password: 'x', firstName: 'Fran', lastName: 'Manager', role: 'floor_manager' },
        ],
      });
    });

    await runAs(async () => {
      await prisma.client.create({
        data: {
          id: CLIENT,
          tenantId: TENANT,
          name: 'ImpVis Client',
          industry: 'Logistics',
          contactName: 'Ops',
          contactEmail: 'ops@impvis.test',
        },
      });
      await prisma.campaign.create({
        data: {
          id: CAMPAIGN,
          tenantId: TENANT,
          clientId: CLIENT,
          name: 'ImpVis Campaign',
          startDate: new Date('2026-08-01T00:00:00Z'),
        },
      });
      for (const [id, userId] of [
        [OWN_BATCH, SDR],
        [OTHER_BATCH, OTHER_SDR],
      ] as const) {
        await prisma.importBatch.create({
          data: {
            id,
            tenantId: TENANT,
            campaignId: CAMPAIGN,
            targetType: 'lead',
            userId,
            filename: `${id}.csv`,
            totalRows: 2,
            status: 'completed',
          },
        });
      }
      // One failed row on the caller's own batch: the thing they could not see, and the reason
      // this route matters rather than the batch's status alone.
      await prisma.importRow.create({
        data: {
          batchId: OWN_BATCH,
          tenantId: TENANT,
          rowIndex: 1,
          data: { email: 'kept@impvis.test', company: 'Northwind' },
          status: 'error',
          errors: { reason: 'Duplicate email within this file' },
        },
      });
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lets an sdr read the import they started, with its failed rows', async () => {
    actAs(user(SDR, 'sdr'));

    const { status, body } = await detail(OWN_BATCH);

    expect(status).toBe(200);
    expect(body.id).toBe(OWN_BATCH);
    // The per-row reason is the whole point — a batch marked `completed` says nothing about the
    // rows inside it that were refused.
    expect(body.importRows).toHaveLength(1);
    expect(body.importRows[0].status).toBe('error');
  });

  it('does not let an sdr read a colleague import', async () => {
    actAs(user(SDR, 'sdr'));

    const { status, body } = await detail(OTHER_BATCH);

    // 404, not 403: the id's existence is not confirmable by someone who may not read it.
    expect(status).toBe(404);
    expect(JSON.stringify(body)).not.toContain('impvis-batch-other.csv');
  });

  it('lists only the caller own batches for a non-overseer role', async () => {
    actAs(user(SDR, 'sdr'));

    const { status, body } = await list();

    expect(status).toBe(200);
    expect(body.map((b: { id: string }) => b.id)).toEqual([OWN_BATCH]);
  });

  it('still shows a floor manager every batch in the tenant', async () => {
    // The control. A fix that merely narrowed everyone to their own imports would break the
    // oversight the route was built for.
    actAs(user(MANAGER, 'floor_manager'));

    const { status, body } = await list();

    expect(status).toBe(200);
    const ids = body.map((b: { id: string }) => b.id);
    expect(ids).toContain(OWN_BATCH);
    expect(ids).toContain(OTHER_BATCH);
  });

  it('lets a floor manager read a batch they did not start', async () => {
    actAs(user(MANAGER, 'floor_manager'));

    expect((await detail(OTHER_BATCH)).status).toBe(200);
  });
});
