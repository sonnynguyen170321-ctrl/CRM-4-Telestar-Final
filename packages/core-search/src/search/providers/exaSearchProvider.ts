import "server-only";

import type {
  CompanyIntelSearchProvider,
  NormalizedSearchResult,
  SearchCategory,
  SingleProviderOutcome,
} from "../types";
import { domainFromUrl, executeProviderSearch, str } from "./shared";

// CINT2: Exa provider. RAW /search only — type:"auto", numResults, contents.highlights.
// NO outputSchema / Agent / deep variants (no provider-side LLM synthesis this phase).
// `category` routes to Exa's dedicated people/company index — the right lever for
// contact vs company discovery (docs: people/company reject excludeDomains + date
// filters; includeDomains for people is LinkedIn-only, so we send neither).
// Docs source of truth: https://docs.exa.ai/reference/search-api-guide-for-coding-agents
const EXA_ENDPOINT = "https://api.exa.ai/search";

export class ExaSearchProvider implements CompanyIntelSearchProvider {
  readonly provider = "exa" as const;
  constructor(private readonly apiKey: string, private readonly fetchImpl: typeof fetch = fetch) {}

  search(input: { query: string; resultsPerQuery: number; timeoutMs: number; category?: SearchCategory }): Promise<SingleProviderOutcome> {
    return executeProviderSearch({
      provider: "exa",
      fetchImpl: this.fetchImpl,
      timeoutMs: input.timeoutMs,
      buildRequest: () => ({
        url: EXA_ENDPOINT,
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": this.apiKey },
        body: JSON.stringify({
          query: input.query,
          type: "auto",
          numResults: input.resultsPerQuery,
          contents: { highlights: true },
          ...(input.category ? { category: input.category } : {}),
        }),
      }),
      parse: (body) => parseExa(body),
    });
  }
}

function parseExa(body: unknown): NormalizedSearchResult[] {
  const record = (body ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(record.results) ? (record.results as unknown[]) : [];
  const out: NormalizedSearchResult[] = [];
  rows.forEach((row, index) => {
    const r = (row ?? {}) as Record<string, unknown>;
    const url = str(r, "url");
    if (!url) return;
    const highlights = Array.isArray(r.highlights) ? (r.highlights as unknown[]) : [];
    const highlight = highlights.find((h) => typeof h === "string" && h.trim()) as string | undefined;
    out.push({
      provider: "exa",
      title: str(r, "title") ?? "",
      url,
      snippet: null,
      highlight: highlight?.trim() ?? null,
      publishedDate: str(r, "publishedDate"),
      position: index + 1,
      sourceDomain: domainFromUrl(url),
    });
  });
  return out;
}
