import { prisma, withTenantRaw } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

export const STALE_CLAIM_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
export const DEFAULT_CACHE_TTL_DAYS = 7;
/** How long a loser waits for the winner's run before giving up and reporting `pending`. */
export const DEFAULT_CLAIM_WAIT_MS = 10_000;

/**
 * Timing knobs for the claim protocol. Production uses the defaults; tests compress the
 * windows so the heartbeat/staleness fence can be proven without waiting five real minutes.
 */
export interface ClaimOptions {
  /** How long to wait for the current winner to finish before reporting `pending`. */
  waitTimeoutMs?: number;
  /** How old `claimedAt` must be before the claim counts as abandoned. */
  staleAfterMs?: number;
}

export interface ClaimResult {
  winner: boolean;
  cacheId: string;
  claimToken: string;
  version: number;
  status: 'pending' | 'completed' | 'failed';
  reused: boolean;
}

// ===========================================================================
// 1. Account Research Cache Protocol
// ===========================================================================

export async function insertOrClaimAccountResearch(
  tenantId: string,
  accountId: string,
  claimedBy?: string,
  options: ClaimOptions = {}
): Promise<ClaimResult> {
  const waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_CLAIM_WAIT_MS;
  const staleAfterMs = options.staleAfterMs ?? STALE_CLAIM_TIMEOUT_MS;
  const token = randomUUID();
  const now = new Date();

  // Step A: Check if cache row already exists before attempting CREATE
  const initialExisting = await prisma.accountResearchCache.findUnique({
    where: { tenantId_accountId: { tenantId, accountId } },
  });

  if (!initialExisting) {
    try {
      const created = await prisma.accountResearchCache.create({
        data: {
          tenantId,
          accountId,
          status: 'pending',
          claimToken: token,
          claimedBy: claimedBy ?? 'worker',
          claimedAt: now,
          version: 1,
        },
      });

      return {
        winner: true,
        cacheId: created.id,
        claimToken: created.claimToken!,
        version: created.version,
        status: 'pending',
        reused: false,
      };
    } catch (err: unknown) {
      // Only catch Prisma P2002 (Unique constraint failed) as expected race
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Expected race — row was created concurrently
      } else {
        throw err;
      }
    }
  }

  // Step B: Row exists — query current state
  const existing =
    initialExisting ??
    (await prisma.accountResearchCache.findUnique({
      where: { tenantId_accountId: { tenantId, accountId } },
    }));

  if (!existing) {
    return { winner: false, cacheId: '', claimToken: '', version: 0, status: 'failed', reused: false };
  }

  // If completed and fresh, reuse!
  if (existing.status === 'completed' && existing.expiresAt && existing.expiresAt > now) {
    return {
      winner: false,
      cacheId: existing.id,
      claimToken: existing.claimToken ?? '',
      version: existing.version,
      status: 'completed',
      reused: true,
    };
  }

  // If pending and claimed recently (heartbeat still renewing it), wait!
  const isStale = !existing.claimedAt || now.getTime() - existing.claimedAt.getTime() > staleAfterMs;

  if (existing.status === 'pending' && !isStale) {
    // Waiter logic: poll for the winner to finish
    const pollStart = Date.now();
    while (Date.now() - pollStart < waitTimeoutMs) {
      await new Promise((res) => setTimeout(res, 500));
      const pollCurrent = await prisma.accountResearchCache.findUnique({
        where: { tenantId_accountId: { tenantId, accountId } },
      });
      if (pollCurrent && pollCurrent.status === 'completed' && pollCurrent.expiresAt && pollCurrent.expiresAt > new Date()) {
        return {
          winner: false,
          cacheId: pollCurrent.id,
          claimToken: pollCurrent.claimToken ?? '',
          version: pollCurrent.version,
          status: 'completed',
          reused: true,
        };
      }
      if (pollCurrent && pollCurrent.status === 'failed') {
        break;
      }
    }
  }

  // Re-read state after waiting
  const preReclaim = await prisma.accountResearchCache.findUnique({
    where: { tenantId_accountId: { tenantId, accountId } },
  });

  if (!preReclaim) {
    return { winner: false, cacheId: '', claimToken: '', version: 0, status: 'failed', reused: false };
  }

  if (preReclaim.status === 'completed' && preReclaim.expiresAt && preReclaim.expiresAt > now) {
    return {
      winner: false,
      cacheId: preReclaim.id,
      claimToken: preReclaim.claimToken ?? '',
      version: preReclaim.version,
      status: 'completed',
      reused: true,
    };
  }

  // Recomputed against the wall clock, not `now`: a wait of `waitTimeoutMs` has elapsed since
  // `now` was taken, and using the stale value would call a live claim abandoned.
  const reclaimAt = new Date();
  const preReclaimStale =
    !preReclaim.claimedAt || reclaimAt.getTime() - preReclaim.claimedAt.getTime() > staleAfterMs;

  if (preReclaim.status === 'pending' && !preReclaimStale) {
    return {
      winner: false,
      cacheId: preReclaim.id,
      claimToken: preReclaim.claimToken ?? '',
      version: preReclaim.version,
      status: 'pending',
      reused: false,
    };
  }

  // Re-claim attempt (for failed, expired, or stale pending rows)
  const currentVersion = preReclaim.version;
  // Raw SQL is outside the tenant extension, so it needs its context set explicitly — see
  // `withTenantRaw` in `lib/prisma.ts`. Unwrapped under RLS this UPDATE matches nothing and
  // returns 0, which reads here as "someone else won the race" rather than as a failure, so
  // every claim would decline forever and no research would ever run.
  const updateRes = await withTenantRaw(tenantId, (db) => db.$executeRaw`
    UPDATE "AccountResearchCache"
    SET status = 'pending', "claimToken" = ${token}, "claimedBy" = ${claimedBy ?? 'worker'}, "claimedAt" = ${reclaimAt}, version = ${currentVersion + 1}
    WHERE "tenantId" = ${tenantId} AND "accountId" = ${accountId} AND version = ${currentVersion}
    AND (
      status = 'failed'
      OR (status = 'completed' AND "expiresAt" < ${reclaimAt})
      OR (status = 'pending' AND "claimedAt" < ${new Date(reclaimAt.getTime() - staleAfterMs)})
    )
  `);

  if (updateRes === 1) {
    return {
      winner: true,
      cacheId: preReclaim.id,
      claimToken: token,
      version: currentVersion + 1,
      status: 'pending',
      reused: false,
    };
  }

  // Lost reclamation race
  return {
    winner: false,
    cacheId: preReclaim.id,
    claimToken: preReclaim.claimToken ?? '',
    version: preReclaim.version,
    status: preReclaim.status as 'pending' | 'completed' | 'failed',
    reused: false,
  };
}

