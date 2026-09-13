import "server-only";

import type {
  CompanyIntelSearchProvider,
  NormalizedSearchResult,
  SingleProviderOutcome,
} from "../types";
import { domainFromUrl, executeProviderSearch, str } from "./shared";

// CINT2: Brave Search provider. GET /res/v1/web/search with x-subscription-token.
const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

export class BraveSearchProvider implements CompanyIntelSearchProvider {
  readonly provider = "brave" as const;
  constructor(private readonly apiKey: string, private readonly fetchImpl: typeof fetch = fetch) {}

  search(input: { query: string; resultsPerQuery: number; timeoutMs: number }): Promise<SingleProviderOutcome> {
    return executeProviderSearch({
      provider: "brave",
      fetchImpl: this.fetchImpl,
      timeoutMs: input.timeoutMs,
      buildRequest: () => {
        const url = new URL(BRAVE_ENDPOINT);
        url.searchParams.set("q", input.query);
        url.searchParams.set("count", String(input.resultsPerQuery));
        url.searchParams.set("result_filter", "web");
        url.searchParams.set("search_lang", "en");
        url.searchParams.set("ui_lang", "en-US");
        url.searchParams.set("extra_snippets", "true");
        return {
          url: url.toString(),
          method: "GET",
          headers: { Accept: "application/json", "X-Subscription-Token": this.apiKey },
        };
      },
      parse: (body) => parseBrave(body),
    });
  }
}

function parseBrave(body: unknown): NormalizedSearchResult[] {
  const record = (body ?? {}) as Record<string, unknown>;
  const web = (record.web ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(web.results) ? (web.results as unknown[]) : [];
  const out: NormalizedSearchResult[] = [];
  rows.forEach((row, index) => {
    const r = (row ?? {}) as Record<string, unknown>;
    const url = str(r, "url");
    if (!url) return;
    const extra = Array.isArray(r.extra_snippets) ? (r.extra_snippets as unknown[]) : [];
    const highlight = extra.find((h) => typeof h === "string" && h.trim()) as string | undefined;
    out.push({
      provider: "brave",
      title: str(r, "title") ?? "",
      url,
      snippet: str(r, "description"),
      highlight: highlight?.trim() ?? null,
      publishedDate: str(r, "age") ?? str(r, "page_age"),
      position: index + 1,
      sourceDomain: domainFromUrl(url),
    });
  });
  return out;
}
