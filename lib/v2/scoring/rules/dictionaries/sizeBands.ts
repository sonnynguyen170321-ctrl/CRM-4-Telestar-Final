// SC1 reference dictionary: employee-count bands + qualitative phrase mapping.
//
// Powers qualitative size rules ("Medium", "SME", "Enterprise", "multi-location")
// across the corpus where numeric headcount is not given. Versioned data — bump
// SIZE_BANDS_DICTIONARY_VERSION on change. Pure data + helpers.

export const SIZE_BAND_KEYS = [
  "SOLO",
  "MICRO",
  "SMALL",
  "MEDIUM",
  "MID_MARKET",
  "ENTERPRISE",
  "LARGE_ENTERPRISE",
] as const;

export type SizeBandKey = (typeof SIZE_BAND_KEYS)[number];

export type SizeBandRange = {
  minEmployees: number;
  // Undefined maxEmployees means open-ended (no upper bound).
  maxEmployees?: number;
};

// Contiguous, non-overlapping bands keyed by headcount.
export const SIZE_BAND_MAP: Record<SizeBandKey, SizeBandRange> = {
  SOLO: { minEmployees: 1, maxEmployees: 1 },
  MICRO: { minEmployees: 2, maxEmployees: 10 },
  SMALL: { minEmployees: 11, maxEmployees: 50 },
  MEDIUM: { minEmployees: 51, maxEmployees: 200 },
  MID_MARKET: { minEmployees: 201, maxEmployees: 1000 },
  ENTERPRISE: { minEmployees: 1001, maxEmployees: 5000 },
  LARGE_ENTERPRISE: { minEmployees: 5001 },
};

// Qualitative phrases (lowercased) -> canonical band. Ordered most-specific first.
const QUALITATIVE_SIZE_ALIASES: readonly { match: readonly string[]; band: SizeBandKey }[] = [
  { match: ["solo", "one person", "one-person", "single founder"], band: "SOLO" },
  { match: ["micro"], band: "MICRO" },
  { match: ["sme", "s&me", "small business", "smb", "startup"], band: "SMALL" },
  { match: ["small"], band: "SMALL" },
  { match: ["medium well", "medium-well", "mid-market", "mid market", "midmarket"], band: "MID_MARKET" },
  { match: ["medium", "mid-size", "mid size"], band: "MEDIUM" },
  { match: ["large enterprise", "global enterprise"], band: "LARGE_ENTERPRISE" },
  { match: ["enterprise"], band: "ENTERPRISE" },
  { match: ["large"], band: "LARGE_ENTERPRISE" },
];

export const SIZE_BANDS_DICTIONARY_VERSION = "size-bands-v1";

/** Resolve a numeric headcount into its band. Returns null for non-positive input. */
export function resolveSizeBand(employeeCount: number): SizeBandKey | null {
  if (!Number.isFinite(employeeCount) || employeeCount < 1) {
    return null;
  }

  for (const key of SIZE_BAND_KEYS) {
    const range = SIZE_BAND_MAP[key];
    const underMax =
      range.maxEmployees === undefined || employeeCount <= range.maxEmployees;

    if (employeeCount >= range.minEmployees && underMax) {
      return key;
    }
  }

  return null;
}

/** Map a qualitative size phrase ("Enterprise", "SME") onto a band, or null. */
export function qualitativeSizeToBand(phrase: string): SizeBandKey | null {
  const value = String(phrase ?? "").trim().toLowerCase();

  if (!value) {
    return null;
  }

  // Numeric headcount ranges as uploads/LinkedIn write them ("5,001 - 10,000 employees",
  // "11 - 50 employees", "10,001+ employees") — resolve via the range's LOWER bound so the band is
  // the conservative one the range actually guarantees. Word aliases below still handle prose sizes.
  const firstNumber = value.replace(/,/g, "").match(/\d{1,9}/);
  if (firstNumber) {
    const band = resolveSizeBand(Number(firstNumber[0]));
    if (band) return band;
  }

  for (const alias of QUALITATIVE_SIZE_ALIASES) {
    for (const keyword of alias.match) {
      if (value.includes(keyword)) {
        return alias.band;
      }
    }
  }

  return null;
}

/** True when a headcount falls inside any of the allowed bands. */
export function employeeCountInBands(
  employeeCount: number,
  bands: readonly SizeBandKey[]
): boolean {
  const resolved = resolveSizeBand(employeeCount);

  return resolved !== null && bands.includes(resolved);
}
