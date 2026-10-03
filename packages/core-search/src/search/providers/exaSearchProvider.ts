import "server-only";

import type {
  CompanyIntelSearchProvider,
  NormalizedSearchResult,
  SearchCategory,
  SingleProviderOutcome,
} from "../types";
import { domainFromUrl, executeProviderSearch, str, stripUnsupportedOperators } from "./shared";

// CINT2: Exa provider. RAW /search only — type:"auto", numResults, contents.highlights.
// NO outputSchema / Agent / deep variants (no provider-side LLM synthesis this phase).
// `category` routes to Exa's dedicated people/company index — the right lever for
// contact vs company discovery. Both "people" and "company" are valid category values;
// `people`/`company` reject excludeDomains and date filters, so we send neither.
// Docs source of truth: https://docs.exa.ai/reference/search-api-guide-for-coding-agents
const EXA_ENDPOINT = "https://api.exa.ai/search";

// Highlight budget per URL. `highlights: true` returned one short passage, and only the first was
// kept, so a LinkedIn profile arrived as a fragment that often missed the job title entirely.
// `maxCharacters` is the supported control (spec: `numSentences` deprecated, `highlightsPerUrl`
// ignored — checked against exa-spec.yaml on 2026-10-03). Billing is per result, not per character.
export const EXA_HIGHLIGHT_MAX_CHARACTERS = 1500;

// For people, the passage worth having is the one naming who they are. A guiding query steers the
// extractor there. Companies keep Exa's default selection: their highlight is the structured
// LinkedIn company block that `lib/research/evidenceFacts.ts` parses, and steering it would break
// that shape.
const PEOPLE_HIGHLIGHT_QUERY = "current job title, employer, seniority and location";

function highlightsFor(category: SearchCategory | undefined) {
  return category === "people"
    ? { query: PEOPLE_HIGHLIGHT_QUERY, maxCharacters: EXA_HIGHLIGHT_MAX_CHARACTERS }
    : { maxCharacters: EXA_HIGHLIGHT_MAX_CHARACTERS };
}

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
          // `site:` is a keyword-engine operator; Exa's reference says to filter by parameter
          // instead of putting one in the query. Stripping it is still right, but it was not the
          // cause of the empty contact runs — measured on 2026-09-17, Exa returns the same
          // LinkedIn profiles with the operator present or absent. The results were being lost
          // afterwards, in `parseContactHits`; see the note there.
          query: stripUnsupportedOperators(input.query),
          type: "auto",
          numResults: input.resultsPerQuery,
          contents: { highlights: highlightsFor(input.category) },
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
    // Every passage, not the first: the title is often in the second. Joined with an ellipsis so the
    // evidence card reads them as separate excerpts rather than one run-on sentence.
    const passages = highlights
      .filter((h): h is string => typeof h === "string" && h.trim().length > 0)
      .map((h) => h.trim());
    const highlight = passages.length > 0 ? passages.join(" … ") : undefined;
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