export async function heartbeatAccountResearchCache(
  tenantId: string,
  accountId: string,
  claimToken: string,
  version: number
): Promise<boolean> {
  const res = await prisma.accountResearchCache.updateMany({
    where: {
      tenantId,
      accountId,
      claimToken,
      version,
      status: 'pending',
    },
    data: {
      claimedAt: new Date(),
    },
  });
  return res.count === 1;
}

export async function completeAccountResearchCache(
  tenantId: string,
  accountId: string,
  claimToken: string,
  version: number,
  ttlDays: number = DEFAULT_CACHE_TTL_DAYS
): Promise<boolean> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);

  const res = await prisma.accountResearchCache.updateMany({
    where: {
      tenantId,
      accountId,
      claimToken,
      version,
      status: 'pending',
    },
    data: {
      status: 'completed',
      completedAt: now,
      expiresAt,
    },
  });
  return res.count === 1;
}

export async function failAccountResearchCache(
  tenantId: string,
  accountId: string,
  claimToken: string,
  version: number
): Promise<boolean> {
  const res = await prisma.accountResearchCache.updateMany({
    where: {
      tenantId,
      accountId,
      claimToken,
      version,
      status: 'pending',
    },
    data: {
      status: 'failed',
    },
  });
  return res.count === 1;
}

// ===========================================================================
// 2. Contact Research Cache Protocol
// ===========================================================================

