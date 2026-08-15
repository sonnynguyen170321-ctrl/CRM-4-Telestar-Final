import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as listWorkOrders, POST as createWorkOrderRoute } from '@/app/api/work-orders/route';
import { POST as dispatchRoute } from '@/app/api/work-orders/[id]/dispatch/route';
import { prisma, tenantStorage } from '@/lib/prisma';
import { auth } from '@/auth';
import type { SessionUser } from '@/lib/auth';

/**
 * Object-level RBAC on work orders, as distinct from reference tenancy.
 *
 * `work-order-reference-integrity.test.ts` proved the tenant axis: a foreign `leadId` or
 * `campaignId` is refused and writes nothing. That is not the same claim as "only the right
 * people can act on the right objects", and an earlier checkpoint of mine conflated them by
 * repeating the design comment "activation re-derives authorization" as though it were a tested
 * property. It was not tested. This file tests it.
 *
 * The documented contract (`lib/workorders/authorization.ts`) is a subtractive chain:
 *
 *   work order type permits capability
 *     → agent capability / autonomy authorization
 *       → CRM role authorization
 *         → CRM object / domain authorization   (inside the domain services)
 *           → execution
 *
 * Object authorization is explicitly delegated to the domain services **at execution**. What the
 * contract does not state is who may *list* or *dispatch* — and dispatch is not a read: it
 * activates the order, may take a lease, and queues a job. Those two gaps are what this
 * establishes, before any product change.
 *
 * Nothing here is fixed yet. The point is to replace "the code does X, so X must be intended"
 * with a recorded, reproducible answer.
 */

const { enqueued } = vi.hoisted(() => ({ enqueued: [] as { type: string }[] }));

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/bullmq/enqueue', () => ({
  enqueue: (type: string) => {
    enqueued.push({ type });
    return Promise.resolve('job-1');
  },
  enqueueImmediate: (type: string) => {
    enqueued.push({ type });
    return Promise.resolve('job-1');
  },
  enqueueReschedule: () => Promise.resolve('job-1'),
  ensureJob: () => Promise.resolve('job-1'),
  removeJob: () => Promise.resolve(true),
}));
vi.mock('@/lib/bullmq/ensureJob', () => ({ ensureJob: () => Promise.resolve('job-1') }));

const hasDb = Boolean(process.env.DATABASE_URL);

const T = 'worbac-tenant';
const SDR_A = 'worbac-sdr-a';
const SDR_B = 'worbac-sdr-b';
const DIRECTOR = 'worbac-director';
const CAMPAIGN = 'worbac-campaign';
const LEAD_A = 'worbac-lead-a';
const LEAD_B = 'worbac-lead-b';

const session = (id: string, role: SessionUser['role']): SessionUser => ({
  id,
  email: `${id}@worbac.test`,
  firstName: 'T',
  lastName: 'User',
  role,
  tenantId: T,
});

const sdrA = session(SDR_A, 'sdr');
const sdrB = session(SDR_B, 'sdr');
const director = session(DIRECTOR, 'director');

const runAs = <R>(fn: () => Promise<R>) =>
  tenantStorage.run({ tenantId: T, bypassRls: true }, fn);
const runSystem = <R>(fn: () => Promise<R>) =>
  tenantStorage.run({ tenantId: 'system', bypassRls: true }, fn);

let seq = 0;
const createOrder = (body: Record<string, unknown>) =>
  createWorkOrderRoute(
    new NextRequest('http://localhost/api/work-orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestKey: `worbac-${++seq}-${Date.now()}`, ...body }),
    })
  );

const list = () => listWorkOrders(new NextRequest('http://localhost/api/work-orders'));

const dispatch = (id: string) =>
  dispatchRoute(new NextRequest(`http://localhost/api/work-orders/${id}/dispatch`, { method: 'POST' }), {
    params: Promise.resolve({ id }),
  });

async function durableState() {
  return runAs(async () => ({
    leases: await prisma.workOrderLease.count({ where: { tenantId: T } }),
    agentActions: await prisma.agentAction.count({ where: { tenantId: T } }),
    jobRuns: await prisma.jobRun.count({ where: { tenantId: T } }),
    tasks: await prisma.task.count({ where: { tenantId: T } }),
    outbound: await prisma.outboundMessage.count({ where: { tenantId: T } }),
    enrollments: await prisma.sequenceEnrollment.count({ where: { tenantId: T } }),
  }));
}

