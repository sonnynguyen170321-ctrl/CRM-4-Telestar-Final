import "server-only";

import type { CompanySearchProvider } from "./types";

// CINT1: server-only env contract for company-intel search. Reads COMPANY_INTEL_*
// config + provider keys. NEVER returns or logs raw key values — only a boolean
// "configured" per provider, so callers/telemetry can reason about availability
// without leaking secrets (Invariant 9). Server-only import bars client bundling.

const VALID_PROVIDERS: CompanySearchProvider[] = ["exa", "brave", "serper", "searxng", "ddg"];

export type CompanyIntelSearchConfig = {
  enabled: boolean;
  providerChain: CompanySearchProvider[];
  timeoutMs: number;
  resultsPerQuery: number;
  minUsableResults: number;
  maxQueriesPerCompany: number;
  maxProviderAttemptsPerQuery: number;
  // Presence only — never the value.
  configuredProviders: Record<CompanySearchProvider, boolean>;
};

const DEFAULTS = {
  timeoutMs: 8000,
  resultsPerQuery: 5,
  minUsableResults: 2,
  maxQueriesPerCompany: 2,
  // 6 so a full chain (3 paid + searxng + ddg) is all reachable per query — otherwise
  // dead-but-present paid keys occupy the first slots and the OSS fallback never runs.
  maxProviderAttemptsPerQuery: 6,
};

function num(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return Math.floor(n);
}

function keyFor(provider: CompanySearchProvider, env: NodeJS.ProcessEnv): string {
  switch (provider) {
    case "exa":
      return (env.EXA_API_KEY ?? "").trim();
    case "brave":
      return (env.BRAVE_SEARCH_API_KEY ?? "").trim();
    case "serper":
      return (env.SERPER_API_KEY ?? "").trim();
    // OSS providers aren't keyed: SearXNG is "configured" by its base URL; DuckDuckGo is
    // keyless and gated by an explicit enable flag. The returned string is only used as a
    // presence signal + (for searxng) the base URL the adapter reads.
    case "searxng":
      return (env.SEARXNG_URL ?? "").trim();
    case "ddg":
      return (env.DDG_SEARCH_ENABLED ?? "").trim().toLowerCase() === "true" ? "ddg" : "";
  }
}

export function readCompanyIntelSearchConfig(
  env: NodeJS.ProcessEnv = process.env
): CompanyIntelSearchConfig {
  const enabled = (env.COMPANY_INTEL_SEARCH_ENABLED ?? "").trim().toLowerCase() === "true";

  const rawChain = (env.COMPANY_INTEL_SEARCH_PROVIDER_CHAIN ?? "exa,brave,serper,searxng,ddg")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter((p): p is CompanySearchProvider => (VALID_PROVIDERS as string[]).includes(p));
  // Dedupe, preserve order; fall back to full default chain if misconfigured.
  const providerChain = rawChain.length
    ? Array.from(new Set(rawChain))
    : [...VALID_PROVIDERS];

  const configuredProviders = {
    exa: keyFor("exa", env).length > 0,
    brave: keyFor("brave", env).length > 0,
    serper: keyFor("serper", env).length > 0,
    searxng: keyFor("searxng", env).length > 0,
    ddg: keyFor("ddg", env).length > 0,
  };

  return {
    enabled,
    providerChain,
    timeoutMs: num(env.COMPANY_INTEL_SEARCH_TIMEOUT_MS, DEFAULTS.timeoutMs, 1000, 60000),
    resultsPerQuery: num(env.COMPANY_INTEL_SEARCH_RESULTS_PER_QUERY, DEFAULTS.resultsPerQuery, 1, 20),
    minUsableResults: num(env.COMPANY_INTEL_SEARCH_MIN_USABLE_RESULTS, DEFAULTS.minUsableResults, 1, 20),
    maxQueriesPerCompany: num(env.COMPANY_INTEL_SEARCH_MAX_QUERIES_PER_COMPANY, DEFAULTS.maxQueriesPerCompany, 1, 6),
    maxProviderAttemptsPerQuery: num(
      env.COMPANY_INTEL_SEARCH_MAX_PROVIDER_ATTEMPTS_PER_QUERY,
      DEFAULTS.maxProviderAttemptsPerQuery,
      1,
      6
    ),
    configuredProviders,
  };
}

/**
 * Resolve the effective provider chain: configured order intersected with providers
 * that actually have a key. Empty => search disabled / nothing usable. Internal use
 * by CINT2; takes env so it stays testable. Does NOT expose key values.
 */
const OSS_PROVIDERS: CompanySearchProvider[] = ["searxng", "ddg"];

export function resolveUsableProviderChain(
  env: NodeJS.ProcessEnv = process.env
): CompanySearchProvider[] {
  const config = readCompanyIntelSearchConfig(env);
  if (!config.enabled) return [];
  const chain = config.providerChain.filter((p) => config.configuredProviders[p]);
  // Free OSS providers (SearXNG/DDG) are auto-appended whenever configured, even if a legacy
  // COMPANY_INTEL_SEARCH_PROVIDER_CHAIN omits them — so enabling one "just works". Appended last
  // so paid providers keep priority; they're kept reachable past the attempt cap in the chain runner.
  for (const p of OSS_PROVIDERS) {
    if (config.configuredProviders[p] && !chain.includes(p)) chain.push(p);
  }
  return chain;
}

/** The always-reachable OSS free providers — kept in the tried set past the paid attempt cap. */
export function isOssSearchProvider(p: CompanySearchProvider): boolean {
  return OSS_PROVIDERS.includes(p);
}

/** Server-only key accessor for CINT2 providers. Never log the return value. */
export function getProviderApiKey(
  provider: CompanySearchProvider,
  env: NodeJS.ProcessEnv = process.env
): string {
  return keyFor(provider, env);
}
