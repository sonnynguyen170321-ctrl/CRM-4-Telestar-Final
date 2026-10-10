import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/auth', () => ({ auth: authMock, handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));

const reconcileSpy = vi.hoisted(() => ({ calls: [] as Array<{ tenantIds?: string[] | null }>, narrowTo: null as string[] | null }));
vi.mock('@/lib/telephony/reconcile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/telephony/reconcile')>();
  return {
    ...actual,
    // Records what the route asked for, then runs only the tenants this test owns: the database is shared,
    // and a genuinely platform-wide sweep would also finish other suites' fixtures.
    reconcileTelephony: (input: Parameters<typeof actual.reconcileTelephony>[0] = {}) => {
      reconcileSpy.calls.push({ tenantIds: input.tenantIds });
      return actual.reconcileTelephony({ ...input, tenantIds: input.tenantIds ?? reconcileSpy.narrowTo });
    },
  };
});

import { prisma } from '@/lib/prisma';
import { processTelephonyEvent } from '@/lib/telephony/applyEvent';
import { FakeTelephonyProvider } from '@/lib/telephony/fake';
import { setTelephonyProviderForTests } from '@/lib/telephony/index';
import { TelephonyProviderError } from '@/lib/telephony/provider';
import {
  ABANDON_UNMATCHED_AFTER_MS,
  abandonUnmatchedEvents,
  EVENT_RETENTION_MS,
  purgeOldEvents,
  BATCH,
  REPLAY_AFTER_MS,
  STALE_AUTHORIZED_AFTER_MS,
  STUCK_ANSWERED_AFTER_MS,
  STUCK_RINGING_AFTER_MS,
  reconcileTelephony,
} from '@/lib/telephony/reconcile';
import { GET } from '@/app/api/cron/telephony-reconcile/route';
import { createTestTenant } from './helpers/testTenant';
import {
  activitiesFor,
  asSystem,
  buildDialerWorld,
  deleteEventsWithPrefix,
  makeCall,
  reload,
  storeEvent,
  type DialerWorld,
  type EventSpec,
} from './helpers/telephonyFixture';

/**
 * The reconcile cron (docs/dialer/TASKS.md D4.4), against a real database and the fake provider.
 * Each repair is bounded, tenant-scoped and idempotent; the cron needs the scheduler's secret.
 */

