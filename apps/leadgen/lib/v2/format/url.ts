// Client-safe external-link helper.
//
// Stored URLs frequently arrive WITHOUT a scheme — "example.com", "www.foo.com/careers",
// "linkedin.com/in/jane". If such a value is dropped straight into <a href={...}>, the browser
// resolves it RELATIVE to the current path (e.g. /v2/crm/example.com) and the user lands on the
// app's 404 page instead of the real site. This normalizes any stored URL/domain into a safe,
// fully-qualified http(s) href — or returns null so the caller can hide a broken link rather than
// render a dead one.
//
// Usage:
//   const site = toExternalHref(company.websiteUrl ?? company.canonicalDomain);
//   {site ? <a href={site} target="_blank" rel="noreferrer">Website</a> : null}

// Build a Google search URL from parts (name + title + company). Used to reach a person's
// LinkedIn/profile VIA Google results instead of hitting linkedin.com directly (heavy direct
// traffic risks a LinkedIn account ban). Returns null when there's nothing to search for.
//   const g = toGoogleSearchHref([contact.fullName, contact.title, company.name]);
//   {g ? <a href={g} target="_blank" rel="noreferrer">Google</a> : null}
export function toGoogleSearchHref(parts: Array<string | null | undefined>): string | null {
  const query = parts
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!query) return null;
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

export function toExternalHref(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;

  // Leave real schemes (http/https/mailto/tel) alone; add https:// to bare hosts/paths.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  const candidate = hasScheme
    ? trimmed
    : `https://${trimmed.replace(/^\/+/, "")}`;

  try {
    const url = new URL(candidate);
    // Only http(s) are safe to open as an external site link.
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // Reject garbage like "https://foo" with no dot in the host.
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}