export async function insertOrClaimContactResearch(
  tenantId: string,
  contactId: string,
  claimedBy?: string,
  options: ClaimOptions = {}
): Promise<ClaimResult> {
  const waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_CLAIM_WAIT_MS;
  const staleAfterMs = options.staleAfterMs ?? STALE_CLAIM_TIMEOUT_MS;
  const token = randomUUID();
  const now = new Date();

  const initialExisting = await prisma.contactResearchCache.findUnique({
    where: { tenantId_contactId: { tenantId, contactId } },
  });

  if (!initialExisting) {
    try {
      const created = await prisma.contactResearchCache.create({
        data: {
          tenantId,
          contactId,
          status: 'pending',
          claimToken: token,
          claimedBy: claimedBy ?? 'worker',
          claimedAt: now,
          version: 1,
        },
      });

      return {
        winner: true,
        cacheId: created.id,
        claimToken: created.claimToken!,
        version: created.version,
        status: 'pending',
        reused: false,
      };
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Expected race — row exists
      } else {
        throw err;
      }
    }
  }

  const existing =
    initialExisting ??
    (await prisma.contactResearchCache.findUnique({
      where: { tenantId_contactId: { tenantId, contactId } },
    }));

  if (!existing) {
    return { winner: false, cacheId: '', claimToken: '', version: 0, status: 'failed', reused: false };
  }

  if (existing.status === 'completed' && existing.expiresAt && existing.expiresAt > now) {
    return {
      winner: false,
      cacheId: existing.id,
      claimToken: existing.claimToken ?? '',
      version: existing.version,
      status: 'completed',
      reused: true,
    };
  }

  const isStale = !existing.claimedAt || now.getTime() - existing.claimedAt.getTime() > staleAfterMs;

  if (existing.status === 'pending' && !isStale) {
    const pollStart = Date.now();
    while (Date.now() - pollStart < waitTimeoutMs) {
      await new Promise((res) => setTimeout(res, 500));
      const pollCurrent = await prisma.contactResearchCache.findUnique({
        where: { tenantId_contactId: { tenantId, contactId } },
      });
      if (pollCurrent && pollCurrent.status === 'completed' && pollCurrent.expiresAt && pollCurrent.expiresAt > new Date()) {
        return {
          winner: false,
          cacheId: pollCurrent.id,
          claimToken: pollCurrent.claimToken ?? '',
          version: pollCurrent.version,
          status: 'completed',
          reused: true,
        };
      }
      if (pollCurrent && pollCurrent.status === 'failed') {
        break;
      }
    }
  }

  // Re-read state after waiting
  const preReclaim = await prisma.contactResearchCache.findUnique({
    where: { tenantId_contactId: { tenantId, contactId } },
  });

  if (!preReclaim) {
    return { winner: false, cacheId: '', claimToken: '', version: 0, status: 'failed', reused: false };
  }

  if (preReclaim.status === 'completed' && preReclaim.expiresAt && preReclaim.expiresAt > now) {
    return {
      winner: false,
      cacheId: preReclaim.id,
      claimToken: preReclaim.claimToken ?? '',
      version: preReclaim.version,
      status: 'completed',
      reused: true,
    };
  }

  const reclaimAt = new Date();
  const preReclaimStale =
    !preReclaim.claimedAt || reclaimAt.getTime() - preReclaim.claimedAt.getTime() > staleAfterMs;

  if (preReclaim.status === 'pending' && !preReclaimStale) {
    return {
      winner: false,
      cacheId: preReclaim.id,
      claimToken: preReclaim.claimToken ?? '',
      version: preReclaim.version,
      status: 'pending',
      reused: false,
    };
  }

  const currentVersion = preReclaim.version;
  // Same reasoning as the account cache above.
  const updateRes = await withTenantRaw(tenantId, (db) => db.$executeRaw`
    UPDATE "ContactResearchCache"
    SET status = 'pending', "claimToken" = ${token}, "claimedBy" = ${claimedBy ?? 'worker'}, "claimedAt" = ${reclaimAt}, version = ${currentVersion + 1}
    WHERE "tenantId" = ${tenantId} AND "contactId" = ${contactId} AND version = ${currentVersion}
    AND (
      status = 'failed'
      OR (status = 'completed' AND "expiresAt" < ${reclaimAt})
      OR (status = 'pending' AND "claimedAt" < ${new Date(reclaimAt.getTime() - staleAfterMs)})
    )
  `);

  if (updateRes === 1) {
    return {
      winner: true,
      cacheId: preReclaim.id,
      claimToken: token,
      version: currentVersion + 1,
      status: 'pending',
      reused: false,
    };
  }

  return {
    winner: false,
    cacheId: preReclaim.id,
    claimToken: preReclaim.claimToken ?? '',
    version: preReclaim.version,
    status: preReclaim.status as 'pending' | 'completed' | 'failed',
    reused: false,
  };
}

export async function heartbeatContactResearchCache(
  tenantId: string,
  contactId: string,
  claimToken: string,
  version: number
): Promise<boolean> {
  const res = await prisma.contactResearchCache.updateMany({
    where: {
      tenantId,
      contactId,
      claimToken,
      version,
      status: 'pending',
    },
    data: {
      claimedAt: new Date(),
    },
  });
  return res.count === 1;
}

export async function completeContactResearchCache(
  tenantId: string,
  contactId: string,
  claimToken: string,
  version: number,
  ttlDays: number = DEFAULT_CACHE_TTL_DAYS
): Promise<boolean> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);

  const res = await prisma.contactResearchCache.updateMany({
    where: {
      tenantId,
      contactId,
      claimToken,
      version,
      status: 'pending',
    },
    data: {
      status: 'completed',
      completedAt: now,
      expiresAt,
    },
  });
  return res.count === 1;
}

export async function failContactResearchCache(
  tenantId: string,
  contactId: string,
  claimToken: string,
  version: number
): Promise<boolean> {
  const res = await prisma.contactResearchCache.updateMany({
    where: {
      tenantId,
      contactId,
      claimToken,
      version,
      status: 'pending',
    },
    data: {
      status: 'failed',
    },
  });
  return res.count === 1;
}
