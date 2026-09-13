/**
 * Search provider abstraction for company enrichment (S-ENRICH-B).
 *
 * No real search-provider SDK is wired up yet: no provider/env contract has been
 * selected by a human. `StubSearchProvider` always returns no results so the
 * enrichment pipeline can call `SearchProvider.search()` without live network
 * access. Swap in a real provider behind this interface once one is selected.
 */

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  sourceQuery: string;
};

export interface SearchProvider {
  search(query: string): Promise<SearchResult[]>;
}

export class StubSearchProvider implements SearchProvider {
  async search(query: string): Promise<SearchResult[]> {
    void query;
    return [];
  }
}

// ---------------------------------------------------------------------------
// Real, env-gated web-search provider
// ---------------------------------------------------------------------------

export type SearchProviderKind = "brave" | "serpapi" | "bing";

export type HttpSearchProviderConfig = {
  kind: SearchProviderKind;
  apiKey: string;
  endpoint?: string;
  maxResults?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const DEFAULT_ENDPOINTS: Record<SearchProviderKind, string> = {
  brave: "https://api.search.brave.com/res/v1/web/search",
  serpapi: "https://serpapi.com/search",
  bing: "https://api.bing.microsoft.com/v7.0/search",
};

const DEFAULT_SEARCH_TIMEOUT_MS = 6000;
const DEFAULT_SEARCH_MAX_RESULTS = 3;

/**
 * Real web-search provider behind the SearchProvider interface. Provider, key,
 * and endpoint come from env (never hard-coded, never logged — Invariant 9).
 * Any failure (missing key, network, non-200, parse) degrades gracefully to an
 * empty result set so enrichment never throws on search. MUST NOT be used from
 * smoke/benchmark scripts (AGENTS.md): those pass a StubSearchProvider, and
 * getSearchProvider() returns the stub whenever env is not configured.
 */
export class HttpSearchProvider implements SearchProvider {
  private readonly config: Required<Omit<HttpSearchProviderConfig, "fetchImpl">> & {
    fetchImpl: typeof fetch;
  };

  constructor(config: HttpSearchProviderConfig) {
    this.config = {
      kind: config.kind,
      apiKey: config.apiKey,
      endpoint: config.endpoint ?? DEFAULT_ENDPOINTS[config.kind],
      maxResults: config.maxResults ?? DEFAULT_SEARCH_MAX_RESULTS,
      timeoutMs: config.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS,
      fetchImpl: config.fetchImpl ?? fetch,
    };
  }

  async search(query: string): Promise<SearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed || !this.config.apiKey) {
      return [];
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const { url, headers } = buildSearchRequest(this.config, trimmed);
      const response = await this.config.fetchImpl(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        return [];
      }

      const body = (await response.json()) as unknown;
      return parseSearchResponse(this.config.kind, body, trimmed).slice(
        0,
        this.config.maxResults
      );
    } catch {
      // Network/timeout/parse errors degrade to no results (never throw, never
      // log the key). Enrichment continues with website-only evidence.
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}

function buildSearchRequest(
  config: { kind: SearchProviderKind; apiKey: string; endpoint: string; maxResults: number },
  query: string
): { url: string; headers: Record<string, string> } {
  const url = new URL(config.endpoint);

  switch (config.kind) {
    case "brave":
      url.searchParams.set("q", query);
      url.searchParams.set("count", String(config.maxResults));
      return {
        url: url.toString(),
        headers: { Accept: "application/json", "X-Subscription-Token": config.apiKey },
      };
    case "bing":
      url.searchParams.set("q", query);
      url.searchParams.set("count", String(config.maxResults));
      return {
        url: url.toString(),
        headers: { Accept: "application/json", "Ocp-Apim-Subscription-Key": config.apiKey },
      };
    case "serpapi":
      url.searchParams.set("q", query);
      url.searchParams.set("num", String(config.maxResults));
      url.searchParams.set("api_key", config.apiKey);
      return { url: url.toString(), headers: { Accept: "application/json" } };
  }
}

function parseSearchResponse(
  kind: SearchProviderKind,
  body: unknown,
  sourceQuery: string
): SearchResult[] {
  const rows = extractResultRows(kind, body);
  const results: SearchResult[] = [];

  for (const row of rows) {
    const record = row as Record<string, unknown>;
    const title = pickString(record, ["title", "name"]);
    const url = pickString(record, ["url", "link"]);
    const snippet = pickString(record, ["description", "snippet"]);

    if (url) {
      results.push({ title: title ?? "", url, snippet: snippet ?? "", sourceQuery });
    }
  }

  return results;
}

function extractResultRows(kind: SearchProviderKind, body: unknown): unknown[] {
  const record = (body ?? {}) as Record<string, unknown>;

  if (kind === "brave") {
    const web = record.web as Record<string, unknown> | undefined;
    return Array.isArray(web?.results) ? (web!.results as unknown[]) : [];
  }
  if (kind === "bing") {
    const web = record.webPages as Record<string, unknown> | undefined;
    return Array.isArray(web?.value) ? (web!.value as unknown[]) : [];
  }
  // serpapi
  return Array.isArray(record.organic_results) ? (record.organic_results as unknown[]) : [];
}

function pickString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

/** Reads the search-provider config from env, or null when not fully configured. */
export function readSearchProviderConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): HttpSearchProviderConfig | null {
  const kindRaw = (env.V2_SEARCH_PROVIDER ?? "").trim().toLowerCase();
  const apiKey = (env.V2_SEARCH_API_KEY ?? "").trim();

  if (kindRaw !== "brave" && kindRaw !== "serpapi" && kindRaw !== "bing") {
    return null;
  }
  if (!apiKey) {
    return null;
  }

  const maxResults = Number(env.V2_SEARCH_MAX_RESULTS);
  const timeoutMs = Number(env.V2_SEARCH_TIMEOUT_MS);

  return {
    kind: kindRaw,
    apiKey,
    endpoint: env.V2_SEARCH_ENDPOINT?.trim() || undefined,
    maxResults: Number.isFinite(maxResults) && maxResults > 0 ? maxResults : undefined,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : undefined,
  };
}

/**
 * Returns the configured search provider. When env configures a real provider
 * (V2_SEARCH_PROVIDER + V2_SEARCH_API_KEY) the live HttpSearchProvider is used;
 * otherwise the no-op stub. This keeps smoke/benchmark runs (no env) on the stub
 * and never calls a live API unless a human supplied credentials.
 */
export function getSearchProvider(): SearchProvider {
  const config = readSearchProviderConfigFromEnv();
  return config ? new HttpSearchProvider(config) : new StubSearchProvider();
}

/**
 * Builds the funding/news/expansion-style queries used to enrich a company.
 */
export function buildEnrichmentSearchQueries(companyName: string): string[] {
  const trimmed = companyName.trim();

  if (!trimmed) {
    return [];
  }

  return [
    `${trimmed} funding`,
    `${trimmed} news`,
    `${trimmed} expansion`,
  ];
}
