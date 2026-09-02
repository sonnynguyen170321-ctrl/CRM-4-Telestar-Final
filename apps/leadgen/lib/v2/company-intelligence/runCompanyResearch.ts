import { createHash } from "node:crypto";

import { normalizeCanonicalDomain } from "./canonicalDomain";
import { extractCompanyDepthSignals } from "./companyDepthSignals";
import { crawlCompanySite } from "./crawlCompanySite";
import { extractNeutralFacts, uniqueFactTokens, type EvidenceItem, type FetchedPage } from "./extractFacts";
import type { FetchCompanyPagesInput, FetchStatus } from "./fetchWebsite";
import { runPlaywrightFallback, type RunPlaywrightFallbackInput } from "./playwrightFallback";
import { COMPANY_INTEL_PIPELINE_VERSION } from "./pipelineVersion";
import { compileCompanyIntelligence } from "./reasoning/compile";
import { deriveIntelConfidenceSignal } from "./reasoning/confidenceLink";
import type { CompanyIntelligenceReasoning, EvidenceRef, ReasoningEngine } from "./reasoning/contract";
import { extractPageModel, type PageModel } from "./reasoning/pageModel";
import { isLowQualityPage } from "./reasoning/pageQuality";
import type { DnsLookup } from "./safeFetch";
import { searchCompanyIntel, searchDepsFromEnv } from "./search/companyIntelSearch";
import { readCompanyIntelSearchConfig } from "./search/env";
import type { CompanyIntelSearchResponse, NormalizedSearchResult } from "./search/types";
import { buildEnrichmentSearchQueries, type SearchProvider, type SearchResult } from "./searchProvider";

export const COMPANY_INTELLIGENCE_PROFILE_STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
export type V2CompanyIntelligenceProfileStatus = "PLACEHOLDER" | "EXTRACTED" | "PARTIAL" | "FAILED";

type PersistedEvidenceItem = EvidenceItem & {
  pageType?: string;
  provider?: string;
  confidence?: string;
};

export type CompanyResearchProfile = {
  profileStatus: V2CompanyIntelligenceProfileStatus;
  companySummary: string | null;
  factsJson: string[];
  evidenceItemsJson: PersistedEvidenceItem[];
  classificationJson: {
    offerings: string[];
    industries: string[];
    businessModels: string[];
    geographies: string[];
    reasoning?: CompanyIntelligenceReasoning;
    schemaVersion?: string;
  };
  sourceCoverageJson: Record<string, unknown> & {
    pagesFetched: number;
    pagesWithContent: number;
    searchQueriesRun: number;
    searchResultsCount: number;
    fetchStatus: FetchStatus;
    playwrightFallbackUsed: boolean;
  };
  riskSignalsJson: string[];
  confidenceJson: Record<string, unknown> & {
    evidenceItemCount: number;
    factTokenCount: number;
    pagesWithContent: number;
    hasSearchResults: boolean;
  };
  staleAt: Date;
};

export type CompanyResearchResult = {
  status: FetchStatus;
  canonicalDomain: string | null;
  websiteUrl: string | null;
  httpStatus: number | null;
  finalUrl: string | null;
  redirectChainJson: string[];
  pagesFetchedJson: unknown;
  searchResultsJson: Array<SearchResult | NormalizedSearchResult>;
  rawTextHash: string | null;
  contentHash: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  profile: CompanyResearchProfile;
};

export type RunCompanyResearchInput = {
  companyName: string;
  country?: string | null;
  // Imported industry label (LinkedIn/CSV) — a weak classification prior, see ReasoningInput.industryRaw.
  industryRaw?: string | null;
  canonicalDomainInput: string | null;
  websiteUrl: string | null;
  now?: Date;
  fetchOptions?: Partial<Omit<FetchCompanyPagesInput, "canonicalDomain">> & { lookup?: DnsLookup };
  playwrightOptions?: Pick<RunPlaywrightFallbackInput, "isEnabled" | "renderer" | "timeoutMs">;
  searchProvider?: SearchProvider;
  searchEnv?: NodeJS.ProcessEnv;
  // AI3: optional reasoning engine. When the org has AI enabled the handler injects a
  // hybrid (rules + LLM) engine; otherwise the default rules-only hybrid is used.
  reasoningEngine?: ReasoningEngine;
  // P4: when the org is over its daily provider budget, skip web search and enrich from
  // website evidence only (degrade, never fail).
  disableSearch?: boolean;
};

