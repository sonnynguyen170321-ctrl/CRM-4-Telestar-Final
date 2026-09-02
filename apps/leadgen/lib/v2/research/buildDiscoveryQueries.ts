import type { IcpVersionRulesV2 } from "@/lib/v2/scoring/rules/schema-v2";

// The native research engine's query planner: the ICP rules ARE the default search spec.
// Manual builder params only narrow or seed the same deterministic query plan. SERP snippets
// are harvested later; no scraping and no AI calls happen in this planner.
//
// Adaptive, not cartesian: instead of industry × geo × 10 near-identical modifiers (which
// spammed the providers with listicle-bait), each (geo × primary term) emits a small curated
// set of high-signal queries with negative operators that exclude data-aggregators, and extra
// permutations are only added until the query cap is reached. A blank ICP yields NO queries.

export type DiscoveryQuery = {
  query: string;
  // Which ICP/manual terms produced this query -- stored on candidates as match hints.
  hints: string[];
};

export const DISCOVERY_QUERY_LIMIT_OPTIONS = [50, 100, 200, 1000] as const;
export type ResearchQueryLimit = typeof DISCOVERY_QUERY_LIMIT_OPTIONS[number];
export const DEFAULT_DISCOVERY_QUERY_LIMIT: ResearchQueryLimit = 50;
export const MAX_DISCOVERY_QUERIES = 1000;

export type ResearchBuilderMode = "ICP" | "BUILDER" | "COMPANY_CONTACTS" | "LOOKALIKE";

export type ResearchBuilderParams = {
  queryPlanVersion: 1;
  mode: ResearchBuilderMode;
  queryLimit: ResearchQueryLimit;
  aiFit?: boolean;
  industries: string[];
  keywords: string[];
  titles: string[];
  geos: string[];
  // Structured seniority (expands into contact titles), include/exclude refinements, and a
  // company-size band. All optional; empty = no effect on the plan.
  seniority: string[];
  excludeKeywords: string[];
  excludeDomains: string[];
  companySize?: string;
  scope?: {
    companyName: string;
    domain?: string;
    companyId?: string;
  };
  seed?: {
    companyId?: string;
    domain?: string;
    name: string;
  };
};

export const RESEARCH_QUERY_PLAN_VERSION = 1;
const MAX_TERMS_PER_BUCKET = 80;
const MAX_TERM_LENGTH = 80;
const MAX_REFINERS_PER_PRIMARY = 4;

// Data-aggregator / social hosts we never want as the prospect: excluded at query time so the
// SERP returns actual company sites, not directory pages. Kept short so query strings stay valid
// across providers (Brave/Serper honor -site:, Exa ignores it harmlessly).
const NEGATIVE_COMPANY_SITES = [
  "linkedin.com", "zoominfo.com", "apollo.io", "crunchbase.com",
  "facebook.com", "wikipedia.org", "g2.com", "glassdoor.com",
];
const NEGATIVE_OPERATORS = NEGATIVE_COMPANY_SITES.map((h) => `-site:${h}`).join(" ");

export function normalizeResearchQueryLimit(input: unknown): ResearchQueryLimit {
  const value = Number(input);
  return DISCOVERY_QUERY_LIMIT_OPTIONS.includes(value as ResearchQueryLimit) ? value as ResearchQueryLimit : DEFAULT_DISCOVERY_QUERY_LIMIT;
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => normalizeTerm(v)).filter((v): v is string => Boolean(v))));
}

function normalizeTerm(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.slice(0, MAX_TERM_LENGTH);
}

function splitInput(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(splitInput);
  if (typeof value !== "string") return [];
  return value.split(/[\n,;]+/g).map((v) => v.trim()).filter(Boolean);
}

function normalizeDomain(value: unknown): string | undefined {
  const raw = normalizeTerm(value)?.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  if (!raw || raw.length > 253) return undefined;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(raw)) return undefined;
  return raw;
}

