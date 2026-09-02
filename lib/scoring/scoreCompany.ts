import type { ParsedCsvRow } from "@/lib/csv";
import type {
  CompanyScoreResult,
  CompanyType,
  Qualification,
  ReviewState,
  WebsiteResearchResult,
  WebsiteResearchStatus,
  WebsiteSignals,
} from "@/lib/types";
import { evaluateHardRules } from "./hardRules";

const allowedCompanyTypes: CompanyType[] = [
  "Not Relevant",
  "PAAS",
  "SAAS",
  "Cloud",
  "ITO",
  "Data Solution",
  "AI Solution",
  "AI Service",
  "Cyber Security",
  "Blockchain Solution",
];

const positiveIcpCountries = [
  "united states",
  "australia",
  "singapore",
  "norway",
  "switzerland",
  "denmark",
  "sweden",
  "uk",
  "united kingdom",
  "canada",
  "israel",
];

const positiveIcpCountryAliases = ["usa", "us", "u.s.", "u.s.a.", "uk"];

const temporaryTypeSignals: Array<{
  type: CompanyType;
  patterns: RegExp[];
  evidence: string;
}> = [
  {
    type: "Cloud",
    patterns: [/\bcloud\b/i, /\binfrastructure\b/i, /\bdevops\b/i, /\bhosting\b/i],
    evidence: "cloud or infrastructure",
  },
  {
    type: "Blockchain Solution",
    patterns: [/\bblockchain\b/i, /\bledger\b/i, /\bcrypto\b/i, /\bweb3\b/i],
    evidence: "blockchain or web3",
  },
  {
    type: "AI Solution",
    patterns: [
      /\bai\b/i,
      /\bartificial\s+intelligence\b/i,
      /\bmachine\s+learning\b/i,
      /\bml\b/i,
    ],
    evidence: "AI or machine learning",
  },
  {
    type: "Cyber Security",
    patterns: [/\bcyber\b/i, /\bcybersecurity\b/i, /\bsecurity\b/i],
    evidence: "security",
  },
  {
    type: "Data Solution",
    patterns: [/\bdata\b/i, /\banalytics\b/i, /\bwarehouse\b/i, /\bbi\b/i],
    evidence: "data or analytics",
  },
  {
    type: "PAAS",
    patterns: [/\bpaas\b/i, /\bplatform\s+as\s+a\s+service\b/i],
    evidence: "PaaS",
  },
  {
    type: "SAAS",
    patterns: [
      /\bsaas\b/i,
      /\bsoftware\b/i,
      /\bproduct\b/i,
      /\bplatform\b/i,
    ],
    evidence: "SaaS, product, or platform",
  },
  {
    type: "ITO",
    patterns: [/\bito\b/i, /\bit\s+outsourcing\b/i],
    evidence: "IT outsourcing",
  },
];

