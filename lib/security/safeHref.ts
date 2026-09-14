/**
 * Turn a stored, user-supplied URL into something safe to put in an `href`.
 *
 * LinkedIn fields arrive from CSV imports and hand-typed forms, booking-link URLs from a
 * settings screen. Three places rendered them straight into `<a href>`, so a value of
 * `javascript:fetch('/api/...')` executed in the clicking user's authenticated session the
 * moment they tried to open a profile. Two other places already did the right thing by
 * prefixing `https://` when the scheme was missing — which incidentally blocks `javascript:` —
 * but as an ad-hoc expression each time, which is how the third, fourth and fifth site missed it.
 *
 * Only `http:` and `https:` come back. A bare host (`linkedin.com/in/x`) is promoted to `https`.
 * Anything else — `javascript:`, `data:`, `vbscript:`, `file:`, an unparsable string — is `null`,
 * and the caller renders no link rather than a dangerous one.
 */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // A scheme is `letters[+.-]*:`. Anything with one that is not http(s) is refused outright,
  // before the `https://` promotion below could turn `javascript:alert(1)` into a "host".
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1]?.toLowerCase();
  if (scheme && scheme !== 'http' && scheme !== 'https') return null;

  const candidate = scheme ? trimmed : `https://${trimmed.replace(/^\/+/, '')}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
}
