import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import type { WorkOrderLease } from '@prisma/client';
import type { LeaseMode } from './types';

/**
 * Work order execution leases (Revenue AI Phase 6a).
 *
 * A lease answers exactly one question: **which work order attempt may execute against this
 * lead right now.** It is not sales ownership and not operating responsibility. Nothing in this
 * file reads or writes `Lead.assignedToId` or `Lead.operatingState`, and that is a property the
 * tests assert rather than a convention — the three concepts are independent, so a lease
 * expiring must never reassign anybody and a reassignment must never interrupt a running order.
 *
 * ## Fencing
 *
 * Every claim and reclaim mints a fresh `claimToken`; renewals preserve it. `renewLease` and
 * `releaseLease` require the caller's token to match the row's, so a holder that lost its lease
 * cannot act on it afterwards.
 *
 * `workOrderId` alone would not be enough. The dangerous case is not two different orders — it
 * is **two attempts at the same order**:
 *
 * ```text
 * worker 1 claims for order X   →   stalls   →   lease expires
 * worker 2 retries order X      →   reclaims
 * worker 1 wakes up             →   its workOrderId still matches
 * ```
 *
 * A `workOrderId`-only predicate would let worker 1 renew or release a lease it no longer holds,
 * and report itself as the holder. The token does not match, so all three fail.
 *
 * ## What this does not claim
 *
 * **Not exactly-once, and not distributed consensus.** A lease is a time-bounded hold with a
 * deterministic recovery rule, running against Postgres through the Neon HTTP driver, which has
 * no interactive transactions. What it guarantees:
 *
 *   1. At most one live exclusive lease per lead, enforced by `@@unique([tenantId, leadId])` —
 *      a *constraint*, not a service-side check. Two concurrent claimants cannot both observe
 *      "free" and both win; the loser is told who holds it rather than seeing a raw unique
 *      violation.
 *   2. An expired lease is reclaimable by anyone. This is the only recovery path for a holder
 *      that died, and it is why `expiresAt` is mandatory.
 *   3. Recovery is deterministic: a lease is live iff `releasedAt IS NULL AND expiresAt > now`.
 *      One rule, applied identically by the claim path, the conflict check and the sweep.
 *   4. A superseded holder is fenced out, per above.
 *
 * What it does not guarantee: that the previous holder has actually *stopped working*. A process
 * partitioned from the database can still be mid-tool-call when its lease expires. Fencing stops
 * it touching the lease; it does not stop it having already called a tool. That is why the lease
 * is execution *protection* rather than mutual exclusion, and why the durable idempotency in
 * `AgentAction` — not the lease — is what stops a CRM mutation happening twice.
 */

/** Long enough to outlive a slow tool call, short enough that a dead holder frees the lead. */
export const DEFAULT_LEASE_TTL_SECONDS = 900;

export const LEASE_TTL_BOUNDS = { min: 60, max: 3_600 } as const;

export type LeaseClaimOutcome =
  /** A fresh lease was taken on a lead that had none. */
  | 'claimed'
  /** An expired or released lease was taken over. */
  | 'reclaimed'
  /** This work order already held a live lease; the expiry was extended. */
  | 'renewed'
  /** Another work order holds a live lease. */
  | 'held_by_other'
  /** Shared-mode work takes no lease and is blocked by none. */
  | 'not_required';

export interface LeaseClaimResult {
  outcome: LeaseClaimOutcome;
  lease: WorkOrderLease | null;
  /**
   * The fencing token for this hold. Required by `renewLease` and `releaseLease`.
   *
   * Null when no lease was taken (`not_required`) or when the claim was lost
   * (`held_by_other`) — a caller that did not win must not be handed a token at all.
   */
  claimToken: string | null;
  /** Set when `held_by_other` — who holds it, so the refusal can name them. */
  heldByWorkOrderId?: string;
}

export interface ClaimLeaseInput {
  tenantId: string;
  leadId: string;
  workOrderId: string;
  mode: LeaseMode;
  ttlSeconds?: number;
  /** Injected in tests; defaults to now. */
  now?: Date;
}

/** A lease is live iff it has not been released and has not expired. The only definition. */
export function isLeaseLive(
  lease: Pick<WorkOrderLease, 'expiresAt' | 'releasedAt'>,
  now: Date
): boolean {
  return lease.releasedAt === null && lease.expiresAt > now;
}