export function scoreCompanyRow(
  row: ParsedCsvRow,
  index: number,
  options: { websiteResearch?: WebsiteResearchResult | null } = {}
): CompanyScoreResult {
  const companyName = getCell(row, "Company Name") || `Company ${index + 1}`;
  const website = getCell(row, "Website");
  const companyCountry = getCell(row, "Company Country");
  const companyIndustry = getCell(row, "Company Industry");
  const staffCountRange = getCell(row, "Company Staff Count Range");
  const note = getCell(row, "Notes / Tags");

  const hardRuleEvaluation = evaluateHardRules({
    company_name: companyName,
    website,
    company_country: companyCountry,
    company_industry: companyIndustry,
    company_staff_count_range: staffCountRange,
    note,
    raw_row_json: row,
  });
  const websiteAssessment = options.websiteResearch
    ? assessWebsiteResearch(options.websiteResearch)
    : null;
  const countryAssessment = assessCountryFit(companyCountry);
  const hardRuleFlags = {
    ...hardRuleEvaluation.flags,
    ...(websiteAssessment?.flags ?? {}),
    icp_country: countryAssessment.fit === "icp",
    non_icp_country: countryAssessment.fit === "non_icp",
  };
  const summary = buildSummary({
    companyName,
    companyIndustry,
    websiteAssessment,
  });

  if (hardRuleEvaluation.is_disqualified) {
    return {
      company_name: companyName,
      website,
      company_country: companyCountry,
      type: "Not Relevant",
      note,
      company_score: scoreDisqualifiedCompany(
        hardRuleEvaluation.triggered_flags.length
      ),
      qualification: "unqualified",
      confidence: websiteAssessment ? 0.85 : 0.8,
      reason: formatReason([
        ...hardRuleEvaluation.reason,
        countryAssessment.reason,
        ...(websiteAssessment?.reasons ?? []),
      ]),
      one_sentence_company_summary: summary,
      hard_rule_flags: hardRuleFlags,
      review_state: "unreviewed",
    };
  }

  if (websiteAssessment?.outcome === "disqualified") {
    return buildWebsiteDrivenResult({
      companyName,
      website,
      companyCountry,
      note,
      type: websiteAssessment.type,
      companyScore: websiteAssessment.score,
      qualification: websiteAssessment.qualification,
      confidence: websiteAssessment.confidence,
      reasons: websiteAssessment.reasons,
      summary,
      hardRuleFlags,
      reviewState: websiteAssessment.reviewState,
    });
  }

  if (hardRuleEvaluation.flags.b2c_only_signal) {
    return {
      company_name: companyName,
      website,
      company_country: companyCountry,
      type: "Not Relevant",
      note,
      company_score: 35,
      qualification: "uncertain",
      confidence: websiteAssessment?.confidence ?? 0.6,
      reason: formatReason([
        ...hardRuleEvaluation.reason,
        countryAssessment.reason,
        ...(websiteAssessment?.reasons ?? []),
      ]),
      one_sentence_company_summary: summary,
      hard_rule_flags: hardRuleFlags,
      review_state: "needs_review",
    };
  }

  if (websiteAssessment) {
    const websiteDrivenType =
      websiteAssessment.type === "Not Relevant"
        ? inferTemporaryCompanyType(row, companyIndustry, note)
        : websiteAssessment.type;

    return buildWebsiteDrivenResult({
      companyName,
      website,
      companyCountry,
      note,
      type: websiteDrivenType,
      companyScore: applyCountryScoreAdjustment(
        websiteAssessment.score,
        websiteDrivenType,
        countryAssessment
      ),
      qualification: websiteAssessment.qualification,
      confidence: websiteAssessment.confidence,
      reasons: [
        "No CSV hard disqualifier detected.",
        countryAssessment.reason,
        ...websiteAssessment.reasons,
      ],
      summary,
      hardRuleFlags,
      reviewState: websiteAssessment.reviewState,
    });
  }

  const csvAssessment = assessCsvOnlyFit({
    row,
    companyIndustry,
    note,
    countryAssessment,
  });

  return {
    company_name: companyName,
    website,
    company_country: companyCountry,
    type: csvAssessment.type,
    note,
    company_score: csvAssessment.score,
    qualification: csvAssessment.qualification,
    confidence: csvAssessment.confidence,
    reason: formatReason(csvAssessment.reasons),
    one_sentence_company_summary: summary,
    hard_rule_flags: hardRuleFlags,
    review_state: "needs_review",
  };
}

function getCell(row: ParsedCsvRow, key: string) {
  return row[key]?.trim() ?? "";
}

function scoreDisqualifiedCompany(triggeredFlagCount: number) {
  if (triggeredFlagCount >= 3) {
    return 10;
  }

  if (triggeredFlagCount === 2) {
    return 15;
  }

  return 25;
}

function formatReason(reasons: string[]) {
  if (reasons.length === 0) {
    return "Scoring did not receive enough company or website evidence for a confident decision.";
  }

  return reasons.join(" ");
}

