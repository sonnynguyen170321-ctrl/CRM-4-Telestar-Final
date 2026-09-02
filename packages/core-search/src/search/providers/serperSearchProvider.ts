import "server-only";

import type {
  CompanyIntelSearchProvider,
  NormalizedSearchResult,
  SingleProviderOutcome,
} from "../types";
import { domainFromUrl, executeProviderSearch, str } from "./shared";

// CINT2: Serper (google.serper.dev) provider. POST /search with X-API-KEY.
const SERPER_ENDPOINT = "https://google.serper.dev/search";

export class SerperSearchProvider implements CompanyIntelSearchProvider {
  readonly provider = "serper" as const;
  constructor(private readonly apiKey: string, private readonly fetchImpl: typeof fetch = fetch) {}

  search(input: { query: string; resultsPerQuery: number; timeoutMs: number }): Promise<SingleProviderOutcome> {
    return executeProviderSearch({
      provider: "serper",
      fetchImpl: this.fetchImpl,
      timeoutMs: input.timeoutMs,
      buildRequest: () => ({
        url: SERPER_ENDPOINT,
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": this.apiKey },
        body: JSON.stringify({ q: input.query, num: input.resultsPerQuery, gl: "us", hl: "en" }),
      }),
      parse: (body) => parseSerper(body),
    });
  }
}

function parseSerper(body: unknown): NormalizedSearchResult[] {
  const record = (body ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(record.organic) ? (record.organic as unknown[]) : [];
  const out: NormalizedSearchResult[] = [];
  rows.forEach((row, index) => {
    const r = (row ?? {}) as Record<string, unknown>;
    const url = str(r, "link");
    if (!url) return;
    const position = typeof r.position === "number" ? (r.position as number) : index + 1;
    out.push({
      provider: "serper",
      title: str(r, "title") ?? "",
      url,
      snippet: str(r, "snippet"),
      highlight: null,
      publishedDate: str(r, "date"),
      position,
      sourceDomain: domainFromUrl(url),
    });
  });
  return out;
}
