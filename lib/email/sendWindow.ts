/**
 * When a message deferred for capacity should be tried again.
 *
 * `nextQuotaResetAt` sends everything to one instant, so a whole day's queue arrived in a
 * single minute: on 2026-09-21 all 278 deferred messages fired at 02:00, 50 were accepted and
 * the provider refused 228 with `550 5.4.6 Sender Hourly Quota Exceeded`. Deferring is not the
 * problem; deferring *everything to the same moment* is.
 *
 * Shared by the send worker and by the recovery script, which has to re-queue the refused
 * messages without re-forming the burst that refused them. Two copies of this would be two
 * spreads that could drift apart while both claimed to protect the same mailbox.
 */
import { calculateNextActionAt, resolveTimezone } from '@/lib/automation/scheduling';

/** 09:00–17:00 in the prospect's timezone. */
export const BUSINESS_WINDOW_START_MINUTES = 9 * 60;
export const BUSINESS_WINDOW_END_MINUTES = 17 * 60;

/**
 * `calculateNextActionAt` already knows how to land a time inside a send window, in a
 * timezone, skipping weekends, with deterministic jitter keyed to a stable seed. Seeding it
 * with the outbound id spreads a queue across the window instead of stacking it, and keeps the
 * same message landing in the same place across retries.
 */
export function nextSendAttemptAt(params: {
  now: Date;
  /** Hours to wait at minimum — 0 for "as soon as the window allows", 1 for an hourly cap. */
  minHours: number;
  timezone: string | null | undefined;
  seed: string;
}): Date {
  const { dueAtUtc } = calculateNextActionAt({
    baseAt: params.now,
    delayDays: 0,
    delayHours: params.minHours,
    // The prospect's working day. Sending at 03:00 local is wasted on the reader and reads as
    // bulk to a spam filter, which is the other half of why the burst was bad.
    sendWindowStartMinutes: BUSINESS_WINDOW_START_MINUTES,
    sendWindowEndMinutes: BUSINESS_WINDOW_END_MINUTES,
    timezone: resolveTimezone(params.timezone) || 'UTC',
    businessDayPolicy: 'skip_weekends',
    deterministicSeed: params.seed,
  });
  return dueAtUtc;
}
