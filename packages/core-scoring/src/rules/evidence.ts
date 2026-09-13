import type { CompanyTypeV2 } from "./schema-v2";
import type { Department, SeniorityTier } from "./dictionaries/seniority";
import type { IndustryKey } from "./dictionaries/industry";
import type { SizeBandKey } from "./dictionaries/sizeBands";

// SC2: the evidence shapes the multi-ICP engine consumes.
//
// RawScoringEvidence is what upstream (CSV intake + enrichment) supplies — strings,
// possibly messy. NormalizedScoringEvidence is the deterministic, dictionary-mapped
// form the gates and dimension scorers read. Pure types only.

export type WebsiteStatus = "reachable" | "missing" | "offline" | "unknown";

export type RawCompanyEvidence = {
  companyName: string;
  domain?: string;
  // Raw HQ country as supplied (alias-normalized by the engine).
  country?: string;
  // Raw office / factory / delivery countries (locationScope != hq).
  officeCountries?: string[];
  industry?: string;
  industryTags?: string[];
  /** Axis-1 category id from company intelligence (`category.<id>`), when one was assigned. */
  industryCategory?: string;
  employeeCount?: number;
  // Qualitative size phrase when headcount is absent ("SME", "Enterprise").
  employeeRange?: string;
  revenueUsd?: number;
  companyType?: CompanyTypeV2;
  websiteStatus?: WebsiteStatus;
  description?: string;
  // Concatenated text used for keyword scans (signals, services/consulting).
  evidenceText?: string;
  productSignals?: string[];
  serviceSignals?: string[];
  isProjectBased?: boolean;
  // Number of distinct office locations (multi-location size rules).
  locationCount?: number;
};

export type RawContactEvidence = {
  rawTitle?: string;
  email?: string;
  contactCountry?: string;
  // BCP-47-ish locale hint ("de") for persona language variants.
  locale?: string;
};

export type RawScoringEvidence = {
  company: RawCompanyEvidence;
  contact?: RawContactEvidence;
};

export type NormalizedCompanyEvidence = {
  companyName: string;
  domain?: string;
  // Canonical country name, or null when unmapped/absent.
  country: string | null;
  countryKnown: boolean;
  officeCountries: string[];
  industryRaw: string | null;
  industryCanonical: IndustryKey | null;
  industryTags: string[];
  industryCategory: string | null;
  employeeCount: number | null;
  sizeBand: SizeBandKey | null;
  sizeKnown: boolean;
  revenueUsd: number | null;
  companyType: CompanyTypeV2;
  websiteStatus: WebsiteStatus;
  evidenceText: string;
  isProjectBased: boolean;
  locationCount: number | null;
};

export type NormalizedContactEvidence = {
  rawTitle: string | null;
  titlePresent: boolean;
  seniorityTier: SeniorityTier;
  department: Department;
  matchedSeniorityKeyword: string | null;
  emailDomain: string | null;
  isGenericEmail: boolean;
  contactCountry: string | null;
  locale: string | null;
};

export type NormalizedScoringEvidence = {
  company: NormalizedCompanyEvidence;
  contact: NormalizedContactEvidence | null;
};

// ---------------------------------------------------------------------------
// Scorer output contracts (every dimension is fully explainable)
// ---------------------------------------------------------------------------

export type DimensionKey =
  | "geo"
  | "industry"
  | "companyType"
  | "size"
  | "persona"
  | "signals";

export type DimensionHit = {
  id: string;
  label: string;
  reasonCode: string;
};

export type DimensionResult = {
  dimension: DimensionKey;
  // 0-100. null only when the dimension is not applicable to the ruleset.
  score: number;
  hits: DimensionHit[];
  missingEvidence: string[];
};

export type GateHit = {
  id: string;
  label: string;
  reasonCode: string;
  // Short, non-sensitive evidence string for the why-drawer.
  evidence: string;
};

export type TerminalGateResult = {
  disqualified: boolean;
  hits: GateHit[];
};
