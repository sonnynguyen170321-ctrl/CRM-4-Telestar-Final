import { assertSafePublicUrl, assertSafeResolvedIp } from "./urlSafety";

export type DnsLookup = (host: string) => Promise<string | string[]>;

export type SafeFetchResult =
  | { ok: true; status: number; finalUrl: string; redirectChain: string[]; response: Response }
  | { ok: false; reason: string; blockedUrl?: string };

async function defaultLookup(host: string): Promise<string[]> {
  const { lookup } = await import("node:dns/promises");
  const results = await lookup(host, { all: true, verbatim: true });
  return results.map((result) => result.address);
}

export async function safeFetch(
  rawUrl: string,
  init: RequestInit,
  opts: { fetchImpl?: typeof fetch; lookup?: DnsLookup; maxRedirects?: number } = {}
): Promise<SafeFetchResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const lookup = opts.lookup ?? defaultLookup;
  const maxRedirects = opts.maxRedirects ?? 5;
  let currentUrl = rawUrl;
  const redirectChain: string[] = [];

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const structural = assertSafePublicUrl(currentUrl);
    if (!structural.ok) return { ok: false, reason: structural.reason, blockedUrl: currentUrl };

    let addresses: string[];
    try {
      const resolved = await lookup(structural.url.hostname);
      addresses = Array.isArray(resolved) ? resolved : [resolved];
    } catch {
      return { ok: false, reason: "DNS_LOOKUP_FAILED", blockedUrl: currentUrl };
    }
    if (addresses.length === 0) {
      return { ok: false, reason: "DNS_LOOKUP_FAILED", blockedUrl: currentUrl };
    }
    for (const address of addresses) {
      const ipCheck = assertSafeResolvedIp(address);
      if (!ipCheck.ok) return { ok: false, reason: ipCheck.reason, blockedUrl: currentUrl };
    }

    let response: Response;
    try {
      response = await fetchImpl(currentUrl, { ...init, redirect: "manual" });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      return { ok: false, reason: timedOut ? "TIMEOUT" : "NETWORK_ERROR", blockedUrl: currentUrl };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return { ok: true, status: response.status, finalUrl: currentUrl, redirectChain, response };
      }
      const next = new URL(location, currentUrl).toString();
      redirectChain.push(next);
      currentUrl = next;
      continue;
    }

    return { ok: true, status: response.status, finalUrl: currentUrl, redirectChain, response };
  }

  return { ok: false, reason: "TOO_MANY_REDIRECTS", blockedUrl: currentUrl };
}
