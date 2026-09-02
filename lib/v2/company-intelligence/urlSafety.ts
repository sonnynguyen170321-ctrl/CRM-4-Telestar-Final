// CINT1: SSRF guard for company-intelligence outbound fetches (website crawl +
// search-result content fetch). The legacy canonicalDomain check only required a
// dot in the hostname — it did not block localhost, private IPs, link-local, the
// cloud metadata endpoint, or credentials-in-URL, and it never re-checked redirect
// hops. This module is the structural gate; CINT2 wires assertSafeResolvedIp into
// the fetch layer to also block DNS-rebinding (resolve host -> IP -> check on every
// hop). Pure (no I/O) so it is unit-testable.

export type UrlSafetyResult = { ok: true; url: URL } | { ok: false; reason: string };

const BLOCKED_HOST_SUFFIXES = [".local", ".internal", ".localhost", ".lan", ".home.arpa"];
const BLOCKED_HOST_EXACT = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
]);

/**
 * Structural safety check for a URL we are about to fetch. Allows only http(s),
 * rejects credentials-in-URL, and blocks localhost aliases + private / loopback /
 * link-local / reserved IP literals (incl. the 169.254.169.254 metadata IP).
 */
export function assertSafePublicUrl(raw: string): UrlSafetyResult {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, reason: "EMPTY_URL" };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: "INVALID_URL" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "NON_HTTP_PROTOCOL" };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "CREDENTIALS_IN_URL" };
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return { ok: false, reason: "EMPTY_HOST" };
  if (isBlockedHost(host)) return { ok: false, reason: "BLOCKED_HOST" };

  return { ok: true, url };
}

/** True for localhost aliases, non-public TLDs, or private/reserved IP literals. */
export function isBlockedHost(host: string): boolean {
  // URL.hostname keeps IPv6 literals bracketed ("[::1]") — strip for the IP check.
  const h = host.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (BLOCKED_HOST_EXACT.has(h)) return true;
  if (BLOCKED_HOST_SUFFIXES.some((s) => h.endsWith(s))) return true;
  if (!h.includes(".") && !h.includes(":")) return true; // bare hostname, no public TLD

  // IPv6 literal (URL hostname strips the [] brackets).
  if (h.includes(":")) return isBlockedIpv6(h);

  // IPv4 literal.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return isPrivateIpv4(h);

  return false;
}

export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return true; // malformed -> treat as unsafe
  }
  const [a, b] = parts;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

export function isBlockedIpv6(ip: string): boolean {
  const h = ip.toLowerCase();
  if (h === "::1" || h === "::") return true; // loopback / unspecified
  if (h.startsWith("fe80") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) return true; // link-local fe80::/10
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // unique-local fc00::/7
  if (h.startsWith("::ffff:")) return isPrivateIpv4(h.slice(7)); // IPv4-mapped
  return false;
}

/**
 * To be called by the fetch layer (CINT2) AFTER DNS resolution, on the resolved IP
 * of every redirect hop, to defeat DNS rebinding. Pure check on an IP literal.
 */
export function assertSafeResolvedIp(ip: string): UrlSafetyResult {
  const blocked = ip.includes(":") ? isBlockedIpv6(ip.toLowerCase()) : isPrivateIpv4(ip);
  return blocked ? { ok: false, reason: "BLOCKED_RESOLVED_IP" } : { ok: true, url: new URL(`https://${ip}`) };
}
