import type { IcpVersionRules } from "../icpRulesSchema";

const BASE_WEIGHTS = {
  geography: 20,
  companyType: 15,
  industry: 15,
  size: 15,
  persona: 25,
  positiveSignals: 10,
  negativeSignals: 20,
} satisfies IcpVersionRules["scoringWeights"];

const BASE_POLICIES = {
  missingWebsitePolicy: "review_required",
  confidencePolicy: {
    highConfidenceThreshold: 75,
    mediumConfidenceThreshold: 45,
  },
  scorePolicy: {
    minScore: 0,
    maxScore: 100,
    qualifiedMinFitScore: 75,
    needsReviewMinFitScore: 45,
  },
} satisfies Pick<
  IcpVersionRules,
  "missingWebsitePolicy" | "confidencePolicy" | "scorePolicy"
>;

const PRODUCT_COMPANY_TYPE_RULES = [
  {
    id: "product_saas",
    type: "PRODUCT_SAAS",
    positiveKeywords: ["saas", "software", "subscription", "product"],
    negativeKeywords: ["agency", "consulting", "outsourcing", "managed services"],
  },
  {
    id: "product_platform",
    type: "PRODUCT_PLATFORM",
    positiveKeywords: ["platform", "api", "loyalty", "engagement", "developer"],
    negativeKeywords: ["consulting", "services only", "outsourcing"],
  },
  {
    id: "service_plus_product",
    type: "SERVICE_PLUS_PRODUCT",
    positiveKeywords: ["platform", "implementation", "consulting"],
    negativeKeywords: ["service only"],
  },
  {
    id: "service_only",
    type: "SERVICE_ONLY",
    positiveKeywords: ["agency", "outsourcing", "consulting", "managed services"],
    negativeKeywords: ["platform", "software"],
  },
] satisfies IcpVersionRules["companyTypeRules"];

export const TELESTAR_SAAS_OUTBOUND_ICP_RULES = {
  schemaVersion: "v1",
  ruleSetId: "icp1r-telestar-saas-outbound",
  displayName: "TeleStar SaaS / Software Outbound ICP",
  ...BASE_POLICIES,
  geography: {
    targetCountries: [
      "United States",
      "USA",
      "Australia",
      "Singapore",
      "Norway",
      "Switzerland",
      "Denmark",
      "Sweden",
      "United Kingdom",
      "UK",
      "Canada",
      "Israel",
    ],
    excludedCountries: ["India", "Pakistan", "Bangladesh", "Philippines"],
    unknownCountryPolicy: "review_required",
  },
  companySize: {
    minEmployees: 3,
    unknownSizePolicy: "review_required",
  },
  hardGates: [
    {
      id: "excluded_country",
      label: "Excluded delivery or office geography",
      field: "country",
      operator: "in",
      value: ["India", "Pakistan", "Bangladesh", "Philippines"],
      severity: "terminal",
      confidence: "HIGH",
      evidenceSource: "explicit country",
      reasonCode: "target_geo_mismatch_explicit",
    },
    {
      id: "one_person_company",
      label: "One-person company",
      field: "employeeCount",
      operator: "lt",
      value: 3,
      severity: "terminal",
      confidence: "HIGH",
      evidenceSource: "employee count",
      reasonCode: "company_too_small",
    },
    {
      id: "website_offline",
      label: "Website offline",
      field: "websiteStatus",
      operator: "equals",
      value: "offline",
      severity: "terminal",
      confidence: "HIGH",
      evidenceSource: "website research",
      reasonCode: "website_offline",
    },
    {
      id: "services_consulting_based",
      label: "Services or consulting based company",
      field: "evidenceText",
      operator: "contains",
      value: ["agency", "consulting", "outsourcing", "managed services", "services only"],
      severity: "terminal",
      confidence: "HIGH",
      evidenceSource: "company evidence",
      reasonCode: "services_consulting_based",
    },
  ],
  positiveSignals: [
    {
      id: "b2b_saas_software_product",
      label: "B2B SaaS or software product evidence",
      keywords: [
        "saas",
        "software",
        "platform",
        "product",
        "subscription",
        "workflow",
        "automation",
        "api",
      ],
      evidenceSources: ["csv_field", "website_homepage", "website_subpage"],
      reasonCode: "target_company_type_match",
    },
    {
      id: "growth_sales_motion",
      label: "Growth or sales-led motion",
      keywords: ["growth", "sales", "pipeline", "revenue", "lead generation"],
      evidenceSources: ["csv_field", "website_metadata"],
      reasonCode: "target_industry_match",
    },
  ],
  negativeSignals: [
    {
      id: "service_consulting_language",
      label: "Service or consulting language",
      keywords: ["agency", "consulting", "outsourcing", "managed services"],
      evidenceSources: ["csv_field", "website_homepage", "website_subpage"],
      reasonCode: "services_consulting_based",
    },
    {
      id: "consumer_only",
      label: "Consumer-only language",
      keywords: ["consumer only", "b2c only"],
      evidenceSources: ["csv_field", "website_homepage"],
      reasonCode: "target_industry_mismatch",
    },
  ],
  companyTypeRules: PRODUCT_COMPANY_TYPE_RULES,
  scoringWeights: BASE_WEIGHTS,
  requiredEvidenceForFinalQualification: {
    explicitGeo: true,
    employeeSize: true,
    personaTitle: true,
    websiteReachable: true,
  },
  blocksFinalQualificationFromCompanyOnlyEvidence: true,
} satisfies IcpVersionRules;

