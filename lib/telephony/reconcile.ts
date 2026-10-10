import { prisma, tenantStorage } from '@/lib/prisma';

import { finishCall, processTelephonyEvent } from './applyEvent';
import { getTelephonyProvider } from './index';
import { parseTelnyxEvent } from './telnyx/events';

/**
 * The backstop for everything the webhook and the worker can lose (docs/dialer/TASKS.md D4.4).
 * Run every five minutes by `app/api/cron/telephony-reconcile`. Three repairs, each bounded to
 * `BATCH` rows per run and each safe to repeat:
 *
 *   1. replay stored events nobody processed (the worker was down, Redis was unreachable, the call
 *      was not yet known) — inline, so a broken queue does not also break its own repair;
 *   2. cancel `authorized` calls the provider never reported (the rep closed the tab, the token
 *      expired, the webhook was unreachable): they were never dialled;
 *   3. for calls still live in our table long after they should have ended, ask the provider — if
 *      it no longer has the leg the call is over, and is finished with what we know.
 *
 * Every write is made for the call's own tenant. `tenantIds` narrows the run to those tenants (a
 * manager's manual run names exactly one); without it the run is platform-wide (the scheduler's).
 */

export const REPLAY_AFTER_MS = 2 * 60_000;
/** An event that still matches no call after this long never will (another connection's traffic, a purged call). */
export const ABANDON_UNMATCHED_AFTER_MS = 60 * 60_000;
export const STALE_AUTHORIZED_AFTER_MS = 3 * 60_000;
/** Initiated or ringing this long is not a call, it is a lost hangup. */
export const STUCK_RINGING_AFTER_MS = 15 * 60_000;
/** Longest believable conversation before the provider is asked. */
export const STUCK_ANSWERED_AFTER_MS = 4 * 60 * 60_000;
export const BATCH = 100;
/** How far back a tenant-scoped replay looks for the tenant's sessions. */
const TENANT_SESSION_LOOKBACK_MS = 48 * 60 * 60_000;

const asSystem = <T>(fn: () => Promise<T>) => tenantStorage.run({ tenantId: 'system', bypassRls: true }, fn);
const asTenant = <T>(tenantId: string, fn: () => Promise<T>) => tenantStorage.run({ tenantId }, fn);

const tenantFilter = (tenantIds: string[] | null) => (tenantIds ? { tenantId: { in: tenantIds } } : {});

export type ReconcileSummary = {
  replayed: number;
  replayFailed: number;
  abandoned: number;
  canceledAuthorized: number;
  finalizedStuck: number;
  stillAlive: number;
  providerUnavailable: boolean;
};

async function replayEvents(now: Date, tenantIds: string[] | null, summary: ReconcileSummary): Promise<void> {
  let sessionFilter: { sessionId: { in: string[] } } | Record<string, never> = {};
  if (tenantIds) {
    const calls = await asSystem(() =>
      prisma.call.findMany({
        where: { tenantId: { in: tenantIds }, providerSessionId: { not: null }, createdAt: { gt: new Date(now.getTime() - TENANT_SESSION_LOOKBACK_MS) } },
        select: { providerSessionId: true },
        take: 1000,
      })
    );
    sessionFilter = { sessionId: { in: calls.map((c) => c.providerSessionId!).filter(Boolean) } };
  }
  const events = await asSystem(() =>
    prisma.telephonyEvent.findMany({
      where: { processedAt: null, receivedAt: { lt: new Date(now.getTime() - REPLAY_AFTER_MS) }, ...sessionFilter },
      orderBy: { receivedAt: 'asc' },
      take: BATCH,
      select: { providerEventId: true },
    })
  );

  for (const event of events) {
    try {
      const result = await processTelephonyEvent(event.providerEventId);
      if (result === 'applied') summary.replayed += 1;
    } catch (error) {
      summary.replayFailed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error('[telephony-reconcile] replay failed', { eventId: event.providerEventId, error: message });
      await asSystem(() =>
        prisma.telephonyEvent.updateMany({
          where: { providerEventId: event.providerEventId, processedAt: null },
          data: { attempts: { increment: 1 }, lastError: message.slice(0, 500) },
        })
      );
    }
  }
}

/**
 * Stop retrying events that matched no call for an hour: they belong to nothing we know (traffic on the
 * same connection that is not ours, a purged call). Platform-wide only — such an event has no tenant, so
 * a tenant-scoped run cannot say it is not theirs. Marked processed, with the reason kept.
 */
