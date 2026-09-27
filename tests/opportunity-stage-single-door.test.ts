import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * A stage move has one door, and `PUT /api/opportunities/[id]` was a second one.
 *
 * `lib/opportunities/lifecycle.ts` calls `moveStage` the single source of truth for stage moves. It
 * does five things the PUT route's `prisma.opportunity.update({ data: body })` never did:
 *
 *   - refuses a move to `lost` with no reason
 *   - sets `status` and `closedAt` on won/lost
 *   - clears them again when a closed deal is reopened
 *   - records the client's acceptance on `handoffStatus`
 *   - syncs the lead's stage and emits the contact-intelligence event
 *
 * So `PUT { stage: 'won' }` produced a deal that read as won on the board while `status` was still
 * `open`, `closedAt` was null, and `handoffStatus` was still `pending`. The comment inside
 * `moveStage` records what the last of those already cost once: acceptance staying `pending` on won
 * deals pinned `clientAcceptanceRate` at 0% while the report showed a six-figure won value. This
 * route was a second way into that exact state.
 *
 * No UI calls this route — the board uses `/stage`, `/handoff` and `/activity` — so it was reachable
 * only by a manager calling the API directly. Latent, not live, which is the reason to write the
 * test: nothing would have noticed it starting to happen.
 */

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));
// The contact-intelligence hook does its own reads and is not what these assertions are about.
vi.mock('@/lib/contact-intelligence/events', () => ({
  onOpportunityStageChanged: vi.fn(async () => undefined),
}));

const { PUT: updateOpportunity } = await import('@/app/api/opportunities/[id]/route');
const { prisma, tenantStorage } = await import('@/lib/prisma');
const { auth } = await import('@/auth');
type SessionUser = import('@/lib/auth').SessionUser;

const hasDb = Boolean(process.env.DATABASE_URL);

const TENANT = 'oppdoor-tenant';
const MANAGER = 'oppdoor-manager';
const CLIENT = 'oppdoor-client';
const CAMPAIGN = 'oppdoor-campaign';

const manager: SessionUser = {
  id: MANAGER,
  email: 'fm@oppdoor.test',
  firstName: 'Fran',
  lastName: 'Manager',
  role: 'floor_manager',
  tenantId: TENANT,
};

const runAs = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId: TENANT, bypassRls: true }, fn);
const runSystem = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId: 'system', bypassRls: true }, fn);

let seq = 0;

const givenOpportunity = (over: Record<string, unknown> = {}) => {
  const id = `oppdoor-opp-${++seq}`;
  return runAs(async () => {
    await prisma.opportunity.create({
      data: {
        id,
        tenantId: TENANT,
        clientId: CLIENT,
        campaignId: CAMPAIGN,
        title: `Deal ${seq}`,
        company: 'Northwind Freight',
        value: 50000,
        stage: 'pending_client_review',
        status: 'open',
        handoffStatus: 'pending',
        ownerId: MANAGER,
        createdById: MANAGER,
        ...over,
      },
    });
    return id;
  });
};