describe.skipIf(!hasDb)('work order object-level RBAC', () => {
  beforeAll(async () => {
    await runAs(async () => {
      await prisma.agentAction.deleteMany({ where: { tenantId: T } });
      await prisma.workOrderLease.deleteMany({ where: { tenantId: T } });
      await prisma.workOrder.deleteMany({ where: { tenantId: T } });
      await prisma.jobRun.deleteMany({ where: { tenantId: T } });
      await prisma.task.deleteMany({ where: { tenantId: T } });
      await prisma.outboundMessage.deleteMany({ where: { tenantId: T } });
      await prisma.sequenceEnrollment.deleteMany({ where: { tenantId: T } });
      await prisma.activity.deleteMany({ where: { tenantId: T } });
      await prisma.lead.deleteMany({ where: { tenantId: T } });
      await prisma.campaignSdr.deleteMany({ where: { tenantId: T } });
      await prisma.campaign.deleteMany({ where: { tenantId: T } });
      await prisma.client.deleteMany({ where: { tenantId: T } });
      await prisma.user.deleteMany({ where: { tenantId: T } });
      await prisma.tenant.deleteMany({ where: { id: T } });
    });

    await runSystem(async () => {
      await prisma.tenant.create({ data: { id: T, name: 'WO RBAC' } });
      await prisma.user.createMany({
        data: [
          { id: DIRECTOR, tenantId: T, email: 'worbac-director@worbac.test', password: 'x', firstName: 'Dee', lastName: 'Rector', role: 'director' },
          { id: SDR_A, tenantId: T, email: 'worbac-sdr-a@worbac.test', password: 'x', firstName: 'Sam', lastName: 'A', role: 'sdr', managerId: DIRECTOR },
          { id: SDR_B, tenantId: T, email: 'worbac-sdr-b@worbac.test', password: 'x', firstName: 'Bea', lastName: 'B', role: 'sdr', managerId: DIRECTOR },
        ],
      });
    });

    await runAs(async () => {
      await prisma.client.create({
        data: { id: 'worbac-client', tenantId: T, name: 'C', industry: 'L', contactName: 'x', contactEmail: 'x@worbac.test' },
      });
      await prisma.campaign.create({
        data: { id: CAMPAIGN, tenantId: T, clientId: 'worbac-client', name: 'Camp', startDate: new Date('2026-08-12T00:00:00Z') },
      });
      await prisma.lead.createMany({
        data: [
          { id: LEAD_A, tenantId: T, campaignId: CAMPAIGN, assignedToId: SDR_A, firstName: 'Own', lastName: 'A', company: 'A Co', email: 'a@worbac.test', stage: 'new' },
          { id: LEAD_B, tenantId: T, campaignId: CAMPAIGN, assignedToId: SDR_B, firstName: 'Peer', lastName: 'B', company: 'B Co', email: 'b@worbac.test', stage: 'new' },
        ],
      });
    });
  });

  beforeEach(() => {
    enqueued.length = 0;
  });

  const as = (u: SessionUser) => vi.mocked(auth).mockResolvedValue({ user: u } as never);

  // ── CASE 1: GET /api/work-orders ─────────────────────────────────────────
  it('records who can list work orders targeting a lead they cannot access', async () => {
    as(sdrB);
    const created = await runAs(() => createOrder({ type: 'research_batch', leadId: LEAD_B }));
    expect(created.status).toBe(201);
    const ownedByB = (await created.json()).workOrder as { id: string };

    // SDR A cannot access lead B — `role-negative-access` and `tenant-isolation` already prove
    // that for the lead itself. The question is whether a work order *about* that lead is
    // visible, since the route filters on tenant alone.
    as(sdrA);
    const res = await runAs(() => list());
    expect(res.status).toBe(200);
    const orders = (await res.json()).workOrders as { id: string; leadId: string | null }[];

    const leaked = orders.filter((o) => o.leadId === LEAD_B);
    expect(
      leaked.length,
      'SDR A can list a work order targeting SDR B lead — the route scopes by tenant only'
    ).toBeGreaterThan(0);

    // Recorded, not asserted as correct. Work orders carry no prospect content — id, type,
    // status, budgets and the target ids — and there is no work order UI in this phase, so this
    // is a metadata read rather than a disclosure of another rep's prospect. Flagged for the
    // product decision rather than silently fixed; if the answer is "scope it", this test
    // inverts.
    expect(ownedByB.id).toBeTruthy();
  });

  // ── CASE 3: dispatch ──────────────────────────────────────────────────────
  it('refuses an SDR dispatching a work order targeting a peer lead, queueing nothing', async () => {
    as(sdrB);
    const created = await runAs(() => createOrder({ type: 'research_batch', leadId: LEAD_B }));
    const order = (await created.json()).workOrder as { id: string };

    const before = await durableState();

    // SDR A dispatches an order about SDR B's lead. Dispatch is not a read: it activates the
    // order, may take a lease, and queues execution.
    as(sdrA);
    const res = await runAs(() => dispatch(order.id));

    const after = await durableState();

    // Whatever the answer, the durable consequences are what matter — an HTTP code alone would
    // not show a lease taken or a job queued.
    const outcome = {
      status: res.status,
      leasesCreated: after.leases - before.leases,
      jobsQueued: enqueued.length,
      jobRunsCreated: after.jobRuns - before.jobRuns,
      agentActions: after.agentActions - before.agentActions,
    };

    // No CRM mutation may happen at dispatch under any policy — dispatch queues work, it does
    // not perform it. This part is a hard assertion regardless of the RBAC answer.
    expect(after.tasks, 'dispatch created a Task').toBe(before.tasks);
    expect(after.outbound, 'dispatch created an OutboundMessage').toBe(before.outbound);
    expect(after.enrollments, 'dispatch created a SequenceEnrollment').toBe(before.enrollments);
    expect(after.agentActions, 'dispatch executed an agent action').toBe(before.agentActions);

    // Measured at 200 with a job queued before `assertActorMayDispatch` existed. "Execution will
    // refuse eventually" is not an answer when the unauthorized caller has already committed the
    // activation and spent queue capacity.
    expect(outcome.status, 'an SDR dispatched a work order on a peer lead').toBe(403);
    expect(outcome.jobsQueued, 'a refused dispatch queued a job').toBe(0);
    expect(outcome.leasesCreated, 'a refused dispatch claimed a lease').toBe(0);
  });

  it('a director can dispatch, so the negative cases above are not a broken endpoint', async () => {
    as(director);
    const created = await runAs(() => createOrder({ type: 'research_batch', leadId: LEAD_A }));
    const order = (await created.json()).workOrder as { id: string };

    const res = await runAs(() => dispatch(order.id));
    expect(res.status, 'a director could not dispatch a work order on an in-tenant lead').toBeLessThan(300);
  });
});