// P4 split: the raw material a fetch stage produces (website crawl + search), JSON-
// serializable so a BullMQ research.fetch job can checkpoint it for a later compile.
export type CompanyResearchMaterial = {
  canonicalDomain: string;
  status: FetchStatus;
  pages: PageModel[];
  playwrightFallbackUsed: boolean;
  crawl: {
    httpStatus: number | null;
    finalUrl: string | null;
    redirectChainJson: string[];
    pagesFetchedJson: unknown[];
    rawTextHash: string | null;
    errorCode: string | null;
    errorMessage: string | null;
  };
  search: {
    results: Array<SearchResult | NormalizedSearchResult>;
    queryCount: number;
    sufficient: boolean;
    attempts: CompanyIntelSearchResponse["attempts"];
  };
};

/** P4 fetch phase: validate domain -> crawl (+ playwright fallback) -> search. Returns
 *  the raw material, or an early empty result when there is no usable website. */
export async function fetchCompanyMaterial(
  input: RunCompanyResearchInput
): Promise<{ ok: true; material: CompanyResearchMaterial } | { ok: false; result: CompanyResearchResult }> {
  const now = input.now ?? new Date();
  const sourceUrl = input.websiteUrl || input.canonicalDomainInput;
  if (!sourceUrl) return { ok: false, result: buildEmptyResult("NO_WEBSITE", null, null, now, "NO_WEBSITE", "Company has no website URL or canonical domain.") };

  const domainResult = normalizeCanonicalDomain(sourceUrl);
  if (!domainResult.ok) return { ok: false, result: buildEmptyResult("INVALID_URL", null, input.websiteUrl, now, "INVALID_URL", "Company website URL or canonical domain was invalid.") };

  const canonicalDomain = domainResult.canonicalDomain;
  const crawl = await crawlCompanySite({
    canonicalDomain,
    fetchImpl: input.fetchOptions?.fetchImpl as typeof fetch | undefined,
    lookup: input.fetchOptions?.lookup,
    timeoutMs: input.fetchOptions?.timeoutMs,
    rateLimitIntervalMs: input.fetchOptions?.rateLimitIntervalMs,
    userAgent: input.fetchOptions?.userAgent,
  });
  let pages = crawl.pages;
  let status = crawl.status;
  let playwrightFallbackUsed = false;

  if (status === "JS_RENDER_REQUIRED") {
    const fallback = await runPlaywrightFallback({ canonicalDomain, ...input.playwrightOptions });
    if (fallback.ok) {
      playwrightFallbackUsed = true;
      pages = mergePageModels(pages, fallback.pages.map((page) => extractPageModel({ url: page.url, path: page.path, text: page.text })));
      const usefulBytes = pages.reduce((sum, page) => sum + Buffer.byteLength(page.mainText, "utf8"), 0);
      status = usefulBytes >= 500 ? "SUCCESS" : pages.some((page) => page.mainText) ? "PARTIAL" : "JS_RENDER_REQUIRED";
    }
  }

  const search = await runSearch(input, canonicalDomain);
  return {
    ok: true,
    material: {
      canonicalDomain,
      status,
      pages,
      playwrightFallbackUsed,
      crawl: {
        httpStatus: crawl.httpStatus,
        finalUrl: crawl.finalUrl,
        redirectChainJson: crawl.redirectChainJson,
        pagesFetchedJson: crawl.pagesFetchedJson,
        rawTextHash: crawl.rawTextHash,
        errorCode: crawl.errorCode,
        errorMessage: crawl.errorMessage,
      },
      search,
    },
  };
}

export async function runCompanyResearch(input: RunCompanyResearchInput): Promise<CompanyResearchResult> {
  const now = input.now ?? new Date();
  const fetched = await fetchCompanyMaterial(input);
  if (!fetched.ok) return fetched.result;
  return compileCompanyResearchResult(input, fetched.material, now);
}

/** P4 extract+profile phase: compile the fetched material into the persistable result.
 *  Pure of network — runs the (hybrid) reasoning engine + assembles the profile. */
