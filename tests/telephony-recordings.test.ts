import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import { processTelephonyEvent } from '@/lib/telephony/applyEvent';
import { FakeTelephonyProvider } from '@/lib/telephony/fake';
import { setTelephonyProviderForTests } from '@/lib/telephony/index';
import { legClientState } from '@/lib/telephony/legMarker';
import { TelephonyProviderError } from '@/lib/telephony/provider';
import { RECORDING_NOTICE_TEXT, RECORDING_PURGE_BATCH, purgeExpiredRecordings, recordingPurgeAt } from '@/lib/telephony/recording';
import { reconcileTelephony } from '@/lib/telephony/reconcile';
import { createTestTenant } from './helpers/testTenant';
import { buildDialerWorld, deleteEventsWithPrefix, inTenant, makeCall, reload, storeEvent, type DialerWorld } from './helpers/telephonyFixture';

/**
 * Phase 7 (docs/dialer/TASKS.md D7.1, D7.3): recording starts on the lead's leg when enabled, the
 * notice plays only when asked for, the saved file gets a purge date, and expired files are deleted.
 */

const DAY = 24 * 60 * 60_000;
const NOW = new Date('2026-10-10T06:00:00Z');

let fake: FakeTelephonyProvider;
let world: DialerWorld;
let prefix: string;
let counter = 0;
const id = () => `${prefix}${(counter += 1)}`;

const setSettings = (data: { recordingEnabled?: boolean; recordingNotice?: boolean; recordingRetentionDays?: number }) =>
  inTenant(world.tenantId, () => prisma.telephonySettings.updateMany({ where: { tenantId: world.tenantId }, data }));

const answeredOnLeadLeg = async (session: string, control = 'lead-leg') => {
  const spec = { id: id(), type: 'call.answered', sessionId: session, controlId: control, direction: 'outgoing' as const };
  await storeEvent(spec);
  return spec;
};

beforeEach(async () => {
  prefix = `evt-rec-${randomUUID()}-`;
  counter = 0;
  fake = new FakeTelephonyProvider();
  setTelephonyProviderForTests(fake);
  world = await buildDialerWorld(await createTestTenant(`t-telrec-${randomUUID()}`, 'Recordings'));
});

afterEach(async () => {
  setTelephonyProviderForTests(null);
  await deleteEventsWithPrefix(prefix);
});

