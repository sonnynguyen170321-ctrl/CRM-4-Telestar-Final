import { getLocalTime, isValidTimezone } from '@/lib/automation/timezone';
import { countryNameToIso } from '@telestar/core-identity';

import { inferTimezone } from '@/lib/time/inferTimezone';

/**
 * Whose clock the calling-hours rule reads (docs/dialer/TASKS.md D3.2).
 *
 * The number decides first. A Vietnamese number is in Vietnam's one timezone whatever the lead
 * record says — `lead.timezone` is editable by any rep who works the lead, so trusting it first would
 * let a call at 21:00 in Hanoi pass by setting the lead to Auckland.
 *
 * Only for a number whose country spans several zones (US, Canada, Australia, …) is `lead.timezone`
 * used, and then only a real region/city zone inside that country. The record's country is the last
 * resort, and only when it names the same country as the number. Otherwise `null`: the gate blocks the
 * call (`tz_unknown`) rather than guess, because a guess three hours off calls someone at 06:00.
 */

export type CallTimezone = {
  timezone: string;
  source: 'phone' | 'lead' | 'country';
};

/**
 * Zone prefixes that can be inside each multi-zone country. Coarse on purpose: it stops a lead in
 * New York being set to Asia/Tokyo; it cannot stop New York being set to Los Angeles, which the
 * snapshot records (`source: 'lead'`) for review.
 */
const COUNTRY_ZONE_PREFIXES: Record<string, string[]> = {
  US: ['America/', 'Pacific/Honolulu'],
  CA: ['America/'],
  AU: ['Australia/', 'Antarctica/Macquarie'],
  BR: ['America/'],
  MX: ['America/'],
  AR: ['America/'],
  CL: ['America/', 'Pacific/Easter'],
  RU: ['Europe/', 'Asia/'],
  ID: ['Asia/'],
  CN: ['Asia/'],
  KZ: ['Asia/'],
  // One calling code, more than one clock: the shared single-zone tables in lib/time/inferTimezone.ts
  // name only the mainland zone, so for the gate these are multi-zone and need the lead's zone.
  ES: ['Europe/Madrid', 'Atlantic/Canary', 'Africa/Ceuta'],
  PT: ['Europe/Lisbon', 'Atlantic/Azores', 'Atlantic/Madeira'],
  NZ: ['Pacific/Auckland', 'Pacific/Chatham'],
};

/** A region/city zone: not `UTC`, not `Etc/GMT-14`, not a bare offset. */
function isRegionZone(zone: string): boolean {
  return /^[A-Z][A-Za-z_]+\/[A-Za-z0-9_\/+-]+$/.test(zone) && !zone.startsWith('Etc/') && isValidTimezone(zone);
}

function plausibleFor(numberCountry: string | null, zone: string): boolean {
  const prefixes = numberCountry ? COUNTRY_ZONE_PREFIXES[numberCountry] : undefined;
  return prefixes ? prefixes.some((prefix) => zone.startsWith(prefix)) : true;
}

export function resolveCallTimezone(input: {
  leadTimezone?: string | null;
  e164?: string | null;
  /** ISO alpha-2 of the dialled number. */
  numberCountry?: string | null;
  /** The record's country as stored (name or code). */
  country?: string | null;
}): CallTimezone | null {
  const multiZone = Boolean(input.numberCountry && COUNTRY_ZONE_PREFIXES[input.numberCountry]);
  if (input.e164 && !multiZone) {
    const byPhone = inferTimezone({ phone: input.e164 });
    if (byPhone) return { timezone: byPhone.timezone, source: 'phone' };
  }

  const own = input.leadTimezone?.trim();
  if (own && isRegionZone(own) && plausibleFor(input.numberCountry ?? null, own)) return { timezone: own, source: 'lead' };

  const recordIso = countryNameToIso(input.country);
  if (input.country?.trim() && !multiZone && (!input.numberCountry || recordIso === input.numberCountry)) {
    const byCountry = inferTimezone({ country: input.country });
    if (byCountry) return { timezone: byCountry.timezone, source: 'country' };
  }
  return null;
}

export type LocalClock = {
  /** Minutes since local midnight, 0–1439. */
  minuteOfDay: number;
  /** 0 = Sunday … 6 = Saturday. */
  dayOfWeek: number;
  /** "HH:MM", for the snapshot and the message shown to the rep. */
  label: string;
};

export function localClock(now: Date, timezone: string): LocalClock {
  const local = getLocalTime(now, timezone);
  // Some ICU builds format midnight as hour 24 under hour12:false.
  const hour = local.hour % 24;
  const minuteOfDay = hour * 60 + local.minute;
  return {
    minuteOfDay,
    dayOfWeek: local.dayOfWeek,
    label: `${String(hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}`,
  };
}