export async function compileCompanyResearchResult(
  input: RunCompanyResearchInput,
  material: CompanyResearchMaterial,
  now: Date = new Date()
): Promise<CompanyResearchResult> {
  const { canonicalDomain, status, pages, playwrightFallbackUsed, crawl, search } = material;
  const searchRefs = search.results.map(toSearchEvidence);
  // Drop soft-404 / thin "page not found" shells BEFORE reasoning + fact extraction so no
  // insight or signal is derived from a dead page (e.g. a /hiring page that returns HTTP 200
  // with an error body). The full `pages` list is still kept for status/debug records.
  const usablePages = pages.filter(
    (page) => !isLowQualityPage({ title: page.title, h1: page.h1, mainText: page.mainText })
  );

  const compiled = await compileCompanyIntelligence({
    companyName: input.companyName,
    canonicalDomain,
    country: input.country ?? null,
    industryRaw: input.industryRaw ?? null,
    pages: usablePages.map((page) => ({
      url: page.url,
      pageType: page.pageType,
      title: page.title,
      metaDescription: page.metaDescription,
      headings: [page.h1, ...page.h2s].filter((value): value is string => Boolean(value)),
      mainText: page.mainText || null,
    })),
    searchResults: searchRefs,
  }, { engine: input.reasoningEngine });

  const legacyPages: FetchedPage[] = usablePages.map((page) => ({ url: page.url, path: page.path, text: page.mainText }));
  const searchPages: FetchedPage[] = search.results.map((result) => ({
    url: result.url,
    path: safePath(result.url),
    text: `${result.title} ${result.snippet ?? ""} ${"highlight" in result ? result.highlight ?? "" : ""}`,
  }));
  const legacyEvidence = extractNeutralFacts([...legacyPages, ...searchPages]);
  const evidenceItemsJson = mergeReasoningEvidence(legacyEvidence, compiled.controlledTokens, compiled.reasoning);
  const factsJson = [...new Set([...uniqueFactTokens(legacyEvidence), ...compiled.controlledTokens])].sort();
  const confidenceSignalRaw = deriveIntelConfidenceSignal(compiled.reasoning);
  const pagesWithContent = pages.filter((page) => page.mainText.length > 0).length;
  // Website-content gate (W2): with ZERO usable website pages (unreachable / JS-only render / 404),
  // the identity + industry facts rest on SERP snippets alone, which routinely mislabel — e.g. a
  // table-reservations site (ontopo.com) came back "category.cybersecurity". SERP corroborates, it
  // does not establish identity, so cap confidence at LOW. Facts stay (advisory); the confidence
  // drops so these companies don't confidently qualify on scraped-snippet guesses.
  const confidenceSignal =
    pagesWithContent === 0 && confidenceSignalRaw.band !== "LOW"
      ? {
          ...confidenceSignalRaw,
          band: "LOW" as const,
          evidenceConfidence: Math.min(confidenceSignalRaw.evidenceConfidence, 0.4),
          reasons: [...confidenceSignalRaw.reasons, "serp_only_no_website_content"],
        }
      : confidenceSignalRaw;
  const depthSignals = extractCompanyDepthSignals({
    pages,
    canonicalDomain,
    status,
    websiteUrl: input.websiteUrl,
    searchResultsCount: search.results.length,
  });
  const profileStatus = deriveProfileStatus(status, pages, search.results.length);
  const contentHash = hashJson({
    pipelineVersion: COMPANY_INTEL_PIPELINE_VERSION,
    pages: pages.map((page) => ({ url: page.url, pageType: page.pageType, text: page.mainText })),
    searchResults: search.results,
    controlledTokens: compiled.controlledTokens,
  });

  return {
    status,
    canonicalDomain,
    websiteUrl: input.websiteUrl,
    httpStatus: crawl.httpStatus,
    finalUrl: crawl.finalUrl,
    redirectChainJson: crawl.redirectChainJson,
    pagesFetchedJson: crawl.pagesFetchedJson,
    searchResultsJson: search.results,
    rawTextHash: crawl.rawTextHash,
    contentHash,
    errorCode: status === "SUCCESS" || status === "PARTIAL" ? null : crawl.errorCode,
    errorMessage: status === "SUCCESS" || status === "PARTIAL" ? null : crawl.errorMessage,
    profile: {
      profileStatus,
      companySummary: compiled.brief,
      factsJson,
      evidenceItemsJson,
      classificationJson: {
        offerings: factsJson.filter((token) => token.startsWith("offering.")),
        industries: factsJson.filter((token) => token.startsWith("industry.")),
        businessModels: factsJson.filter((token) => token.startsWith("business_model.")),
        geographies: factsJson.filter((token) => token.startsWith("geo.")),
        schemaVersion: "v2.company-intelligence.reasoning.v1",
        reasoning: compiled.reasoning,
      },
      sourceCoverageJson: {
        depthTerminalState: depthSignals.terminalState,
        pagesFetched: crawl.pagesFetchedJson.length,
        pagesWithContent,
        searchQueriesRun: search.queryCount,
        searchResultsCount: search.results.length,
        searchResults: search.results.slice(0, 20),
        fetchStatus: status,
        playwrightFallbackUsed,
        pipelineVersion: COMPANY_INTEL_PIPELINE_VERSION,
        searchSufficient: search.sufficient,
        providerAttempts: search.attempts,
        pageTypes: pages.map((page) => page.pageType),
        publicEmailCount: depthSignals.publicEmails.length,
        personalEmailCount: depthSignals.personalEmails.length,
        roleEmailCount: depthSignals.roleEmails.length,
        phoneCount: depthSignals.phones.length,
        addressCount: depthSignals.addresses.length,
        teamHintCount: depthSignals.teamHints.length,
        learnedEmailPatterns: depthSignals.learnedEmailPatterns,
        publicEmails: depthSignals.publicEmails.slice(0, 20),
        phones: depthSignals.phones.slice(0, 20),
        addresses: depthSignals.addresses.slice(0, 10),
        teamHints: depthSignals.teamHints.slice(0, 20),
      },
      riskSignalsJson: factsJson.filter((token) => token.startsWith("risk.")),
      confidenceJson: {
        evidenceItemCount: evidenceItemsJson.length,
        factTokenCount: factsJson.length,
        pagesWithContent,
        hasSearchResults: search.results.length > 0,
        hasPublicContactEvidence: depthSignals.publicEmails.length > 0 || depthSignals.phones.length > 0,
        hasTeamEvidence: depthSignals.teamHints.length > 0,
        ...confidenceSignal,
        overallConfidence: compiled.reasoning.overallConfidence,
        engineTrace: compiled.reasoning.engineTrace,
      },
      staleAt: new Date(now.getTime() + COMPANY_INTELLIGENCE_PROFILE_STALE_AFTER_MS),
    },
  };
}

