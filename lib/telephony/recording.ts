import { prisma, tenantStorage } from '@/lib/prisma';

import { getTelephonyProvider } from './index';
import { legCallId } from './legMarker';
import { TelephonyProviderError } from './provider';
import { safeError } from './safeError';
import type { TelnyxEvent } from './telnyx/events';

/**
 * Call recordings (docs/dialer/TASKS.md Phase 7). Worker-safe: no session or route code in here.
 *
 *   - start: when the lead's leg answers, `record_start` on that leg (dual channel, so both voices
 *     are on the file), then the spoken notice when the tenant turned it on. The recording is started
 *     first so the notice is part of what was recorded. Both commands carry a stable `command_id`, and
 *     what was accepted is kept on the Call, so a replay never records or speaks twice.
 *   - saved: `recordingPurgeAt` is set from the tenant's retention when the provider reports the file.
 *   - purge: files past `recordingPurgeAt` are deleted at the provider, then forgotten here.
 */

/** Spoken to the lead when `TelephonySettings.recordingNotice` is on. Vietnam is never dialled, so English only. */
export const RECORDING_NOTICE_TEXT = 'This call may be recorded for quality and training purposes.';

export const DEFAULT_RETENTION_DAYS = 90;
const MAX_RETENTION_DAYS = 3650;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Recordings deleted (and purge dates backfilled) per purge run. */
export const RECORDING_PURGE_BATCH = 100;
/** A failed delete is not retried for this long, so rows that keep failing cannot starve the ones behind them. */
export const PURGE_RETRY_BACKOFF_MS = 30 * 60_000;

const asSystem = <T>(fn: () => Promise<T>) => tenantStorage.run({ tenantId: 'system', bypassRls: true }, fn);

export function retentionDaysOf(value: number | null | undefined): number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_RETENTION_DAYS ? (value as number) : DEFAULT_RETENTION_DAYS;
}

export function recordingPurgeAt(from: Date, retentionDays: number): Date {
  return new Date(from.getTime() + retentionDaysOf(retentionDays) * DAY_MS);
}

/** The tenant's recording settings; the schema defaults when no settings row exists. Call inside the tenant's scope. */
export async function loadRecordingSettings(tenantId: string) {
  const row = await prisma.telephonySettings.findFirst({
    where: { tenantId },
    select: { recordingEnabled: true, recordingNotice: true, recordingRetentionDays: true },
  });
  return {
    recordingEnabled: row?.recordingEnabled ?? true,
    recordingNotice: row?.recordingNotice ?? false,
    recordingRetentionDays: retentionDaysOf(row?.recordingRetentionDays),
  };
}

/** Is this the lead's leg - the one we created with the transfer? Decided by our mark or the stored leg id, never by direction. */
export function isLeadLegEvent(
  event: Pick<TelnyxEvent, 'controlId' | 'clientState'>,
  callId: string,
  storedLeadLegControlId: string | null
): boolean {
  if (legCallId(event.clientState) === callId) return true;
  return storedLeadLegControlId !== null && event.controlId !== null && event.controlId === storedLeadLegControlId;
}

/** Remember the lead's leg from the first event that carries our mark, so later events without it still resolve. */
export async function noteLeadLeg(call: { id: string; tenantId: string }, event: Pick<TelnyxEvent, 'controlId' | 'clientState'>): Promise<void> {
  if (!event.controlId || legCallId(event.clientState) !== call.id) return;
  await prisma.call.updateMany({ where: { id: call.id, tenantId: call.tenantId, leadLegControlId: null }, data: { leadLegControlId: event.controlId } });
}

/**
 * Start recording (and play the notice) on the lead's leg once it answers. Best effort for the call:
 * a refused command is logged and the call carries on unrecorded; a command whose result is unknown
 * (timeout, 5xx) throws so the event is retried, which `command_id` makes safe.
 *
 * What was already accepted is kept on the Call (`recordingStartedAt`, `recordingNoticeAt`), so a late
 * replay never records or speaks twice, and a refused `record_start` (for instance "already recording"
 * after a partial success) does not stop the notice from playing once.
 */
export async function startRecordingOnAnswer(call: { id: string; tenantId: string }, event: TelnyxEvent): Promise<'started' | 'skipped'> {
  if (!event.controlId) return 'skipped';
  const row = await prisma.call.findFirst({
    where: { id: call.id, tenantId: call.tenantId },
    select: { leadLegControlId: true, recordingStartedAt: true, recordingNoticeAt: true },
  });
  if (!row || !isLeadLegEvent(event, call.id, row.leadLegControlId)) return 'skipped';
  await noteLeadLeg(call, event);
  const settings = await loadRecordingSettings(call.tenantId);
  if (!settings.recordingEnabled) return 'skipped';

  const provider = getTelephonyProvider();
  const markStarted = () =>
    prisma.call.updateMany({ where: { id: call.id, tenantId: call.tenantId, recordingStartedAt: null }, data: { recordingStartedAt: new Date() } });
  const markNoticed = () =>
    prisma.call.updateMany({ where: { id: call.id, tenantId: call.tenantId, recordingNoticeAt: null }, data: { recordingNoticeAt: new Date() } });
  let started = row.recordingStartedAt !== null;

  if (!started) {
    try {
      await provider.command(event.controlId, { action: 'record_start', channels: 'dual', playBeep: false }, `record:${call.id}`);
      await markStarted();
      started = true;
    } catch (error) {
      if (error instanceof TelephonyProviderError && error.retryable) throw error;
      console.error('[telephony] could not start recording', { callId: call.id, error: safeError(error) });
    }
  }

  if (settings.recordingNotice && row.recordingNoticeAt === null) {
    try {
      await provider.command(event.controlId, { action: 'speak', payload: RECORDING_NOTICE_TEXT }, `notice:${call.id}`);
      await markNoticed();
    } catch (error) {
      if (error instanceof TelephonyProviderError && error.retryable) throw error;
      console.error('[telephony] could not play the recording notice', { callId: call.id, error: safeError(error) });
    }
  }
  return started ? 'started' : 'skipped';
}

