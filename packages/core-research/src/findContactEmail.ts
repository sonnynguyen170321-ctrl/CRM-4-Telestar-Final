// Pure email-pattern guesser for a promoted/known contact. No network: it proposes the common
// corporate patterns from a full name + company domain. Verification (MX/SMTP or a paid
// contact-data adapter) is a separate seam — until then guesses are marked GUESSED, never
// VERIFIED, so the UI is honest about confidence. Handles diacritics (Vietnamese names).

import { foldAscii as asciiFold, VN_SURNAMES } from "@telestar/core-identity";

export type EmailGuess = { email: string; status: "GUESSED" | "VERIFIED" | "UNKNOWN" };

function nameParts(fullName: string): { first: string; last: string | null; vietnamese: boolean } {
  const tokens = fullName.trim().split(/\s+/).map(asciiFold).filter(Boolean);
  if (tokens.length === 0) return { first: "", last: null, vietnamese: false };
  if (tokens.length === 1) return { first: tokens[0], last: null, vietnamese: false };
  // `first` always means "the name the address is built from" — the GIVEN name.
  if (VN_SURNAMES.has(tokens[0])) {
    return { first: tokens[tokens.length - 1], last: tokens[0], vietnamese: true };
  }
  return { first: tokens[0], last: tokens[tokens.length - 1], vietnamese: false };
}

function cleanDomain(domain: string): string | null {
  const raw = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(raw) ? raw : null;
}

/** Common corporate address patterns, most-likely first. Empty when name/domain unusable. */
export function guessEmailPatterns(fullName: string, domain: string): string[] {
  const d = cleanDomain(domain);
  const { first, last, vietnamese } = nameParts(fullName);
  if (!d || !first) return [];
  if (!last) return [`${first}@${d}`];
  // Vietnamese corporate addresses are overwhelmingly given-name-first, often with the surname
  // reduced to an initial (thuy.tran@, duy_p@, nguyent@, kduy@, hle@ are all real examples).
  const locals = vietnamese
    ? [`${first}.${last}`, `${first}${last}`, `${first}${last[0]}`, `${last}${first[0]}`,
       `${first[0]}${last}`, `${first}`, `${first}_${last}`, `${first}_${last[0]}`]
    : [`${first}.${last}`, `${first}${last}`, `${first[0]}${last}`, `${first}`, `${last}.${first}`, `${first}_${last}`];
  return Array.from(new Set(locals)).map((local) => `${local}@${d}`);
}

/** Best single guess for display, or null when it cannot be formed. */
export function bestEmailGuess(fullName: string, domain: string): EmailGuess | null {
  const [best] = guessEmailPatterns(fullName, domain);
  return best ? { email: best, status: "GUESSED" } : null;
}