const put = async (id: string, body: Record<string, unknown>) => {
  const res = await runAs(() =>
    updateOpportunity(
      new NextRequest(`http://localhost/api/opportunities/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) }
    )
  );
  return { status: res.status, body: await res.json().catch(() => null) };
};

const stored = (id: string) =>
  runAs(() =>
    prisma.opportunity.findFirstOrThrow({
      where: { id, tenantId: TENANT },
      select: {
        stage: true,
        status: true,
        closedAt: true,
        handoffStatus: true,
        title: true,
        nextStep: true,
        value: true,
      },
    })
  );

const activityTypes = (id: string) =>
  runAs(async () =>
    (
      await prisma.opportunityActivity.findMany({
        where: { opportunityId: id, tenantId: TENANT },
        select: { type: true },
      })
    ).map((a) => a.type)
  );

describe.skipIf(!hasDb)('a stage move through PUT goes through the lifecycle', () => {
  beforeAll(async () => {
    await runAs(async () => {
      await prisma.opportunityActivity.deleteMany({ where: { tenantId: TENANT } });
      await prisma.opportunity.deleteMany({ where: { tenantId: TENANT } });
      await prisma.campaign.deleteMany({ where: { tenantId: TENANT } });
      await prisma.client.deleteMany({ where: { tenantId: TENANT } });
      await prisma.user.deleteMany({ where: { tenantId: TENANT } });
      await prisma.tenant.deleteMany({ where: { id: TENANT } });
    });
    await runSystem(async () => {
      await prisma.tenant.create({ data: { id: TENANT, name: 'OppDoor' } });
      await prisma.user.create({
        data: {
          id: MANAGER,
          tenantId: TENANT,
          email: 'fm@oppdoor.test',
          password: 'x',
          firstName: 'Fran',
          lastName: 'Manager',
          role: 'floor_manager',
        },
      });
    });
    await runAs(async () => {
      await prisma.client.create({
        data: {
          id: CLIENT,
          tenantId: TENANT,
          name: 'OppDoor Client',
          industry: 'Logistics',
          contactName: 'Ops',
          contactEmail: 'ops@oppdoor.test',
        },
      });
      await prisma.campaign.create({
        data: {
          id: CAMPAIGN,
          tenantId: TENANT,
          clientId: CLIENT,
          name: 'OppDoor Campaign',
          startDate: new Date('2026-08-01T00:00:00Z'),
        },
      });
    });
  });

  beforeEach(() => {
    vi.mocked(auth).mockResolvedValue({ user: manager } as never);
  });

  it('closes the deal properly when the stage is moved to won', async () => {
    const id = await givenOpportunity();

    expect((await put(id, { stage: 'won' })).status).toBe(200);

    const after = await stored(id);
    expect(after.stage).toBe('won');
    // The three the raw update left behind. A deal reading `won` with `status: open` is the state
    // the pipeline and every report disagree about.
    expect(after.status).toBe('won');
    expect(after.closedAt).not.toBeNull();
    // And the one that already cost a 0% clientAcceptanceRate on real won deals.
    expect(after.handoffStatus).toBe('accepted');
  });

  it('refuses a move to lost with no reason, instead of recording an unexplained loss', async () => {
    const id = await givenOpportunity();

    const res = await put(id, { stage: 'lost' });

    expect(res.status).toBe(400);
    // 400 rather than the 500 `moveStage`'s own throw would produce.
    expect(JSON.stringify(res.body)).toMatch(/lostReason/i);
    expect((await stored(id)).stage).toBe('pending_client_review');
  });

  it('records a loss out of client review as the client refusing the handoff', async () => {
    const id = await givenOpportunity();

    expect((await put(id, { stage: 'lost', lostReason: 'no_budget' })).status).toBe(200);

    const after = await stored(id);
    expect(after.status).toBe('lost');
    expect(after.closedAt).not.toBeNull();
    expect(after.handoffStatus).toBe('rejected');
  });

  it('reopens a closed deal by clearing the close, not just the stage', async () => {
    const id = await givenOpportunity({
      stage: 'lost',
      status: 'lost',
      closedAt: new Date('2026-09-01T00:00:00Z'),
      handoffStatus: 'rejected',
    });

    expect((await put(id, { stage: 'negotiation' })).status).toBe(200);

    const after = await stored(id);
    expect(after.status).toBe('open');
    expect(after.closedAt).toBeNull();
  });

  it('logs the stage change once, not twice', async () => {
    const id = await givenOpportunity();

    await put(id, { stage: 'won' });

    // `moveStage` writes `closed_won` with the from/to pair. This route used to add its own vaguer
    // 'Opportunity updated' beside it, so one move read as two events in the deal's history.
    expect(await activityTypes(id)).toEqual(['closed_won']);
  });

  it('will not set status on its own, since status follows the stage', async () => {
    const id = await givenOpportunity();

    const res = await put(id, { status: 'won' });

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain('/stage');
    const after = await stored(id);
    expect(after.status).toBe('open');
    expect(after.stage).toBe('pending_client_review');
  });

  it('will not set handoffStatus, since that is the client decision', async () => {
    const id = await givenOpportunity();

    const res = await put(id, { handoffStatus: 'accepted' });

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain('/handoff');
    expect((await stored(id)).handoffStatus).toBe('pending');
  });

  it('still edits the ordinary fields it exists for', async () => {
    // The control: this route's real job must survive the narrowing.
    const id = await givenOpportunity();

    expect((await put(id, { title: 'Renamed deal', nextStep: 'Send the revised quote' })).status).toBe(
      200
    );

    const after = await stored(id);
    expect(after.title).toBe('Renamed deal');
    expect(after.nextStep).toBe('Send the revised quote');
    expect(after.stage).toBe('pending_client_review');
    expect(await activityTypes(id)).toEqual(['next_step_updated']);
  });
});
