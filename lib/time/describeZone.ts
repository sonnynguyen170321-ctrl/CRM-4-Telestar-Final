import { getLocalTime, isValidTimezone } from '@/lib/automation/timezone';

/**
 * What a moment looks like in a given zone — for the prospect clock and the booking preview.
 *
 * Built on `getLocalTime` from lib/automation/timezone.ts, which the sequence engine already
 * trusts for send windows; nothing here computes an offset by hand.
 */
export type ZoneDescription = {
  timezone: string;
  /** `14:32` */
  localTime: string;
  /** `Tue` */
  weekday: string;
  /** `GMT+8`, `GMT-5`, `GMT+5:30` */
  offsetLabel: string;
  /** 09:00–18:00 local, Monday to Friday. Same convention as lib/dates/businessDays.ts. */
  isBusinessHours: boolean;
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const BUSINESS_HOURS = { start: 9, end: 18 } as const;

/** Offset of `timezone` from UTC at `at`, in minutes, from Intl rather than arithmetic. */
export function utcOffsetMinutes(timezone: string, at: Date): number {
  const local = getLocalTime(at, timezone);
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  // `at` truncated to the minute, so a seconds component cannot produce a 59-minute offset.
  const atMinute = Math.floor(at.getTime() / 60000) * 60000;
  return Math.round((asUtc - atMinute) / 60000);
}

export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `GMT${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

export function describeZone(timezone: string, at: Date = new Date()): ZoneDescription {
  if (!isValidTimezone(timezone)) {
    throw new Error(`Not an IANA timezone: ${timezone}`);
  }
  const local = getLocalTime(at, timezone);
  const inWeek = local.dayOfWeek >= 1 && local.dayOfWeek <= 5;
  const inHours = local.hour >= BUSINESS_HOURS.start && local.hour < BUSINESS_HOURS.end;
  return {
    timezone,
    localTime: `${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}`,
    weekday: WEEKDAYS[local.dayOfWeek],
    offsetLabel: formatOffset(utcOffsetMinutes(timezone, at)),
    isBusinessHours: inWeek && inHours,
  };
}

/** `Asia/Ho_Chi_Minh` → `Ho Chi Minh`. For labels; the id stays the source of truth. */
export function zoneCityName(timezone: string): string {
  const last = timezone.split('/').pop() ?? timezone;
  return last.replace(/_/g, ' ');
}