function expiryFrom(now: Date, ttlSeconds: number): Date {
  const bounded = Math.min(
    Math.max(Math.trunc(ttlSeconds), LEASE_TTL_BOUNDS.min),
    LEASE_TTL_BOUNDS.max
  );
  return new Date(now.getTime() + bounded * 1_000);
}

/**
 * Take, take over, or extend the lead's lease.
 *
 * Shared-mode orders return `not_required` without touching the table. Assistance work does not
 * compete for the prospect, so making it queue behind an outreach order would block a summary
 * exactly when the SDR wants one.
 */
export async function claimLease(input: ClaimLeaseInput): Promise<LeaseClaimResult> {
  if (input.mode === 'shared') {
    return { outcome: 'not_required', lease: null, claimToken: null };
  }

  const now = input.now ?? new Date();
  const expiresAt = expiryFrom(now, input.ttlSeconds ?? DEFAULT_LEASE_TTL_SECONDS);
  const claimToken = randomUUID();

  try {
    const lease = await prisma.workOrderLease.create({
      data: {
        tenantId: input.tenantId,
        leadId: input.leadId,
        workOrderId: input.workOrderId,
        mode: input.mode,
        claimToken,
        claimedAt: now,
        expiresAt,
      },
    });
    return { outcome: 'claimed', lease, claimToken };
  } catch (err) {
    // The unique constraint is the arbiter under a concurrent claim. Catching it here is what
    // turns "two workers raced" into a named outcome instead of an unhandled P2002 reaching the
    // caller — the loser falls through to the compare-and-set below and is told who won.
    if (!isUniqueViolation(err)) throw err;
  }

  // A row exists. Read who holds it *before* the compare-and-set, because afterwards the row
  // says us either way and the two cases are no longer distinguishable — extending our own hold
  // and taking a dead holder's lead away are different events.
  const existing = await prisma.workOrderLease.findUnique({
    where: { tenantId_leadId: { tenantId: input.tenantId, leadId: input.leadId } },
    select: { workOrderId: true, expiresAt: true, releasedAt: true },
  });
  const wasOursAndLive =
    existing?.workOrderId === input.workOrderId && existing !== null && isLeaseLive(existing, now);

  // Take it over only if it is dead or already ours — one statement, so two racing reclaimers
  // cannot both pass. The loser's predicate is re-evaluated against the winner's committed row
  // and no longer matches.
  const takeover = await prisma.workOrderLease.updateMany({
    where: {
      tenantId: input.tenantId,
      leadId: input.leadId,
      OR: [
        { releasedAt: { not: null } },
        { expiresAt: { lte: now } },
        { workOrderId: input.workOrderId },
      ],
    },
    data: {
      workOrderId: input.workOrderId,
      mode: input.mode,
      // A new token on every claim and reclaim, so any previous holder — including a stalled
      // earlier attempt at this same work order — is fenced out from this moment on.
      claimToken,
      expiresAt,
      releasedAt: null,
      renewedAt: now,
      // A new hold starts a new clock. `claimedAt` is left alone only when we already held a
      // live lease, so a genuine renewal does not keep resetting when this hold began.
      ...(wasOursAndLive ? {} : { claimedAt: now }),
    },
  });

  const lease = await prisma.workOrderLease.findUnique({
    where: { tenantId_leadId: { tenantId: input.tenantId, leadId: input.leadId } },
  });

  if (takeover.count !== 1 || !lease) {
    return {
      outcome: 'held_by_other',
      lease,
      claimToken: null,
      heldByWorkOrderId: lease?.workOrderId,
    };
  }

  return { outcome: wasOursAndLive ? 'renewed' : 'reclaimed', lease, claimToken };
}

export interface RenewLeaseInput {
  tenantId: string;
  leadId: string;
  workOrderId: string;
  /** The token this holder was given when it claimed. A stale token cannot renew. */
  claimToken: string;
  ttlSeconds?: number;
  now?: Date;
}

/**
 * Extend a lease this holder still owns.
 *
 * Requires the lease to be **live** and the token to match. An expired lease is not renewable,
 * deliberately: by then anyone may have taken it, and a worker resuming from a long pause must
 * go back through `claimLease` — which runs the conflict path — rather than quietly resurrecting
 * a hold the system had already declared free.
 */
