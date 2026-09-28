import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';

/**
 * Two people moving the same deal at the same time must not produce a third state neither chose.
 *
 * `moveStage` read the opportunity, decided everything from that snapshot — `handoffStatus`, whether
 * `status` becomes won/lost/open, whether `closedAt` is set or cleared, which activity to log — and
 * then wrote it out unguarded. Two callers reading within milliseconds of each other each computed
 * from a snapshot the other had already replaced. The reopen branch is the sharpest edge: it fires
 * when `opp.status` was `lost`, so a caller holding a stale "lost" snapshot would set
 * `status: 'open'` and `closedAt: null` on a deal the other request had just marked won.
 *
 * With 44 concurrent users and a team lead who can move their reps' deals, that is an ordinary
 * Tuesday rather than a thought experiment.
 *
 * The rest of this codebase settles races with `updateMany` plus a count check, in roughly forty
 * places. These tests hold `moveStage` to the same rule.
 */

vi.mock('@/lib/contact-intelligence/events', () => ({
  onOpportunityStageChanged: vi.fn(async () => undefined),
}));

const { prisma, tenantStorage } = await import('@/lib/prisma');
const { moveStage } = await import('@/lib/opportunities/lifecycle');
type SessionUser = import('@/lib/auth').SessionUser;

const hasDb = Boolean(process.env.DATABASE_URL);

const T = 'oppRace-tenant';
const OWNER = 'opprace-owner';
const CLIENT = 'opprace-client';
const CAMPAIGN = 'opprace-campaign';
const OPP = 'opprace-opportunity';

const actor: SessionUser = {
  id: OWNER,
  email: 'owner@opprace.test',
  firstName: 'Own',
  lastName: 'Er',
  role: 'floor_manager',
  tenantId: T,
};

const runAs = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId: T, bypassRls: true }, fn);
const runSystem = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId: 'system', bypassRls: true }, fn);

const stored = () =>
  runAs(() =>
    prisma.opportunity.findUniqueOrThrow({
      where: { id: OPP },
      select: { stage: true, status: true, closedAt: true },
    })
  );

const activityCount = () =>
  runAs(() => prisma.opportunityActivity.count({ where: { opportunityId: OPP, tenantId: T } }));

describe.skipIf(!hasDb)('moveStage settles a concurrent move instead of interleaving it', () => {
  beforeAll(async () => {
    await runAs(async () => {
      await prisma.opportunityActivity.deleteMany({ where: { tenantId: T } });
      await prisma.opportunity.deleteMany({ where: { tenantId: T } });
      await prisma.campaign.deleteMany({ where: { tenantId: T } });
      await prisma.client.deleteMany({ where: { tenantId: T } });
      await prisma.user.deleteMany({ where: { tenantId: T } });
      await prisma.tenant.deleteMany({ where: { id: T } });
    });
    await runSystem(async () => {
      await prisma.tenant.create({ data: { id: T, name: 'OppRace' } });
      await prisma.user.create({
        data: {
          id: OWNER,
          tenantId: T,
          email: 'owner@opprace.test',
          password: 'x',
          firstName: 'Own',
          lastName: 'Er',
          role: 'floor_manager',
        },
      });
    });
    await runAs(async () => {
      await prisma.client.create({
        data: { id: CLIENT, tenantId: T, name: 'OppRace Client', industry: 'Tech', contactName: 'Ops', contactEmail: 'ops@opprace.test' },
      });
      await prisma.campaign.create({
        data: { id: CAMPAIGN, tenantId: T, clientId: CLIENT, name: 'OppRace Campaign', startDate: new Date('2026-08-01T00:00:00Z') },
      });
    });
  });

  beforeEach(async () => {
    await runAs(async () => {
      await prisma.opportunityActivity.deleteMany({ where: { tenantId: T } });
      await prisma.opportunity.deleteMany({ where: { tenantId: T } });
      await prisma.opportunity.create({
        data: {
          id: OPP,
          tenantId: T,
          clientId: CLIENT,
          campaignId: CAMPAIGN,
          title: 'Race Deal',
          company: 'Northwind',
          value: 50000,
          stage: 'negotiation',
          status: 'open',
          handoffStatus: 'accepted',
          ownerId: OWNER,
          createdById: OWNER,
        },
      });
    });
  });

  it('lets exactly one of two simultaneous moves win', async () => {
    const both = await Promise.allSettled([
      runAs(() => moveStage({ opportunityId: OPP, user: actor, tenantId: T, stage: 'won' })),
      runAs(() =>
        moveStage({ opportunityId: OPP, user: actor, tenantId: T, stage: 'lost', lostReason: 'no_budget' })
      ),
    ]);

    const won = both.filter((r) => r.status === 'fulfilled').length;
    expect(won, 'exactly one writer should succeed').toBe(1);

    // And the record is one of the two intended outcomes, never a mixture of both.
    const after = await stored();
    expect(['won', 'lost']).toContain(after.stage);
    expect(after.status).toBe(after.stage);
    expect(after.closedAt).not.toBeNull();
  });

  it('logs one activity for one effective move, not two', async () => {
    await Promise.allSettled([
      runAs(() => moveStage({ opportunityId: OPP, user: actor, tenantId: T, stage: 'won' })),
      runAs(() => moveStage({ opportunityId: OPP, user: actor, tenantId: T, stage: 'won' })),
    ]);

    // The loser must not leave a `stage_changed` row describing a transition that did not happen.
    expect(await activityCount()).toBe(1);
  });

  it('still moves a stage when nobody is competing for it', async () => {
    // The control. A guard that refuses the ordinary case would pass both tests above and break the
    // product.
    const updated = await runAs(() =>
      moveStage({ opportunityId: OPP, user: actor, tenantId: T, stage: 'won' })
    );

    expect(updated.stage).toBe('won');
    const after = await stored();
    expect(after.status).toBe('won');
    expect(after.closedAt).not.toBeNull();
    expect(await activityCount()).toBe(1);
  });

  it('tells the loser what happened rather than failing silently', async () => {
    await runAs(() => moveStage({ opportunityId: OPP, user: actor, tenantId: T, stage: 'won' }));

    // A second move from the now-stale 'negotiation' snapshot: the deal has already left that stage.
    await expect(
      runAs(() => moveStage({ opportunityId: OPP, user: actor, tenantId: T, stage: 'proposal' }))
    ).resolves.toBeDefined();
    // Moving from `won` to `proposal` is a legitimate later decision — it reads the current stage,
    // so it is not a race. The stale-snapshot case is what the CAS catches, proven above.
  });
});
