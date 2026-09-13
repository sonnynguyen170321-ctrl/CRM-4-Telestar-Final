import {
  normalizeIdentityText,
  normalizePhoneIdentifier,
  normalizeCompanyName as normalizeCompanyNameCore,
} from '@telestar/core-identity';

// Identifier normalisation for dedupe keys and lookups.
//
// These three names are unchanged, so every existing call site keeps working; what changed is what
// they do. The previous implementations were `toLowerCase().trim()` for email, `replace(/\D/g, '')`
// for phone and `toLowerCase().trim()` for LinkedIn — enough to look like normalisation while
// letting the same person through as two records:
//
//   +84 90 123 4567 / 0901234567   → "84901234567" vs "0901234567" under digit-stripping, but the
//                                     same E.164 number once the country is known
//   linkedin.com/in/jane/ /
//   https://www.linkedin.com/in/jane → two different strings, one profile
//
// A dedupe key is only as good as its normaliser, so these now use the shared implementation the
// lead-generation app has been using against Vietnamese data.

export function normalizeEmail(email: string | null | undefined): string | null {
  return normalizeIdentityText(email);
}

/**
 * E.164 where the number can be parsed, digits-only otherwise.
 *
 * `defaultCountry` matters for local formats: "0901234567" is a valid Vietnamese mobile but is not
 * parseable without knowing the country, so callers that have one (a company's country, say) should
 * pass it. Without it the behaviour degrades to the old digit-stripping rather than dropping the
 * number.
 */
export function normalizePhone(
  phone: string | null | undefined,
  defaultCountry?: string | null
): string | null {
  if (!phone) return null;
  const parsed = normalizePhoneIdentifier(phone, (defaultCountry ?? undefined) as never);
  if (parsed.e164) return parsed.e164;
  const digits = String(phone).replace(/\D/g, '');
  return digits || null;
}

/** Canonical profile path: scheme, host, trailing slash and query all dropped. */
export function normalizeLinkedIn(linkedIn: string | null | undefined): string | null {
  if (!linkedIn) return null;
  const raw = String(linkedIn).trim();
  if (!raw) return null;
  const withoutScheme = raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  const withoutQuery = withoutScheme.split(/[?#]/)[0];
  const trimmed = withoutQuery.replace(/\/+$/, '');
  return trimmed.toLowerCase() || null;
}

/** Company name folded for identity comparison — Unicode, diacritics and Vietnamese legal forms. */
export function normalizeCompanyName(company: string | null | undefined): string | null {
  return normalizeCompanyNameCore(company);
}
