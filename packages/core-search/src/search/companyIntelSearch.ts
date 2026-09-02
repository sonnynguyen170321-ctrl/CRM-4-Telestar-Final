import "server-only";

import { getProviderApiKey, isOssSearchProvider, readCompanyIntelSearchConfig, resolveUsableProviderChain } from "./env";
import { computeSufficiency, scoreSearchResults } from "./scoreSearchResult";
import { ExaSearchProvider } from "./providers/exaSearchProvider";
import { BraveSearchProvider } from "./providers/braveSearchProvider";
import { SerperSearchProvider } from "./providers/serperSearchProvider";
import { SearxngSearchProvider } from "./providers/searxngSearchProvider";
import { DdgSearchProvider } from "./providers/ddgSearchProvider";
import { buildCompanySearchQueries, type CompanyQueryInput } from "./buildCompanySearchQueries";
import type {
  CompanyIntelSearchProvider,
  CompanyIntelSearchResponse,
  CompanySearchProvider,
  CompanySearchPurpose,
  NormalizedSearchResult,
  ProviderAttempt,
  SearchCategory,
} from "./types";

// CINT2: the Exa -> Brave -> Serper orchestrator. Per query it walks the chain,
// scores each provider's results (CINT1 deterministic usability/sufficiency), and
// STOPS at the first sufficient provider (no double-check). Falls back only on
// failure / timeout / 401/403/429/5xx / zero / below-min-usable / mostly-noise.
// Persistable: returns sanitized attempt trace (no keys, no raw bodies).

export type SearchDeps = {
  providers: CompanyIntelSearchProvider[];
  timeoutMs: number;
  resultsPerQuery: number;
  minUsableResults: number;
  maxProviderAttemptsPerQuery: number;
};

/** Build the ordered usable provider chain from env (server-only). */
export function createProvidersFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch
): CompanyIntelSearchProvider[] {
  return resolveUsableProviderChain(env).map((p) => makeProvider(p, getProviderApiKey(p, env), fetchImpl));
}

function makeProvider(p: CompanySearchProvider, key: string, fetchImpl: typeof fetch): CompanyIntelSearchProvider {
  if (p === "exa") return new ExaSearchProvider(key, fetchImpl);
  if (p === "brave") return new BraveSearchProvider(key, fetchImpl);
  if (p === "serper") return new SerperSearchProvider(key, fetchImpl);
  if (p === "searxng") return new SearxngSearchProvider(key, fetchImpl); // `key` = SEARXNG_URL
  return new DdgSearchProvider(fetchImpl); // ddg — keyless
}

export function searchDepsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch
): SearchDeps {
  const c = readCompanyIntelSearchConfig(env);
  return {
    providers: createProvidersFromEnv(env, fetchImpl),
    timeoutMs: c.timeoutMs,
    resultsPerQuery: c.resultsPerQuery,
    minUsableResults: c.minUsableResults,
    maxProviderAttemptsPerQuery: c.maxProviderAttemptsPerQuery,
  };
}

// Process-wide cap on concurrent provider calls. High enrichment concurrency (network-bound,
// ~12-20 companies at once) would otherwise fire dozens of simultaneous SERP calls and trip
// provider rate limits (DDG especially). Overflow waits for a slot. Env-tunable.
function searchMaxConcurrency(): number {
  const n = Number(process.env.COMPANY_INTEL_SEARCH_MAX_CONCURRENCY);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 8;
}
let searchActive = 0;
const searchWaiters: Array<() => void> = [];
async function acquireSearchSlot(): Promise<() => void> {
  if (searchActive < searchMaxConcurrency()) {
    searchActive += 1;
  } else {
    await new Promise<void>((resolve) => searchWaiters.push(resolve)); // slot handed over on release
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = searchWaiters.shift();
    if (next) next(); // hand the slot to the next waiter (count unchanged)
    else searchActive -= 1;
  };
}

export async function runQueryAcrossProviders(
  input: { query: string; purpose: CompanySearchPurpose; canonicalDomain?: string | null; category?: SearchCategory },
  deps: SearchDeps
): Promise<CompanyIntelSearchResponse> {
  const releaseSlot = await acquireSearchSlot();
  try {
    return await runQueryAcrossProvidersInner(input, deps);
  } finally {
    releaseSlot();
  }
}

