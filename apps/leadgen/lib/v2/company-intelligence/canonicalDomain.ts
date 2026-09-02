/**
 * Canonical domain normalization for company enrichment.
 *
 * canonicalDomain is the key used for fetch, persistence, idempotency, rate limiting,
 * and comparison. websiteUrl / finalUrl preserve the full URL separately.
 */

export type CanonicalDomainResult =
  | { ok: true; canonicalDomain: string }
  | { ok: false; reason: "INVALID_URL" };

/**
 * Lowercase, strip protocol, strip leading "www.", strip path/query/hash/trailing slash.
 *
 * Examples:
 *   "HTTPS://WWW.Example.COM/about?x=1" -> "example.com"
 *   "http://example.com/"               -> "example.com"
 *   "www.example.com/contact"           -> "example.com"
 */
export function normalizeCanonicalDomain(
  value: string | null | undefined
): CanonicalDomainResult {
  const trimmed = (value ?? "").trim();

  if (!trimmed) {
    return { ok: false, reason: "INVALID_URL" };
  }

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;

  try {
    parsed = new URL(withProtocol);
  } catch {
    return { ok: false, reason: "INVALID_URL" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "INVALID_URL" };
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");

  if (!host || !host.includes(".")) {
    return { ok: false, reason: "INVALID_URL" };
  }

  return { ok: true, canonicalDomain: host };
}

/**
 * Whether two canonical domains likely refer to the same company, used to decide
 * whether a redirect's finalUrl may update canonicalDomain. Conservative: exact
 * match or a subdomain relationship only.
 */
export function domainsBelongToSameCompany(
  domainA: string | null | undefined,
  domainB: string | null | undefined
): boolean {
  if (!domainA || !domainB) {
    return false;
  }

  if (domainA === domainB) {
    return true;
  }

  return (
    domainA.endsWith(`.${domainB}`) || domainB.endsWith(`.${domainA}`)
  );
}

/**
 * Builds a fully-qualified https URL for fetching, given a canonical domain and an
 * optional path (e.g. "/about").
 */
export function buildFetchUrl(canonicalDomain: string, path = "/"): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  return `https://${canonicalDomain}${normalizedPath}`;
}