function buildSummary({
  companyName,
  companyIndustry,
  websiteAssessment,
}: {
  companyName: string;
  companyIndustry: string;
  websiteAssessment: WebsiteAssessment | null;
}) {
  if (websiteAssessment?.summary) {
    return websiteAssessment.summary;
  }

  if (companyIndustry.length > 0) {
    return `${companyName} appears to operate in ${companyIndustry}.`;
  }

  return `${companyName} needs more company context before final scoring.`;
}

function inferTemporaryCompanyType(
  row: ParsedCsvRow,
  companyIndustry: string,
  note: string
): CompanyType {
  return inferTemporaryCompanyTypeWithEvidence(row, companyIndustry, note).type;
}

function inferTemporaryCompanyTypeWithEvidence(
  row: ParsedCsvRow,
  companyIndustry: string,
  note: string
): { type: CompanyType; evidence: string | null } {
  const csvType = getCell(row, "Type");

  if (isAllowedCompanyType(csvType)) {
    return { type: csvType, evidence: `source type ${csvType}` };
  }

  const signalText = [
    companyIndustry,
    note,
    getCell(row, "Type"),
  ].join(" ");

  for (const signal of temporaryTypeSignals) {
    if (signal.patterns.some((pattern) => pattern.test(signalText))) {
      return { type: signal.type, evidence: signal.evidence };
    }
  }

  return { type: "Not Relevant", evidence: null };
}

function isAllowedCompanyType(value: string): value is CompanyType {
  return allowedCompanyTypes.includes(value as CompanyType);
}

type WebsiteAssessment = {
  outcome: "disqualified" | "weak" | "positive" | "neutral";
  type: CompanyType;
  score: number;
  qualification: Qualification;
  confidence: number;
  reviewState: ReviewState;
  reasons: string[];
  summary: string | null;
  flags: Record<string, boolean>;
};

type CountryAssessment = {
  fit: "icp" | "non_icp" | "unknown";
  reason: string;
  scoreAdjustment: number;
};

type CsvAssessment = {
  type: CompanyType;
  score: number;
  qualification: Qualification;
  confidence: number;
  reasons: string[];
};

function assessCsvOnlyFit({
  row,
  companyIndustry,
  note,
  countryAssessment,
}: {
  row: ParsedCsvRow;
  companyIndustry: string;
  note: string;
  countryAssessment: CountryAssessment;
}): CsvAssessment {
  const inferred = inferTemporaryCompanyTypeWithEvidence(
    row,
    companyIndustry,
    note
  );
  const reasons = [
    "No hard disqualifier was detected, but website research signals are not available, so product fit could not be verified.",
    countryAssessment.reason,
  ];

  if (inferred.type === "ITO") {
    return {
      type: "Not Relevant",
      score: 25,
      qualification: "unqualified",
      confidence: 0.55,
      reasons: [
        "CSV fields suggest an IT outsourcing or service-led company.",
        countryAssessment.reason,
        "Website research is not available to verify a product-led exception.",
      ],
    };
  }

  if (inferred.type !== "Not Relevant") {
    const score = clampScore(55 + countryAssessment.scoreAdjustment, 50, 60);

    return {
      type: inferred.type,
      score,
      qualification: "uncertain",
      confidence: countryAssessment.fit === "icp" ? 0.45 : 0.4,
      reasons: [
        `CSV fields suggest ${inferred.type} based on ${inferred.evidence ?? "company metadata"} signals.`,
        countryAssessment.reason,
        "Website research is not available, so this remains a review-needed estimate.",
      ],
    };
  }

  const weakScore = countryAssessment.fit === "non_icp" ? 32 : 35;

  return {
    type: "Not Relevant",
    score: weakScore,
    qualification: "uncertain",
    confidence: countryAssessment.fit === "icp" ? 0.35 : 0.3,
    reasons,
  };
}

