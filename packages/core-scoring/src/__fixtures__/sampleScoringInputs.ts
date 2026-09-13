import type { EvaluateLeadAssignmentInput } from "../types";
import { TELSTAR_SAAS_OUTBOUND_ICP_RULES_FIXTURE } from "./defaultIcpRules";

export const PERFECT_FIT_COMPANY_INPUT_FIXTURE = {
  leadAssignmentId: "fixture-perfect-fit-lead-assignment",
  companyInput: {
    companyName: "BrightWave Platform",
    canonicalDomain: "brightwave.example",
    website: "https://brightwave.example",
    companyCountry: "Singapore",
    companyIndustry: "B2B SaaS",
    companyStaffCountRange: "51-200",
    companyLinkedInUrl: "https://linkedin.com/company/brightwave",
    normalizedCompanyName: "brightwave platform",
    csvSignalHash: "fixture-csv-perfect-fit",
  },
  websiteEvidence: {
    normalizedDomain: "brightwave.example",
    finalUrl: "https://brightwave.example",
    status: "reachable",
    quality: "strong",
    evidenceHash: "fixture-website-perfect-fit",
    productSignals: ["platform", "workflow automation"],
    pricingSignals: ["pricing"],
    apiSignals: ["api"],
    researchedAt: "2026-06-07T00:00:00.000Z",
  },
  icpVersionId: "telestar-saas-outbound-v1",
  icpRules: TELSTAR_SAAS_OUTBOUND_ICP_RULES_FIXTURE,
} satisfies EvaluateLeadAssignmentInput;

export const MISSING_WEBSITE_COMPANY_INPUT_FIXTURE = {
  leadAssignmentId: "fixture-missing-website-lead-assignment",
  companyInput: {
    companyName: "No Site Software",
    companyCountry: "Australia",
    companyIndustry: "Software",
    companyStaffCountRange: "11-50",
    normalizedCompanyName: "no site software",
    csvSignalHash: "fixture-csv-missing-website",
  },
  websiteEvidence: null,
  icpVersionId: "telestar-saas-outbound-v1",
  icpRules: TELSTAR_SAAS_OUTBOUND_ICP_RULES_FIXTURE,
} satisfies EvaluateLeadAssignmentInput;

export const EXCLUDED_COUNTRY_COMPANY_INPUT_FIXTURE = {
  leadAssignmentId: "fixture-excluded-country-lead-assignment",
  companyInput: {
    companyName: "Offshore Dev Services",
    canonicalDomain: "offshoredev.example",
    website: "https://offshoredev.example",
    companyCountry: "India",
    companyIndustry: "Software development services",
    companyStaffCountRange: "51-200",
    normalizedCompanyName: "offshore dev services",
    csvSignalHash: "fixture-csv-excluded-country",
  },
  websiteEvidence: {
    normalizedDomain: "offshoredev.example",
    finalUrl: "https://offshoredev.example",
    status: "reachable",
    quality: "medium",
    evidenceHash: "fixture-website-excluded-country",
    serviceSignals: ["outsourcing", "dedicated developers"],
    researchedAt: "2026-06-07T00:00:00.000Z",
  },
  icpVersionId: "telestar-saas-outbound-v1",
  icpRules: TELSTAR_SAAS_OUTBOUND_ICP_RULES_FIXTURE,
} satisfies EvaluateLeadAssignmentInput;

export const SERVICE_ONLY_COMPANY_INPUT_FIXTURE = {
  leadAssignmentId: "fixture-service-only-lead-assignment",
  companyInput: {
    companyName: "Northstar Agency",
    canonicalDomain: "northstaragency.example",
    website: "https://northstaragency.example",
    companyCountry: "United Kingdom",
    companyIndustry: "Marketing agency",
    companyStaffCountRange: "11-50",
    normalizedCompanyName: "northstar agency",
    csvSignalHash: "fixture-csv-service-only",
  },
  websiteEvidence: {
    normalizedDomain: "northstaragency.example",
    finalUrl: "https://northstaragency.example",
    status: "reachable",
    quality: "medium",
    evidenceHash: "fixture-website-service-only",
    serviceSignals: ["agency", "consulting"],
    researchedAt: "2026-06-07T00:00:00.000Z",
  },
  icpVersionId: "telestar-saas-outbound-v1",
  icpRules: TELSTAR_SAAS_OUTBOUND_ICP_RULES_FIXTURE,
} satisfies EvaluateLeadAssignmentInput;

export const SERVICE_PLUS_PRODUCT_COMPANY_INPUT_FIXTURE = {
  leadAssignmentId: "fixture-service-plus-product-lead-assignment",
  companyInput: {
    companyName: "Atlas Automation",
    canonicalDomain: "atlasautomation.example",
    website: "https://atlasautomation.example",
    companyCountry: "Canada",
    companyIndustry: "Automation software and implementation",
    companyStaffCountRange: "51-200",
    normalizedCompanyName: "atlas automation",
    csvSignalHash: "fixture-csv-service-plus-product",
  },
  websiteEvidence: {
    normalizedDomain: "atlasautomation.example",
    finalUrl: "https://atlasautomation.example",
    status: "reachable",
    quality: "strong",
    evidenceHash: "fixture-website-service-plus-product",
    productSignals: ["platform", "workflow automation"],
    serviceSignals: ["implementation", "consulting"],
    pricingSignals: ["pricing"],
    researchedAt: "2026-06-07T00:00:00.000Z",
  },
  icpVersionId: "telestar-saas-outbound-v1",
  icpRules: TELSTAR_SAAS_OUTBOUND_ICP_RULES_FIXTURE,
} satisfies EvaluateLeadAssignmentInput;

export const DATA_POOR_COMPANY_INPUT_FIXTURE = {
  leadAssignmentId: "fixture-data-poor-lead-assignment",
  companyInput: {
    companyName: "Unknown Co",
    normalizedCompanyName: "unknown co",
    csvSignalHash: "fixture-csv-data-poor",
  },
  websiteEvidence: null,
  icpVersionId: "telestar-saas-outbound-v1",
  icpRules: TELSTAR_SAAS_OUTBOUND_ICP_RULES_FIXTURE,
} satisfies EvaluateLeadAssignmentInput;
