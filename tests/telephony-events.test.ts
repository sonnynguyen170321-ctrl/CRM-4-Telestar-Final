import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { processTelephonyEvent } from '@/lib/telephony/applyEvent';
import { canAdvance, finalStatusFor, isTerminalStatus, statusesBefore } from '@/lib/telephony/callStatus';
import { legClientState } from '@/lib/telephony/legMarker';
import { createTestTenant } from './helpers/testTenant';
import {
  activitiesFor,
  asSystem,
  buildDialerWorld,
  deleteEventsWithPrefix,
  inTenant,
  makeCall,
  reload,
  storeEvent,
  type DialerWorld,
  type EventSpec,
} from './helpers/telephonyFixture';

/**
 * Applying stored provider events to calls (docs/dialer/TASKS.md D4.3), against a real database.
 *
 * Status only moves forward; a replay, a redelivery under a new event id and the reconcile cron all
 * converge on a single `call_made` Activity; the tenant is the call's own.
 */

let world: DialerWorld;
let other: DialerWorld;
let prefix: string;
let counter = 0;
const id = () => `${prefix}${(counter += 1)}`;
const T0 = new Date('2026-10-05T03:00:00Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

async function liveCall(status: 'initiated' | 'ringing' | 'answered' = 'initiated', w = world) {
  const sessionId = `sess-${randomUUID()}`;
  const call = await makeCall(w, { status, sessionId, controlId: `ctl-${randomUUID()}`, initiatedAt: at(0) });
  return { call, sessionId };
}

const ev = (sessionId: string, spec: Partial<EventSpec> & { type: string }): EventSpec => ({ id: id(), sessionId, controlId: `leg-${randomUUID()}`, ...spec });

async function run(spec: EventSpec) {
  await storeEvent(spec);
  return processTelephonyEvent(spec.id);
}

beforeEach(async () => {
  prefix = `evt-ap-${randomUUID()}-`;
  counter = 0;
  world = await buildDialerWorld(await createTestTenant(`t-telap-${randomUUID()}`, 'Events'));
  other = await buildDialerWorld(await createTestTenant(`t-telap-o-${randomUUID()}`, 'Events other'));
});

afterEach(async () => {
  await deleteEventsWithPrefix(prefix);
});

describe('call status rules', () => {
  it('moves forward only', () => {
    expect(canAdvance('initiated', 'ringing')).toBe(true);
    expect(canAdvance('ringing', 'answered')).toBe(true);
    expect(canAdvance('initiated', 'answered')).toBe(true);
    expect(canAdvance('answered', 'ringing')).toBe(false);
    expect(canAdvance('ringing', 'initiated')).toBe(false);
    expect(canAdvance('ringing', 'ringing')).toBe(false);
    expect(canAdvance('answered', 'completed')).toBe(true);
  });

  it('never moves a finished call', () => {
    for (const done of ['completed', 'no_answer', 'busy', 'failed', 'canceled', 'blocked', 'missed'] as const) {
      expect(isTerminalStatus(done)).toBe(true);
      expect(canAdvance(done, 'answered')).toBe(false);
      expect(canAdvance(done, 'failed')).toBe(false);
    }
  });

  it('lists the statuses a guarded move may start from', () => {
    expect(statusesBefore('ringing')).toEqual(['authorized', 'initiated']);
    expect(statusesBefore('answered')).toEqual(['authorized', 'initiated', 'ringing']);
    expect(statusesBefore('completed')).toEqual(['authorized', 'initiated', 'ringing', 'answered']);
  });

  it('classifies how a call ended', () => {
    expect(finalStatusFor({ answered: true, hangupCause: 'user_busy' })).toBe('completed');
    expect(finalStatusFor({ answered: false, hangupCause: 'user_busy' })).toBe('busy');
    expect(finalStatusFor({ answered: false, hangupCause: 'timeout' })).toBe('no_answer');
    expect(finalStatusFor({ answered: false, hangupCause: 'NO_ANSWER' })).toBe('no_answer');
    expect(finalStatusFor({ answered: false, hangupCause: 'originator_cancel' })).toBe('canceled');
    expect(finalStatusFor({ answered: false, hangupCause: 'normal_clearing' })).toBe('canceled');
    expect(finalStatusFor({ answered: false, hangupCause: 'call_rejected' })).toBe('failed');
    expect(finalStatusFor({ answered: false, hangupCause: null })).toBe('failed');
  });
});

describe('applying events to a call', () => {
  it('walks a normal call to completed and records its timing, cause and duration', async () => {
    const { call, sessionId } = await liveCall();
    await run(ev(sessionId, { type: 'call.initiated', direction: 'outgoing', clientState: legClientState(call.id), occurredAt: at(1) }));
    expect((await reload(world.tenantId, call.id)).status).toBe('ringing');

    await run(ev(sessionId, { type: 'call.answered', occurredAt: at(10) }));
    const answered = await reload(world.tenantId, call.id);
    expect(answered.status).toBe('answered');
    expect(answered.answeredAt?.toISOString()).toBe(at(10).toISOString());

    await run(ev(sessionId, { type: 'call.hangup', direction: 'outgoing', hangupCause: 'normal_clearing', occurredAt: at(75), endTime: at(75) }));
    const done = await reload(world.tenantId, call.id);
    expect(done).toMatchObject({ status: 'completed', hangupCause: 'normal_clearing', billedDurationSec: 65 });
    expect(done.endedAt?.toISOString()).toBe(at(75).toISOString());
  });

  it('ends an unanswered call by its hangup cause', async () => {
    for (const [cause, expected] of [['user_busy', 'busy'], ['timeout', 'no_answer'], ['originator_cancel', 'canceled'], ['call_rejected', 'failed']] as const) {
      const { call, sessionId } = await liveCall('ringing');
      await run(ev(sessionId, { type: 'call.hangup', direction: 'outgoing', hangupCause: cause, occurredAt: at(30) }));
      expect(await reload(world.tenantId, call.id)).toMatchObject({ status: expected, hangupCause: cause, billedDurationSec: 0 });
    }
  });

  it('keeps forward-only status when events arrive late or out of order', async () => {
    const { call, sessionId } = await liveCall();
    await run(ev(sessionId, { type: 'call.answered', occurredAt: at(10) }));
    // The "ringing" leg event reaches us after the call was already answered.
    await run(ev(sessionId, { type: 'call.initiated', direction: 'outgoing', clientState: legClientState(call.id), occurredAt: at(1) }));
    expect((await reload(world.tenantId, call.id)).status).toBe('answered');

    await run(ev(sessionId, { type: 'call.hangup', direction: 'outgoing', hangupCause: 'normal_clearing', occurredAt: at(60) }));
    expect((await reload(world.tenantId, call.id)).status).toBe('completed');

    // Late events after the end change neither status nor the recorded end.
    await run(ev(sessionId, { type: 'call.answered', occurredAt: at(11) }));
    await run(ev(sessionId, { type: 'call.hangup', direction: 'incoming', hangupCause: 'originator_cancel', occurredAt: at(99) }));
    const row = await reload(world.tenantId, call.id);
    expect(row).toMatchObject({ status: 'completed', hangupCause: 'normal_clearing' });
    expect(row.endedAt?.toISOString()).toBe(at(60).toISOString());
  });

  it('counts a call answered even when its hangup is processed before the answered event', async () => {
    const { call, sessionId } = await liveCall();
    const answered = ev(sessionId, { type: 'call.answered', occurredAt: at(5) });
    await storeEvent(answered); // received, not yet processed
    await run(ev(sessionId, { type: 'call.hangup', direction: 'outgoing', hangupCause: 'normal_clearing', occurredAt: at(45) }));
    expect(await reload(world.tenantId, call.id)).toMatchObject({ status: 'completed', billedDurationSec: 40 });
    await processTelephonyEvent(answered.id);
    expect((await reload(world.tenantId, call.id)).status).toBe('completed');
  });

  it('prefers the lead’s leg for why the call ended', async () => {
    const { call, sessionId } = await liveCall('ringing');
    await storeEvent(ev(sessionId, { type: 'call.hangup', direction: 'incoming', hangupCause: 'normal_clearing', occurredAt: at(20) }));
    await run(ev(sessionId, { type: 'call.hangup', direction: 'outgoing', hangupCause: 'user_busy', occurredAt: at(20) }));
    expect(await reload(world.tenantId, call.id)).toMatchObject({ status: 'busy', hangupCause: 'user_busy' });
  });

  it('stores a recording id once and keeps the first', async () => {
    const { call, sessionId } = await liveCall('answered');
    await run(ev(sessionId, { type: 'call.recording.saved', recordingId: 'rec-1' }));
    await run(ev(sessionId, { type: 'call.recording.saved', recordingId: 'rec-2' }));
    expect((await reload(world.tenantId, call.id)).recordingProviderId).toBe('rec-1');
  });

  it('marks events it does not act on as processed', async () => {
    const { sessionId } = await liveCall();
    const spec = ev(sessionId, { type: 'call.machine.detection.ended' });
    expect(await run(spec)).toBe('applied');
    const row = await asSystem(() => prisma.telephonyEvent.findUniqueOrThrow({ where: { providerEventId: spec.id } }));
    expect(row.processedAt).not.toBeNull();
  });

  it('leaves an event for a call it does not know unprocessed, with the reason', async () => {
    const spec = ev('sess-unknown', { type: 'call.answered' });
    expect(await run(spec)).toBe('unmatched');
    const row = await asSystem(() => prisma.telephonyEvent.findUniqueOrThrow({ where: { providerEventId: spec.id } }));
    expect(row).toMatchObject({ processedAt: null, attempts: 1, lastError: 'no_call' });
  });

  it('correlates by control id when the session id is missing', async () => {
    const { call } = await liveCall();
    const full = await reload(world.tenantId, call.id);
    await run({ id: id(), type: 'call.answered', controlId: full.providerControlId, occurredAt: at(3) });
    expect((await reload(world.tenantId, call.id)).status).toBe('answered');
  });

  it('is a no-op when the same event is processed again', async () => {
    const { sessionId } = await liveCall();
    const spec = ev(sessionId, { type: 'call.answered' });
    expect(await run(spec)).toBe('applied');
    expect(await processTelephonyEvent(spec.id)).toBe('already_processed');
    expect(await processTelephonyEvent(`${prefix}nope`)).toBe('missing');
  });

  it('never touches another tenant’s call', async () => {
    const mine = await liveCall();
    const theirs = await liveCall('initiated', other);
    await run(ev(mine.sessionId, { type: 'call.hangup', direction: 'outgoing', hangupCause: 'timeout', occurredAt: at(30) }));
    expect((await reload(world.tenantId, mine.call.id)).status).toBe('no_answer');
    expect((await reload(other.tenantId, theirs.call.id)).status).toBe('initiated');
    expect(await activitiesFor(other.tenantId, theirs.call.id)).toHaveLength(0);
  });
});

describe('the call_made activity', () => {
  const finish = async (sessionId: string, eventId = id(), cause = 'normal_clearing') =>
    run({ id: eventId, type: 'call.hangup', sessionId, controlId: `leg-${randomUUID()}`, direction: 'outgoing', hangupCause: cause, occurredAt: at(90) });

  it('is written once for a finished call, linked to it, and credits the rep and the lead', async () => {
    const { call, sessionId } = await liveCall('answered');
    await inTenant(world.tenantId, () => prisma.call.update({ where: { id: call.id }, data: { answeredAt: at(10) } }));
    await finish(sessionId);

    const row = await reload(world.tenantId, call.id);
    const activities = await activitiesFor(world.tenantId, call.id);
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({ type: 'call_made', channel: 'phone', userId: world.repId, leadId: world.leadId, tenantId: world.tenantId });
    expect(activities[0].metadata).toMatchObject({ callId: call.id, status: 'completed', durationSec: 80 });
    expect(row.activityId).toBe(activities[0].id);
    const lead = await inTenant(world.tenantId, () => prisma.lead.findUniqueOrThrow({ where: { id: world.leadId } }));
    expect(lead.lastContactedAt?.toISOString()).toBe(at(90).toISOString());
  });

  it('is written once however often the final event is delivered', async () => {
    const { call, sessionId } = await liveCall('answered');
    await finish(sessionId, `${prefix}a`);
    await finish(sessionId, `${prefix}b`); // the other leg's hangup, a different event id
    await asSystem(() => prisma.telephonyEvent.updateMany({ where: { providerEventId: `${prefix}a` }, data: { processedAt: null } }));
    await processTelephonyEvent(`${prefix}a`); // replayed
    expect(await activitiesFor(world.tenantId, call.id)).toHaveLength(1);
  });

  it('is written once when the same final event is processed concurrently', async () => {
    const { call, sessionId } = await liveCall('answered');
    const spec = ev(sessionId, { type: 'call.hangup', direction: 'outgoing', hangupCause: 'normal_clearing', occurredAt: at(50) });
    const other2 = ev(sessionId, { type: 'call.hangup', direction: 'incoming', hangupCause: 'normal_clearing', occurredAt: at(50) });
    await Promise.all([storeEvent(spec), storeEvent(other2)]);
    await Promise.all([processTelephonyEvent(spec.id), processTelephonyEvent(other2.id), processTelephonyEvent(spec.id)]);
    expect(await activitiesFor(world.tenantId, call.id)).toHaveLength(1);
    expect((await reload(world.tenantId, call.id)).activityId).not.toBeNull();
  });

  it('repairs a call that finished but lost its activity when the final event is replayed', async () => {
    const { call, sessionId } = await liveCall('answered');
    await finish(sessionId, `${prefix}a`);
    await inTenant(world.tenantId, async () => {
      await prisma.call.update({ where: { id: call.id }, data: { activityId: null } });
      await prisma.activity.deleteMany({ where: { idempotencyKey: `call:${call.id}:final` } });
    });
    await asSystem(() => prisma.telephonyEvent.updateMany({ where: { providerEventId: `${prefix}a` }, data: { processedAt: null } }));
    await processTelephonyEvent(`${prefix}a`);
    expect(await activitiesFor(world.tenantId, call.id)).toHaveLength(1);
  });

  it('links an activity that already exists under the key instead of failing', async () => {
    const { call, sessionId } = await liveCall('answered');
    await inTenant(world.tenantId, () =>
      prisma.activity.create({ data: { tenantId: world.tenantId, userId: world.repId, leadId: world.leadId, type: 'call_made', idempotencyKey: `call:${call.id}:final` } })
    );
    await finish(sessionId);
    expect(await activitiesFor(world.tenantId, call.id)).toHaveLength(1);
    expect((await reload(world.tenantId, call.id)).activityId).not.toBeNull();
  });

  it('does not move the lead’s last-contacted date backwards', async () => {
    const later = new Date('2027-01-01T00:00:00Z');
    await inTenant(world.tenantId, () => prisma.lead.update({ where: { id: world.leadId }, data: { lastContactedAt: later } }));
    const { sessionId } = await liveCall('answered');
    await finish(sessionId);
    const lead = await inTenant(world.tenantId, () => prisma.lead.findUniqueOrThrow({ where: { id: world.leadId } }));
    expect(lead.lastContactedAt?.toISOString()).toBe(later.toISOString());
  });

  it('is not written for a call the provider was never asked to place', async () => {
    const sessionId = `sess-${randomUUID()}`;
    const blocked = await makeCall(world, { status: 'blocked', sessionId, initiatedAt: null });
    await finish(sessionId);
    expect(await activitiesFor(world.tenantId, blocked.id)).toHaveLength(0);
    expect((await reload(world.tenantId, blocked.id)).status).toBe('blocked');
  });

  it('lands in the call’s own tenant', async () => {
    const mine = await liveCall('answered');
    await finish(mine.sessionId);
    const rows = await asSystem(() => prisma.activity.findMany({ where: { idempotencyKey: `call:${mine.call.id}:final` } }));
    expect(rows.map((r) => r.tenantId)).toEqual([world.tenantId]);
  });
});
