/**
 * Timezone resolution for automation scheduling (spec §8).
 *
 * Precedence:
 *   1. Lead.timezone
 *   2. User.timezone (SDR)
 *   3. Tenant/application default
 *   4. 'UTC' as final technical fallback
 *
 * Never guesses from country, phone, email domain, or IP.
 */

/** Validate that a string is a recognised IANA timezone. */
export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the effective timezone for scheduling.
 *
 * Each argument is optional and checked in precedence order.
 * Invalid or empty strings are skipped.
 */
export function resolveTimezone(
  leadTimezone?: string | null,
  userTimezone?: string | null,
  tenantDefault?: string | null,
): string {
  for (const tz of [leadTimezone, userTimezone, tenantDefault]) {
    if (tz && isValidTimezone(tz)) return tz;
  }
  return 'UTC';
}

/**
 * Get the local hour and minute for a given Date in the target timezone.
 *
 * Returns { hour: 0-23, minute: 0-59, dayOfWeek: 0-6 (Sun=0) }.
 */
export function getLocalTime(date: Date, timezone: string): {
  hour: number;
  minute: number;
  dayOfWeek: number;
  year: number;
  month: number;
  day: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    weekday: 'short',
  }).formatToParts(date);

  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;

  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };

  return {
    hour: parseInt(map.hour, 10),
    minute: parseInt(map.minute, 10),
    dayOfWeek: weekdayMap[map.weekday] ?? 0,
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
  };
}

/**
 * Convert a local calendar time in a timezone to a UTC Date.
 *
 * This is the inverse of getLocalTime: given "09:30 on 2026-08-12 in
 * America/New_York", produce the UTC instant.
 *
 * Strategy: construct an initial UTC guess, compute the offset the
 * timezone formatter shows, then adjust. Handles DST by iterating once
 * (the offset can shift between the guess and the corrected value near
 * a DST boundary).
 */
export function localToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  // Initial UTC guess assuming timezone offset is 0
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));

  const computeOffset = (ref: Date): number => {
    const local = getLocalTime(ref, timezone);
    const localMs = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, 0, 0);
    return localMs - ref.getTime();
  };

  // First pass
  const offset1 = computeOffset(guess);
  const corrected = new Date(guess.getTime() - offset1);

  // Second pass (DST edge correction)
  const offset2 = computeOffset(corrected);
  if (offset2 !== offset1) {
    return new Date(guess.getTime() - offset2);
  }

  return corrected;
}

/**
 * Convert minutes-since-midnight to { hour, minute }.
 * E.g. 540 → { hour: 9, minute: 0 }, 690 → { hour: 11, minute: 30 }.
 */
export function minutesToHourMinute(minutes: number): { hour: number; minute: number } {
  return {
    hour: Math.floor(minutes / 60),
    minute: minutes % 60,
  };
}
