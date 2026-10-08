import {
  INDUSTRY_KEYS,
  INDUSTRY_TAXONOMY,
  canonicalizeIndustry,
  type IndustryKey,
} from "@telestar/core-scoring/rules/dictionaries/industry";
import type { SizeBandKey } from "@telestar/core-scoring/rules/dictionaries/sizeBands";

// The shapes verification scoring reads from a company classification (owner report, 2026-10-08).
//
// The classification contract itself is built in a parallel change (`companyClassification.ts`, PR1).
// This file mirrors exactly the fields scoring consumes, and nothing else, so the swap is one
// import: replace `CompanyClassificationInput` and `COMPANY_KINDS` with the contract's exports and no
// behaviour changes. Pure: no I/O, no provider calls.

export const COMPANY_KINDS = [
  "operator",
  "software_vendor",
  "services_agency",
  "reseller_wholesaler",
  "association_nonprofit",
  "government",
  "education",
  "media_news",
  "directory_marketplace_jobboard",
  "research_analyst",
  "event",
] as const;
export type CompanyKind = (typeof COMPANY_KINDS)[number];

export const NOT_COMPANY_REASONS = ["article", "listicle", "job_posting", "directory_page", "parked", "unrelated"] as const;
export type NotCompanyReason = (typeof NOT_COMPANY_REASONS)[number];

export type ClassificationConfidence = "high" | "medium" | "low";

export type ClassificationEvidence = { field: string; quote: string; sourceUrl: string };

export type CompanyClassificationInput = {
  isCompanySite: boolean;
  notCompanyReason: NotCompanyReason | null;
  companyKind: CompanyKind | null;
  industryText: string | null;
  industryKey: IndustryKey | null;
  whatTheySell: string | null;
  hqCountry: string | null;
  employeeCount: number | null;
  employeeBand: SizeBandKey | null;
  confidence: ClassificationConfidence;
  evidence: ClassificationEvidence[];
};

let aliasByKey: Map<IndustryKey, string> | null = null;

function buildAliasTable(): Map<IndustryKey, string> {
  const table = new Map<IndustryKey, string>();
  for (const key of INDUSTRY_KEYS) {
    // The engine reads a free-text industry through `canonicalizeIndustry`, a substring match over the
    // aliases in taxonomy order. An alias is only safe if the engine maps it BACK to the same key:
    // "ads" and "water" are aliases that other, earlier entries swallow. Verified here, not assumed.
    const entries = INDUSTRY_TAXONOMY.filter((entry) => entry.canonical === key);
    const alias = entries.flatMap((entry) => entry.aliases).find((candidate) => canonicalizeIndustry(candidate) === key);
    if (alias) table.set(key, alias);
  }
  return table;
}

/**
 * The phrase to hand the scoring engine for a classified industry key.
 *
 * The classifier chooses from the closed `INDUSTRY_KEYS` list, but the engine's text matcher knows
 * aliases, not keys: `FNB` or `REAL_ESTATE` as raw text map to nothing, so a correctly classified
 * restaurant group would read as "industry unknown". Returns null for a key with no round-tripping
 * alias (today only `OTHER`), and the caller falls back to the free-text industry.
 */
export function safeAlias(industryKey: IndustryKey | null | undefined): string | null {
  if (!industryKey) return null;
  aliasByKey ??= buildAliasTable();
  return aliasByKey.get(industryKey) ?? null;
}