async function runSearch(input: RunCompanyResearchInput, canonicalDomain: string): Promise<{
  results: Array<SearchResult | NormalizedSearchResult>;
  queryCount: number;
  sufficient: boolean;
  attempts: CompanyIntelSearchResponse["attempts"];
}> {
  // P4: over-budget => website-only enrichment (no provider calls this run).
  if (input.disableSearch) {
    return { results: [], queryCount: 0, sufficient: false, attempts: [] };
  }
  if (input.searchProvider) {
    const queries = buildEnrichmentSearchQueries(input.companyName);
    const results = (await Promise.all(queries.map((query) => input.searchProvider!.search(query)))).flat();
    return { results, queryCount: queries.length, sufficient: results.length > 0, attempts: [] };
  }
  const env = input.searchEnv ?? process.env;
  const config = readCompanyIntelSearchConfig(env);
  if (!config.enabled) return { results: [], queryCount: 0, sufficient: false, attempts: [] };
  const aggregate = await searchCompanyIntel({
    companyName: input.companyName,
    canonicalDomain,
    country: input.country ?? null,
    maxQueriesPerCompany: config.maxQueriesPerCompany,
  }, searchDepsFromEnv(env));
  return {
    results: aggregate.results,
    queryCount: aggregate.queries.length,
    sufficient: aggregate.sufficient,
    attempts: aggregate.queries.flatMap((query) => query.attempts),
  };
}