function assessCountryFit(country: string): CountryAssessment {
  const normalizedCountry = country.trim().toLowerCase();

  if (!normalizedCountry) {
    return {
      fit: "unknown",
      reason: "Company country is missing, so ICP geography fit is unknown.",
      scoreAdjustment: -3,
    };
  }

  if (
    positiveIcpCountryAliases.includes(normalizedCountry) ||
    positiveIcpCountries.some(
      (icpCountry) =>
        normalizedCountry === icpCountry ||
        normalizedCountry.includes(icpCountry)
    )
  ) {
    return {
      fit: "icp",
      reason: `${country} is in the current ICP geography list.`,
      scoreAdjustment: 3,
    };
  }

  return {
    fit: "non_icp",
    reason: `${country} is outside the current ICP geography list and is treated as a soft negative.`,
    scoreAdjustment: -8,
  };
}

function applyCountryScoreAdjustment(
  score: number,
  type: CompanyType,
  countryAssessment: CountryAssessment
) {
  return normalizeScoreForType(
    clampScore(score + countryAssessment.scoreAdjustment, 0, 100),
    type
  );
}

function normalizeScoreForType(score: number, type: CompanyType) {
  if (type === "Not Relevant") {
    return Math.min(score, 35);
  }

  return score;
}

function clampScore(score: number, min: number, max: number) {
  return Math.min(Math.max(score, min), max);
}

function assessWebsiteResearch(
  websiteResearch: WebsiteResearchResult
): WebsiteAssessment {
  const { status, quality, signals, classificationHints } = websiteResearch;
  const flags = buildWebsiteFlags(websiteResearch);
  const evidence = summarizeWebsiteEvidence(signals);
  const inferredType = inferWebsiteCompanyType(websiteResearch);
  const productSignalStrength = getProductSignalStrength(signals);
  const hasStrongProductEvidence =
    classificationHints.likelyProductLed && productSignalStrength >= 2;
  const hasVeryStrongProductEvidence =
    hasStrongProductEvidence &&
    quality === "strong" &&
    (signals.hasPricingSignal || signals.hasApiSignal) &&
    productSignalStrength >= 3;

  if (status === "blocked") {
    return {
      outcome: "disqualified",
      type: "Not Relevant",
      score: 10,
      qualification: "unqualified",
      confidence: 0.85,
      reviewState: "unreviewed",
      reasons: ["Website appears blocked/private, so fit cannot be verified."],
      summary: "Website research could not verify this company because the site is blocked.",
      flags,
    };
  }

  if (isUnreachableStatus(status)) {
    return {
      outcome: "disqualified",
      type: "Not Relevant",
      score: 30,
      qualification: "uncertain",
      confidence: 0.65,
      reviewState: "needs_review",
      reasons: ["Website appears offline or unreachable, so fit cannot be verified."],
      summary: "Website research found the site unreachable and needs manual review.",
      flags,
    };
  }

  if (status === "parked" || status === "empty") {
    return {
      outcome: "disqualified",
      type: "Not Relevant",
      score: status === "parked" ? 15 : 25,
      qualification: "unqualified",
      confidence: 0.8,
      reviewState: "unreviewed",
      reasons: [
        status === "parked"
          ? "Website appears parked or under construction."
          : "Website appears empty or has too little company information.",
      ],
      summary: "Website research found limited or unusable company information.",
      flags,
    };
  }

  if (
    classificationHints.likelyServiceLed &&
    !classificationHints.likelyProductLed
  ) {
    return {
      outcome: "disqualified",
      type: inferServiceCompanyType(signals),
      score: 25,
      qualification: "unqualified",
      confidence: 0.8,
      reviewState: "unreviewed",
      reasons: [
        `Website appears service-led based on ${evidence.service || "service"} signals.`,
      ],
      summary: "Website research suggests this company is service-led rather than product-led.",
      flags,
    };
  }

  if (hasVeryStrongProductEvidence) {
    return {
      outcome: "positive",
      type: inferredType,
      score: 88,
      qualification: "qualified",
      confidence: 0.85,
      reviewState: "needs_review",
      reasons: [
        `Website shows strong product signals such as ${formatEvidenceList([
          evidence.product,
          evidence.pricing,
          evidence.api,
        ])}.`,
      ],
      summary: buildWebsiteSummary(websiteResearch, inferredType),
      flags,
    };
  }

  if (hasStrongProductEvidence && ["medium", "strong"].includes(quality)) {
    return {
      outcome: "positive",
      type: inferredType,
      score: 78,
      qualification: "qualified",
      confidence: 0.75,
      reviewState: "needs_review",
      reasons: [
        `Website shows product/category signals such as ${formatEvidenceList([
          evidence.product,
          evidence.ai,
          evidence.cloud,
          evidence.data,
          evidence.security,
        ])}.`,
      ],
      summary: buildWebsiteSummary(websiteResearch, inferredType),
      flags,
    };
  }

  if (classificationHints.likelyProductLed || productSignalStrength > 0) {
    return {
      outcome: "weak",
      type: inferredType,
      score: 60,
      qualification: "uncertain",
      confidence: quality === "weak" ? 0.55 : 0.65,
      reviewState: "needs_review",
      reasons: [
        `Website has possible product signals, but signal quality is ${quality}.`,
      ],
      summary: buildWebsiteSummary(websiteResearch, inferredType),
      flags,
    };
  }

  if (quality === "weak") {
    return {
      outcome: "weak",
      type: "Not Relevant",
      score: 40,
      qualification: "uncertain",
      confidence: 0.5,
      reviewState: "needs_review",
      reasons: [
        "Website is reachable but has weak signal quality and no clear product evidence.",
      ],
      summary: "Website research found limited company information.",
      flags,
    };
  }

  return {
    outcome: "neutral",
    type: "Not Relevant",
    score: 55,
    qualification: "uncertain",
    confidence: 0.55,
    reviewState: "needs_review",
    reasons: ["Website research did not find a deterministic disqualifier."],
    summary: "Website research found some company information but needs later scoring.",
    flags,
  };
}

