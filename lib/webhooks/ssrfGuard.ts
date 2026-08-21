import { lookup } from 'node:dns/promises';
import { lookup as lookupCb } from 'node:dns';
import { Agent } from 'undici';

/**
 * Refuse webhook destinations that point back inside our own network.
 *
 * `deliverWebhook` used to call `fetch(url)` with no validation beyond the route checking
 * `url.startsWith('http')`. Any authenticated user could therefore make the production VM issue
 * a POST, with a body they controlled, to any address it could reach — and read back the status
 * code, the latency and the error string. That is server-side request forgery with a response
 * oracle: enough to port-scan and fingerprint the internal network from outside (TEL-P1-030).
 *
 * The check is deliberately on resolved addresses rather than on the hostname text. That is
 * what makes the exotic encodings fall out for free: `http://2130706433/`, `http://0x7f000001/`
 * and a DNS name whose A record is 10.0.0.5 all resolve to a blocked address, so none of them
 * needs its own special case.
 *
 * Two layers, because one of them is a check-then-use and CodeQL was right to say so
 * (`js/request-forgery`, critical). `assertPublicDestination` validates before the request and
 * gives a clear early error naming the destination; `guardedDispatcher` at the bottom of this
 * file re-runs the same address rules inside the connector, against the address the socket is
 * actually about to use. The DNS-rebinding window an earlier version of this file recorded as
 * residual is closed by the second layer.
 */

export type DestinationVerdict = { ok: true } | { ok: false; reason: string };

/** Parsed once so every rule below reads the same normalised form. */
function parse(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

function ipv4Blocked(ip: string): string | null {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return 'not a valid IPv4 address';
  }
  const [a, b] = parts;

  if (a === 0) return 'unspecified / this-network (0.0.0.0/8)';
  if (a === 10) return 'private (10.0.0.0/8)';
  if (a === 127) return 'loopback (127.0.0.0/8)';
  if (a === 169 && b === 254) return 'link-local, includes cloud metadata (169.254.0.0/16)';
  if (a === 172 && b >= 16 && b <= 31) return 'private (172.16.0.0/12)';
  if (a === 192 && b === 168) return 'private (192.168.0.0/16)';
  if (a === 100 && b >= 64 && b <= 127) return 'carrier-grade NAT (100.64.0.0/10)';
  if (a === 192 && b === 0) return 'IETF protocol assignments (192.0.0.0/24)';
  if (a >= 224) return 'multicast or reserved (224.0.0.0/4 and above)';
  return null;
}

function ipv6Blocked(ip: string): string | null {
  const lower = ip.toLowerCase().split('%')[0];

  // IPv4-mapped and IPv4-compatible forms carry an IPv4 address inside an IPv6 one.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/) ?? lower.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) {
    const inner = ipv4Blocked(mapped[1]);
    return inner ? `IPv4-mapped ${inner}` : null;
  }

  if (lower === '::' ) return 'unspecified (::)';
  if (lower === '::1') return 'IPv6 loopback (::1)';
  if (/^f[cd]/.test(lower)) return 'IPv6 unique local address (fc00::/7)';
  if (/^fe[89ab]/.test(lower)) return 'IPv6 link-local (fe80::/10)';
  if (/^ff/.test(lower)) return 'IPv6 multicast (ff00::/8)';
  return null;
}

/** Why this resolved address may not be contacted, or null if it is fine. */
export function blockedAddressReason(ip: string, family?: number): string | null {
  if (family === 6 || ip.includes(':')) return ipv6Blocked(ip);
  return ipv4Blocked(ip);
}

/**
 * Rules that need no network: scheme, credentials, and an explicit destination.
 * Separated so it can be tested without DNS, and so the route can reject early.
 */
export function checkDestinationShape(rawUrl: string): DestinationVerdict {
  const url = parse(rawUrl);
  if (!url) return { ok: false, reason: 'not a valid URL' };

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    // `startsWith('http')` also admitted things like `httpx://`; be explicit instead.
    return { ok: false, reason: `unsupported scheme ${url.protocol}` };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'credentials in the URL are not accepted' };
  }
  if (!url.hostname) {
    return { ok: false, reason: 'no host' };
  }
  return { ok: true };
}

export type LookupFn = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

const defaultLookup: LookupFn = (hostname) => lookup(hostname, { all: true, verbatim: true });

/**
 * Full check: shape, then every address the hostname resolves to.
 *
 * Every address must pass. A hostname with one public and one private A record is refused,
 * because which one `fetch` connects to is not ours to choose.
 */
export async function assertPublicDestination(
  rawUrl: string,
  lookupFn: LookupFn = defaultLookup,
): Promise<DestinationVerdict> {
  const shape = checkDestinationShape(rawUrl);
  if (!shape.ok) return shape;

  const url = parse(rawUrl)!;
  const host = url.hostname.replace(/^\[|\]$/g, '');

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookupFn(host);
  } catch {
    return { ok: false, reason: `could not resolve ${host}` };
  }

  if (!addresses || addresses.length === 0) {
    return { ok: false, reason: `${host} resolved to no addresses` };
  }

  for (const { address, family } of addresses) {
    const reason = blockedAddressReason(address, family);
    if (reason) {
      return { ok: false, reason: `${host} resolves to ${address}: ${reason}` };
    }
  }

  return { ok: true };
}

/**
 * A dispatcher that re-checks the address at the moment it connects.
 *
 * `assertPublicDestination` is a check-then-use: it validates what the hostname resolved to a
 * moment ago, and `fetch` then resolves it again itself. CodeQL flags exactly this
 * (`js/request-forgery`, critical) and is right to — a guard that runs before the connection is
 * not a sanitizer, and DNS rebinding lives in the gap.
 *
 * Undici lets the connector's DNS lookup be replaced, so the same rules run against the address
 * the socket is actually about to use. The window closes: there is no longer a resolution that
 * happens after the check.
 *
 * Both layers are kept. This one is authoritative; the earlier check stays because it produces
 * a clear, early error message naming the destination, rather than a connect-time failure.
 */
export const guardedDispatcher = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      // Resolve every address so all of them can be checked, regardless of what the caller
      // asked for — then answer in the shape the caller expects. Getting this wrong does not
      // fail safe: replying with the single-address shape while `all` was requested hands the
      // connector `undefined` and breaks every legitimate delivery.
      const wantsAll = Boolean((options as { all?: boolean })?.all);

      lookupCb(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
        if (err) return callback(err, '', 0);

        const list = Array.isArray(addresses) ? addresses : [];
        if (list.length === 0) {
          return callback(new Error(`${hostname} resolved to no addresses`), '', 0);
        }

        for (const entry of list) {
          const reason = blockedAddressReason(entry.address, entry.family);
          if (reason) {
            // Refused at connect time, so a record that changed since the pre-check cannot be
            // used. This is the DNS-rebinding case.
            return callback(
              new Error(`Refused webhook destination: ${hostname} resolves to ${entry.address}: ${reason}`),
              '',
              0,
            );
          }
        }

        if (wantsAll) return callback(null, list as never);
        const first = list[0];
        return callback(null, first.address, first.family);
      });
    },
  },
});
