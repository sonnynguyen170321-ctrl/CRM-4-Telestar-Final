// Contact display-name resolver. Ingestion historically stored `fullName = email.split("@")[0]`
// (or the literal email) when a row had no real name, so the leads table/drawer/compose showed
// "john.doe" instead of a person. This resolver fixes every read surface at once: it prefers a
// real first/last name, keeps a genuine fullName, humanizes an email-derived value, and only then
// falls back to the company. Pure + deterministic; no I/O.

export type ContactNameInput = {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  companyName?: string | null;
};

function emailLocalPart(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  const local = at > 0 ? email.slice(0, at) : email;
  return local.trim() || null;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** "john.doe" / "john_doe-27" / "j.smith2" -> "John Doe" / "J Smith". Empty if nothing usable. */
export function humanizeEmailLocalPart(local: string): string {
  const cleaned = local
    .replace(/[._+-]+/g, " ")
    .replace(/\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/** True when `fullName` is really an email or the raw local-part of one (the ingestion default). */
export function isEmailDerivedName(fullName: string | null | undefined, email: string | null | undefined): boolean {
  const full = fullName?.trim();
  if (!full) return false;
  if (full.includes("@")) return true;
  const local = emailLocalPart(email);
  return local ? normalize(full) === normalize(local) : false;
}

export function resolveContactDisplayName(input: ContactNameInput): string {
  const first = input.firstName?.trim();
  const last = input.lastName?.trim();
  if (first || last) return [first, last].filter(Boolean).join(" ");

  const full = input.fullName?.trim();
  if (full && !isEmailDerivedName(full, input.email)) return full;

  // At this point `full` is either empty or email-derived, so never return it raw.
  const local = emailLocalPart(input.email) ?? (full && full.includes("@") ? emailLocalPart(full) : full ?? null);
  const humanized = local ? humanizeEmailLocalPart(local) : "";
  if (humanized) return humanized;

  const company = input.companyName?.trim();
  return company ? `${company} (no contact name)` : "Unknown contact";
}
