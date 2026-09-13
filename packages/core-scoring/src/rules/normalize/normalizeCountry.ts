// SC2: raw country string -> canonical country name.
//
// Canonical names match the region dictionary's country lists so geo comparisons
// (targetCountries, expanded regions, office-location) are apples-to-apples.
// NFC + diacritic-fold + alias map. Pure.

const COUNTRY_ALIASES: Record<string, string> = {
  usa: "United States",
  "u.s.": "United States",
  "u.s.a.": "United States",
  us: "United States",
  "united states of america": "United States",
  america: "United States",
  uk: "United Kingdom",
  "u.k.": "United Kingdom",
  "great britain": "United Kingdom",
  britain: "United Kingdom",
  england: "United Kingdom",
  uae: "United Arab Emirates",
  "u.a.e.": "United Arab Emirates",
  "hong kong sar": "Hong Kong",
  hongkong: "Hong Kong",
  "republic of korea": "South Korea",
  korea: "South Korea",
  "viet nam": "Vietnam",
  "czech republic": "Czechia",
  "the netherlands": "Netherlands",
  holland: "Netherlands",
  "republic of ireland": "Ireland",
};

// Known canonical names that should pass through unchanged after title-casing.
function titleCaseCountry(value: string): string {
  return value
    .split(/\s+/)
    .map((word) =>
      word.length <= 2
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    )
    .join(" ");
}

/** NFC-normalize, strip diacritics, lowercase, collapse whitespace. */
export function foldText(value: string): string {
  return String(value ?? "")
    .normalize("NFC")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Map a raw country string to a canonical country name, or null when empty. */
export function normalizeCountry(raw: string | undefined | null): string | null {
  const folded = foldText(raw ?? "");

  if (!folded) {
    return null;
  }

  if (COUNTRY_ALIASES[folded]) {
    return COUNTRY_ALIASES[folded];
  }

  return titleCaseCountry(folded);
}

/** Normalize a list of raw countries, dropping empties and de-duping. */
export function normalizeCountries(
  raws: readonly string[] | undefined | null
): string[] {
  const out = new Set<string>();

  for (const raw of raws ?? []) {
    const canonical = normalizeCountry(raw);
    if (canonical) {
      out.add(canonical);
    }
  }

  return [...out];
}
