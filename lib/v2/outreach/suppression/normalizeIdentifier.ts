// O2: normalize an email/domain identifier for suppression matching.
// NFC + trim + lowercase (Invariant 11 spirit). Pure.

export function normalizeEmailIdentifier(raw: string | null | undefined): string | null {
  const value = String(raw ?? "")
    .normalize("NFC")
    .trim()
    .toLowerCase();
  if (!value || !value.includes("@")) {
    return null;
  }
  return value;
}

export function extractDomainIdentifier(
  emailOrDomain: string | null | undefined
): string | null {
  const value = String(emailOrDomain ?? "").normalize("NFC").trim().toLowerCase();
  if (!value) {
    return null;
  }
  const at = value.lastIndexOf("@");
  const domain = (at >= 0 ? value.slice(at + 1) : value).replace(/^@+/, "").replace(/\/+$/, "");
  return domain.includes(".") ? domain : null;
}
