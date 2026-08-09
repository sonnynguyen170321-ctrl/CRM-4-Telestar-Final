/**
 * Central scheduling function (spec §9).
 *
 * Moves all sequence scheduling math into one deterministic module.
 * No React components or BullMQ workers should compute schedules.
 *
 * Concepts kept separate (spec §7):
 *   Cadence  = delayDays + delayHours (when the next step is logically due)
 *   Policy   = send window, business days, timezone (when execution is allowed)
 */

import { deterministicOffset } from './jitter';
import {
  resolveTimezone,
  getLocalTime,
  localToUtc,
  minutesToHourMinute,
} from './timezone';

// ── Types ───────────────────────────────────────────────────────────────────

export type BusinessDayPolicy = 'skip_weekends' | 'none';

export type AdjustmentReason =
  | 'none'
  | 'before_send_window'
  | 'after_send_window'
  | 'weekend_adjustment';

export interface SchedulingInput {
  /** The timestamp from which the cadence delay is measured (usually now or previous step completion). */
  baseAt: Date;
  /** Cadence: whole business-day delay component. */
  delayDays: number;
  /** Cadence: hour delay component (fractional same-day offset). */
  delayHours: number;
  /** Send-window start as minutes since midnight in the resolved timezone. Null = no window. */
  sendWindowStartMinutes?: number | null;
  /** Send-window end as minutes since midnight in the resolved timezone. Null = no window. */
  sendWindowEndMinutes?: number | null;
  /** IANA timezone string. Resolved upstream via resolveTimezone(). */
  timezone: string;
  /** Whether to skip weekends. */
  businessDayPolicy: BusinessDayPolicy;
  /** Stable seed for deterministic jitter within the send window. */
  deterministicSeed?: string | null;
}

