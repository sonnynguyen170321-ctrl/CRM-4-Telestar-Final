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
 *     first so the notice is part of what was recorded. Both commands carry a stable `command_id`, so
 *     the answered and bridged events, a redelivery and a reconcile replay issue them once.
 *   - saved: `recordingPurgeAt` is set from the tenant's retention when the provider reports the file.
 *   - purge: files past `recordingPurgeAt` are deleted at the provider, then forgotten here.
 */

/** Spoken to the lead when `TelephonySettings.recordingNotice` is on. Vietnam is never dialled, so English only. */
export const RECORDING_NOTICE_TEXT = 'This call may be recorded for quality and training purposes.';

export const DEFAULT_RETENTION_DAYS = 90;
const MAX_RETENTION_DAYS = 3650;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Recordings deleted per purge run. */
export const RECORDING_PURGE_BATCH = 100;

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

/** Is this the lead's leg (the one we created with the transfer) rather than the rep's browser leg? */
export function isLeadLegEvent(event: Pick<TelnyxEvent, 'direction' | 'clientState'>, callId: string): boolean {
  return event.direction === 'outgoing' || legCallId(event.clientState) === callId;
}

/**
 * Start recording (and play the notice) on the lead's leg once it answers. Best effort for the call:
 * a refused command is logged and the call carries on unrecorded; a command whose result is unknown
 * (timeout, 5xx) throws so the event is retried, which `command_id` makes safe.
 */
export async function startRecordingOnAnswer(call: { id: string; tenantId: string }, event: TelnyxEvent): Promise<'started' | 'skipped'> {
  if (!event.controlId || !isLeadLegEvent(event, call.id)) return 'skipped';
  const settings = await loadRecordingSettings(call.tenantId);
  if (!settings.recordingEnabled) return 'skipped';

  const provider = getTelephonyProvider();
  try {
    await provider.command(event.controlId, { action: 'record_start', channels: 'dual', playBeep: false }, `record:${call.id}`);
    if (settings.recordingNotice) {
      await provider.command(event.controlId, { action: 'speak', payload: RECORDING_NOTICE_TEXT }, `notice:${call.id}`);
    }
  } catch (error) {
    if (error instanceof TelephonyProviderError && error.retryable) throw error;
    console.error('[telephony] could not start recording', { callId: call.id, error: safeError(error) });
    return 'skipped';
  }
  return 'started';
}

/** The provider saved the file: remember it and when it must go. Only the first recording id sticks. */
export async function storeSavedRecording(call: { id: string; tenantId: string }, recordingId: string, savedAt: Date): Promise<void> {
  const settings = await loadRecordingSettings(call.tenantId);
  await prisma.call.updateMany({
    where: { id: call.id, tenantId: call.tenantId, recordingProviderId: null },
    data: { recordingProviderId: recordingId, recordingPurgeAt: recordingPurgeAt(savedAt, settings.recordingRetentionDays) },
  });
}

export type PurgeSummary = { deleted: number; failed: number };

/**
 * Delete recordings whose retention ended. Bounded; safe to repeat and to run concurrently (the id is
 * cleared with a guarded update). A provider that no longer has the file counts as deleted; any other
 * failure leaves the row for the next run.
 */
export async function purgeExpiredRecordings(input: { now?: Date; tenantIds?: string[] | null } = {}): Promise<PurgeSummary> {
  const now = input.now ?? new Date();
  const summary: PurgeSummary = { deleted: 0, failed: 0 };
  const due = await asSystem(() =>
    prisma.call.findMany({
      where: {
        recordingProviderId: { not: null },
        recordingPurgeAt: { lte: now },
        ...(input.tenantIds ? { tenantId: { in: input.tenantIds } } : {}),
      },
      orderBy: { recordingPurgeAt: 'asc' },
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
    }
  }
  return summary;
}
