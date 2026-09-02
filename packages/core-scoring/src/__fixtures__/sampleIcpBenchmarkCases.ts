import type {
  CompanyEvidence,
  IcpVersionRules,
  PersonaEvidence,
  Qualification,
} from "../icpRulesSchema";
import {
  MANUFACTURING_ERP_BUYER_ICP_RULES,
  STRATOVA_CXO_ICP_RULES,
  TELESTAR_SDR_OUTSOURCING_ICP_RULES,
} from "./sampleIcpRules";

export type SampleIcpBenchmarkCase = {
  name: string;
  companyEvidence: CompanyEvidence;
  personaEvidence?: PersonaEvidence;
  icpRules: IcpVersionRules;
  expected: {
    qualification: Qualification;
    minFitScore?: number;
    maxFitScore?: number;
    missingEvidenceIncludes?: string[];
    reasonCodesInclude?: string[];
    accountPreRankNot?: string;
    accountPreRankOneOf?: string[];
    neverQualified?: boolean;
  };
};

export const LOYALTY_PLATFORM_COMPANY = {
  companyName: "Meridian Loyalty Platform",
  website: "https://meridianloyalty.example",
  canonicalDomain: "meridianloyalty.example",
  description:
    "B2B SaaS customer engagement and loyalty platform for revenue teams.",
  industry: "Customer engagement SaaS",
  country: "Singapore",
  employeeRange: "101-250",
  productSignals: ["customer engagement platform", "loyalty software"],
  pricingSignals: ["pricing"],
  platformSignals: ["platform", "analytics"],
  websiteStatus: "reachable",
} satisfies CompanyEvidence;

export const CXO_PERSONA = {
  rawTitle: "Chief Revenue Officer",
  title: "Chief Revenue Officer",
  department: "Revenue",
  seniorityTier: "C_LEVEL",
  titleKeywords: ["chief", "cro"],
  contactLocation: "Singapore",
} satisfies PersonaEvidence;

const FOUNDER_PERSONA = {
  rawTitle: "Founder",
  title: "Founder",
  department: "Executive",
  seniorityTier: "C_LEVEL",
  titleKeywords: ["founder"],
  contactLocation: "United States",
} satisfies PersonaEvidence;

