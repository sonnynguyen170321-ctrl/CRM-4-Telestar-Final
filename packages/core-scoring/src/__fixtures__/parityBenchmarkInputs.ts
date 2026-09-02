import type { EvaluateLeadAssignmentInput } from "../types";
import { TELSTAR_SAAS_OUTBOUND_ICP_RULES_FIXTURE } from "./defaultIcpRules";

export type ParityBenchmarkInvariant =
  | "not_relevant_not_score_60"
  | "weak_or_no_website_not_high_confidence_qualified"
  | "product_led_above_service_only"
  | "missing_website_review_not_terminal"
  | "service_plus_product_not_auto_failed_by_service_keywords"
  | "excluded_country_not_qualified"
  | "no_ai_dependency";

export type ParityBenchmarkDivergence = {
  field: "score" | "type" | "qualification" | "confidence";
  reason: string;
};

export type ParityBenchmarkFixture = {
  id: string;
  name: string;
  category:
    | "strong_product_website"
    | "strong_saas_csv_no_website"
    | "service_only"
    | "service_plus_product"
    | "website_offline_or_weak"
    | "data_poor"
    | "excluded_country"
    | "personal_email"
    | "b2c_only"
    | "conflicting_evidence"
    | "ai_unavailable";
  v1Row: Record<string, string>;
  v1Options?: {
    websiteResearch?: unknown;
  };
  v2Input: EvaluateLeadAssignmentInput;
  invariants: ParityBenchmarkInvariant[];
  approvedDivergences: ParityBenchmarkDivergence[];
};

