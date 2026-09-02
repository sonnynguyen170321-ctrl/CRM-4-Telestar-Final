// Shared person-name helpers. Vietnamese names are written Surname Middle Given
// ("Nguyen Van Minh" -> family Nguyen, given Minh), the opposite of Western order, so a blind
// `first = tokens[0]` makes the surname the first name (Inv 11). Used by ingestion's name split and
// the research email guesser so both agree. Pure.

/** Strip diacritics + d-stroke, lowercase, keep only [a-z0-9] — for surname-set membership only. */
export function foldAscii(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// Common Vietnamese family names (ASCII-folded). Presence as the FIRST token marks Surname-first order.
export const VN_SURNAMES = new Set([
  "nguyen", "tran", "le", "pham", "hoang", "huynh", "phan", "vu", "vo", "dang", "bui", "do", "ho",
  "ngo", "duong", "ly", "dinh", "truong", "lam", "mai", "trinh", "cao", "chu", "ta", "luu", "quach",
  "thai", "ha", "tong", "nghiem", "phung", "dao", "doan", "dam",
]);

/** True when the full name's leading token is a Vietnamese family name (Surname-first order). */
export function isVietnameseSurnameFirst(fullName: string): boolean {
  const tokens = String(fullName ?? "").trim().split(/\s+/).filter(Boolean);
  return tokens.length >= 2 && VN_SURNAMES.has(foldAscii(tokens[0]));
}

/**
 * Split a full name into display-cased given (firstName) and family (lastName) parts, respecting
 * Vietnamese Surname-first order. Preserves the original diacritics/casing (this feeds display
 * columns, not email locals). Returns nulls for an empty name; a single token is a firstName only.
 */
export function splitPersonName(fullName: string): { firstName: string | null; lastName: string | null } {
  const tokens = String(fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { firstName: null, lastName: null };
  if (tokens.length === 1) return { firstName: tokens[0], lastName: null };
  if (VN_SURNAMES.has(foldAscii(tokens[0]))) {
    // Surname-first: family = leading token, given = trailing token.
    return { firstName: tokens[tokens.length - 1], lastName: tokens[0] };
  }
  // Western: given = first token, family = the rest.
  return { firstName: tokens[0], lastName: tokens.slice(1).join(" ") };
}
