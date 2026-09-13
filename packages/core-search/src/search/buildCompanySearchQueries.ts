import type { CompanySearchPurpose } from "./types";

// CINT2: deterministic company search-query builder. 1-2 queries per company by
// default (orchestrator caps at COMPANY_INTEL_SEARCH_MAX_QUERIES_PER_COMPANY). Pure.
// Queries target the 5 SDR questions (what they sell / model / channels / growth /
// partners) — NOT page-presence. Order = most identity-bearing first.

export type CompanyQueryInput = {
  companyName: string;
  canonicalDomain?: string | null;
  country?: string | null;
};

export type CompanySearchQuery = { purpose: CompanySearchPurpose; query: string };

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

export function buildCompanySearchQueries(input: CompanyQueryInput): CompanySearchQuery[] {
  const name = clean(input.companyName);
  if (!name) return [];
  const domain = clean(input.canonicalDomain);
  const country = clean(input.country);
  const q = `"${name}"`;
  const dom = domain ? ` ${domain}` : "";
  const geo = country ? ` ${country}` : "";

  // Ordered by identity value. Orchestrator runs the first N (default 2) and stops
  // when evidence is sufficient.
  const queries: CompanySearchQuery[] = [
    { purpose: "company_profile", query: `${q}${dom} what does the company do industry product` },
    { purpose: "product_evidence", query: `${q}${dom} product platform service customers` },
    { purpose: "partnership_signal", query: `${q}${dom} partners integrations` },
    { purpose: "customer_evidence", query: `${q}${dom} customers case studies clients` },
    { purpose: "news_or_market_signal", query: `${q} funding hiring expansion${geo}` },
    { purpose: "official_domain", query: `${q} official website${geo}` },
  ];

  // Drop duplicate query strings (e.g. when domain/country empty collapse variants).
  const seen = new Set<string>();
  return queries.filter((item) => {
    const key = item.query.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
