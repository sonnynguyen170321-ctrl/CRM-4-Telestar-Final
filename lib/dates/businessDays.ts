import { getLocalTime, localToUtc } from '@/lib/automation/timezone';

/**
 * Business-day helpers for task scheduling.
 *
 * Every function takes the IANA timezone the answer is *for*. The previous version used
 * `getDay()` and `setHours(9)`, which are the server's local clock; the containers run in UTC,
 * so "next business day at 09:00" for a rep in Ho Chi Minh City was 09:00 UTC — 16:00 their
 * time — and a call logged at 01:00 ICT on a Monday was counted as Sunday. It passed every test
 * on a developer machine in Vietnam, where local time happens to be UTC+7.
 *
 * The timezone is resolved by the caller with `resolveTimezone(lead.timezone, user.timezone)`,
 * the same convention the sequence engine uses, so a due date and a send window agree on what
 * "morning" means.
 *
 * Weekends are Saturday/Sunday; no holiday calendar (SKILL.md doesn't define one).
 */

const SATURDAY = 6;
const SUNDAY = 0;
const BUSINESS_DAY_START_HOUR = 9;

export function isWeekend(date: Date, timezone: string): boolean {
  const day = getLocalTime(date, timezone).dayOfWeek;
  return day === SATURDAY || day === SUNDAY;
}

/** 09:00 on the local calendar day that is `daysAhead` days after `from`'s local day. */
function localMorning(from: Date, daysAhead: number, timezone: string): Date {
  const local = getLocalTime(from, timezone);
  // Roll the calendar in UTC arithmetic — month/year overflow is handled by Date.UTC — then map
  // that local (y, m, d, 09:00) back to the instant it names in `timezone`.
  const rolled = new Date(Date.UTC(local.year, local.month - 1, local.day + daysAhead));
  return localToUtc(
    rolled.getUTCFullYear(),
    rolled.getUTCMonth() + 1,
    rolled.getUTCDate(),
    BUSINESS_DAY_START_HOUR,
    0,
    timezone
  );
}

/**
 * The next business day strictly after `from`, at 09:00 in `timezone`.
 * Friday → Monday, Saturday → Monday, Sunday → Monday, Tuesday → Wednesday.
 */
export function nextBusinessDay(from: Date, timezone: string): Date {
  let daysAhead = 1;
  while (isWeekend(localMorning(from, daysAhead, timezone), timezone)) daysAhead += 1;
  return localMorning(from, daysAhead, timezone);
}

/**
 * Snap a due date forward off a weekend (local Saturday/Sunday → Monday 09:00 local).
 * Weekday dates pass through unchanged.
 */
export function snapToBusinessDay(date: Date, timezone: string): Date {
  if (!isWeekend(date, timezone)) return date;
  let daysAhead = 1;
  while (isWeekend(localMorning(date, daysAhead, timezone), timezone)) daysAhead += 1;
  return localMorning(date, daysAhead, timezone);
}