export function normalizeResearchBuilderParams(input: unknown): ResearchBuilderParams | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  const scopeObj = obj.scope && typeof obj.scope === "object" ? obj.scope as Record<string, unknown> : null;
  const companyName = normalizeTerm(scopeObj?.companyName);
  const scope = companyName
    ? {
        companyName,
        ...(normalizeDomain(scopeObj?.domain) ? { domain: normalizeDomain(scopeObj?.domain) } : {}),
        ...(normalizeTerm(scopeObj?.companyId) ? { companyId: normalizeTerm(scopeObj?.companyId) as string } : {}),
      }
    : undefined;
  const seedObj = obj.seed && typeof obj.seed === "object" ? obj.seed as Record<string, unknown> : null;
  const seedName = normalizeTerm(seedObj?.name);
  const seed = seedName
    ? {
        name: seedName,
        ...(normalizeDomain(seedObj?.domain) ? { domain: normalizeDomain(seedObj?.domain) } : {}),
        ...(normalizeTerm(seedObj?.companyId) ? { companyId: normalizeTerm(seedObj?.companyId) as string } : {}),
      }
    : undefined;
  const mode: ResearchBuilderMode = seed ? "LOOKALIKE" : scope ? "COMPANY_CONTACTS" : "BUILDER";

  return {
    queryPlanVersion: RESEARCH_QUERY_PLAN_VERSION,
    mode,
    queryLimit: normalizeResearchQueryLimit(obj.queryLimit),
    ...(typeof obj.aiFit === "boolean" ? { aiFit: obj.aiFit } : {}),
    industries: uniq(splitInput(obj.industries)).slice(0, MAX_TERMS_PER_BUCKET),
    keywords: uniq(splitInput(obj.keywords)).slice(0, MAX_TERMS_PER_BUCKET),
    titles: uniq(splitInput(obj.titles)).slice(0, MAX_TERMS_PER_BUCKET),
    geos: uniq(splitInput(obj.geos)).slice(0, 30),
    seniority: uniq(splitInput(obj.seniority)).slice(0, 12),
    excludeKeywords: uniq(splitInput(obj.excludeKeywords)).slice(0, MAX_TERMS_PER_BUCKET),
    excludeDomains: Array.from(
      new Set(splitInput(obj.excludeDomains).map((d) => normalizeDomain(d)).filter((d): d is string => Boolean(d)))
    ).slice(0, 30),
    ...(normalizeTerm(obj.companySize) ? { companySize: normalizeTerm(obj.companySize) as string } : {}),
    ...(scope ? { scope } : {}),
    ...(seed ? { seed } : {}),
  };
}

// Structured seniority → concrete title tokens the SERP query planner can search on.
const SENIORITY_TITLES: Record<string, string[]> = {
  "c-level": ["CEO", "CTO", "CFO", "COO", "Founder", "Chief"],
  "c-suite": ["CEO", "CTO", "CFO", "COO", "Founder", "Chief"],
  vp: ["VP", "Vice President"],
  director: ["Director", "Head of"],
  head: ["Head of"],
  manager: ["Manager", "Lead"],
};
function seniorityToTitles(seniority: string[]): string[] {
  return seniority.flatMap((s) => SENIORITY_TITLES[s.trim().toLowerCase()] ?? [s]);
}

// Append the builder's include/exclude refinements to already-built queries: exclude domains
// (-site:), exclude keywords (-"kw"), and a positive company-size term. Bounded to a safe length.
function applyBuilderModifiers(queries: DiscoveryQuery[], params: ResearchBuilderParams): DiscoveryQuery[] {
  const negatives = [
    ...params.excludeDomains.map((d) => `-site:${d}`),
    ...params.excludeKeywords.map((k) => `-"${k}"`),
  ].join(" ");
  const sizeTerm = params.companySize ? `"${params.companySize}"` : "";
  if (!negatives && !sizeTerm) return queries;
  return queries.map((q) => ({ ...q, query: [q.query, sizeTerm, negatives].filter(Boolean).join(" ").slice(0, 350) }));
}

export function isEmptyResearchBuilderParams(params: ResearchBuilderParams | null): boolean {
  if (!params) return true;
  if (params.scope || params.seed) return false;
  return params.industries.length === 0 && params.keywords.length === 0 && params.titles.length === 0 && params.geos.length === 0 && params.seniority.length === 0;
}