function buildWebsiteDrivenResult({
  companyName,
  website,
  companyCountry,
  note,
  type,
  companyScore,
  qualification,
  confidence,
  reasons,
  summary,
  hardRuleFlags,
  reviewState,
}: {
  companyName: string;
  website: string;
  companyCountry: string;
  note: string;
  type: CompanyType;
  companyScore: number;
  qualification: Qualification;
  confidence: number;
  reasons: string[];
  summary: string;
  hardRuleFlags: Record<string, boolean>;
  reviewState: ReviewState;
}): CompanyScoreResult {
  return {
    company_name: companyName,
    website,
    company_country: companyCountry,
    type,
    note,
    company_score: normalizeScoreForType(companyScore, type),
    qualification,
    confidence,
    reason: formatReason(reasons),
    one_sentence_company_summary: summary,
    hard_rule_flags: hardRuleFlags,
    review_state: reviewState,
  };
}

function buildWebsiteFlags(websiteResearch: WebsiteResearchResult) {
  const { status, signals, classificationHints } = websiteResearch;

  return {
    websiteBlocked: status === "blocked",
    websiteUnreachable: isUnreachableStatus(status),
    websiteWeakOrParked:
      status === "parked" ||
      status === "empty" ||
      websiteResearch.quality === "weak",
    websiteServiceLed: classificationHints.likelyServiceLed,
    websiteProductLed: classificationHints.likelyProductLed,
    websiteHasPricing: signals.hasPricingSignal,
    websiteHasApi: signals.hasApiSignal,
    websiteHasAi: signals.hasAiSignal,
    websiteHasCloud: signals.hasCloudSignal,
    websiteHasData: signals.hasDataSignal,
    websiteHasSecurity: signals.hasSecuritySignal,
  };
}

function isUnreachableStatus(status: WebsiteResearchStatus) {
  return ["offline", "timeout", "invalid_url", "error"].includes(status);
}