// Kept as a compatibility alias for older smoke scripts/imports.
export const TELESTAR_SDR_OUTSOURCING_ICP_RULES = {
  ...TELESTAR_SAAS_OUTBOUND_ICP_RULES,
} satisfies IcpVersionRules;

export const MANUFACTURING_ERP_BUYER_ICP_RULES = {
  schemaVersion: "v1",
  ruleSetId: "icp1r-manufacturing-erp-buyer",
  displayName: "Manufacturing ERP Buyer",
  ...BASE_POLICIES,
  geography: {
    targetCountries: ["Vietnam", "Thailand", "Malaysia", "Indonesia"],
    excludedCountries: ["Singapore"],
    unknownCountryPolicy: "review_required",
  },
  companySize: {
    minEmployees: 100,
    maxEmployees: 5000,
    unknownSizePolicy: "review_required",
  },
  hardGates: [
    {
      id: "loyalty_platform_not_erp_buyer",
      label: "Loyalty platform is not a manufacturing ERP buyer",
      field: "evidenceText",
      operator: "contains",
      value: ["loyalty", "customer engagement"],
      severity: "terminal",
      confidence: "HIGH",
      evidenceSource: "company evidence",
      reasonCode: "target_industry_mismatch",
    },
  ],
  positiveSignals: [
    {
      id: "manufacturing_erp",
      label: "Manufacturing ERP evidence",
      keywords: ["manufacturing", "factory", "erp", "production planning"],
      evidenceSources: ["csv_field", "website_homepage"],
      reasonCode: "target_industry_match",
    },
  ],
  negativeSignals: [
    {
      id: "non_manufacturing_platform",
      label: "Non-manufacturing platform",
      keywords: ["loyalty", "customer engagement", "marketing platform"],
      evidenceSources: ["csv_field", "website_homepage"],
      reasonCode: "target_industry_mismatch",
    },
  ],
  companyTypeRules: PRODUCT_COMPANY_TYPE_RULES,
  scoringWeights: BASE_WEIGHTS,
  requiredEvidenceForFinalQualification: {
    explicitGeo: true,
    employeeSize: true,
    personaTitle: true,
  },
  blocksFinalQualificationFromCompanyOnlyEvidence: true,
} satisfies IcpVersionRules;

export const STRATOVA_CXO_ICP_RULES = {
  schemaVersion: "v1",
  ruleSetId: "icp1r-stratova-cxo",
  displayName: "Stratova CXO",
  ...BASE_POLICIES,
  geography: {
    targetCountries: ["Singapore", "Vietnam", "Thailand", "Malaysia", "Indonesia"],
    excludedCountries: ["India", "Pakistan", "Bangladesh"],
    unknownCountryPolicy: "review_required",
  },
  companySize: {
    minEmployees: 50,
    maxEmployees: 5000,
    unknownSizePolicy: "review_required",
  },
  hardGates: [
    {
      id: "excluded_country",
      label: "Explicit excluded country",
      field: "country",
      operator: "in",
      value: ["India", "Pakistan", "Bangladesh"],
      severity: "terminal",
      confidence: "HIGH",
      evidenceSource: "explicit country",
      reasonCode: "target_geo_mismatch_explicit",
    },
  ],
  positiveSignals: [
    {
      id: "enterprise_platform",
      label: "Enterprise platform evidence",
      keywords: ["platform", "enterprise", "customer engagement", "analytics"],
      evidenceSources: ["csv_field", "website_homepage", "website_subpage"],
      reasonCode: "target_company_type_match",
    },
  ],
  negativeSignals: [],
  companyTypeRules: PRODUCT_COMPANY_TYPE_RULES,
  scoringWeights: BASE_WEIGHTS,
  requiredEvidenceForFinalQualification: {
    explicitGeo: true,
    employeeSize: true,
    personaTitle: true,
  },
  blocksFinalQualificationFromCompanyOnlyEvidence: true,
} satisfies IcpVersionRules;
