import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

// Canonical phone normalization for contact identifiers. Ingestion previously stored the raw CSV
// string as both rawValue and normalizedValue with isValid hardcoded true, so the same number in two
// formats ("84948200638" vs "0948200638") became two rows and never matched the E.164 that the
// research path stores. This is the single normalizer both paths use. Pure.

export type NormalizedPhone = { e164: string | null; isValid: boolean };

/**
 * Normalize a raw phone string to E.164. Strategy, most-reliable first:
 *   1. as written, using `defaultCountry` (a bare national number like "0948200638" needs it);
 *   2. if that fails and the digits look like they already carry a country code, retry with a leading
 *      "+" (covers foreign numbers pasted without "+", e.g. a NL/NZ number in a VN-defaulted sheet).
 * Returns `{ e164: null, isValid: false }` when nothing parses to a valid number — the caller keeps
 * the cleaned raw value but marks the identifier invalid rather than dropping it.
 */
export function normalizePhoneIdentifier(
  raw: string | null | undefined,
  defaultCountry?: CountryCode | null
): NormalizedPhone {
  const cleaned = String(raw ?? "").trim();
  if (!cleaned) return { e164: null, isValid: false };

  const withCountry = parsePhoneNumberFromString(cleaned, defaultCountry ?? undefined);
  if (withCountry?.isValid()) return { e164: withCountry.number, isValid: true };

  const digits = cleaned.replace(/[\s().\-+]/g, "");
  if (/^\d{8,15}$/.test(digits)) {
    const withPlus = parsePhoneNumberFromString(`+${digits}`);
    if (withPlus?.isValid()) return { e164: withPlus.number, isValid: true };
  }

  return { e164: null, isValid: false };
}

// Country NAME (as it appears in uploads, e.g. "Vietnam") -> ISO 3166 alpha-2 for libphonenumber's
// default-country. Uploads carry country names, not codes, and libphonenumber needs the code to parse
// a bare national number. Focused on the markets that actually appear in the data; unknowns return
// null (the normalizer then relies on an embedded country code / "+" prefix). Also accepts a value
// that is already a 2-letter code.
const COUNTRY_NAME_TO_ISO: Record<string, CountryCode> = {
  vietnam: "VN", "viet nam": "VN", vn: "VN",
  singapore: "SG", thailand: "TH", malaysia: "MY", indonesia: "ID", philippines: "PH",
  cambodia: "KH", laos: "LA", myanmar: "MM", brunei: "BN",
  china: "CN", "hong kong": "HK", taiwan: "TW", japan: "JP", "south korea": "KR", korea: "KR",
  india: "IN", "united states": "US", usa: "US", "united states of america": "US",
  "united kingdom": "GB", uk: "GB", "great britain": "GB",
  netherlands: "NL", germany: "DE", france: "FR", spain: "ES", italy: "IT",
  "new zealand": "NZ", australia: "AU", canada: "CA",
};

/** Resolve an uploaded country name (or an alpha-2 code) to an ISO 3166 alpha-2 code, or null. */
export function countryNameToIso(raw: string | null | undefined): CountryCode | null {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v) return null;
  if (COUNTRY_NAME_TO_ISO[v]) return COUNTRY_NAME_TO_ISO[v];
  if (/^[a-z]{2}$/.test(v)) return v.toUpperCase() as CountryCode;
  return null;
}