function inferWebsiteCompanyType(
  websiteResearch: WebsiteResearchResult
): CompanyType {
  const { signals, classificationHints } = websiteResearch;

  if (
    hasSignalKeyword(signals.productSignals, [
      "blockchain",
      "web3",
      "smart contract",
      "crypto infrastructure",
      "tokenization",
      "wallet infrastructure",
      "decentralized application",
      "dApp",
      "NFT platform",
    ])
  ) {
    return "Blockchain Solution";
  }

  if (
    hasSignalKeyword(signals.productSignals, [
      "platform as a service",
      "PaaS",
      "developer platform",
      "infrastructure platform",
      "deployment platform",
      "application platform",
      "build on our platform",
      "cloud platform",
    ])
  ) {
    return "PAAS";
  }

  if (classificationHints.likelyCyberSecurity) {
    return "Cyber Security";
  }

  if (classificationHints.likelyAi && classificationHints.likelyProductLed) {
    return "AI Solution";
  }

  if (classificationHints.likelyCloud) {
    return "Cloud";
  }

  if (classificationHints.likelyDataSolution) {
    return "Data Solution";
  }

  if (classificationHints.likelySaas || classificationHints.likelyProductLed) {
    return "SAAS";
  }

  return "Not Relevant";
}

function inferServiceCompanyType(signals: WebsiteSignals): CompanyType {
  if (
    signals.aiSignals.length > 0 &&
    hasSignalKeyword(signals.serviceSignals, [
      "AI consulting",
      "AI development services",
      "machine learning consulting",
      "custom AI solutions",
      "AI implementation services",
      "AI agency",
      "AI outsourcing",
    ])
  ) {
    return "AI Service";
  }

  if (
    hasSignalKeyword(signals.serviceSignals, [
      "IT outsourcing",
      "outsourcing",
      "staff augmentation",
      "custom software development",
      "software development services",
      "managed services",
      "IT services",
      "offshore development",
      "dedicated developers",
    ])
  ) {
    return "ITO";
  }

  return "Not Relevant";
}

function getProductSignalStrength(signals: WebsiteSignals) {
  return (
    signals.productSignals.filter(
      (item) => item.keyword.toLowerCase() !== "software"
    ).length +
    signals.pricingSignals.length +
    signals.apiSignals.length +
    signals.aiSignals.length +
    signals.cloudSignals.length +
    signals.dataSignals.length +
    signals.securitySignals.length
  );
}

function summarizeWebsiteEvidence(signals: WebsiteSignals) {
  return {
    product: getFirstKeyword(signals.productSignals),
    service: getFirstKeyword(signals.serviceSignals),
    pricing: getFirstKeyword(signals.pricingSignals),
    api: getFirstKeyword(signals.apiSignals),
    ai: getFirstKeyword(signals.aiSignals),
    cloud: getFirstKeyword(signals.cloudSignals),
    data: getFirstKeyword(signals.dataSignals),
    security: getFirstKeyword(signals.securitySignals),
  };
}

function getFirstKeyword(signals: Array<{ keyword: string }>) {
  return signals[0]?.keyword ?? null;
}

function formatEvidenceList(values: Array<string | null>) {
  const evidence = values.filter((value): value is string => Boolean(value));

  if (evidence.length === 0) {
    return "website evidence";
  }

  return evidence.slice(0, 3).join(", ");
}

function hasSignalKeyword(
  signals: Array<{ keyword: string }>,
  keywords: string[]
) {
  const normalizedKeywords = new Set(
    keywords.map((keyword) => keyword.toLowerCase())
  );

  return signals.some((signal) =>
    normalizedKeywords.has(signal.keyword.toLowerCase())
  );
}

function buildWebsiteSummary(
  websiteResearch: WebsiteResearchResult,
  type: CompanyType
) {
  if (type === "Not Relevant") {
    return "Website research found limited company information.";
  }

  return `Website research suggests a ${type} fit with ${websiteResearch.quality} signal quality.`;
}
