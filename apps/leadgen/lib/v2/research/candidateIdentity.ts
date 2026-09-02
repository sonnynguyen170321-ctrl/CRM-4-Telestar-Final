import { normalizeCompanyName, normalizeIdentityDomain } from "@/lib/v2/identity";
import { EXCLUDED_HOSTS as EXCLUDED_PROSPECT_DOMAINS } from "./parseDiscoveryResults";

export type ResearchIdentitySource =
  | "promoted_company"
  | "scoped_run"
  | "candidate_domain"
  | "official_source_url"
  | "existing_company"
  | "unresolved";

export type ResearchCompanyIdentityInput = {
  kind: string;
  candidateName: string;
  candidateCompanyName: string | null;
  candidateDomain: string | null;
  sourceUrl: string | null;
  runParamsJson: unknown;
  matchedCompany?: {
    id: string;
    name: string;
    canonicalDomain: string | null;
    websiteUrl: string | null;
  } | null;
  promotedCompanyId?: string | null;
};

export type ResearchCompanyIdentity = {
  displayName: string;
  domain: string | null;
  websiteUrl: string | null;
  matchedCompanyId: string | null;
  matchStatus: "matched" | "unmatched";
  identitySource: ResearchIdentitySource;
  normalizedCompanyName: string | null;
};

export function resolveResearchCompanyIdentity(input: ResearchCompanyIdentityInput): ResearchCompanyIdentity {
  const scoped = readCompanyScope(input.runParamsJson);
  const candidateCompanyName = resolveCandidateCompanyName(input.kind, input.candidateName, input.candidateCompanyName);
  const sourceDomain = companyDomainFromUrl(input.sourceUrl);
  const candidateDomain = normalizeCompanyDomain(input.candidateDomain);
  const matched = input.matchedCompany ?? null;
  const matchedDomain = normalizeCompanyDomain(matched?.canonicalDomain ?? null) ?? companyDomainFromUrl(matched?.websiteUrl ?? null);

  const domain = matchedDomain ?? scoped.domain ?? candidateDomain ?? sourceDomain ?? null;

  const identitySource: ResearchIdentitySource =
    matched && input.promotedCompanyId ? "promoted_company" :
    matched && matchedDomain ? "existing_company" :
    scoped.domain ? "scoped_run" :
    candidateDomain ? "candidate_domain" :
    sourceDomain ? "official_source_url" :
    matched ? "existing_company" :
    "unresolved";

  const displayName =
    cleanDisplay(matched?.name) ??
    scoped.companyName ??
    candidateCompanyName ??
    labelFromDomain(domain) ??
    "Company unresolved";

  return {
    displayName,
    domain,
    websiteUrl: normalizeWebsite(matched?.websiteUrl ?? null, domain),
    matchedCompanyId: matched?.id ?? null,
    matchStatus: matched ? "matched" : "unmatched",
    identitySource,
    normalizedCompanyName: normalizeCompanyName(displayName) || null,
  };
}

export function readCompanyScope(paramsJson: unknown): { companyName: string | null; domain: string | null } {
  if (!paramsJson || typeof paramsJson !== "object" || Array.isArray(paramsJson)) {
    return { companyName: null, domain: null };
  }
  const scope = (paramsJson as { scope?: unknown }).scope;
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    return { companyName: null, domain: null };
  }
  const o = scope as { companyName?: unknown; domain?: unknown };
  return {
    companyName: cleanCompanyCandidateDisplay(typeof o.companyName === "string" ? o.companyName : null),
    domain: normalizeCompanyDomain(o.domain),
  };
}

export function resolveCandidateCompanyName(kind: string, candidateName: string, candidateCompanyName: string | null): string | null {
  const cleanCompany = cleanCompanyCandidateDisplay(candidateCompanyName);
  if (cleanCompany) return cleanCompany;
  if (kind === "COMPANY") return cleanCompanyCandidateDisplay(candidateName);
  return null;
}

export function domainFromUrl(value: string | null | undefined): string | null {
  if (!value || !value.trim()) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    return normalizeDomain(new URL(withProtocol).hostname);
  } catch {
    return normalizeDomain(value);
  }
}

export function companyDomainFromUrl(value: string | null | undefined): string | null {
  const domain = domainFromUrl(value);
  return isExcludedProspectDomain(domain) ? null : domain;
}

export function normalizeDomain(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? normalizeIdentityDomain(value) : null;
}

export function normalizeCompanyDomain(value: unknown): string | null {
  const domain = normalizeDomain(value);
  return isExcludedProspectDomain(domain) ? null : domain;
}

export function isExcludedProspectDomain(domain: string | null | undefined): boolean {
  if (!domain) return false;
  return EXCLUDED_PROSPECT_DOMAINS.has(rootDomain(domain));
}

function normalizeWebsite(value: string | null, domain: string | null): string | null {
  if (value) {
    const d = companyDomainFromUrl(value);
    if (d) return /^https?:\/\//i.test(value) ? value : `https://${d}`;
  }
  return domain ? `https://${domain}` : null;
}

function cleanDisplay(value: string | null | undefined): string | null {
  const clean = value?.trim();
  return clean ? clean : null;
}

function cleanCompanyCandidateDisplay(value: string | null | undefined): string | null {
  const clean = cleanDisplay(value);
  if (!clean) return null;
  const normalized = normalizeCompanyName(clean)?.toLowerCase() ?? clean.toLowerCase();
  return GENERIC_PLATFORM_COMPANY_LABELS.has(normalized) ? null : clean;
}

function labelFromDomain(domain: string | null): string | null {
  if (!domain) return null;
  const stem = domain.split(".")[0]?.replace(/[-_]+/g, " ").trim();
  if (!stem) return domain;
  return stem.replace(/\b\w/g, (c) => c.toUpperCase());
}

const GENERIC_PLATFORM_COMPANY_LABELS = new Set([
  "linkedin", "linked in", "facebook", "instagram", "x", "twitter", "youtube",
  "crunchbase", "zoominfo", "apollo", "lusha", "rocketreach", "the org", "owler",
]);

function rootDomain(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  return parts.length <= 2 ? parts.join(".") : parts.slice(-2).join(".");
}