import { DICTIONARY_VERSIONS } from "../../rules/dictionaries/index";
import type {
  GeographyRulesV2,
  IcpVersionRulesV2,
  IndustryRulesV2,
  PersonaRulesV2,
  SizeRulesV2,
} from "../../rules/schema-v2";

// Test-fixture builder: fills schema-v2 defaults so each corpus ICP only states
// the dimensions that matter. Every produced object is structurally valid v2.
// Fixture-only; never imported by runtime.

export function defaultGeography(over: Partial<GeographyRulesV2> = {}): GeographyRulesV2 {
  return {
    targetCountries: [],
    excludedCountries: [],
    targetRegions: [],
    locationScope: "hq",
    requiredOfficeCountries: [],
    excludedOfficeCountries: [],
    priorityTiers: [],
    subNationalRegions: [],
    unknownCountryPolicy: "review_required",
    ...over,
  };
}

export function defaultIndustry(over: Partial<IndustryRulesV2> = {}): IndustryRulesV2 {
  return {
    mode: "all",
    targetIndustries: [],
    excludedIndustries: [],
    industryKeywords: [],
    subIndustries: [],
    ...over,
  };
}

export function defaultPersona(over: Partial<PersonaRulesV2> = {}): PersonaRulesV2 {
  return {
    titleAllowlist: [],
    titleDenylist: [],
    titleTiers: [],
    seniorityExclusions: [],
    departmentAllowlist: [],
    departmentSeniorityOverrides: {},
    titleKeywords: [],
    languageVariants: {},
    requirePersonaForFinalQualification: true,
    ...over,
  };
}

export function defaultSize(over: Partial<SizeRulesV2> = {}): SizeRulesV2 {
  return {
    sizeBands: [],
    unknownSizePolicy: "review_required",
    ...over,
  };
}

type DefineIcpInput = {
  ruleSetId: string;
  displayName: string;
  geography?: GeographyRulesV2;
  industry?: IndustryRulesV2;
  companyType?: IcpVersionRulesV2["companyType"];
  persona?: PersonaRulesV2;
  size?: SizeRulesV2;
  disqualifiers?: Partial<IcpVersionRulesV2["disqualifiers"]>;
  accountSupplied?: IcpVersionRulesV2["accountSupplied"];
  subIcps?: IcpVersionRulesV2["subIcps"];
  requiredEvidence?: Partial<IcpVersionRulesV2["requiredEvidenceForFinalQualification"]>;
  scoringWeights?: IcpVersionRulesV2["scoringWeights"];
  blocksCompanyOnly?: boolean;
};

export function defineIcp(input: DefineIcpInput): IcpVersionRulesV2 {
  return {
    schemaVersion: "v2",
    ruleSetId: input.ruleSetId,
    displayName: input.displayName,
    geography: input.geography ?? defaultGeography(),
    industry: input.industry ?? defaultIndustry(),
    companyType: input.companyType ?? {
      allow: [],
      deny: [],
      servicesConsultingPolicy: { disqualify: false, exceptMarkets: [] },
    },
    persona: input.persona ?? defaultPersona(),
    size: input.size ?? defaultSize(),
    disqualifiers: {
      genericEmailContact: { disqualify: false },
      onePersonCompany: { disqualify: false },
      websiteOffline: { disqualify: false },
      projectBased: { disqualify: false },
      competitorDenylist: [],
      ...input.disqualifiers,
    },
    accountSupplied: input.accountSupplied ?? { mode: "score", companyList: [] },
    ...(input.subIcps ? { subIcps: input.subIcps } : {}),
    requiredEvidenceForFinalQualification: {
      explicitGeo: true,
      employeeSize: false,
      personaTitle: true,
      websiteReachable: false,
      ...input.requiredEvidence,
    },
    scoringWeights:
      input.scoringWeights ?? {
        geo: 20,
        industry: 15,
        companyType: 15,
        size: 10,
        persona: 30,
        signals: 10,
      },
    scorePolicy: { minScore: 0, maxScore: 100, qualifiedMinFitScore: 75, needsReviewMinFitScore: 45 },
    confidencePolicy: { highConfidenceThreshold: 75, mediumConfidenceThreshold: 45 },
    dictionaryVersions: { ...DICTIONARY_VERSIONS },
    blocksFinalQualificationFromCompanyOnlyEvidence: input.blocksCompanyOnly ?? true,
  };
}