export async function abandonUnmatchedEvents(now: Date): Promise<number> {
  const result = await asSystem(() =>
    prisma.telephonyEvent.updateMany({
      where: { processedAt: null, lastError: 'no_call', receivedAt: { lt: new Date(now.getTime() - ABANDON_UNMATCHED_AFTER_MS) } },
      data: { processedAt: now, lastError: 'unmatched_abandoned' },
    })
  );
  return result.count;
}

async function cancelStaleAuthorized(now: Date, tenantIds: string[] | null, summary: ReconcileSummary): Promise<void> {
  const stale = await asSystem(() =>
    prisma.call.findMany({
      where: { status: 'authorized', authorizedAt: { lt: new Date(now.getTime() - STALE_AUTHORIZED_AFTER_MS) }, ...tenantFilter(tenantIds) },
      orderBy: { authorizedAt: 'asc' },
      take: BATCH,
      select: { id: true, tenantId: true },
    })
  );
  for (const call of stale) {
    const moved = await asTenant(call.tenantId, () =>
      prisma.call.updateMany({
        where: { id: call.id, tenantId: call.tenantId, status: 'authorized' },
        data: { status: 'canceled', endedAt: now, hangupCause: 'never_initiated', billedDurationSec: 0 },
      })
    );
    summary.canceledAuthorized += moved.count;
  }
}

/** When the stored events say the call was answered, in case the status lags them. */
async function storedAnsweredAt(sessionId: string | null): Promise<Date | null> {
  if (!sessionId) return null;
  const rows = await asSystem(() =>
    prisma.telephonyEvent.findMany({
      where: { sessionId, type: { in: ['call.answered', 'call.bridged'] } },
      orderBy: { receivedAt: 'asc' },
      take: 5,
      select: { payload: true, receivedAt: true },
    })
  );
  const first = rows[0];
  if (!first) return null;
  return parseTelnyxEvent(first.payload)?.occurredAt ?? first.receivedAt;
}

async function finalizeStuck(now: Date, tenantIds: string[] | null, summary: ReconcileSummary): Promise<void> {
  const stuck = await asSystem(() =>
    prisma.call.findMany({
      where: {
        ...tenantFilter(tenantIds),
        OR: [
          { status: { in: ['initiated', 'ringing'] }, initiatedAt: { lt: new Date(now.getTime() - STUCK_RINGING_AFTER_MS) } },
          { status: 'answered', answeredAt: { lt: new Date(now.getTime() - STUCK_ANSWERED_AFTER_MS) } },
        ],
      },
      orderBy: { updatedAt: 'asc' },
      take: BATCH,
    })
  );
  if (stuck.length === 0) return;

  let provider;
  try {
    provider = getTelephonyProvider();
  } catch {
    summary.providerUnavailable = true;
    return;
  }

  for (const call of stuck) {
    try {
      const status = call.providerControlId ? await provider.getCallStatus(call.providerControlId) : { alive: false };
      if (status.alive) {
        summary.stillAlive += 1;
        continue;
      }
      const answeredAt = call.answeredAt ?? (await storedAnsweredAt(call.providerSessionId));
      await asTenant(call.tenantId, () =>
        finishCall(call, { status: answeredAt ? 'completed' : 'failed', endedAt: now, hangupCause: 'reconciled', answeredAt })
      );
      summary.finalizedStuck += 1;
    } catch (error) {
      summary.providerUnavailable = true;
      console.error('[telephony-reconcile] could not finalize a stuck call', { callId: call.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

export async function reconcileTelephony(input: { now?: Date; tenantIds?: string[] | null } = {}): Promise<ReconcileSummary> {
  const now = input.now ?? new Date();
  const tenantIds = input.tenantIds ?? null;
  const summary: ReconcileSummary = {
    replayed: 0,
    replayFailed: 0,
    abandoned: 0,
    canceledAuthorized: 0,
    finalizedStuck: 0,
    stillAlive: 0,
    providerUnavailable: false,
  };
  await replayEvents(now, tenantIds, summary);
  if (!tenantIds) summary.abandoned = await abandonUnmatchedEvents(now);
  await cancelStaleAuthorized(now, tenantIds, summary);
  await finalizeStuck(now, tenantIds, summary);
  return summary;
}
