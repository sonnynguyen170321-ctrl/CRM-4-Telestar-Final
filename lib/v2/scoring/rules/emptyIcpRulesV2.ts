import { IcpVersionRulesV2 } from "./schema-v2";
import { DICTIONARY_VERSIONS } from "./dictionaries/index";

/**
 * Creates an empty, structurally valid schema-v2 ICP rules object.
 * Used when initializing a new ICP profile from scratch.
 */
export function emptyIcpRulesV2(ruleSetId: string, displayName: string): IcpVersionRulesV2 {
  return {
    schemaVersion: "v2",
    ruleSetId,
    displayName,
    geography: {
      targetCountries: [],
      excludedCountries: [],
      targetRegions: [],
      locationScope: "hq",
      requiredOfficeCountries: [],
      excludedOfficeCountries: [],
      priorityTiers: [],
      subNationalRegions: [],
      unknownCountryPolicy: "review_required",
    },
    industry: {
      mode: "all",
      targetIndustries: [],
      excludedIndustries: [],
      industryKeywords: [],
      subIndustries: [],
    },
    companyType: {
      allow: [],
      deny: [],
      servicesConsultingPolicy: {
        disqualify: false,
        exceptMarkets: [],
      },
    },
    persona: {
      titleAllowlist: [],
      titleDenylist: [],
      titleTiers: [],
      seniorityExclusions: [],
      departmentAllowlist: [],
      departmentSeniorityOverrides: {},
      titleKeywords: [],
      languageVariants: {},
      requirePersonaForFinalQualification: false,
    },
    size: {
      sizeBands: [],
      excludeTooSmall: false,
      unknownSizePolicy: "low_confidence_continue",
    },
    disqualifiers: {
      genericEmailContact: { disqualify: false },
      onePersonCompany: { disqualify: false },
      websiteOffline: { disqualify: false },
      projectBased: { disqualify: false },
      competitorDenylist: [],
    },
    accountSupplied: {
      mode: "score",
      companyList: [],
    },
    requiredEvidenceForFinalQualification: {
      explicitGeo: false,
      employeeSize: false,
      personaTitle: false,
      websiteReachable: false,
    },
    scoringWeights: {
      geo: 20,
      industry: 15,
      companyType: 15,
      size: 10,
      persona: 30,
      signals: 10,
    },
    scorePolicy: {
      minScore: 0,
      maxScore: 100,
      qualifiedMinFitScore: 75,
      needsReviewMinFitScore: 45,
    },
    confidencePolicy: {
      highConfidenceThreshold: 75,
      mediumConfidenceThreshold: 45,
    },
    dictionaryVersions: { ...DICTIONARY_VERSIONS },
    blocksFinalQualificationFromCompanyOnlyEvidence: true,
  };
}
