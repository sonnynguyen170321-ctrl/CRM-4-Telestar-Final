import type {
  EvaluateLeadAssignmentInput,
  NormalizedScoringContext,
  NormalizedStaffRange,
  WebsiteEvidenceSnapshot,
} from "./types";

export function normalizeScoringInput(
  input: EvaluateLeadAssignmentInput
): NormalizedScoringContext {
  const companyName = normalizeWhitespace(input.companyInput.companyName);
  const normalizedCompanyName =
    normalizeWhitespace(input.companyInput.normalizedCompanyName) ||
    normalizeCompanyName(companyName);
  const website = normalizeUrlLike(input.companyInput.website);
  const evidenceDomain = normalizeDomain(input.websiteEvidence?.normalizedDomain);
  const finalUrlDomain = normalizeDomain(input.websiteEvidence?.finalUrl);
  const inputDomain = normalizeDomain(input.companyInput.canonicalDomain);
  const websiteDomain = normalizeDomain(website);
  const canonicalDomain =
    inputDomain || evidenceDomain || finalUrlDomain || websiteDomain || null;
  const companyCountry = normalizeWhitespace(input.companyInput.companyCountry);
  const companyIndustry = normalizeWhitespace(input.companyInput.companyIndustry);
  const staffRangeRaw = normalizeWhitespace(
    input.companyInput.companyStaffCountRange
  );
  const contactInput = input.contactInput;

  return {
    leadAssignmentId: input.leadAssignmentId,
    icpVersionId: input.icpVersionId,
    icpRules: input.icpRules,
    company: {
      companyName,
      normalizedCompanyName,
      website: website || null,
      canonicalDomain,
      companyCountry: companyCountry || null,
      normalizedCompanyCountry: normalizeCountry(companyCountry) || null,
      companyIndustry: companyIndustry || null,
      normalizedCompanyIndustry: normalizeComparableText(companyIndustry) || null,
      companyStaffCountRange: staffRangeRaw || null,
      staffRange: normalizeStaffRange(staffRangeRaw),
      companyLinkedInUrl:
        normalizeUrlLike(input.companyInput.companyLinkedInUrl) || null,
      notes: normalizeWhitespace(input.companyInput.notes) || null,
      csvSignalHash: normalizeWhitespace(input.companyInput.csvSignalHash) || null,
    },
    contact: contactInput
      ? {
          contactName: normalizeWhitespace(contactInput.contactName) || null,
          title: normalizeWhitespace(contactInput.title) || null,
          contactLinkedInUrl:
            normalizeUrlLike(contactInput.contactLinkedInUrl) || null,
          emailDomainType: contactInput.emailDomainType || "unknown",
        }
      : undefined,
    websiteEvidence: normalizeWebsiteEvidence(input.websiteEvidence),
    previousFeedbackSignals: input.previousFeedbackSignals || [],
  };
}

export function normalizeDomain(value?: string | null): string | null {
  const trimmed = normalizeWhitespace(value).toLowerCase();

  if (!trimmed) {
    return null;
  }

  const withoutProtocol = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const withoutAuth = withoutProtocol.replace(/^[^@/]+@/, "");
  const host = withoutAuth.split(/[/?#]/, 1)[0] || "";
  const withoutPort = host.replace(/:\d+$/, "");
  const withoutWww = withoutPort.replace(/^www\./, "");
  const normalized = withoutWww.replace(/\.+$/, "");

  return normalized || null;
}

function normalizeWebsiteEvidence(
  evidence?: WebsiteEvidenceSnapshot | null
): NormalizedScoringContext["websiteEvidence"] {
  if (!evidence) {
    return {
      status: "missing",
      quality: "unknown",
      productSignals: [],
      serviceSignals: [],
      pricingSignals: [],
      apiSignals: [],
      aiSignals: [],
      cloudSignals: [],
      dataSignals: [],
      securitySignals: [],
    };
  }

  return {
    normalizedDomain: normalizeDomain(evidence.normalizedDomain),
    finalUrl: normalizeUrlLike(evidence.finalUrl) || null,
    status: evidence.status,
    quality: evidence.quality || "unknown",
    evidenceHash: normalizeWhitespace(evidence.evidenceHash) || null,
    productSignals: normalizeSignalArray(evidence.productSignals),
    serviceSignals: normalizeSignalArray(evidence.serviceSignals),
    pricingSignals: normalizeSignalArray(evidence.pricingSignals),
    apiSignals: normalizeSignalArray(evidence.apiSignals),
    aiSignals: normalizeSignalArray(evidence.aiSignals),
    cloudSignals: normalizeSignalArray(evidence.cloudSignals),
    dataSignals: normalizeSignalArray(evidence.dataSignals),
    securitySignals: normalizeSignalArray(evidence.securitySignals),
    researchedAt: normalizeWhitespace(evidence.researchedAt) || null,
  };
}

function normalizeStaffRange(value?: string | null): NormalizedStaffRange {
  const raw = normalizeWhitespace(value);

  if (!raw) {
    return { raw: null };
  }

  const cleaned = raw.toLowerCase().replace(/,/g, "");
  const numbers = Array.from(cleaned.matchAll(/\d+/g)).map((match) =>
    Number.parseInt(match[0], 10)
  );

  if (numbers.length >= 2) {
    return { raw, minEmployees: numbers[0], maxEmployees: numbers[1] };
  }

  if (numbers.length === 1) {
    const count = numbers[0];

    if (/\+|over|more than|above/.test(cleaned)) {
      return { raw, minEmployees: count };
    }

    if (/under|less than|fewer than|<|up to/.test(cleaned)) {
      return { raw, maxEmployees: count };
    }

    return { raw, minEmployees: count, maxEmployees: count };
  }

  return { raw };
}

function normalizeSignalArray(values?: string[]): string[] {
  const seen = new Set<string>();
  const normalizedValues: string[] = [];

  for (const value of values || []) {
    const normalized = normalizeWhitespace(value);
    const key = normalized.toLowerCase();

    if (!normalized || seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalizedValues.push(normalized);
  }

  return normalizedValues;
}

function normalizeCountry(value?: string | null): string {
  return normalizeComparableText(value);
}

function normalizeComparableText(value?: string | null): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrlLike(value?: string | null): string {
  return normalizeWhitespace(value).replace(/\s+/g, "");
}

function normalizeWhitespace(value?: string | null): string {
  return (value || "").trim().replace(/\s+/g, " ");
}

function normalizeCompanyName(value?: string | null): string {
  let str = normalizeWhitespace(value).toLowerCase();
  
  // 1. Unicode NFD + Diacritic removal for Vietnamese
  str = str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  str = str.replace(/đ/g, "d").replace(/Đ/g, "d");
  str = str.normalize("NFC");
  
  // 2. Remove legal prefixes (already diacritic-stripped, so only 'cong ty' instead of 'công ty')
  str = str.replace(/\b(cong ty|tnhh|cp|co phan|jsc|ltd|inc|llc|corp)\b/gi, " ");
  
  // 3. Fallback to standard comparable text cleaning
  return str
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