export const SAMPLE_ICP_BENCHMARK_CASES: SampleIcpBenchmarkCase[] = [
  {
    name: "same company qualifies for telestar when persona evidence exists",
    companyEvidence: LOYALTY_PLATFORM_COMPANY,
    personaEvidence: CXO_PERSONA,
    icpRules: TELESTAR_SDR_OUTSOURCING_ICP_RULES,
    expected: {
      qualification: "QUALIFIED",
      minFitScore: 75,
      reasonCodesInclude: ["target_geo_match_explicit", "target_persona_match"],
    },
  },
  {
    name: "us software product company qualifies for telestar",
    companyEvidence: {
      companyName: "BrightWave Revenue OS",
      website: "https://brightwave.example",
      canonicalDomain: "brightwave.example",
      description:
        "B2B SaaS revenue workflow software with product, platform, pricing, and API pages.",
      industry: "Sales software",
      country: "United States",
      employeeCount: 12,
      productSignals: ["revenue workflow software", "platform"],
      pricingSignals: ["pricing"],
      platformSignals: ["api", "platform"],
      websiteStatus: "reachable",
    },
    personaEvidence: FOUNDER_PERSONA,
    icpRules: TELESTAR_SDR_OUTSOURCING_ICP_RULES,
    expected: {
      qualification: "QUALIFIED",
      minFitScore: 75,
      reasonCodesInclude: ["target_geo_match_explicit", "target_persona_match"],
    },
  },
  {
    name: "same company unqualified for manufacturing erp buyer",
    companyEvidence: LOYALTY_PLATFORM_COMPANY,
    personaEvidence: CXO_PERSONA,
    icpRules: MANUFACTURING_ERP_BUYER_ICP_RULES,
    expected: {
      qualification: "UNQUALIFIED",
      reasonCodesInclude: ["hard_gate_confirmed", "target_industry_mismatch"],
      accountPreRankNot: "STRONG_ACCOUNT_FIT",
    },
  },
  {
    name: "same company cxo company only needs review",
    companyEvidence: LOYALTY_PLATFORM_COMPANY,
    icpRules: STRATOVA_CXO_ICP_RULES,
    expected: {
      qualification: "NEEDS_REVIEW",
      missingEvidenceIncludes: ["target_persona_missing_required"],
      accountPreRankOneOf: ["STRONG_ACCOUNT_FIT", "POSSIBLE_ACCOUNT_FIT"],
      neverQualified: true,
    },
  },
  {
    name: "high fit missing persona title is blocked",
    companyEvidence: LOYALTY_PLATFORM_COMPANY,
    icpRules: TELESTAR_SDR_OUTSOURCING_ICP_RULES,
    expected: {
      qualification: "NEEDS_REVIEW",
      missingEvidenceIncludes: ["target_persona_missing_required"],
      neverQualified: true,
    },
  },
  {
    name: "explicit wrong country is unqualified",
    companyEvidence: {
      ...LOYALTY_PLATFORM_COMPANY,
      companyName: "Offshore Loyalty Platform",
      country: "India",
    },
    personaEvidence: CXO_PERSONA,
    icpRules: TELESTAR_SDR_OUTSOURCING_ICP_RULES,
    expected: {
      qualification: "UNQUALIFIED",
      reasonCodesInclude: ["hard_gate_confirmed", "target_geo_mismatch_explicit"],
    },
  },
  {
    name: "excluded offshore office geography is unqualified",
    companyEvidence: {
      ...LOYALTY_PLATFORM_COMPANY,
      companyName: "Offshore SaaS Operations",
      country: "Philippines",
      notes: "Company office and delivery team are in the Philippines.",
    },
    personaEvidence: CXO_PERSONA,
    icpRules: TELESTAR_SDR_OUTSOURCING_ICP_RULES,
    expected: {
      qualification: "UNQUALIFIED",
      reasonCodesInclude: ["hard_gate_confirmed", "target_geo_mismatch_explicit"],
    },
  },
  {
    name: "one person company is unqualified",
    companyEvidence: {
      ...LOYALTY_PLATFORM_COMPANY,
      companyName: "Solo Founder SaaS",
      employeeCount: 1,
    },
    personaEvidence: FOUNDER_PERSONA,
    icpRules: TELESTAR_SDR_OUTSOURCING_ICP_RULES,
    expected: {
      qualification: "UNQUALIFIED",
      reasonCodesInclude: ["hard_gate_confirmed"],
    },
  },
  {
    name: "offline website is unqualified",
    companyEvidence: {
      ...LOYALTY_PLATFORM_COMPANY,
      companyName: "Offline Product Company",
      websiteStatus: "offline",
    },
    personaEvidence: CXO_PERSONA,
    icpRules: TELESTAR_SDR_OUTSOURCING_ICP_RULES,
    expected: {
      qualification: "UNQUALIFIED",
      reasonCodesInclude: ["hard_gate_confirmed"],
    },
  },
  {
    name: "weak evidence needs review",
    companyEvidence: {
      companyName: "SparseCo",
      description: "Possible software company.",
      websiteStatus: "unknown",
    },
    icpRules: TELESTAR_SDR_OUTSOURCING_ICP_RULES,
    expected: {
      qualification: "NEEDS_REVIEW",
      maxFitScore: 50,
      missingEvidenceIncludes: [
        "target_geo_missing",
        "target_size_missing_required",
        "target_persona_missing_required",
      ],
    },
  },
  {
    name: "services and consulting based company is unqualified",
    companyEvidence: {
      companyName: "Atlas Implementation Platform",
      website: "https://atlasplatform.example",
      canonicalDomain: "atlasplatform.example",
      description:
        "Implementation consulting with a workflow automation platform and pricing page.",
      industry: "Automation software",
      country: "Singapore",
      employeeRange: "51-200",
      productSignals: ["workflow automation platform"],
      serviceSignals: ["implementation consulting"],
      pricingSignals: ["pricing"],
      websiteStatus: "reachable",
    },
    personaEvidence: CXO_PERSONA,
    icpRules: TELESTAR_SDR_OUTSOURCING_ICP_RULES,
    expected: {
      qualification: "UNQUALIFIED",
      reasonCodesInclude: ["hard_gate_confirmed"],
    },
  },
];
