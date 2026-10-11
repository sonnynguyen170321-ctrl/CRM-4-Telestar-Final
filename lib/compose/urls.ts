/**
 * What a link or an image in the composer may point at.
 *
 * Pure, client and server. The editor uses these to refuse a bad URL at the toolbar; the server
 * sanitizer (`lib/compose/sanitizeHtml.ts`) enforces the same rules on whatever arrives, because
 * the browser is not a trust boundary.
 */

const MAX_URL_LENGTH = 2048;

/** `javascript:`, `data:`, `file:` and friends are not links a prospect should be sent. */
const LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001f\u007f\s]/.test(value);
}

/**
 * A link target the composer accepts, normalised, or null.
 *
 *  - `http`, `https` and `mailto` only;
 *  - a bare "telestar.vn/book" becomes `https://telestar.vn/book`;
 *  - an address-looking "name@host.com" becomes `mailto:`.
 */
export function normalizeLinkUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.length > MAX_URL_LENGTH || hasControlCharacters(value)) return null;

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value)
    ? value
    : /^[^\s@/]+@[^\s@/]+\.[^\s@/]{2,}$/.test(value)
      ? `mailto:${value}`
      : `https://${value}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!LINK_SCHEMES.has(url.protocol)) return null;
  if (url.protocol !== 'mailto:' && !url.hostname.includes('.')) return null;
  if (url.protocol === 'mailto:' && !url.pathname) return null;
  return withScheme;
}

/** An image address the composer accepts: https only. Returns the URL, or null. */
export function normalizeImageUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.length > MAX_URL_LENGTH || hasControlCharacters(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return url.protocol === 'https:' && url.hostname.includes('.') ? value : null;
}

/** Image types an inline upload may be. */
export const INLINE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

/** One inline image, before it is stored. Larger belongs in an attachment. */
export const MAX_INLINE_IMAGE_BYTES = 1024 * 1024;
