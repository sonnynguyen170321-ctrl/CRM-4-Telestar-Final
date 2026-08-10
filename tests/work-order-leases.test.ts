import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  activateWorkOrder,
  createWorkOrder,
  finishWorkOrder,
  requireWorkOrder,
  WorkOrderNotFoundError,
} from '@/lib/workorders/service';
import { detectActivationConflicts } from '@/lib/workorders/conflicts';
import {
  claimLease,
  findStaleLeases,
  holdsLease,
  isLeaseLive,
  releaseLease,
  renewLease,
} from '@/lib/workorders/leases';
import {
  resetWorkOrders,
  runAs,
  setupWorkOrderFixture,
  type WorkOrderFixture,
} from './helpers/workOrderFixture';

// Services must not pull next-auth setup into Vitest.
vi.mock('@/auth', () => ({
  auth: vi.fn(),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

/**
 * Work order leases, fencing and tenant isolation (Revenue AI Phase 6a).
 *
 * Its own tenant prefix, so it can run in parallel with `work-order-lifecycle.test.ts` against
 * one database without either clearing the other's fixtures.
 *
 * Covers Phase 6a acceptance 6, 7, 8 and 11.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const ONE_HOUR_MS = 3_600_000;

let fx: WorkOrderFixture;
const run = <T>(fn: () => Promise<T>) => runAs(fx.tenantId, fn);
const runOther = <T>(fn: () => Promise<T>) => runAs(fx.otherTenantId, fn);

beforeAll(async () => {
  if (!hasDb) return;
  fx = await setupWorkOrderFixture('wolease');
});

beforeEach(async () => {
  if (!hasDb) return;
  await resetWorkOrders(fx);
});

async function draft(type: string, requestKey: string, leadId: string | null = fx.idleLeadId) {
  return createWorkOrder({
    tenantId: fx.tenantId,
    type,
    createdById: fx.directorId,
    requestKey,
    leadId,
  });
}

/** Activate and hand back both the order and the fencing token the activation now holds. */
async function activated(type: string, requestKey: string, leadId: string | null = fx.idleLeadId) {
  const order = await draft(type, requestKey, leadId);
  const result = await activateWorkOrder({ workOrderId: order.id, tenantId: fx.tenantId });
  return {
    order: await requireWorkOrder(order.id, fx.tenantId),
    claimToken: result.claimToken,
  };
}

const exclusiveClaim = (workOrderId: string, now?: Date, ttlSeconds?: number) =>
  claimLease({
    tenantId: fx.tenantId,
    leadId: fx.idleLeadId,
    workOrderId,
    mode: 'exclusive',
    ttlSeconds,
    now,
  });

describe.skipIf(!hasDb)('one lead cannot be actively leased by competing work orders', () => {
  it('gives the lease to one claimant and tells the other who holds it', async () => {
    await run(async () => {
      const a = await draft('outreach_launch', 'lease-a');
      const b = await draft('reengagement', 'lease-b');

      const first = await exclusiveClaim(a.id);
      const second = await exclusiveClaim(b.id);

      expect(first.outcome).toBe('claimed');
      expect(first.claimToken).toBeTruthy();
      expect(second.outcome).toBe('held_by_other');
      expect(second.heldByWorkOrderId).toBe(a.id);
      // A caller that did not win is handed no token at all.
      expect(second.claimToken).toBeNull();

      expect(
        await prisma.workOrderLease.count({
          where: { tenantId: fx.tenantId, leadId: fx.idleLeadId },
        })
      ).toBe(1);
    });
  });

  it('resolves a genuine concurrent race to one winner and one named result', async () => {
    await run(async () => {
      const a = await draft('outreach_launch', 'race-a');
      const b = await draft('reengagement', 'race-b');

      // Both claims in flight at once. The unique constraint is the arbiter; the loser must come
      // back as a named outcome, never as an unhandled P2002 escaping to the caller.
      const results = await Promise.all([exclusiveClaim(a.id), exclusiveClaim(b.id)]);

      const winners = results.filter((r) => r.outcome === 'claimed' || r.outcome === 'reclaimed');
      const losers = results.filter((r) => r.outcome === 'held_by_other');

      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect(winners[0].claimToken).toBeTruthy();
      expect(losers[0].claimToken).toBeNull();
      expect(losers[0].heldByWorkOrderId).toBe(winners[0].lease!.workOrderId);

      expect(
        await prisma.workOrderLease.count({
          where: { tenantId: fx.tenantId, leadId: fx.idleLeadId },
        })
      ).toBe(1);
    });
  });

  it('survives several concurrent claimants with exactly one holder', async () => {
    await run(async () => {
      const orders = await Promise.all([
        draft('outreach_launch', 'race-many-a'),
        draft('reengagement', 'race-many-b'),
        draft('outreach_launch', 'race-many-c'),
      ]);

      const results = await Promise.all(orders.map((o) => exclusiveClaim(o.id)));
      const held = results.filter((r) => r.claimToken !== null);

      expect(held).toHaveLength(1);
      expect(
        await prisma.workOrderLease.count({
          where: { tenantId: fx.tenantId, leadId: fx.idleLeadId },
        })
      ).toBe(1);
    });
  });

  it('takes no lease for shared-mode work, so assistance is blocked by none', async () => {
    await run(async () => {
      const order = await draft('reply_review', 'lease-shared');

      const claim = await claimLease({
        tenantId: fx.tenantId,
        leadId: fx.idleLeadId,
        workOrderId: order.id,
        mode: 'shared',
      });

      expect(claim.outcome).toBe('not_required');
      expect(claim.lease).toBeNull();
      expect(claim.claimToken).toBeNull();
      expect(
        await prisma.workOrderLease.count({
          where: { tenantId: fx.tenantId, leadId: fx.idleLeadId },
        })
      ).toBe(0);
    });
  });

  it('extends rather than duplicates when the same order claims twice while live', async () => {
    await run(async () => {
      const { order } = await activated('outreach_launch', 'lease-reentrant');
      const again = await exclusiveClaim(order.id);

      expect(again.outcome).toBe('renewed');
      expect(
        await prisma.workOrderLease.count({
          where: { tenantId: fx.tenantId, leadId: fx.idleLeadId },
        })
      ).toBe(1);
    });
  });
});

describe.skipIf(!hasDb)('a superseded holder is fenced out', () => {
  it('stops a stalled worker acting after another order reclaimed the lease', async () => {
    await run(async () => {
      const a = await draft('outreach_launch', 'fence-a');
      const b = await draft('reengagement', 'fence-b');

      // A claims, then stalls long enough for the lease to expire.
      const aClaim = await exclusiveClaim(a.id, new Date(Date.now() - ONE_HOUR_MS), 60);
      expect(aClaim.outcome).toBe('claimed');

      // B reclaims the expired lease.
      const bClaim = await exclusiveClaim(b.id);
      expect(bClaim.outcome).toBe('reclaimed');
      expect(bClaim.claimToken).not.toBe(aClaim.claimToken);

      // A wakes up. It may do none of the three things a holder may do.
      const args = { tenantId: fx.tenantId, leadId: fx.idleLeadId, workOrderId: a.id };
      expect(await renewLease({ ...args, claimToken: aClaim.claimToken! })).toBe(false);
      expect(await releaseLease({ ...args, claimToken: aClaim.claimToken! })).toBe(false);
      expect(await holdsLease({ ...args, claimToken: aClaim.claimToken! })).toBe(false);

      // B is still the holder, and its lease is untouched.
      expect(
        await holdsLease({
          tenantId: fx.tenantId,
          leadId: fx.idleLeadId,
          workOrderId: b.id,
          claimToken: bClaim.claimToken!,
        })
      ).toBe(true);

      const lease = await prisma.workOrderLease.findUnique({
        where: { tenantId_leadId: { tenantId: fx.tenantId, leadId: fx.idleLeadId } },
      });
      expect(lease!.workOrderId).toBe(b.id);
      expect(lease!.releasedAt).toBeNull();
    });
  });

  it('fences a stalled *earlier attempt at the same order* — the case workOrderId alone misses', async () => {
    await run(async () => {
      const order = await draft('outreach_launch', 'fence-same-order');

      // Attempt 1 claims and stalls until the lease expires.
      const attemptOne = await exclusiveClaim(order.id, new Date(Date.now() - ONE_HOUR_MS), 60);
      // Attempt 2 — a retry of the *same* work order — reclaims.
      const attemptTwo = await exclusiveClaim(order.id);

      expect(attemptTwo.outcome).toBe('reclaimed');
      expect(attemptTwo.claimToken).not.toBe(attemptOne.claimToken);

      const args = { tenantId: fx.tenantId, leadId: fx.idleLeadId, workOrderId: order.id };

      // The workOrderId matches for both attempts, so only the token can tell them apart.
      expect(await renewLease({ ...args, claimToken: attemptOne.claimToken! })).toBe(false);
      expect(await releaseLease({ ...args, claimToken: attemptOne.claimToken! })).toBe(false);
      expect(await holdsLease({ ...args, claimToken: attemptOne.claimToken! })).toBe(false);

      expect(await holdsLease({ ...args, claimToken: attemptTwo.claimToken! })).toBe(true);
    });
  });

  it('rotates the token on re-activation, so a restarted worker supersedes its own prior attempt', async () => {
    await run(async () => {
      const first = await activated('outreach_launch', 'fence-reactivate');
      const second = await activateWorkOrder({
        workOrderId: first.order.id,
        tenantId: fx.tenantId,
      });

      expect(second.changed).toBe(false);
      expect(second.claimToken).toBeTruthy();
      expect(second.claimToken).not.toBe(first.claimToken);

      const args = {
        tenantId: fx.tenantId,
        leadId: fx.idleLeadId,
        workOrderId: first.order.id,
      };
      expect(await holdsLease({ ...args, claimToken: first.claimToken! })).toBe(false);
      expect(await holdsLease({ ...args, claimToken: second.claimToken! })).toBe(true);
    });
  });

  it('will not release under a token that never held the lease', async () => {
    await run(async () => {
      const { order } = await activated('outreach_launch', 'fence-bogus-token');

      expect(
        await releaseLease({
          tenantId: fx.tenantId,
          leadId: fx.idleLeadId,
          workOrderId: order.id,
          claimToken: 'not-a-real-token',
        })
      ).toBe(false);

      const lease = await prisma.workOrderLease.findUnique({
        where: { tenantId_leadId: { tenantId: fx.tenantId, leadId: fx.idleLeadId } },
      });
      expect(lease!.releasedAt).toBeNull();
    });
  });

  it('preserves the token across a renewal — renewing extends a hold, it does not start one', async () => {
    await run(async () => {
      const { order, claimToken } = await activated('outreach_launch', 'fence-renew-keeps-token');

      expect(
        await renewLease({
          tenantId: fx.tenantId,
          leadId: fx.idleLeadId,
          workOrderId: order.id,
          claimToken: claimToken!,
        })
      ).toBe(true);

      const lease = await prisma.workOrderLease.findUnique({
        where: { tenantId_leadId: { tenantId: fx.tenantId, leadId: fx.idleLeadId } },
      });
      expect(lease!.claimToken).toBe(claimToken);
    });
  });
});

describe.skipIf(!hasDb)('expired leases are recoverable, deterministically', () => {
  it('lets a new order take over once the holder’s lease has expired', async () => {
    await run(async () => {
      const dead = await draft('outreach_launch', 'lease-dead');
      const successor = await draft('reengagement', 'lease-successor');

      await exclusiveClaim(dead.id, new Date(Date.now() - ONE_HOUR_MS), 60);
      const takeover = await exclusiveClaim(successor.id);

      expect(takeover.outcome).toBe('reclaimed');
      expect(takeover.lease?.workOrderId).toBe(successor.id);
      expect(
        await prisma.workOrderLease.count({
          where: { tenantId: fx.tenantId, leadId: fx.idleLeadId },
        })
      ).toBe(1);
    });
  });

  it('starts a new hold rather than inheriting the dead holder’s claim time', async () => {
    await run(async () => {
      const dead = await draft('outreach_launch', 'lease-claimtime-dead');
      const successor = await draft('reengagement', 'lease-claimtime-successor');
      const longAgo = new Date(Date.now() - ONE_HOUR_MS);

      await exclusiveClaim(dead.id, longAgo, 60);
      const takeover = await exclusiveClaim(successor.id);

      expect(takeover.lease!.claimedAt.getTime()).toBeGreaterThan(longAgo.getTime());
    });
  });

  it('refuses to renew an expired lease — the holder must re-claim through the conflict path', async () => {
    await run(async () => {
      const order = await draft('outreach_launch', 'lease-renew-expired');
      const claim = await exclusiveClaim(order.id, new Date(Date.now() - ONE_HOUR_MS), 60);

      expect(
        await renewLease({
          tenantId: fx.tenantId,
          leadId: fx.idleLeadId,
          workOrderId: order.id,
          claimToken: claim.claimToken!,
        })
      ).toBe(false);
    });
  });

  it('renews a live lease and extends its expiry', async () => {
    await run(async () => {
      const { order, claimToken } = await activated('outreach_launch', 'lease-renew-live');
      const before = await prisma.workOrderLease.findUnique({
        where: { tenantId_leadId: { tenantId: fx.tenantId, leadId: fx.idleLeadId } },
      });

      expect(
        await renewLease({
          tenantId: fx.tenantId,
          leadId: fx.idleLeadId,
          workOrderId: order.id,
          claimToken: claimToken!,
        })
      ).toBe(true);

      const after = await prisma.workOrderLease.findUnique({
        where: { tenantId_leadId: { tenantId: fx.tenantId, leadId: fx.idleLeadId } },
      });
      expect(after!.expiresAt.getTime()).toBeGreaterThanOrEqual(before!.expiresAt.getTime());
      expect(after!.renewedAt).not.toBeNull();
    });
  });

  it('will not renew a lease held by a different order', async () => {
    await run(async () => {
      const { claimToken } = await activated('outreach_launch', 'lease-renew-holder');
      const stranger = await draft('reengagement', 'lease-renew-stranger');

      expect(
        await renewLease({
          tenantId: fx.tenantId,
          leadId: fx.idleLeadId,
          workOrderId: stranger.id,
          claimToken: claimToken!,
        })
      ).toBe(false);
    });
  });

  it('releases idempotently and keeps the row as the record that work happened', async () => {
    await run(async () => {
      const { order, claimToken } = await activated('outreach_launch', 'lease-release');
      const args = {
        tenantId: fx.tenantId,
        leadId: fx.idleLeadId,
        workOrderId: order.id,
        claimToken: claimToken!,
      };

      expect(await releaseLease(args)).toBe(true);
      expect(await releaseLease(args)).toBe(false);
      expect(
        await prisma.workOrderLease.count({
          where: { tenantId: fx.tenantId, leadId: fx.idleLeadId },
        })
      ).toBe(1);
    });
  });

  it('reports a stale lease rather than silently absorbing a dead holder', async () => {
    await run(async () => {
      const order = await draft('outreach_launch', 'lease-stale');
      await exclusiveClaim(order.id, new Date(Date.now() - ONE_HOUR_MS), 60);

      const stale = await findStaleLeases(fx.tenantId);
      expect(stale).toHaveLength(1);
      expect(stale[0].workOrderId).toBe(order.id);
      expect(stale[0].staleForSeconds).toBeGreaterThan(0);
    });
  });

  it('does not report a released lease as stale', async () => {
    await run(async () => {
      const { order, claimToken } = await activated('outreach_launch', 'lease-released-not-stale');
      await releaseLease({
        tenantId: fx.tenantId,
        leadId: fx.idleLeadId,
        workOrderId: order.id,
        claimToken: claimToken!,
      });

      expect(await findStaleLeases(fx.tenantId)).toEqual([]);
    });
  });

  it('uses one definition of live everywhere', () => {
    const now = new Date();
    const future = new Date(now.getTime() + 1_000);
    const past = new Date(now.getTime() - 1_000);

    expect(isLeaseLive({ expiresAt: future, releasedAt: null }, now)).toBe(true);
    expect(isLeaseLive({ expiresAt: past, releasedAt: null }, now)).toBe(false);
    expect(isLeaseLive({ expiresAt: future, releasedAt: now }, now)).toBe(false);
  });
});

describe.skipIf(!hasDb)('a lease is execution protection, never CRM ownership', () => {
  it('changes neither the assigned SDR nor the operating state, through the whole cycle', async () => {
    await run(async () => {
      const select = {
        assignedToId: true,
        operatingState: true,
        operatingStateAt: true,
      } as const;

      const before = await prisma.lead.findUnique({ where: { id: fx.idleLeadId }, select });

      const { order, claimToken } = await activated('outreach_launch', 'lease-ownership');
      const duringLease = await prisma.lead.findUnique({ where: { id: fx.idleLeadId }, select });

      await releaseLease({
        tenantId: fx.tenantId,
        leadId: fx.idleLeadId,
        workOrderId: order.id,
        claimToken: claimToken!,
      });
      await finishWorkOrder({
        workOrderId: order.id,
        tenantId: fx.tenantId,
        status: 'completed',
      });

      const after = await prisma.lead.findUnique({ where: { id: fx.idleLeadId }, select });

      expect(duringLease).toEqual(before);
      expect(after).toEqual(before);
      expect(before!.assignedToId).toBe(fx.sdrId);
    });
  });

  it('does not reassign the lead when a lease expires and another order takes over', async () => {
    await run(async () => {
      const dead = await draft('outreach_launch', 'expiry-no-reassign-dead');
      const successor = await draft('reengagement', 'expiry-no-reassign-successor');

      await exclusiveClaim(dead.id, new Date(Date.now() - ONE_HOUR_MS), 60);
      await exclusiveClaim(successor.id);

      const lead = await prisma.lead.findUnique({
        where: { id: fx.idleLeadId },
        select: { assignedToId: true, operatingState: true },
      });
      expect(lead!.assignedToId).toBe(fx.sdrId);
      expect(lead!.operatingState).toBe('unassigned');
    });
  });

  it('writes no ProspectTransition — a lease is not a transition', async () => {
    await run(async () => {
      const before = await prisma.prospectTransition.count({
        where: { tenantId: fx.tenantId, leadId: fx.idleLeadId },
      });
      await activated('outreach_launch', 'lease-no-transition');
      const after = await prisma.prospectTransition.count({
        where: { tenantId: fx.tenantId, leadId: fx.idleLeadId },
      });
      expect(after).toBe(before);
    });
  });
});

describe.skipIf(!hasDb)('tenant isolation holds', () => {
  it('refuses to load another tenant’s work order, even with its id', async () => {
    const order = await run(() => draft('research_batch', 'isolation-order'));

    await runOther(async () => {
      await expect(requireWorkOrder(order.id, fx.otherTenantId)).rejects.toBeInstanceOf(
        WorkOrderNotFoundError
      );
    });
  });

  it('refuses to activate another tenant’s work order', async () => {
    const order = await run(() => draft('research_batch', 'isolation-activate'));

    await runOther(async () => {
      await expect(
        activateWorkOrder({ workOrderId: order.id, tenantId: fx.otherTenantId })
      ).rejects.toBeInstanceOf(WorkOrderNotFoundError);
    });
  });

  it('does not let one tenant’s live work order conflict with another tenant’s', async () => {
    await run(() => activated('outreach_launch', 'isolation-incumbent'));

    await runOther(async () => {
      const conflicts = await detectActivationConflicts({
        tenantId: fx.otherTenantId,
        leadId: fx.otherTenantLeadId,
        type: 'outreach_launch',
      });
      expect(conflicts).toEqual([]);
    });
  });

  it('scopes the requestKey per tenant rather than globally', async () => {
    await run(() => draft('research_batch', 'shared-request-key'));

    const other = await runOther(() =>
      createWorkOrder({
        tenantId: fx.otherTenantId,
        type: 'research_batch',
        createdById: fx.otherDirectorId,
        requestKey: 'shared-request-key',
        leadId: fx.otherTenantLeadId,
      })
    );

    expect(other.tenantId).toBe(fx.otherTenantId);
  });

  it('does not report another tenant’s stale lease', async () => {
    await run(async () => {
      const order = await draft('outreach_launch', 'isolation-stale');
      await exclusiveClaim(order.id, new Date(Date.now() - ONE_HOUR_MS), 60);
    });

    await runOther(async () => {
      expect(await findStaleLeases(fx.otherTenantId)).toEqual([]);
    });
  });
});