export const V2_PARITY_BENCHMARK_FIXTURES = [
  {
    id: "strong_product_website",
    name: "Strong product website",
    category: "strong_product_website",
    v1Row: baseRow({
      companyName: "BrightWave Platform",
      website: "https://brightwave.example",
      country: "Singapore",
      industry: "B2B SaaS",
      staff: "51-200",
    }),
    v1Options: {
      websiteResearch: websiteResearchFixture({
        quality: "strong",
        productSignals: ["software platform"],
        pricingSignals: ["pricing"],
        apiSignals: ["api"],
        likelyProductLed: true,
        likelySaas: true,
      }),
    },
    v2Input: v2Input({
      id: "strong-product-website",
      companyName: "BrightWave Platform",
      website: "https://brightwave.example",
      country: "Singapore",
      industry: "B2B SaaS",
      staff: "51-200",
      websiteEvidence: {
        status: "reachable",
        quality: "strong",
        productSignals: ["software platform"],
        pricingSignals: ["pricing"],
        apiSignals: ["api"],
      },
    }),
    invariants: ["product_led_above_service_only", "no_ai_dependency"],
    approvedDivergences: [
      {
        field: "type",
        reason: "V2 uses configured product_saas taxonomy instead of V1 SAAS label.",
      },
      {
        field: "score",
        reason: "V2 fit score is component-based rather than V1 branch score.",
      },
      {
        field: "confidence",
        reason: "V2 confidence is aggregated from evidence and data quality instead of V1 website branch confidence.",
      },
    ],
  },
  {
    id: "strong_saas_csv_no_website",
    name: "Strong SaaS CSV without website evidence",
    category: "strong_saas_csv_no_website",
    v1Row: baseRow({
      companyName: "Example SaaS Platform",
      website: "https://examplesaas.example",
      country: "Singapore",
      industry: "SaaS platform",
      staff: "11-50",
    }),
    v2Input: v2Input({
      id: "strong-saas-csv-no-website",
      companyName: "Example SaaS Platform",
      website: "https://examplesaas.example",
      country: "Singapore",
      industry: "SaaS platform",
      staff: "11-50",
      websiteEvidence: null,
    }),
    invariants: [
      "weak_or_no_website_not_high_confidence_qualified",
      "no_ai_dependency",
    ],
    approvedDivergences: [
      {
        field: "type",
        reason: "V2 uses configured product_saas taxonomy instead of V1 SAAS label.",
      },
      {
        field: "score",
        reason: "V2 separates fit score from confidence and may score CSV product fit differently.",
      },
      {
        field: "confidence",
        reason: "V2 explicitly penalizes missing website evidence through confidence.",
      },
      {
        field: "qualification",
        reason: "This is intentionally left visible as an invariant review case for no-website evidence.",
      },
    ],
  },
  {
    id: "service_only",
    name: "Service-only company",
    category: "service_only",
    v1Row: baseRow({
      companyName: "Northstar Agency",
      website: "https://northstaragency.example",
      country: "United Kingdom",
      industry: "Marketing agency",
      staff: "11-50",
    }),
    v1Options: {
      websiteResearch: websiteResearchFixture({
        quality: "medium",
        serviceSignals: ["agency", "consulting"],
        likelyServiceLed: true,
        likelyNotRelevant: true,
      }),
    },
    v2Input: v2Input({
      id: "service-only",
      companyName: "Northstar Agency",
      website: "https://northstaragency.example",
      country: "United Kingdom",
      industry: "Marketing agency",
      staff: "11-50",
      websiteEvidence: {
        status: "reachable",
        quality: "medium",
        serviceSignals: ["agency", "consulting"],
      },
    }),
    invariants: ["not_relevant_not_score_60", "no_ai_dependency"],
    approvedDivergences: [
      {
        field: "type",
        reason: "V2 keeps service_only as a configured type result before persistence mapping.",
      },
      {
        field: "qualification",
        reason: "V2 benchmark keeps service-led rows reviewable unless an explicit terminal gate fires.",
      },
      {
        field: "score",
        reason: "V2 applies configured hard-gate caps and penalties rather than V1 direct service branch score.",
      },
      {
        field: "confidence",
        reason: "V2 confidence remains separate from the V1 service disqualification confidence.",
      },
    ],
  },
  {
    id: "service_plus_product",
    name: "Service plus product",
    category: "service_plus_product",
    v1Row: baseRow({
      companyName: "Atlas Automation",
      website: "https://atlasautomation.example",
      country: "Canada",
      industry: "Automation software and implementation",
      staff: "51-200",
    }),
    v1Options: {
      websiteResearch: websiteResearchFixture({
        quality: "strong",
        productSignals: ["platform", "workflow automation"],
        serviceSignals: ["implementation", "consulting"],
        pricingSignals: ["pricing"],
        likelyProductLed: true,
        likelySaas: true,
      }),
    },
    v2Input: v2Input({
      id: "service-plus-product",
      companyName: "Atlas Automation",
      website: "https://atlasautomation.example",
      country: "Canada",
      industry: "Automation software and implementation",
      staff: "51-200",
      websiteEvidence: {
        status: "reachable",
        quality: "strong",
        productSignals: ["platform", "workflow automation"],
        serviceSignals: ["implementation", "consulting"],
        pricingSignals: ["pricing"],
      },
    }),
    invariants: [
      "service_plus_product_not_auto_failed_by_service_keywords",
      "no_ai_dependency",
    ],
    approvedDivergences: [
      {
        field: "type",
        reason: "V2 may classify mixed product/service evidence differently from V1 SAAS.",
      },
      {
        field: "confidence",
        reason: "V2 applies review pressure for mixed service/product evidence.",
      },
      {
        field: "score",
        reason: "V2 fit score retains product-led strength while V1 uses website branch scoring.",
      },
    ],
  },
  {
    id: "website_offline",
    name: "Website offline",
    category: "website_offline_or_weak",
    v1Row: baseRow({
      companyName: "Offline Product Co",
      website: "https://offlineproduct.example",
      country: "Australia",
      industry: "Software",
      staff: "11-50",
      notes: "Website offline",
    }),
    v1Options: {
      websiteResearch: websiteResearchFixture({
        status: "offline",
        quality: "weak",
      }),
    },
    v2Input: v2Input({
      id: "website-offline",
      companyName: "Offline Product Co",
      website: "https://offlineproduct.example",
      country: "Australia",
      industry: "Software",
      staff: "11-50",
      websiteEvidence: {
        status: "offline",
        quality: "weak",
      },
    }),
    invariants: [
      "weak_or_no_website_not_high_confidence_qualified",
      "no_ai_dependency",
    ],
    approvedDivergences: [
      {
        field: "qualification",
        reason: "V2 treats weak/offline evidence as reviewable uncertainty unless configured terminal.",
      },
      {
        field: "confidence",
        reason: "V2 confidence is data-quality based rather than V1 website-status branch confidence.",
      },
      {
        field: "score",
        reason: "V2 treats offline evidence as review pressure and score cap rather than V1 Not Relevant branch.",
      },
      {
        field: "type",
        reason: "V2 classifies available product/service hints separately from V1 Not Relevant mapping.",
      },
    ],
  },
  {
    id: "data_poor",
    name: "Data-poor row",
    category: "data_poor",
    v1Row: {
      "Company Name": "Unknown Co",
    },
    v2Input: v2Input({
      id: "data-poor",
      companyName: "Unknown Co",
      websiteEvidence: null,
    }),
    invariants: [
      "weak_or_no_website_not_high_confidence_qualified",
      "no_ai_dependency",
    ],
    approvedDivergences: [
      {
        field: "qualification",
        reason: "V2 keeps sparse rows uncertain instead of hard-failing missing website by default.",
      },
      {
        field: "confidence",
        reason: "V2 explicitly lowers confidence for missing critical data.",
      },
      {
        field: "score",
        reason: "V2 starts data-poor rows from a neutral default score and uses confidence for uncertainty.",
      },
      {
        field: "type",
        reason: "V2 uses unknown type for sparse evidence instead of V1 Not Relevant fallback.",
      },
    ],
  },
  {
    id: "excluded_country",
    name: "Excluded country",
    category: "excluded_country",
    v1Row: baseRow({
      companyName: "Offshore Dev Services",
      website: "https://offshoredev.example",
      country: "India",
      industry: "Software development services",
      staff: "51-200",
    }),
    v2Input: v2Input({
      id: "excluded-country",
      companyName: "Offshore Dev Services",
      website: "https://offshoredev.example",
      country: "India",
      industry: "Software development services",
      staff: "51-200",
      websiteEvidence: {
        status: "reachable",
        quality: "medium",
        serviceSignals: ["outsourcing", "dedicated developers"],
      },
    }),
    invariants: ["excluded_country_not_qualified", "no_ai_dependency"],
    approvedDivergences: [
      {
        field: "type",
        reason: "V2 reports configured service_only type before later persistence/export mapping.",
      },
      {
        field: "confidence",
        reason: "V2 confidence reflects current evidence rather than V1 disqualification branch confidence.",
      },
      {
        field: "score",
        reason: "V2 applies configured excluded-country hard gate cap rather than V1 direct branch score.",
      },
    ],
  },
  {
    id: "personal_email",
    name: "Personal email signal",
    category: "personal_email",
    v1Row: {
      ...baseRow({
        companyName: "Solo Builder SaaS",
        website: "https://solobuilder.example",
        country: "United States",
        industry: "SaaS",
        staff: "2",
      }),
      Email: "founder@gmail.com",
    },
    v2Input: v2Input({
      id: "personal-email",
      companyName: "Solo Builder SaaS",
      website: "https://solobuilder.example",
      country: "United States",
      industry: "SaaS",
      staff: "2",
      emailDomainType: "personal",
      websiteEvidence: {
        status: "reachable",
        quality: "medium",
        productSignals: ["saas platform"],
      },
    }),
    invariants: ["no_ai_dependency"],
    approvedDivergences: [
      {
        field: "qualification",
        reason: "V2 uses hard gate cap/confidence pipeline instead of direct V1 disqualification branch.",
      },
      {
        field: "type",
        reason: "V2 reports configured product_saas taxonomy before persistence/export mapping.",
      },
      {
        field: "score",
        reason: "V2 scores product evidence with hard-gate caps rather than V1 personal-email branch score.",
      },
      {
        field: "confidence",
        reason: "V2 confidence is evidence-based and separate from V1 personal-email branch confidence.",
      },
    ],
  },
  {
    id: "b2c_only",
    name: "B2C-only signal",
    category: "b2c_only",
    v1Row: baseRow({
      companyName: "Retail App Co",
      website: "https://retailapp.example",
      country: "Canada",
      industry: "Consumer app marketplace retail only",
      staff: "11-50",
    }),
    v2Input: v2Input({
      id: "b2c-only",
      companyName: "Retail App Co",
      website: "https://retailapp.example",
      country: "Canada",
      industry: "Consumer app marketplace retail only",
      staff: "11-50",
      websiteEvidence: {
        status: "reachable",
        quality: "medium",
        productSignals: ["consumer app"],
      },
    }),
    invariants: ["not_relevant_not_score_60", "no_ai_dependency"],
    approvedDivergences: [
      {
        field: "qualification",
        reason: "V2 treats B2C signal as configured negative evidence, not a V1 hard-rule branch.",
      },
      {
        field: "confidence",
        reason: "V2 confidence is evidence-based and separated from score.",
      },
      {
        field: "score",
        reason: "V2 applies configured B2C negative evidence instead of V1 branch score.",
      },
      {
        field: "type",
        reason: "V2 reports unknown when product/service taxonomy is not sufficiently supported.",
      },
    ],
  },
  {
    id: "conflicting_evidence",
    name: "Conflicting product and service evidence",
    category: "conflicting_evidence",
    v1Row: baseRow({
      companyName: "DualMode Platform",
      website: "https://dualmode.example",
      country: "Singapore",
      industry: "Software platform and consulting services",
      staff: "51-200",
    }),
    v1Options: {
      websiteResearch: websiteResearchFixture({
        quality: "medium",
        productSignals: ["platform"],
        serviceSignals: ["consulting"],
        likelyProductLed: true,
        likelyServiceLed: true,
      }),
    },
    v2Input: v2Input({
      id: "conflicting-evidence",
      companyName: "DualMode Platform",
      website: "https://dualmode.example",
      country: "Singapore",
      industry: "Software platform and consulting services",
      staff: "51-200",
      websiteEvidence: {
        status: "reachable",
        quality: "medium",
        productSignals: ["platform"],
        serviceSignals: ["consulting"],
      },
    }),
    invariants: [
      "service_plus_product_not_auto_failed_by_service_keywords",
      "no_ai_dependency",
    ],
    approvedDivergences: [
      {
        field: "type",
        reason: "V2 explicitly represents configured mixed evidence behavior.",
      },
      {
        field: "confidence",
        reason: "V2 applies confidence pressure to ambiguous/mixed evidence.",
      },
      {
        field: "score",
        reason: "V2 preserves product evidence in the fit score while V1 collapses conflicting evidence to Not Relevant.",
      },
      {
        field: "qualification",
        reason: "V2 downgrades conflicting high-fit evidence to uncertain through confidence separation.",
      },
    ],
  },
  {
    id: "ai_unavailable",
    name: "AI unavailable has no benchmark effect",
    category: "ai_unavailable",
    v1Row: baseRow({
      companyName: "No AI Needed Platform",
      website: "https://noaineeded.example",
      country: "Israel",
      industry: "Software platform",
      staff: "11-50",
    }),
    v2Input: v2Input({
      id: "ai-unavailable",
      companyName: "No AI Needed Platform",
      website: "https://noaineeded.example",
      country: "Israel",
      industry: "Software platform",
      staff: "11-50",
      websiteEvidence: {
        status: "reachable",
        quality: "medium",
        productSignals: ["software platform"],
      },
    }),
    invariants: ["no_ai_dependency"],
    approvedDivergences: [
      {
        field: "type",
        reason: "V2 uses configured product_saas taxonomy instead of V1 SAAS label.",
      },
      {
        field: "score",
        reason: "V2 scores current product evidence independently from AI availability.",
      },
      {
        field: "confidence",
        reason: "V2 confidence is based on deterministic evidence quality, not AI availability.",
      },
    ],
  },
] satisfies ParityBenchmarkFixture[];