function toSearchEvidence(result: SearchResult | NormalizedSearchResult): EvidenceRef {
  // Providers often return title ⊆ snippet ⊆ highlight (the same text three times).
  // Keep the most informative parts only, dropping any part already contained in a
  // longer kept one, so the evidence isn't a duplicated blob.
  const parts = [result.title, result.snippet, "highlight" in result ? result.highlight : undefined]
    .map((p) => (p ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const kept: string[] = [];
  for (const p of parts) {
    const lc = p.toLowerCase();
    if (kept.some((k) => k.toLowerCase().includes(lc))) continue;
    kept.push(p);
  }
  return {
    url: result.url,
    text: kept.join(" — ").slice(0, 400),
    pageType: "SEARCH",
    provider: "provider" in result ? result.provider : undefined,
  };
}

function mergeReasoningEvidence(legacy: EvidenceItem[], tokens: string[], reasoning: CompanyIntelligenceReasoning): PersistedEvidenceItem[] {
  const refs = collectReasoningEvidence(reasoning);
  const existing = new Set(legacy.map((item) => item.token));
  const additions = tokens.filter((token) => !existing.has(token)).flatMap((token) => {
    const ref = refs[0];
    return ref ? [{ token, evidenceText: ref.text, sourceUrl: ref.url, pageType: ref.pageType, provider: ref.provider, confidence: reasoning.overallConfidence }] : [];
  });
  return [...legacy, ...additions];
}

function collectReasoningEvidence(reasoning: CompanyIntelligenceReasoning): EvidenceRef[] {
  const refs = [
    ...reasoning.offering.evidence,
    ...reasoning.businessModel.evidence,
    ...reasoning.channels.evidence,
    ...reasoning.growth.hiring.evidence,
    ...reasoning.growth.signals.flatMap((signal) => signal.evidence),
    ...reasoning.partnerships.flatMap((partnership) => partnership.evidence),
  ];
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.url}::${ref.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergePageModels(left: PageModel[], right: PageModel[]): PageModel[] {
  const byUrl = new Map(left.map((page) => [page.url, page]));
  for (const page of right) {
    const current = byUrl.get(page.url);
    if (!current || page.mainText.length > current.mainText.length) byUrl.set(page.url, page);
  }
  return [...byUrl.values()];
}

function deriveProfileStatus(status: FetchStatus, pages: PageModel[], searchCount: number): V2CompanyIntelligenceProfileStatus {
  if (status === "SUCCESS" && pages.some((page) => page.mainText)) return "EXTRACTED";
  if (pages.some((page) => page.mainText) || searchCount > 0) return "PARTIAL";
  return "FAILED";
}

function safePath(rawUrl: string): string { try { return new URL(rawUrl).pathname; } catch { return ""; } }
function hashJson(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

function deriveEmptyDepthTerminalState(status: FetchStatus, canonicalDomain: string | null, websiteUrl: string | null) {
  if (!canonicalDomain) return "NO_DOMAIN";
  if (!websiteUrl) return "NO_WEBSITE";
  if (status === "BLOCKED") return "WAF_BLOCKED";
  if (status === "PARKED") return "PARKED";
  if (status === "TIMEOUT") return "TIMEOUT";
  return "FAILED";
}

function buildEmptyResult(status: FetchStatus, canonicalDomain: string | null, websiteUrl: string | null, now: Date, errorCode: string, errorMessage: string): CompanyResearchResult {
  return {
    status, canonicalDomain, websiteUrl, httpStatus: null, finalUrl: null, redirectChainJson: [], pagesFetchedJson: [],
    searchResultsJson: [], rawTextHash: null, contentHash: null, errorCode, errorMessage,
    profile: {
      profileStatus: "FAILED", companySummary: null, factsJson: [], evidenceItemsJson: [],
      classificationJson: { offerings: [], industries: [], businessModels: [], geographies: [] },
      sourceCoverageJson: { depthTerminalState: deriveEmptyDepthTerminalState(status, canonicalDomain, websiteUrl), pagesFetched: 0, pagesWithContent: 0, searchQueriesRun: 0, searchResultsCount: 0, fetchStatus: status, playwrightFallbackUsed: false, pipelineVersion: COMPANY_INTEL_PIPELINE_VERSION },
      riskSignalsJson: [],
      confidenceJson: { evidenceItemCount: 0, factTokenCount: 0, pagesWithContent: 0, hasSearchResults: false, evidenceConfidence: 0.15, band: "LOW", hasUsableEvidence: false, reasons: ["no_usable_evidence"] },
      staleAt: new Date(now.getTime() + COMPANY_INTELLIGENCE_PROFILE_STALE_AFTER_MS),
    },
  };
}