const NOW = new Date('2026-10-05T06:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;

let fake: FakeTelephonyProvider;
let world: DialerWorld;
let other: DialerWorld;
let prefix: string;
let counter = 0;
let savedSecret: string | undefined;
const id = () => `${prefix}${(counter += 1)}`;

const eventRow = (providerEventId: string) => asSystem(() => prisma.telephonyEvent.findUniqueOrThrow({ where: { providerEventId } }));

beforeEach(async () => {
  prefix = `evt-rc-${randomUUID()}-`;
  counter = 0;
  fake = new FakeTelephonyProvider();
  setTelephonyProviderForTests(fake);
  savedSecret = process.env.CRON_SECRET;
  world = await buildDialerWorld(await createTestTenant(`t-telrc-${randomUUID()}`, 'Reconcile'));
  other = await buildDialerWorld(await createTestTenant(`t-telrc-o-${randomUUID()}`, 'Reconcile other'));
  authMock.mockReset().mockResolvedValue(null);
  reconcileSpy.calls = [];
  reconcileSpy.narrowTo = [world.tenantId, other.tenantId];
});

afterEach(async () => {
  setTelephonyProviderForTests(null);
  await deleteEventsWithPrefix(prefix);
  if (savedSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedSecret;
});

describe('replaying unprocessed events', () => {
  const hangup = (sessionId: string): EventSpec => ({ id: id(), type: 'call.hangup', sessionId, controlId: 'leg', direction: 'outgoing', hangupCause: 'normal_clearing', occurredAt: ago(10 * MIN) });

  it('applies events older than the grace period and leaves fresher ones to the worker', async () => {
    const old = await makeCall(world, { status: 'answered', sessionId: 's-old', controlId: 'c-old', answeredAt: ago(20 * MIN) });
    const fresh = await makeCall(world, { status: 'answered', sessionId: 's-fresh', controlId: 'c-fresh', answeredAt: ago(20 * MIN) });
    const oldEvent = hangup('s-old');
    const freshEvent = hangup('s-fresh');
    await storeEvent(oldEvent, { receivedAt: ago(REPLAY_AFTER_MS + MIN) });
    await storeEvent(freshEvent, { receivedAt: ago(REPLAY_AFTER_MS - MIN) });

    const summary = await reconcileTelephony({ now: NOW, tenantIds: [world.tenantId] });

    expect(summary.replayed).toBe(1);
    expect((await reload(world.tenantId, old.id)).status).toBe('completed');
    expect((await reload(world.tenantId, fresh.id)).status).toBe('answered');
    expect((await eventRow(oldEvent.id)).processedAt).not.toBeNull();
    expect((await eventRow(freshEvent.id)).processedAt).toBeNull();
  });

  it('leaves exactly one activity when the worker and the cron both apply the final event', async () => {
    const call = await makeCall(world, { status: 'answered', sessionId: 's-twice', controlId: 'c-twice', answeredAt: ago(20 * MIN) });
    const spec = hangup('s-twice');
    await storeEvent(spec, { receivedAt: ago(10 * MIN) });

    await processTelephonyEvent(spec.id); // the worker
    await asSystem(() => prisma.telephonyEvent.update({ where: { providerEventId: spec.id }, data: { processedAt: null } })); // its mark was lost
    await reconcileTelephony({ now: NOW, tenantIds: [world.tenantId] }); // the cron
    await reconcileTelephony({ now: NOW, tenantIds: [world.tenantId] }); // and again

    expect(await activitiesFor(world.tenantId, call.id)).toHaveLength(1);
    expect((await reload(world.tenantId, call.id)).status).toBe('completed');
  });

  it('keeps an event with no call for now, and gives up on it after an hour', async () => {
    const young = { id: id(), type: 'call.answered', sessionId: 's-none' };
    const ancient = { id: id(), type: 'call.answered', sessionId: 's-none-2' };
    await storeEvent(young, { receivedAt: ago(ABANDON_UNMATCHED_AFTER_MS - MIN) });
    await storeEvent(ancient, { receivedAt: ago(ABANDON_UNMATCHED_AFTER_MS + MIN) });
    // The replay found no call for either (this is what leaves `no_call` on the row).
    await processTelephonyEvent(young.id);
    await processTelephonyEvent(ancient.id);

    const abandoned = await abandonUnmatchedEvents(NOW);

    expect(abandoned).toBeGreaterThanOrEqual(1);
    expect(await eventRow(young.id)).toMatchObject({ processedAt: null, lastError: 'no_call' });
    expect(await eventRow(ancient.id)).toMatchObject({ lastError: 'unmatched_abandoned' });
    expect((await eventRow(ancient.id)).processedAt).not.toBeNull();
  });

  it('does not abandon an event whose call exists, however old', async () => {
    const call = await makeCall(world, { status: 'initiated', sessionId: 's-known', controlId: 'c-known' });
    const old = { id: id(), type: 'call.answered', sessionId: 's-known' };
    await storeEvent(old, { receivedAt: ago(ABANDON_UNMATCHED_AFTER_MS + 10 * MIN) });
    await reconcileTelephony({ now: NOW, tenantIds: [world.tenantId] });
    expect((await eventRow(old.id)).lastError).toBeNull();
    expect((await reload(world.tenantId, call.id)).status).toBe('answered');
  });

  it('handles at most one batch per run', async () => {
    await makeCall(world, { status: 'answered', sessionId: 's-batch', controlId: 'c-batch' });
    await asSystem(() =>
      prisma.telephonyEvent.createMany({
        data: Array.from({ length: BATCH + 5 }, (_, i) => ({
          providerEventId: `${prefix}b${i}`,
          type: 'call.machine.detection.ended',
          sessionId: 's-batch',
          payload: { data: { id: `${prefix}b${i}`, event_type: 'call.machine.detection.ended', payload: { call_session_id: 's-batch' } } },
          receivedAt: ago(10 * MIN),
        })),
      })
    );
    const summary = await reconcileTelephony({ now: NOW, tenantIds: [world.tenantId] });
    expect(summary.replayed).toBe(BATCH);
    const left = await asSystem(() => prisma.telephonyEvent.count({ where: { providerEventId: { startsWith: `${prefix}b` }, processedAt: null } }));
    expect(left).toBe(5);
  });

  it('a tenant-scoped run replays only that tenant’s events', async () => {
    const mine = await makeCall(world, { status: 'answered', sessionId: 's-mine', controlId: 'c-mine', answeredAt: ago(20 * MIN) });
    const theirs = await makeCall(other, { status: 'answered', sessionId: 's-theirs', controlId: 'c-theirs', answeredAt: ago(20 * MIN) });
    await storeEvent(hangup('s-mine'), { receivedAt: ago(10 * MIN) });
    await storeEvent(hangup('s-theirs'), { receivedAt: ago(10 * MIN) });

    await reconcileTelephony({ now: NOW, tenantIds: [world.tenantId] });

    expect((await reload(world.tenantId, mine.id)).status).toBe('completed');
    expect((await reload(other.tenantId, theirs.id)).status).toBe('answered');
  });
});

describe('event retention', () => {
  it('deletes processed events past 30 days and keeps newer ones and any unprocessed one', async () => {
    const day = 24 * 60 * MIN;
    const old = { id: id(), type: 'call.answered', sessionId: 's-ret' };
    const recent = { id: id(), type: 'call.answered', sessionId: 's-ret' };
    const oldUnprocessed = { id: id(), type: 'call.answered', sessionId: 's-ret' };
    await storeEvent(old, { receivedAt: ago(EVENT_RETENTION_MS + day), processedAt: ago(EVENT_RETENTION_MS + day) });
    await storeEvent(recent, { receivedAt: ago(EVENT_RETENTION_MS - day), processedAt: ago(EVENT_RETENTION_MS - day) });
    await storeEvent(oldUnprocessed, { receivedAt: ago(EVENT_RETENTION_MS + day) });

    expect(await purgeOldEvents(NOW)).toBeGreaterThanOrEqual(1);

    const left = await asSystem(() => prisma.telephonyEvent.findMany({ where: { providerEventId: { startsWith: prefix } }, select: { providerEventId: true } }));
    expect(left.map((e) => e.providerEventId).sort()).toEqual([recent.id, oldUnprocessed.id].sort());
  });
});

describe('cancelling calls that never reached the provider', () => {
  it('cancels stale authorized calls without an activity, and leaves fresh ones', async () => {
    const stale = await makeCall(world, { authorizedAt: ago(STALE_AUTHORIZED_AFTER_MS + MIN) });
    const fresh = await makeCall(world, { authorizedAt: ago(STALE_AUTHORIZED_AFTER_MS - MIN) });

    const summary = await reconcileTelephony({ now: NOW, tenantIds: [world.tenantId] });

    expect(summary.canceledAuthorized).toBe(1);
    expect(await reload(world.tenantId, stale.id)).toMatchObject({ status: 'canceled', hangupCause: 'never_initiated' });
    expect((await reload(world.tenantId, fresh.id)).status).toBe('authorized');
    expect(await activitiesFor(world.tenantId, stale.id)).toHaveLength(0);
  });

  it('does not cancel a call that was claimed meanwhile, and is a no-op when repeated', async () => {
    const claimed = await makeCall(world, { status: 'initiated', authorizedAt: ago(10 * MIN), sessionId: 's-c', controlId: 'c-c' });
    await reconcileTelephony({ now: NOW, tenantIds: [world.tenantId] });
    await reconcileTelephony({ now: NOW, tenantIds: [world.tenantId] });
    expect((await reload(world.tenantId, claimed.id)).status).toBe('initiated');
  });

  it('a platform-wide run reaches every tenant it is given', async () => {
    const mine = await makeCall(world, { authorizedAt: ago(10 * MIN) });
    const theirs = await makeCall(other, { authorizedAt: ago(10 * MIN) });
    await reconcileTelephony({ now: NOW, tenantIds: [world.tenantId, other.tenantId] });
    expect((await reload(world.tenantId, mine.id)).status).toBe('canceled');
    expect((await reload(other.tenantId, theirs.id)).status).toBe('canceled');
  });

  it('a tenant-scoped run cancels only that tenant’s calls', async () => {
    const mine = await makeCall(world, { authorizedAt: ago(10 * MIN) });
    const theirs = await makeCall(other, { authorizedAt: ago(10 * MIN) });
    await reconcileTelephony({ now: NOW, tenantIds: [world.tenantId] });
    expect((await reload(world.tenantId, mine.id)).status).toBe('canceled');
    expect((await reload(other.tenantId, theirs.id)).status).toBe('authorized');
  });
});

describe('finishing calls that no webhook ended', () => {
  it('asks the provider and finishes a call it no longer has: failed when it was never answered', async () => {
    const call = await makeCall(world, { status: 'ringing', sessionId: 's-r', controlId: 'c-r', initiatedAt: ago(STUCK_RINGING_AFTER_MS + MIN) });
    const summary = await reconcileTelephony({ now: NOW, tenantIds: [world.tenantId] });
    expect(fake.callStatusChecks).toEqual(['c-r']);
    expect(summary.finalizedStuck).toBe(1);
    expect(await reload(world.tenantId, call.id)).toMatchObject({ status: 'failed', hangupCause: 'reconciled', billedDurationSec: 0 });
    expect(await activitiesFor(world.tenantId, call.id)).toHaveLength(1);
  });

  it('finishes it as completed when the stored events show it was answered', async () => {
    const call = await makeCall(world, { status: 'initiated', sessionId: 's-a', controlId: 'c-a', initiatedAt: ago(STUCK_RINGING_AFTER_MS + MIN) });
    await storeEvent({ id: id(), type: 'call.answered', sessionId: 's-a', occurredAt: ago(STUCK_RINGING_AFTER_MS) }, { processedAt: NOW });
    await reconcileTelephony({ now: NOW, tenantIds: [world.tenantId] });
    const row = await reload(world.tenantId, call.id);
    expect(row.status).toBe('completed');
    expect(row.billedDurationSec).toBe(STUCK_RINGING_AFTER_MS / 1000);
  });

  it('finishes a very long answered call the provider has dropped', async () => {
    const call = await makeCall(world, { status: 'answered', sessionId: 's-l', controlId: 'c-l', answeredAt: ago(STUCK_ANSWERED_AFTER_MS + MIN), initiatedAt: ago(STUCK_ANSWERED_AFTER_MS + 2 * MIN) });
    await reconcileTelephony({ now: NOW, tenantIds: [world.tenantId] });
    expect((await reload(world.tenantId, call.id)).status).toBe('completed');
  });

  it('leaves a call the provider still has, and one that is not old enough', async () => {
    const live = await makeCall(world, { status: 'ringing', sessionId: 's-live', controlId: 'c-live', initiatedAt: ago(STUCK_RINGING_AFTER_MS + MIN) });
    const young = await makeCall(world, { status: 'ringing', sessionId: 's-young', controlId: 'c-young', initiatedAt: ago(STUCK_RINGING_AFTER_MS - MIN) });
    fake.liveCalls.add('c-live');

    const summary = await reconcileTelephony({ now: NOW, tenantIds: [world.tenantId] });

    expect(summary.stillAlive).toBe(1);
    expect(fake.callStatusChecks).toEqual(['c-live']);
    expect((await reload(world.tenantId, live.id)).status).toBe('ringing');
    expect((await reload(world.tenantId, young.id)).status).toBe('ringing');
  });

  it('leaves the call alone and reports it when the provider cannot be asked', async () => {
    const call = await makeCall(world, { status: 'ringing', sessionId: 's-e', controlId: 'c-e', initiatedAt: ago(STUCK_RINGING_AFTER_MS + MIN) });
    fake.failNext.getCallStatus = new TelephonyProviderError('down', 503, true);
    const summary = await reconcileTelephony({ now: NOW, tenantIds: [world.tenantId] });
    expect(summary.providerUnavailable).toBe(true);
    expect((await reload(world.tenantId, call.id)).status).toBe('ringing');
  });

  it('writes the activity once however often it runs, and never touches a finished call', async () => {
    const call = await makeCall(world, { status: 'ringing', sessionId: 's-o', controlId: 'c-o', initiatedAt: ago(STUCK_RINGING_AFTER_MS + MIN) });
    await reconcileTelephony({ now: NOW, tenantIds: [world.tenantId] });
    await reconcileTelephony({ now: NOW, tenantIds: [world.tenantId] });
    expect(await activitiesFor(world.tenantId, call.id)).toHaveLength(1);
    expect(fake.callStatusChecks).toHaveLength(1);
  });

  it('a tenant-scoped run finishes only that tenant’s calls', async () => {
    const mine = await makeCall(world, { status: 'ringing', sessionId: 's-m', controlId: 'c-m', initiatedAt: ago(STUCK_RINGING_AFTER_MS + MIN) });
    const theirs = await makeCall(other, { status: 'ringing', sessionId: 's-t', controlId: 'c-t', initiatedAt: ago(STUCK_RINGING_AFTER_MS + MIN) });
    await reconcileTelephony({ now: NOW, tenantIds: [world.tenantId] });
    expect((await reload(world.tenantId, mine.id)).status).toBe('failed');
    expect((await reload(other.tenantId, theirs.id)).status).toBe('ringing');
  });
});

describe('GET /api/cron/telephony-reconcile', () => {
  const request = (authorization?: string) =>
    new NextRequest('https://crm.telestar.cloud/api/cron/telephony-reconcile', { headers: authorization ? { authorization } : {} });

  it('refuses a request without the scheduler’s secret', async () => {
    process.env.CRON_SECRET = 'cron-secret-for-telephony-test';
    const call = await makeCall(world, { authorizedAt: new Date(Date.now() - 10 * MIN) });
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request('Bearer wrong'))).status).toBe(401);
    expect((await reload(world.tenantId, call.id)).status).toBe('authorized');
  });

  it('runs the repairs for the scheduler', async () => {
    process.env.CRON_SECRET = 'cron-secret-for-telephony-test';
    const call = await makeCall(world, { authorizedAt: new Date(Date.now() - 10 * MIN) });
    const response = await GET(request('Bearer cron-secret-for-telephony-test'));
    expect(response.status).toBe(200);
    expect(reconcileSpy.calls).toEqual([{ tenantIds: null }]); // platform-wide
    expect(await response.json()).toMatchObject({ canceledAuthorized: expect.any(Number), replayed: expect.any(Number) });
    expect((await reload(world.tenantId, call.id)).status).toBe('canceled');
  });

  it('confines a signed-in manager to their own tenant', async () => {
    delete process.env.CRON_SECRET;
    const mine = await makeCall(world, { authorizedAt: new Date(Date.now() - 10 * MIN) });
    const theirs = await makeCall(other, { authorizedAt: new Date(Date.now() - 10 * MIN) });
    authMock.mockResolvedValue({ user: { id: world.repId, role: 'director', tenantId: world.tenantId } });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(reconcileSpy.calls).toEqual([{ tenantIds: [world.tenantId] }]);
    expect((await reload(world.tenantId, mine.id)).status).toBe('canceled');
    expect((await reload(other.tenantId, theirs.id)).status).toBe('authorized');
  });

  it('refuses a signed-in rep', async () => {
    delete process.env.CRON_SECRET;
    authMock.mockResolvedValue({ user: { id: world.repId, role: 'sdr', tenantId: world.tenantId } });
    expect((await GET(request())).status).toBe(401);
  });
});
