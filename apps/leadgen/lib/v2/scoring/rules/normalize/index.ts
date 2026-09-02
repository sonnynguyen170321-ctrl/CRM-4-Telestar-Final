import { canonicalizeIndustry } from "../dictionaries/industry";
import type {
  NormalizedScoringEvidence,
  RawScoringEvidence,
  WebsiteStatus,
} from "../evidence";
import { foldText, normalizeCountries, normalizeCountry } from "./normalizeCountry";
import { normalizeEmail } from "./normalizeEmail";
import { normalizeSize } from "./normalizeSize";
import { normalizeTitle } from "./normalizeTitle";

// SC2: pipeline step 0 — turn messy raw evidence into deterministic, dictionary-
// mapped normalized evidence the gates and dimension scorers read. Pure.

export * from "./normalizeCountry";
export * from "./normalizeTitle";
export * from "./normalizeSize";
export * from "./normalizeEmail";

const VALID_WEBSITE_STATUSES: readonly WebsiteStatus[] = [
  "reachable",
  "missing",
  "offline",
  "unknown",
];

function normalizeWebsiteStatus(status: string | undefined | null): WebsiteStatus {
  const value = String(status ?? "").trim().toLowerCase();

  return (VALID_WEBSITE_STATUSES as readonly string[]).includes(value)
    ? (value as WebsiteStatus)
    : "unknown";
}

function buildEvidenceText(parts: ReadonlyArray<string | undefined>): string {
  return foldText(parts.filter(Boolean).join(" \n "));
}

export function normalizeEvidence(
  raw: RawScoringEvidence
): NormalizedScoringEvidence {
  const company = raw.company;
  const country = normalizeCountry(company.country);
  const size = normalizeSize(company.employeeCount, company.employeeRange);
  const industryRaw = company.industry ? company.industry.trim() : null;

  const evidenceText = buildEvidenceText([
    company.evidenceText,
    company.description,
    company.industry,
    ...(company.industryTags ?? []),
    ...(company.productSignals ?? []),
    ...(company.serviceSignals ?? []),
  ]);

  const normalizedCompany = {
    companyName: company.companyName,
    domain: company.domain ? company.domain.trim().toLowerCase() : undefined,
    country,
    countryKnown: country !== null,
    officeCountries: normalizeCountries(company.officeCountries),
    industryRaw,
    industryCanonical: industryRaw ? canonicalizeIndustry(industryRaw) : null,
    industryTags: (company.industryTags ?? []).map((tag) => tag.trim()).filter(Boolean),
    industryCategory: company.industryCategory ? company.industryCategory.trim() : null,
    employeeCount: size.employeeCount,
    sizeBand: size.sizeBand,
    sizeKnown: size.sizeKnown,
    revenueUsd:
      typeof company.revenueUsd === "number" && Number.isFinite(company.revenueUsd)
        ? company.revenueUsd
        : null,
    companyType: company.companyType ?? "UNKNOWN",
    websiteStatus: normalizeWebsiteStatus(company.websiteStatus),
    evidenceText,
    isProjectBased: company.isProjectBased === true,
    locationCount:
      typeof company.locationCount === "number" ? company.locationCount : null,
  };

  if (!raw.contact) {
    return { company: normalizedCompany, contact: null };
  }

  const title = normalizeTitle(raw.contact.rawTitle);
  const email = normalizeEmail(raw.contact.email);

  return {
    company: normalizedCompany,
    contact: {
      rawTitle: title.rawTitle,
      titlePresent: title.titlePresent,
      seniorityTier: title.seniorityTier,
      department: title.department,
      matchedSeniorityKeyword: title.matchedKeyword,
      emailDomain: email.emailDomain,
      isGenericEmail: email.isGenericEmail,
      contactCountry: normalizeCountry(raw.contact.contactCountry),
      locale: raw.contact.locale ? raw.contact.locale.trim().toLowerCase() : null,
    },
  };
}