describe('starting a recording', () => {
  it('records the lead leg when recording is enabled, and plays no notice by default', async () => {
    const call = await makeCall(world, { status: 'ringing', sessionId: 's1', controlId: 'rep-leg', initiatedAt: new Date() });
    const spec = await answeredOnLeadLeg('s1');

    await processTelephonyEvent(spec.id);

    expect(fake.commands).toEqual([
      { callControlId: 'lead-leg', command: { action: 'record_start', channels: 'dual', playBeep: false }, commandId: `record:${call.id}` },
    ]);
  });

  it('plays the notice after starting the recording when recordingNotice is on', async () => {
    const call = await makeCall(world, { status: 'ringing', sessionId: 's2', controlId: 'rep-leg', initiatedAt: new Date() });
    await setSettings({ recordingNotice: true });

    await processTelephonyEvent((await answeredOnLeadLeg('s2')).id);

    expect(fake.commands.map((c) => [c.callControlId, c.command.action, c.commandId])).toEqual([
      ['lead-leg', 'record_start', `record:${call.id}`],
      ['lead-leg', 'speak', `notice:${call.id}`],
    ]);
    expect(fake.commands[1].command).toEqual({ action: 'speak', payload: RECORDING_NOTICE_TEXT });
  });

  it('records nothing when recording is disabled', async () => {
    await makeCall(world, { status: 'ringing', sessionId: 's3', controlId: 'rep-leg', initiatedAt: new Date() });
    await setSettings({ recordingEnabled: false, recordingNotice: true });

    await processTelephonyEvent((await answeredOnLeadLeg('s3')).id);

    expect(fake.commands).toEqual([]);
  });

  it('does not record the rep leg', async () => {
    await makeCall(world, { status: 'ringing', sessionId: 's4', controlId: 'rep-leg', initiatedAt: new Date() });
    const spec = { id: id(), type: 'call.answered', sessionId: 's4', controlId: 'rep-leg', direction: 'incoming' as const };
    await storeEvent(spec);

    await processTelephonyEvent(spec.id);

    expect(fake.commands).toEqual([]);
  });

  it('recognises the lead leg by its mark when the event carries no direction', async () => {
    const call = await makeCall(world, { status: 'ringing', sessionId: 's5', controlId: 'rep-leg', initiatedAt: new Date() });
    const spec = { id: id(), type: 'call.bridged', sessionId: 's5', controlId: 'lead-leg', clientState: legClientState(call.id) };
    await storeEvent(spec);

    await processTelephonyEvent(spec.id);

    expect(fake.commands.map((c) => c.command.action)).toEqual(['record_start']);
  });

  it('issues the same command ids when answered, bridged and a redelivery all arrive', async () => {
    const call = await makeCall(world, { status: 'ringing', sessionId: 's6', controlId: 'rep-leg', initiatedAt: new Date() });
    await setSettings({ recordingNotice: true });
    const answered = await answeredOnLeadLeg('s6');
    const bridged = { id: id(), type: 'call.bridged', sessionId: 's6', controlId: 'lead-leg', direction: 'outgoing' as const };
    await storeEvent(bridged);

    await processTelephonyEvent(answered.id);
    await processTelephonyEvent(answered.id); // redelivered: already processed
    await processTelephonyEvent(bridged.id);

    const ids = fake.commands.map((c) => c.commandId);
    expect(new Set(ids)).toEqual(new Set([`record:${call.id}`, `notice:${call.id}`]));
    expect(ids).toHaveLength(4); // the provider dedupes the repeats by command id
  });

  it('keeps the call going when the provider refuses to record', async () => {
    const call = await makeCall(world, { status: 'ringing', sessionId: 's7', controlId: 'rep-leg', initiatedAt: new Date() });
    fake.failNext.command = new TelephonyProviderError('refused', 422, false);

    await processTelephonyEvent((await answeredOnLeadLeg('s7')).id);

    expect((await reload(world.tenantId, call.id)).status).toBe('answered');
  });

  it('retries the event when the result of the record command is unknown', async () => {
    const call = await makeCall(world, { status: 'ringing', sessionId: 's8', controlId: 'rep-leg', initiatedAt: new Date() });
    const spec = await answeredOnLeadLeg('s8');
    fake.failNext.command = new TelephonyProviderError('timeout', null, true);

    await expect(processTelephonyEvent(spec.id)).rejects.toThrow();
    expect(await processTelephonyEvent(spec.id)).toBe('applied');

    expect(fake.commands.map((c) => c.commandId)).toEqual([`record:${call.id}`]);
  });
});

describe('call.recording.saved', () => {
  const saved = async (session: string, recordingId: string, occurredAt = NOW) => {
    const spec = { id: id(), type: 'call.recording.saved', sessionId: session, controlId: 'lead-leg', recordingId, occurredAt };
    await storeEvent(spec);
    return spec;
  };

  it('stores the recording id and a purge date from the tenant retention', async () => {
    const call = await makeCall(world, { status: 'answered', sessionId: 'sv1', controlId: 'rep-leg' });
    await setSettings({ recordingRetentionDays: 30 });

    await processTelephonyEvent((await saved('sv1', 'rec-1')).id);

    const row = await reload(world.tenantId, call.id);
    expect(row.recordingProviderId).toBe('rec-1');
    expect(row.recordingPurgeAt).toEqual(new Date(NOW.getTime() + 30 * DAY));
  });

  it('uses 90 days by default and keeps the first recording on a second event', async () => {
    const call = await makeCall(world, { status: 'answered', sessionId: 'sv2', controlId: 'rep-leg' });

    await processTelephonyEvent((await saved('sv2', 'rec-a')).id);
    await processTelephonyEvent((await saved('sv2', 'rec-b', new Date(NOW.getTime() + DAY))).id);

    const row = await reload(world.tenantId, call.id);
    expect(row.recordingProviderId).toBe('rec-a');
    expect(row.recordingPurgeAt).toEqual(new Date(NOW.getTime() + 90 * DAY));
  });

  it('falls back to 90 days for an out-of-range retention', () => {
    expect(recordingPurgeAt(NOW, 0)).toEqual(new Date(NOW.getTime() + 90 * DAY));
    expect(recordingPurgeAt(NOW, 100_000)).toEqual(new Date(NOW.getTime() + 90 * DAY));
    expect(recordingPurgeAt(NOW, 1)).toEqual(new Date(NOW.getTime() + DAY));
  });
});

