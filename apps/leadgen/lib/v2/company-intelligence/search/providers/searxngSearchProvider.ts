import "server-only";

import type {
  CompanyIntelSearchProvider,
  NormalizedSearchResult,
  SingleProviderOutcome,
} from "../types";
import { domainFromUrl, executeProviderSearch, str } from "./shared";

// OSS/self-hosted provider: SearXNG. A metasearch engine that aggregates Google/Bing/
// DuckDuckGo/Brave/etc behind one free JSON API — the closest self-hostable stand-in for a
// paid SERP. Configured by SEARXNG_URL (a base URL, not a secret). Requires the instance to
// enable `search.formats: [json]`. `category` is ignored (SERP, not neural). `site:` dorks
// pass through to the upstream engines.
export class SearxngSearchProvider implements CompanyIntelSearchProvider {
  readonly provider = "searxng" as const;
  constructor(private readonly baseUrl: string, private readonly fetchImpl: typeof fetch = fetch) {}

  search(input: { query: string; resultsPerQuery: number; timeoutMs: number }): Promise<SingleProviderOutcome> {
    return executeProviderSearch({
      provider: "searxng",
      fetchImpl: this.fetchImpl,
      timeoutMs: input.timeoutMs,
      buildRequest: () => {
        const url = new URL("/search", this.baseUrl.replace(/\/+$/, "") + "/");
        url.searchParams.set("q", input.query);
        url.searchParams.set("format", "json");
        url.searchParams.set("categories", "general");
        url.searchParams.set("language", "en");
        return {
          url: url.toString(),
          method: "GET",
          headers: { Accept: "application/json" },
        };
      },
      parse: (body) => parseSearxng(body, input.resultsPerQuery),
    });
  }
}

function parseSearxng(body: unknown, limit: number): NormalizedSearchResult[] {
  const record = (body ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(record.results) ? (record.results as unknown[]) : [];
  const out: NormalizedSearchResult[] = [];
  for (const row of rows) {
    const r = (row ?? {}) as Record<string, unknown>;
    const url = str(r, "url");
    if (!url) continue;
    out.push({
      provider: "searxng",
      title: str(r, "title") ?? "",
      url,
      snippet: str(r, "content"),
      highlight: null,
      publishedDate: str(r, "publishedDate"),
      position: out.length + 1,
      sourceDomain: domainFromUrl(url),
    });
    if (out.length >= limit) break;
  }
  return out;
}