function primaryGeos(rules: IcpVersionRulesV2): string[] {
  const geos = uniq(rules.geography.targetCountries);
  return geos.length > 0 ? geos.slice(0, 30) : [""];
}

function geosFromParams(params: ResearchBuilderParams): string[] {
  return params.geos.length > 0 ? params.geos.slice(0, 30) : [""];
}

export function buildCompanyDiscoveryQueries(rules: IcpVersionRulesV2, limit: ResearchQueryLimit = DEFAULT_DISCOVERY_QUERY_LIMIT): DiscoveryQuery[] {
  const industries = uniq(rules.industry.targetIndustries).slice(0, MAX_TERMS_PER_BUCKET);
  const keywords = uniq(rules.industry.industryKeywords).slice(0, MAX_TERMS_PER_BUCKET);
  const geos = primaryGeos(rules);
  return buildCompanyQueries({ industries, keywords, geos, limit });
}

export function buildContactDiscoveryQueries(rules: IcpVersionRulesV2, limit: ResearchQueryLimit = DEFAULT_DISCOVERY_QUERY_LIMIT): DiscoveryQuery[] {
  const tierTitles = [...rules.persona.titleTiers]
    .sort((a, b) => b.weight - a.weight)
    .flatMap((tier) => tier.titles);
  const titles = uniq([...tierTitles, ...rules.persona.titleAllowlist, ...rules.persona.titleKeywords]).slice(0, MAX_TERMS_PER_BUCKET);
  const industries = uniq([...rules.industry.targetIndustries, ...rules.industry.industryKeywords]).slice(0, MAX_TERMS_PER_BUCKET);
  const geos = primaryGeos(rules);
  return buildContactQueries({ titles, industries, geos, limit });
}

export function buildQueriesFromBuilderParams(kind: "COMPANY" | "CONTACT", params: ResearchBuilderParams): DiscoveryQuery[] {
  let base: DiscoveryQuery[];
  if (params.seed) {
    base = buildLookalikeQueries({ seed: params.seed, industries: params.industries, keywords: params.keywords, geos: geosFromParams(params), limit: params.queryLimit });
  } else if (kind === "COMPANY") {
    base = buildCompanyQueries({ industries: params.industries, keywords: params.keywords, geos: geosFromParams(params), limit: params.queryLimit });
  } else {
    // Seniority expands into the title set the contact planner searches on.
    const titles = uniq([...params.titles, ...seniorityToTitles(params.seniority)]).slice(0, MAX_TERMS_PER_BUCKET);
    base = buildContactQueries({ titles, industries: [...params.industries, ...params.keywords], geos: geosFromParams(params), scope: params.scope, limit: params.queryLimit });
  }
  return applyBuilderModifiers(base, params);
}

function buildCompanyQueries(input: { industries: string[]; keywords: string[]; geos: string[]; limit: ResearchQueryLimit }): DiscoveryQuery[] {
  // Primary term = industry when present, else fall back to keywords. Blank both -> no queries.
  const primaries = input.industries.length > 0 ? input.industries : input.keywords;
  if (primaries.length === 0) return [];
  const refiners = input.industries.length > 0 ? input.keywords : [];
  const geos = input.geos.length > 0 ? input.geos : [""];
  const queries: DiscoveryQuery[] = [];
  const cap = input.limit * 2;

  outer: for (const geo of geos) {
    for (const primary of primaries) {
      // 1. Core intent query — real company sites, aggregators excluded.
      pushQuery(queries, [`"${primary}"`, geo, NEGATIVE_OPERATORS], [primary, geo]);
      // 2. Directory-style — listing pages that yield many candidate domains.
      pushQuery(queries, ["top", `"${primary}"`, "companies", geo], [primary, geo]);
      // 3. Keyword refinements — sharpen fit, bounded so one industry can't explode the plan.
      for (const keyword of refiners.slice(0, MAX_REFINERS_PER_PRIMARY)) {
        pushQuery(queries, [`"${primary}"`, `"${keyword}"`, geo, NEGATIVE_OPERATORS], [primary, keyword, geo]);
        if (queries.length >= cap) break outer;
      }
      if (queries.length >= cap) break outer;
    }
  }

  return dedupeQueries(queries).slice(0, input.limit);
}