describe('purging expired recordings', () => {
  const recorded = async (recordingId: string, purgeAt: Date | null) => {
    const call = await makeCall(world, { status: 'completed', sessionId: `p-${recordingId}`, controlId: `c-${recordingId}` });
    await inTenant(world.tenantId, () =>
      prisma.call.updateMany({ where: { id: call.id }, data: { recordingProviderId: recordingId, recordingPurgeAt: purgeAt } })
    );
    return call;
  };

  it('keeps day 89 and deletes day 90', async () => {
    const savedAt = new Date('2026-07-12T06:00:00Z');
    const purgeAt = recordingPurgeAt(savedAt, 90);
    const call = await recorded('rec-day', purgeAt);

    const dayBefore = await purgeExpiredRecordings({ now: new Date(purgeAt.getTime() - 1), tenantIds: [world.tenantId] });
    expect(dayBefore.deleted).toBe(0);
    expect((await reload(world.tenantId, call.id)).recordingProviderId).toBe('rec-day');

    const onTheDay = await purgeExpiredRecordings({ now: purgeAt, tenantIds: [world.tenantId] });
    expect(onTheDay.deleted).toBe(1);
    expect(fake.deletedRecordings).toEqual(['rec-day']);
    expect((await reload(world.tenantId, call.id)).recordingProviderId).toBeNull();
  });

  it('is idempotent: a second run deletes nothing more', async () => {
    await recorded('rec-once', new Date(NOW.getTime() - DAY));

    await purgeExpiredRecordings({ now: NOW, tenantIds: [world.tenantId] });
    const again = await purgeExpiredRecordings({ now: NOW, tenantIds: [world.tenantId] });

    expect(again).toEqual({ deleted: 0, failed: 0 });
    expect(fake.deletedRecordings).toEqual(['rec-once']);
  });

  it('counts a provider 404 as deleted', async () => {
    const call = await recorded('rec-gone', new Date(NOW.getTime() - DAY));
    fake.failNext.deleteRecording = new TelephonyProviderError('not found', 404, false);

    const summary = await purgeExpiredRecordings({ now: NOW, tenantIds: [world.tenantId] });

    expect(summary).toEqual({ deleted: 1, failed: 0 });
    expect((await reload(world.tenantId, call.id)).recordingProviderId).toBeNull();
  });

  it('keeps the recording for the next run when the provider fails', async () => {
    const call = await recorded('rec-down', new Date(NOW.getTime() - DAY));
    fake.failNext.deleteRecording = new TelephonyProviderError('boom', 503, true);

    const summary = await purgeExpiredRecordings({ now: NOW, tenantIds: [world.tenantId] });

    expect(summary).toEqual({ deleted: 0, failed: 1 });
    expect((await reload(world.tenantId, call.id)).recordingProviderId).toBe('rec-down');
    expect((await purgeExpiredRecordings({ now: NOW, tenantIds: [world.tenantId] })).deleted).toBe(1);
  });

  it('leaves calls without a purge date alone and stays inside the tenant scope', async () => {
    const other = await buildDialerWorld(await createTestTenant(`t-telrec-o-${randomUUID()}`, 'Recordings other'));
    await recorded('rec-nodate', null);
    const foreign = await makeCall(other, { status: 'completed', sessionId: 'p-foreign', controlId: 'c-foreign' });
    await inTenant(other.tenantId, () =>
      prisma.call.updateMany({ where: { id: foreign.id }, data: { recordingProviderId: 'rec-foreign', recordingPurgeAt: new Date(NOW.getTime() - DAY) } })
    );

    const summary = await purgeExpiredRecordings({ now: NOW, tenantIds: [world.tenantId] });

    expect(summary.deleted).toBe(0);
    expect(fake.deletedRecordings).toEqual([]);
  });

  it('deletes at most one batch per run', async () => {
    const overdue = new Date(NOW.getTime() - DAY);
    await inTenant(world.tenantId, () =>
      prisma.call.createMany({
        data: Array.from({ length: RECORDING_PURGE_BATCH + 3 }, (_, i) => ({
          tenantId: world.tenantId,
          direction: 'outbound' as const,
          status: 'completed' as const,
          toE164: world.toE164,
          recordingProviderId: `bulk-${i}`,
          recordingPurgeAt: overdue,
        })),
      })
    );

    const first = await purgeExpiredRecordings({ now: NOW, tenantIds: [world.tenantId] });
    const second = await purgeExpiredRecordings({ now: NOW, tenantIds: [world.tenantId] });

    expect(first.deleted).toBe(RECORDING_PURGE_BATCH);
    expect(second.deleted).toBe(3);
  });

  it('runs as part of the reconcile cron', async () => {
    const call = await recorded('rec-cron', new Date(NOW.getTime() - DAY));

    const summary = await reconcileTelephony({ now: NOW, tenantIds: [world.tenantId] });

    expect(summary.purgedRecordings).toBe(1);
    expect((await reload(world.tenantId, call.id)).recordingProviderId).toBeNull();
  });
});