function baseRow({
  companyName,
  website,
  country,
  industry,
  staff,
  notes,
}: {
  companyName: string;
  website: string;
  country: string;
  industry: string;
  staff: string;
  notes?: string;
}) {
  return {
    "Company Name": companyName,
    Website: website,
    "Company Country": country,
    "Company Industry": industry,
    "Company Staff Count Range": staff,
    "Notes / Tags": notes || "",
  };
}

function v2Input({
  id,
  companyName,
  website,
  country,
  industry,
  staff,
  emailDomainType,
  websiteEvidence,
}: {
  id: string;
  companyName: string;
  website?: string;
  country?: string;
  industry?: string;
  staff?: string;
  emailDomainType?: "business" | "personal" | "generic" | "unknown";
  websiteEvidence: EvaluateLeadAssignmentInput["websiteEvidence"];
}): EvaluateLeadAssignmentInput {
  return {
    leadAssignmentId: `parity-${id}`,
    companyInput: {
      companyName,
      canonicalDomain: website?.replace(/^https?:\/\//, "") || null,
      website: website || null,
      companyCountry: country || null,
      companyIndustry: industry || null,
      companyStaffCountRange: staff || null,
      normalizedCompanyName: companyName.toLowerCase(),
      csvSignalHash: `parity-${id}`,
    },
    contactInput: emailDomainType ? { emailDomainType } : undefined,
    websiteEvidence,
    icpVersionId: TELSTAR_SAAS_OUTBOUND_ICP_RULES_FIXTURE.ruleSetId,
    icpRules: TELSTAR_SAAS_OUTBOUND_ICP_RULES_FIXTURE,
  };
}

function websiteResearchFixture({
  status = "reachable",
  quality = "medium",
  productSignals = [],
  serviceSignals = [],
  pricingSignals = [],
  apiSignals = [],
  likelyProductLed = false,
  likelyServiceLed = false,
  likelySaas = false,
  likelyNotRelevant = false,
}: {
  status?: string;
  quality?: string;
  productSignals?: string[];
  serviceSignals?: string[];
  pricingSignals?: string[];
  apiSignals?: string[];
  likelyProductLed?: boolean;
  likelyServiceLed?: boolean;
  likelySaas?: boolean;
  likelyNotRelevant?: boolean;
}) {
  const signals = {
    positiveKeywords: [],
    negativeKeywords: [],
    productSignals: evidenceSignals(productSignals, "product"),
    serviceSignals: evidenceSignals(serviceSignals, "service"),
    pricingSignals: evidenceSignals(pricingSignals, "pricing"),
    apiSignals: evidenceSignals(apiSignals, "api"),
    aiSignals: [],
    cloudSignals: [],
    dataSignals: [],
    securitySignals: [],
    parkedSignals: [],
    hasProductSignal: productSignals.length > 0,
    hasServiceSignal: serviceSignals.length > 0,
    hasPricingSignal: pricingSignals.length > 0,
    hasApiSignal: apiSignals.length > 0,
    hasAiSignal: false,
    hasCloudSignal: false,
    hasDataSignal: false,
    hasSecuritySignal: false,
  };

  return {
    inputUrl: "https://fixture.example",
    normalizedUrl: "https://fixture.example/",
    normalizedDomain: "fixture.example",
    finalUrl: "https://fixture.example/",
    reachable: status === "reachable",
    status,
    httpStatus: status === "reachable" ? 200 : null,
    redirectChain: [],
    pagesChecked: [],
    signals,
    quality,
    classificationHints: {
      likelyProductLed,
      likelyServiceLed,
      likelySaas,
      likelyCloud: false,
      likelyAi: false,
      likelyDataSolution: false,
      likelyCyberSecurity: false,
      likelyNotRelevant,
    },
    summary: "Fixture website research summary.",
    errors: [],
    researchedAt: "1970-01-01T00:00:00.000Z",
  };
}

function evidenceSignals(keywords: string[], category: string) {
  return keywords.map((keyword) => ({
    keyword,
    category,
    url: "https://fixture.example/",
    snippet: `Fixture evidence for ${keyword}.`,
  }));
}
