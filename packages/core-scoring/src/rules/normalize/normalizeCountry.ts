// SC2: raw country string -> canonical country name.
//
// Canonical names match the region dictionary's country lists so geo comparisons
// (targetCountries, expanded regions, office-location) are apples-to-apples.
import { REGION_TO_COUNTRIES } from "../dictionaries/regions";

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
  // 2026-10-08: spellings the research builder and company sites use. Same keys on the lead side so a
  // candidate and a lead from "KSA" or "Türkiye" (folded to turkiye) land on the same country.
  ksa: "Saudi Arabia",
  "kingdom of saudi arabia": "Saudi Arabia",
  turkiye: "Turkey",
  "republic of turkiye": "Turkey",
  "republic of turkey": "Turkey",
  "u.a.e": "United Arab Emirates",
  emirates: "United Arab Emirates",
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
  saudi: "Saudi Arabia",
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

/** Alias lookup that survives a stripped final dot: "u.k" (from "U.K.") is still "u.k.". */
function aliasOf(folded: string): string | undefined {
  return COUNTRY_ALIASES[folded] ?? COUNTRY_ALIASES[`${folded}.`];
}

/** Map a raw country string to a canonical country name, or null when empty. */
export function normalizeCountry(raw: string | undefined | null): string | null {
  const trimmed = String(raw ?? "").trim().replace(/[.,;]+$/, "");
  // "United Kingdom (UK)", "Vietnam (VN)": the parenthetical restates the country — an alias of it
  // or a two-letter code — so it drops. "Korea (North)" and "Congo (Brazzaville)" are not
  // restatements: there the parenthetical IS the country, and dropping it would read North Korea
  // as South Korea. Those keep their full text.
  const restated = /^([^()]+)\(([^()]+)\)$/.exec(trimmed);
  if (restated) {
    const head = normalizeCountry(restated[1]);
    const inner = restated[2].trim();
    if (head && (/^[a-z]{2}$/i.test(inner) || head === normalizeCountry(inner))) return head;
    return titleCaseCountry(foldText(trimmed));
  }
  const folded = foldText(trimmed);

  if (!folded) {
    return null;
  }

  const alias = aliasOf(folded);
  if (alias) {
    return alias;
  }

  // "United Kingdom Uk", "United States USA": a name followed by its own abbreviation, as
  // spreadsheet exports write it. Production had 90 leads read as a non-target country this way.
  const words = folded.split(" ");
  if (words.length > 1) {
    const tail = aliasOf(words[words.length - 1]);
    const head = words.slice(0, -1).join(" ");
    if (tail && (foldText(tail) === head || aliasOf(head) === tail)) {
      return tail;
    }
  }

  return titleCaseCountry(folded);
}

/**
 * The form two country strings are compared in: aliases resolved ("USA" -> "United States"),
 * then folded. Every country comparison goes through this — comparing a normalized lead country
 * with a raw ICP list ("USA") is how a United States lead scored as outside a USA-targeting ICP.
 */
export function countryKey(raw: string | undefined | null): string {
  return foldText(normalizeCountry(raw) ?? "");
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

const KNOWN_COUNTRIES: ReadonlySet<string> = new Set([
  ...Object.values(REGION_TO_COUNTRIES).flat(),
  ...Object.values(COUNTRY_ALIASES),
]);

/** True for a canonical country name the region dictionary or the alias table knows. */
export function isKnownCountry(canonical: string | null | undefined): boolean {
  return canonical ? KNOWN_COUNTRIES.has(canonical) : false;
}

/** Folded spellings that mean this canonical country: its own name plus every alias that maps to it. */
export function countryVariants(canonical: string): string[] {
  const aliases = Object.entries(COUNTRY_ALIASES)
    .filter(([, value]) => value === canonical)
    .map(([alias]) => alias);
  return [foldText(canonical), ...aliases];
}