async function runQueryAcrossProvidersInner(
  input: { query: string; purpose: CompanySearchPurpose; canonicalDomain?: string | null; category?: SearchCategory },
  deps: SearchDeps
): Promise<CompanyIntelSearchResponse> {
  const attempts: ProviderAttempt[] = [];
  const attemptedProviders: CompanySearchProvider[] = [];
  let best: { provider: CompanySearchProvider; results: NormalizedSearchResult[]; score: number } | null = null;

  // Cap the number of PAID providers tried, but always keep the free OSS providers (SearXNG/DDG)
  // in the tried set — otherwise dead-but-present paid keys in the first slots starve the fallback.
  const paidHead = deps.providers.filter((p) => !isOssSearchProvider(p.provider)).slice(0, deps.maxProviderAttemptsPerQuery);
  const oss = deps.providers.filter((p) => isOssSearchProvider(p.provider));
  const chain = [...paidHead, ...oss];
  for (const provider of chain) {
    attemptedProviders.push(provider.provider);
    const outcome = await provider.search({
      query: input.query,
      purpose: input.purpose,
      resultsPerQuery: deps.resultsPerQuery,
      timeoutMs: deps.timeoutMs,
      category: input.category,
    });

    const scored = scoreSearchResults(outcome.results, { canonicalDomain: input.canonicalDomain });
    const usable = scored.filter((s) => s.usable).map((s) => s.result);
    const sufficiency = computeSufficiency(scored, deps.minUsableResults);

    const attempt: ProviderAttempt = {
      ...outcome.attempt,
      usableCount: sufficiency.usableCount,
      evidenceScore: sufficiency.totalScore,
      rejectionReason: deriveRejection(outcome.attempt, sufficiency.usableCount, outcome.results.length, sufficiency.sufficient),
    };
    attempts.push(attempt);

    if (!best || sufficiency.totalScore > best.score) {
      best = { provider: provider.provider, results: usable, score: sufficiency.totalScore };
    }

    if (attempt.status === "ok" && sufficiency.sufficient) {
      return {
        query: input.query,
        purpose: input.purpose,
        providerUsed: provider.provider,
        attemptedProviders,
        attempts,
        results: usable,
        sufficiency,
      };
    }
    // else fall through to next provider
  }

  // No provider sufficient — return best-effort with the strongest evidence seen.
  const bestScored = best ? scoreSearchResults(best.results, { canonicalDomain: input.canonicalDomain }) : [];
  return {
    query: input.query,
    purpose: input.purpose,
    providerUsed: best && best.results.length > 0 ? best.provider : null,
    attemptedProviders,
    attempts,
    results: best?.results ?? [],
    sufficiency: computeSufficiency(bestScored, deps.minUsableResults),
  };
}

function deriveRejection(
  attempt: ProviderAttempt,
  usableCount: number,
  rawCount: number,
  sufficient: boolean
): ProviderAttempt["rejectionReason"] {
  if (attempt.rejectionReason && attempt.status !== "ok") return attempt.rejectionReason; // http/timeout/network
  if (sufficient) return null;
  if (rawCount === 0) return "zero_results";
  if (usableCount === 0) return "mostly_noise";
  return "below_min_usable";
}

export type CompanyIntelSearchAggregate = {
  queries: CompanyIntelSearchResponse[];
  results: NormalizedSearchResult[];
  sufficient: boolean;
};

/** Company-level: run up to maxQueriesPerCompany, stop once aggregate is sufficient. */
export async function searchCompanyIntel(
  input: CompanyQueryInput & { maxQueriesPerCompany: number },
  deps: SearchDeps
): Promise<CompanyIntelSearchAggregate> {
  const queries = buildCompanySearchQueries(input).slice(0, Math.max(1, input.maxQueriesPerCompany));
  const responses: CompanyIntelSearchResponse[] = [];
  const all: NormalizedSearchResult[] = [];

  for (const q of queries) {
    const resp = await runQueryAcrossProviders(
      { query: q.query, purpose: q.purpose, canonicalDomain: input.canonicalDomain },
      deps
    );
    responses.push(resp);
    all.push(...resp.results);
    const aggregate = computeSufficiency(
      scoreSearchResults(all, { canonicalDomain: input.canonicalDomain }),
      deps.minUsableResults
    );
    if (aggregate.sufficient) {
      return { queries: responses, results: dedupeByUrl(all), sufficient: true };
    }
  }

  const finalScored = scoreSearchResults(all, { canonicalDomain: input.canonicalDomain });
  return {
    queries: responses,
    results: dedupeByUrl(all),
    sufficient: computeSufficiency(finalScored, deps.minUsableResults).sufficient,
  };
}

function dedupeByUrl(results: NormalizedSearchResult[]): NormalizedSearchResult[] {
  const seen = new Set<string>();
  const out: NormalizedSearchResult[] = [];
  for (const r of results) {
    const key = r.url.trim().toLowerCase().replace(/\/+$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
