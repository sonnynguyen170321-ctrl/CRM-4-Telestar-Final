// CINT1: company-intel search contracts. Engine/enrichment consume ONLY these
// normalized shapes — never a raw provider response (Invariant: no provider leakage
// into UI/scoring). The provider chain (CINT2) produces a structured outcome with a
// sanitized attempt trace (no API keys) so fallback is observable and decidable.

export type CompanySearchProvider = "exa" | "brave" | "serper" | "ddg" | "searxng";

// Entity category hint. Neural providers (Exa) route to a dedicated people/company
// index; SERP providers (brave/serper/ddg/searxng) ignore it and rely on the query.
export type SearchCategory = "people" | "company";

export type CompanySearchPurpose =
  | "official_domain"
  | "company_profile"
  | "product_evidence"
  | "customer_evidence"
  | "partnership_signal"
  | "news_or_market_signal";

export type NormalizedSearchResult = {
  provider: CompanySearchProvider;
  title: string;
  url: string;
  snippet: string | null;
  highlight: string | null; // Exa highlights / Brave extra_snippets / Serper snippet
  publishedDate: string | null;
  position: number | null;
  sourceDomain: string | null;
};

export type ProviderAttemptStatus = "ok" | "http_error" | "timeout" | "network_error" | "insufficient";

// Why the chain moved past a provider — drives observable, decidable fallback.
export type ProviderRejectionReason =
  | "request_failed"
  | "timeout"
  | "unauthorized" // 401/403
  | "rate_limited" // 429
  | "server_error" // 5xx
  | "zero_results"
  | "below_min_usable"
  | "mostly_noise"
  | null;

export type ProviderAttempt = {
  provider: CompanySearchProvider;
  status: ProviderAttemptStatus;
  httpStatus: number | null;
  latencyMs: number;
  resultCount: number;
  usableCount: number;
  evidenceScore: number;
  rejectionReason: ProviderRejectionReason;
  // NEVER include the API key or raw provider body here.
};

export type EvidenceSufficiency = {
  sufficient: boolean;
  usableCount: number;
  totalScore: number;
  uniqueDomains: number;
};

export type CompanyIntelSearchResponse = {
  query: string;
  purpose: CompanySearchPurpose;
  providerUsed: CompanySearchProvider | null;
  attemptedProviders: CompanySearchProvider[];
  attempts: ProviderAttempt[];
  results: NormalizedSearchResult[];
  sufficiency: EvidenceSufficiency;
};

// A single provider implementation returns this; the chain orchestrator (CINT2)
// turns a sequence of these into a CompanyIntelSearchResponse.
export type SingleProviderOutcome = {
  attempt: ProviderAttempt;
  results: NormalizedSearchResult[];
};

export interface CompanyIntelSearchProvider {
  readonly provider: CompanySearchProvider;
  search(input: {
    query: string;
    purpose: CompanySearchPurpose;
    resultsPerQuery: number;
    timeoutMs: number;
    category?: SearchCategory;
  }): Promise<SingleProviderOutcome>;
}
