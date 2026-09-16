import "server-only";

import type {
  CompanySearchProvider,
  NormalizedSearchResult,
  ProviderAttempt,
  ProviderRejectionReason,
  SingleProviderOutcome,
} from "../types";

// CINT2: shared HTTP runner for search providers. Handles timeout, latency, and the
// HTTP-status -> {status, rejectionReason} mapping uniformly so each provider only
// supplies a request builder + a response parser. NEVER logs the API key or the raw
// body. Default checks inject fetchImpl (no live API).

export type ProviderHttpRequest = {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
};

export function domainFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function rejectionForHttp(status: number): ProviderRejectionReason {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "request_failed";
}

export async function executeProviderSearch(opts: {
  provider: CompanySearchProvider;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  buildRequest: () => ProviderHttpRequest;
  parse: (body: unknown) => NormalizedSearchResult[];
}): Promise<SingleProviderOutcome> {
  const started = Date.now();
  const baseAttempt = (over: Partial<ProviderAttempt>): ProviderAttempt => ({
    provider: opts.provider,
    status: "ok",
    httpStatus: null,
    latencyMs: Date.now() - started,
    resultCount: 0,
    usableCount: 0,
    evidenceScore: 0,
    rejectionReason: null,
    ...over,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const req = opts.buildRequest();
    const res = await opts.fetchImpl(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      signal: controller.signal,
    });

    if (!res.ok) {
      return {
        attempt: baseAttempt({ status: "http_error", httpStatus: res.status, rejectionReason: rejectionForHttp(res.status) }),
        results: [],
      };
    }

    const body = (await res.json().catch(() => null)) as unknown;
    const results = body ? opts.parse(body) : [];
    return {
      attempt: baseAttempt({
        status: results.length > 0 ? "ok" : "ok",
        httpStatus: res.status,
        resultCount: results.length,
        rejectionReason: results.length === 0 ? "zero_results" : null,
      }),
      results,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      attempt: baseAttempt({
        status: aborted ? "timeout" : "network_error",
        rejectionReason: aborted ? "timeout" : "request_failed",
      }),
      results: [],
    };
  } finally {
    clearTimeout(timer);
  }
}

// Sibling of executeProviderSearch for providers whose response is HTML/text (e.g. DuckDuckGo's
// html endpoint has no JSON API). Same timeout + http->rejection handling; parses a text body.
export async function executeProviderSearchText(opts: {
  provider: CompanySearchProvider;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  buildRequest: () => ProviderHttpRequest;
  parse: (body: string) => NormalizedSearchResult[];
}): Promise<SingleProviderOutcome> {
  const started = Date.now();
  const baseAttempt = (over: Partial<ProviderAttempt>): ProviderAttempt => ({
    provider: opts.provider,
    status: "ok",
    httpStatus: null,
    latencyMs: Date.now() - started,
    resultCount: 0,
    usableCount: 0,
    evidenceScore: 0,
    rejectionReason: null,
    ...over,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const req = opts.buildRequest();
    const res = await opts.fetchImpl(req.url, { method: req.method, headers: req.headers, body: req.body, signal: controller.signal });
    if (!res.ok) {
      return {
        attempt: baseAttempt({ status: "http_error", httpStatus: res.status, rejectionReason: rejectionForHttp(res.status) }),
        results: [],
      };
    }
    const text = await res.text().catch(() => "");
    const results = text ? opts.parse(text) : [];
    return {
      attempt: baseAttempt({ httpStatus: res.status, resultCount: results.length, rejectionReason: results.length === 0 ? "zero_results" : null }),
      results,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      attempt: baseAttempt({ status: aborted ? "timeout" : "network_error", rejectionReason: aborted ? "timeout" : "request_failed" }),
      results: [],
    };
  } finally {
    clearTimeout(timer);
  }
}

export function str(record: Record<string, unknown>, key: string): string | null {
  const v = record[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Remove search operators a neural provider does not implement.
 *
 * The discovery planner writes one query string for every provider in the chain. Brave and Serper
 * are keyword engines and honour `site:` / `-site:`; Exa is neural, and its reference is explicit:
 * "Use this parameter for domain or path filtering instead of adding a `site:` operator to the
 * query." Sent anyway, the operator is not a filter — it is embedded in the semantic query and
 * steers it. A production contact run asked for `site:linkedin.com/in "CEO" "Saas" Singapore`,
 * got back 200 with pages that were not profiles, and `parseContactHits` discarded all of them.
 *
 * Quoted phrases are left alone: Exa does use those.
 */
export function stripUnsupportedOperators(query: string): string {
  const stripped = query
    .replace(/(^|\s)-?site:\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // A query that was nothing but operators would become an empty string, and an empty query asks
  // for everything. Keep the original, whose domain at least reads as a semantic hint.
  return stripped.length > 0 ? stripped : query;
}
