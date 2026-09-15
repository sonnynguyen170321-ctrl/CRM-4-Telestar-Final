import { formatOffset, utcOffsetMinutes, zoneCityName } from './describeZone';

/**
 * The timezone picker's option list.
 *
 * The zones this company deals with daily come first, so a rep in Ho Chi Minh City booking a
 * Singapore prospect never scrolls. Everything else is the runtime's own IANA list, grouped by
 * region. Offsets in the labels are computed for *now*, so a DST zone reads correctly in both
 * halves of the year; the id is what gets stored.
 */
export const PINNED_TIMEZONES = [
  'Asia/Ho_Chi_Minh',
  'Asia/Singapore',
  'Asia/Kuala_Lumpur',
  'Asia/Bangkok',
  'Australia/Sydney',
  'Europe/London',
  'America/New_York',
] as const;

export type TimezoneOption = { id: string; label: string };
export type TimezoneGroup = { label: string; zones: TimezoneOption[] };

function option(id: string, at: Date): TimezoneOption {
  return { id, label: `${zoneCityName(id)} (${formatOffset(utcOffsetMinutes(id, at))})` };
}

function supportedZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  const list = intl.supportedValuesOf?.('timeZone') ?? [];
  // A runtime without supportedValuesOf still gets the pinned set, which is the set that matters.
  return list.length ? list : [...PINNED_TIMEZONES];
}

export function buildTimezoneOptions(at: Date = new Date()): TimezoneGroup[] {
  const pinned: TimezoneGroup = { label: 'Pinned', zones: PINNED_TIMEZONES.map((id) => option(id, at)) };
  const byRegion = new Map<string, TimezoneOption[]>();
  for (const id of supportedZones()) {
    const region = id.includes('/') ? id.split('/')[0] : 'Other';
    if (!byRegion.has(region)) byRegion.set(region, []);
    byRegion.get(region)!.push(option(id, at));
  }
  const groups = [...byRegion.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, zones]) => ({ label, zones: zones.sort((a, b) => a.id.localeCompare(b.id)) }));
  return [pinned, ...groups];
}

/** Built once per process load; offsets are "now at load", which is fine for a picker label. */
export const TIMEZONE_OPTIONS: TimezoneGroup[] = buildTimezoneOptions();
