// O5 / design B8: resolve a tenant timezone into the send-window UTC offset, so a
// sequence step's send window is tenant-local (don't send at 3am local). Supports a
// numeric offset string ("+07:00" / "-05:00" / "+0700") and a few common IANA zones;
// defaults to UTC. Pure (a full IANA db is intentionally not pulled in here).

const COMMON_ZONE_OFFSETS: Record<string, number> = {
  utc: 0,
  "asia/ho_chi_minh": 7 * 60,
  "asia/bangkok": 7 * 60,
  "asia/singapore": 8 * 60,
  "asia/hong_kong": 8 * 60,
  "asia/tokyo": 9 * 60,
  "australia/sydney": 10 * 60,
  "europe/london": 0,
  "europe/berlin": 60,
  "europe/zurich": 60,
  "america/new_york": -5 * 60,
  "america/chicago": -6 * 60,
  "america/los_angeles": -8 * 60,
};

/** Parse "+07:00" / "-0530" / "+7" into minutes, or null if not an offset. */
function parseOffsetString(value: string): number | null {
  const m = /^([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  const hours = Number(m[2]);
  const minutes = Number(m[3] ?? "0");
  if (hours > 14 || minutes >= 60) return null;
  return sign * (hours * 60 + minutes);
}

export function resolveUtcOffsetMinutes(orgTimezone: string | null | undefined): number {
  const tz = String(orgTimezone ?? "").trim();
  if (!tz) return 0;

  const offset = parseOffsetString(tz);
  if (offset !== null) return offset;

  const known = COMMON_ZONE_OFFSETS[tz.toLowerCase()];
  return known ?? 0; // unknown zone -> UTC (safe default; never throws)
}