function buildContactQueries(input: { titles: string[]; industries: string[]; geos: string[]; scope?: ResearchBuilderParams["scope"]; limit: ResearchQueryLimit }): DiscoveryQuery[] {
  // A blank spec (no titles, no industries, no company scope) yields nothing — never fabricate
  // default-title junk from an empty ICP.
  if (input.titles.length === 0 && input.industries.length === 0 && !input.scope) return [];
  const titles = input.titles.length > 0 ? input.titles : ["sales", "growth", "marketing", "operations"];
  // Company-scoped ("people at company") beats industry targeting when a scope is present.
  const targets = input.scope ? [input.scope.companyName] : input.industries.length > 0 ? input.industries : [""];
  const geos = input.geos.length > 0 ? input.geos : [""];
  const domain = input.scope?.domain ? `"${input.scope.domain}"` : "";
  const queries: DiscoveryQuery[] = [];
  const cap = input.limit * 2;

  outer: for (const geo of geos) {
    for (const title of titles) {
      for (const target of targets) {
        // Focused LinkedIn people search — a single high-signal operator, not 6 noisy ones.
        pushQuery(queries, ["site:linkedin.com/in", `"${title}"`, target ? `"${target}"` : "", domain, geo], [title, target, input.scope?.domain ?? "", geo]);
        if (queries.length >= cap) break outer;
      }
    }
  }

  return dedupeQueries(queries).slice(0, input.limit);
}

function buildLookalikeQueries(input: { seed: NonNullable<ResearchBuilderParams["seed"]>; industries: string[]; keywords: string[]; geos: string[]; limit: ResearchQueryLimit }): DiscoveryQuery[] {
  const seedLabel = input.seed.domain ?? input.seed.name;
  const geos = input.geos.length > 0 ? input.geos : [""];
  // Primary lookalike signal = the seed's real industries/offerings (from seed comprehension),
  // NOT its brand name. Searching the brand just returns the seed itself. Fall back to keywords.
  const primaries = input.industries.length > 0 ? input.industries : input.keywords;
  const refiners = input.industries.length > 0 ? input.keywords : [];
  const queries: DiscoveryQuery[] = [];
  const cap = input.limit * 2;
  const seedNeg = input.seed.domain ? `${NEGATIVE_OPERATORS} -site:${input.seed.domain}` : NEGATIVE_OPERATORS;

  // Exactly one brand-anchored "alternatives" query (some SERPs surface real peers here); the
  // seed's own domain is negated so it cannot dominate.
  pushQuery(queries, [`"${seedLabel}" alternatives`, seedNeg], [`alternatives:${seedLabel}`]);

  // Attribute-based peer discovery — behaves like a company search over the seed's real category.
  if (primaries.length > 0) {
    outer: for (const geo of geos) {
      for (const primary of primaries) {
        pushQuery(queries, [`"${primary}"`, geo, seedNeg], [primary, geo, `like:${seedLabel}`]);
        pushQuery(queries, ["top", `"${primary}"`, "companies", geo], [primary, geo, `like:${seedLabel}`]);
        for (const keyword of refiners.slice(0, MAX_REFINERS_PER_PRIMARY)) {
          pushQuery(queries, [`"${primary}"`, `"${keyword}"`, geo, seedNeg], [primary, keyword, geo, `like:${seedLabel}`]);
          if (queries.length >= cap) break outer;
        }
        if (queries.length >= cap) break outer;
      }
    }
  }

  return dedupeQueries(queries).slice(0, input.limit);
}

function pushQuery(queries: DiscoveryQuery[], parts: string[], hints: string[]) {
  const query = parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  if (!query) return;
  queries.push({ query, hints: hints.filter(Boolean) });
}

function dedupeQueries(queries: DiscoveryQuery[]): DiscoveryQuery[] {
  const seen = new Set<string>();
  const out: DiscoveryQuery[] = [];
  for (const q of queries) {
    const key = q.query.toLowerCase();
    if (!q.query || seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}
