// SC1 reference dictionary: region -> canonical country list.
//
// Versioned data. A change to this file's data MUST bump REGIONS_DICTIONARY_VERSION
// so the scoring fingerprint changes and dependent assessments are recomputed.
// Pure data + pure helpers only. No I/O, no provider calls, no DB.

export const REGION_KEYS = [
  "APAC",
  "SEA",
  "ANZ",
  "EU",
  "EUROPE",
  "NORDICS",
  "GERMAN_SPEAKING",
  "NORTH_AMERICA",
  "LATAM",
  "SOUTH_AMERICA",
  "MENA",
  "NORTH_AFRICA",
  "CENTRAL_AFRICA",
] as const;

export type RegionKey = (typeof REGION_KEYS)[number];

// Canonical English country names. The geo normalizer (SC2) maps raw evidence
// (aliases like "USA", "U.K.") onto these canonical names before comparison.
export const REGION_TO_COUNTRIES: Record<RegionKey, readonly string[]> = {
  APAC: [
    "Australia",
    "New Zealand",
    "Singapore",
    "Malaysia",
    "Thailand",
    "Indonesia",
    "Philippines",
    "Vietnam",
    "Laos",
    "Cambodia",
    "Myanmar",
    "Hong Kong",
    "Taiwan",
    "Japan",
    "South Korea",
    "India",
    "China",
  ],
  SEA: [
    "Singapore",
    "Malaysia",
    "Thailand",
    "Indonesia",
    "Philippines",
    "Vietnam",
    "Laos",
    "Cambodia",
    "Myanmar",
    "Brunei",
  ],
  ANZ: ["Australia", "New Zealand"],
  EU: [
    "Austria",
    "Belgium",
    "Bulgaria",
    "Croatia",
    "Cyprus",
    "Czechia",
    "Denmark",
    "Estonia",
    "Finland",
    "France",
    "Germany",
    "Greece",
    "Hungary",
    "Ireland",
    "Italy",
    "Latvia",
    "Lithuania",
    "Luxembourg",
    "Malta",
    "Netherlands",
    "Poland",
    "Portugal",
    "Romania",
    "Slovakia",
    "Slovenia",
    "Spain",
    "Sweden",
  ],
  EUROPE: [
    "Austria",
    "Belgium",
    "Bulgaria",
    "Croatia",
    "Cyprus",
    "Czechia",
    "Denmark",
    "Estonia",
    "Finland",
    "France",
    "Germany",
    "Greece",
    "Hungary",
    "Iceland",
    "Ireland",
    "Italy",
    "Latvia",
    "Lithuania",
    "Luxembourg",
    "Malta",
    "Netherlands",
    "Norway",
    "Poland",
    "Portugal",
    "Romania",
    "Slovakia",
    "Slovenia",
    "Spain",
    "Sweden",
    "Switzerland",
    "United Kingdom",
  ],
  NORDICS: ["Denmark", "Finland", "Iceland", "Norway", "Sweden"],
  // German-speaking DACH (used by FlexEnergy: "German-speaking part of Switzerland").
  // Sub-national scoping (e.g. canton-level) is expressed via subNationalRegions on the rule.
  GERMAN_SPEAKING: ["Germany", "Austria", "Switzerland", "Liechtenstein"],
  NORTH_AMERICA: ["United States", "Canada", "Mexico"],
  LATAM: [
    "Mexico",
    "Brazil",
    "Argentina",
    "Chile",
    "Colombia",
    "Peru",
    "Ecuador",
    "Uruguay",
    "Paraguay",
    "Bolivia",
    "Venezuela",
  ],
  SOUTH_AMERICA: [
    "Brazil",
    "Argentina",
    "Chile",
    "Colombia",
    "Peru",
    "Ecuador",
    "Uruguay",
    "Paraguay",
    "Bolivia",
    "Venezuela",
  ],
  MENA: [
    "Saudi Arabia",
    "United Arab Emirates",
    "Qatar",
    "Kuwait",
    "Bahrain",
    "Oman",
    "Turkey",
    "Egypt",
    "Jordan",
    "Lebanon",
    "Israel",
    "Morocco",
    "Algeria",
    "Tunisia",
  ],
  NORTH_AFRICA: ["Morocco", "Algeria", "Tunisia", "Libya", "Egypt"],
  CENTRAL_AFRICA: [
    "Cameroon",
    "Chad",
    "Central African Republic",
    "Democratic Republic of the Congo",
    "Republic of the Congo",
    "Gabon",
    "Equatorial Guinea",
  ],
};

export const REGIONS_DICTIONARY_VERSION = "regions-v1";

function isRegionKey(value: string): value is RegionKey {
  return (REGION_KEYS as readonly string[]).includes(value);
}

/**
 * Expand a set of region keys into a deduped, sorted list of canonical countries.
 * Unknown region keys are ignored (the schema validates keys; this stays pure/total).
 */
export function expandRegionsToCountries(
  regionKeys: readonly string[]
): string[] {
  const countries = new Set<string>();

  for (const key of regionKeys) {
    if (!isRegionKey(key)) {
      continue;
    }

    for (const country of REGION_TO_COUNTRIES[key]) {
      countries.add(country);
    }
  }

  return [...countries].sort();
}