export interface SchedulingResult {
  /** The computed due date in UTC. */
  dueAtUtc: Date;
  /** Human-readable local representation. */
  dueAtLocal: string;
  /** The timezone used. */
  timezone: string;
  /** Why the raw cadence date was adjusted. */
  adjustmentReason: AdjustmentReason;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const SATURDAY = 6;
const SUNDAY = 0;

function isWeekendDay(dayOfWeek: number): boolean {
  return dayOfWeek === SATURDAY || dayOfWeek === SUNDAY;
}

/**
 * Add N business days to a date in the given timezone.
 *
 * Business days skip Saturday and Sunday. Adding 0 business days returns
 * the same date (no snap). Adding 1 skips to the next weekday.
 */
function addBusinessDays(
  startUtc: Date,
  days: number,
  timezone: string,
): Date {
  if (days <= 0) return startUtc;

  let current = new Date(startUtc);
  let remaining = days;

  while (remaining > 0) {
    current = new Date(current.getTime() + 86_400_000);
    const local = getLocalTime(current, timezone);
    if (!isWeekendDay(local.dayOfWeek)) {
      remaining--;
    }
  }

  return current;
}

/**
 * Snap a UTC date forward past weekends in the given timezone.
 * Returns the original date if already a weekday.
 */
function snapPastWeekend(
  utcDate: Date,
  timezone: string,
): { date: Date; adjusted: boolean } {
  const local = getLocalTime(utcDate, timezone);
  if (!isWeekendDay(local.dayOfWeek)) {
    return { date: utcDate, adjusted: false };
  }

  // Advance day-by-day until we hit a weekday
  let current = new Date(utcDate);
  while (true) {
    current = new Date(current.getTime() + 86_400_000);
    const l = getLocalTime(current, timezone);
    if (!isWeekendDay(l.dayOfWeek)) {
      // Snap to the start of this weekday in the target timezone
      const snapped = localToUtc(l.year, l.month, l.day, 9, 0, timezone);
      return { date: snapped, adjusted: true };
    }
  }
}

/**
 * Apply the send window to a candidate UTC date.
 *
 * If the date falls before the window start, push to window start + jitter.
 * If the date falls after the window end, push to next day's window start + jitter.
 * If inside the window, leave as-is (jitter already applied or not needed).
 */
function applySendWindow(
  candidateUtc: Date,
  windowStartMinutes: number,
  windowEndMinutes: number,
  timezone: string,
  jitterMinutes: number,
): { date: Date; reason: AdjustmentReason } {
  const local = getLocalTime(candidateUtc, timezone);
  const currentMinutes = local.hour * 60 + local.minute;

  if (currentMinutes < windowStartMinutes) {
    // Before window → snap to window start + jitter
    const { hour, minute } = minutesToHourMinute(windowStartMinutes + jitterMinutes);
    const adjusted = localToUtc(local.year, local.month, local.day, hour, minute, timezone);
    return { date: adjusted, reason: 'before_send_window' };
  }

  if (currentMinutes >= windowEndMinutes) {
    // After window → push to next day's window start + jitter
    // We need to advance to the next day
    const nextDayUtc = new Date(candidateUtc.getTime() + 86_400_000);
    const nextLocal = getLocalTime(nextDayUtc, timezone);
    const { hour, minute } = minutesToHourMinute(windowStartMinutes + jitterMinutes);
    const adjusted = localToUtc(nextLocal.year, nextLocal.month, nextLocal.day, hour, minute, timezone);
    return { date: adjusted, reason: 'after_send_window' };
  }

  // Inside window — no adjustment needed
  return { date: candidateUtc, reason: 'none' };
}

// ── Main ────────────────────────────────────────────────────────────────────

/**
 * Calculate when the next automation action should fire.
 *
 * Separates cadence (delay) from execution policy (window, business days,
 * timezone) per spec §7. Deterministic: same inputs always produce the
 * same output, even across rebuilds.
 */
export function calculateNextActionAt(input: SchedulingInput): SchedulingResult {
  const {
    baseAt,
    delayDays,
    delayHours,
    sendWindowStartMinutes,
    sendWindowEndMinutes,
    timezone: rawTimezone,
    businessDayPolicy,
    deterministicSeed,
  } = input;

  // Resolve timezone (should already be resolved, but belt-and-suspenders)
  const timezone = resolveTimezone(rawTimezone) || 'UTC';

  // ── Step 1: Apply cadence ───────────────────────────────────────────────
  let candidate: Date;

  if (businessDayPolicy === 'skip_weekends' && delayDays > 0) {
    // Add hours first, then business days
    const afterHours = new Date(baseAt.getTime() + delayHours * 3_600_000);
    candidate = addBusinessDays(afterHours, delayDays, timezone);
  } else {
    // Simple arithmetic delay
    candidate = new Date(
      baseAt.getTime() + delayDays * 86_400_000 + delayHours * 3_600_000,
    );
  }

  let adjustmentReason: AdjustmentReason = 'none';

  // ── Step 2: Weekend snap (if policy requires) ───────────────────────────
  if (businessDayPolicy === 'skip_weekends') {
    const { date, adjusted } = snapPastWeekend(candidate, timezone);
    if (adjusted) {
      candidate = date;
      adjustmentReason = 'weekend_adjustment';
    }
  }

  // ── Step 3: Compute jitter ──────────────────────────────────────────────
  const hasSendWindow =
    sendWindowStartMinutes != null &&
    sendWindowEndMinutes != null &&
    sendWindowEndMinutes > sendWindowStartMinutes;

  const windowDuration = hasSendWindow
    ? sendWindowEndMinutes! - sendWindowStartMinutes!
    : 0;

  const jitterMinutes =
    deterministicSeed && windowDuration > 0
      ? deterministicOffset(deterministicSeed, windowDuration)
      : 0;

  // ── Step 4: Apply send window ───────────────────────────────────────────
  if (hasSendWindow) {
    const { date, reason } = applySendWindow(
      candidate,
      sendWindowStartMinutes!,
      sendWindowEndMinutes!,
      timezone,
      jitterMinutes,
    );
    candidate = date;
    if (reason !== 'none') {
      adjustmentReason = reason;
    }

    // After window adjustment may have landed on a weekend → re-snap
    if (businessDayPolicy === 'skip_weekends') {
      const { date: snapped, adjusted } = snapPastWeekend(candidate, timezone);
      if (adjusted) {
        candidate = snapped;
        adjustmentReason = 'weekend_adjustment';
        // Re-apply window start + jitter on the snapped day
        const local = getLocalTime(candidate, timezone);
        const { hour, minute } = minutesToHourMinute(sendWindowStartMinutes! + jitterMinutes);
        candidate = localToUtc(local.year, local.month, local.day, hour, minute, timezone);
      }
    }
  }

  // ── Step 5: Format local representation ─────────────────────────────────
  const localParts = getLocalTime(candidate, timezone);
  const pad = (n: number) => String(n).padStart(2, '0');
  const dueAtLocal = `${localParts.year}-${pad(localParts.month)}-${pad(localParts.day)} ${pad(localParts.hour)}:${pad(localParts.minute)}`;

  return {
    dueAtUtc: candidate,
    dueAtLocal,
    timezone,
    adjustmentReason,
  };
}

// Re-export timezone utilities for convenience
export { resolveTimezone } from './timezone';