/**
 * The provider saved the file: remember it and when it must go. Only the first recording id sticks, and a
 * row that has an id but no purge date (an older path) always gets one.
 */
export async function storeSavedRecording(call: { id: string; tenantId: string }, recordingId: string, savedAt: Date): Promise<void> {
  const settings = await loadRecordingSettings(call.tenantId);
  const purgeAt = recordingPurgeAt(savedAt, settings.recordingRetentionDays);
  await prisma.call.updateMany({
    where: { id: call.id, tenantId: call.tenantId, recordingProviderId: null },
    data: { recordingProviderId: recordingId, recordingPurgeAt: purgeAt },
  });
  await prisma.call.updateMany({
    where: { id: call.id, tenantId: call.tenantId, recordingProviderId: { not: null }, recordingPurgeAt: null },
    data: { recordingPurgeAt: purgeAt },
  });
}

export type PurgeSummary = { deleted: number; failed: number; backfilled: number };

/**
 * Recordings that have an id but no purge date (written by an older path) would never be purged. Give
 * each one a date from when its call ended (or was created) plus its tenant's retention.
 */
async function backfillMissingPurgeDates(tenantIds: string[] | null): Promise<number> {
  const rows = await asSystem(() =>
    prisma.call.findMany({
      where: { recordingProviderId: { not: null }, recordingPurgeAt: null, ...(tenantIds ? { tenantId: { in: tenantIds } } : {}) },
      orderBy: { createdAt: 'asc' },
      take: RECORDING_PURGE_BATCH,
      select: { id: true, tenantId: true, endedAt: true, createdAt: true },
    })
  );
  let filled = 0;
  for (const row of rows) {
    await tenantStorage.run({ tenantId: row.tenantId }, async () => {
      const settings = await loadRecordingSettings(row.tenantId);
      const moved = await prisma.call.updateMany({
        where: { id: row.id, tenantId: row.tenantId, recordingProviderId: { not: null }, recordingPurgeAt: null },
        data: { recordingPurgeAt: recordingPurgeAt(row.endedAt ?? row.createdAt, settings.recordingRetentionDays) },
      });
      filled += moved.count;
    });
  }
  return filled;
}

/**
 * Delete recordings whose retention ended. Bounded; safe to repeat and to run concurrently (the id is
 * cleared with a guarded update). A provider that no longer has the file counts as deleted; any other
 * failure stamps `recordingPurgeAttemptAt` and leaves the row for a later run, after the back-off.
 */
export async function purgeExpiredRecordings(input: { now?: Date; tenantIds?: string[] | null } = {}): Promise<PurgeSummary> {
  const now = input.now ?? new Date();
  const tenantIds = input.tenantIds ?? null;
  const summary: PurgeSummary = { deleted: 0, failed: 0, backfilled: await backfillMissingPurgeDates(tenantIds) };
  const retryBefore = new Date(now.getTime() - PURGE_RETRY_BACKOFF_MS);
  const due = await asSystem(() =>
    prisma.call.findMany({
      where: {
        recordingProviderId: { not: null },
        recordingPurgeAt: { lte: now },
        OR: [{ recordingPurgeAttemptAt: null }, { recordingPurgeAttemptAt: { lt: retryBefore } }],
        ...(tenantIds ? { tenantId: { in: tenantIds } } : {}),
      },
      orderBy: [{ recordingPurgeAttemptAt: { sort: 'asc', nulls: 'first' } }, { recordingPurgeAt: 'asc' }],
      take: RECORDING_PURGE_BATCH,
      select: { id: true, tenantId: true, recordingProviderId: true },
    })
  );
  if (due.length === 0) return summary;

  const provider = getTelephonyProvider();
  for (const call of due) {
    const recordingId = call.recordingProviderId!;
    try {
      try {
        await provider.deleteRecording(recordingId);
      } catch (error) {
        if (!(error instanceof TelephonyProviderError) || error.status !== 404) throw error;
      }
      await tenantStorage.run({ tenantId: call.tenantId }, () =>
        prisma.call.updateMany({ where: { id: call.id, tenantId: call.tenantId, recordingProviderId: recordingId }, data: { recordingProviderId: null } })
      );
      summary.deleted += 1;
    } catch (error) {
      summary.failed += 1;
      console.error('[telephony] could not purge a recording', { callId: call.id, error: safeError(error) });
      await tenantStorage.run({ tenantId: call.tenantId }, () =>
        prisma.call.updateMany({ where: { id: call.id, tenantId: call.tenantId }, data: { recordingPurgeAttemptAt: now } })
      );
    }
  }
  return summary;
}