export async function renewLease(input: RenewLeaseInput): Promise<boolean> {
  const now = input.now ?? new Date();
  const expiresAt = expiryFrom(now, input.ttlSeconds ?? DEFAULT_LEASE_TTL_SECONDS);

  const renewed = await prisma.workOrderLease.updateMany({
    where: {
      tenantId: input.tenantId,
      leadId: input.leadId,
      workOrderId: input.workOrderId,
      claimToken: input.claimToken,
      releasedAt: null,
      expiresAt: { gt: now },
    },
    // The token is preserved: renewing extends the same hold rather than starting a new one.
    data: { expiresAt, renewedAt: now },
  });

  return renewed.count === 1;
}

export interface ReleaseLeaseInput {
  tenantId: string;
  leadId: string;
  workOrderId: string;
  /** The token this holder was given when it claimed. A stale token cannot release. */
  claimToken: string;
  now?: Date;
}

/**
 * Give up a lease.
 *
 * Idempotent, and returns false rather than throwing when the lease was already released, is
 * held by someone else, or is held under a newer token — a worker unwinding after a failure
 * should not fail again on cleanup, and a superseded worker must not free the lead out from
 * under its successor. The row is kept rather than deleted: it is the record that this order
 * executed against this lead.
 */
export async function releaseLease(input: ReleaseLeaseInput): Promise<boolean> {
  const now = input.now ?? new Date();

  const released = await prisma.workOrderLease.updateMany({
    where: {
      tenantId: input.tenantId,
      leadId: input.leadId,
      workOrderId: input.workOrderId,
      claimToken: input.claimToken,
      releasedAt: null,
    },
    data: { releasedAt: now },
  });

  return released.count === 1;
}

/**
 * Release every lease a work order holds, regardless of which attempt holds them.
 *
 * **Deliberately unfenced**, and the only unfenced writer. This is the order-ending unwind: once
 * a work order reaches a terminal status, no attempt at it may still execute, so "which attempt
 * holds the row" is not a question worth asking. Fencing exists to stop a *superseded* worker
 * acting; it must not stop the order itself from ending.
 */
export async function releaseLeasesForWorkOrder(
  tenantId: string,
  workOrderId: string,
  now: Date = new Date()
): Promise<number> {
  const released = await prisma.workOrderLease.updateMany({
    where: { tenantId, workOrderId, releasedAt: null },
    data: { releasedAt: now },
  });
  return released.count;
}

/** True when this exact holder still owns a live lease on the lead. */
export async function holdsLease(input: {
  tenantId: string;
  leadId: string;
  workOrderId: string;
  claimToken: string;
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const lease = await prisma.workOrderLease.findUnique({
    where: { tenantId_leadId: { tenantId: input.tenantId, leadId: input.leadId } },
    select: { workOrderId: true, claimToken: true, expiresAt: true, releasedAt: true },
  });

  return (
    lease !== null &&
    lease.workOrderId === input.workOrderId &&
    lease.claimToken === input.claimToken &&
    isLeaseLive(lease, now)
  );
}

export interface StaleLease {
  id: string;
  leadId: string;
  workOrderId: string;
  expiresAt: Date;
  /** How long past expiry, in seconds — the number that says whether this is routine or wrong. */
  staleForSeconds: number;
}

/**
 * Leases whose holder never released them and whose time is up.
 *
 * Reporting, not repair. Nothing needs to clean these up for correctness — the claim path
 * already treats an expired lease as free — but a lead sitting expired-and-unreleased for hours
 * means a worker died mid-order, and that is worth seeing rather than silently absorbing.
 */
export async function findStaleLeases(
  tenantId: string,
  now: Date = new Date(),
  limit = 100
): Promise<StaleLease[]> {
  const rows = await prisma.workOrderLease.findMany({
    where: { tenantId, releasedAt: null, expiresAt: { lte: now } },
    orderBy: { expiresAt: 'asc' },
    take: limit,
    select: { id: true, leadId: true, workOrderId: true, expiresAt: true },
  });

  return rows.map((row) => ({
    ...row,
    staleForSeconds: Math.floor((now.getTime() - row.expiresAt.getTime()) / 1_000),
  }));
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === 'P2002';
}
