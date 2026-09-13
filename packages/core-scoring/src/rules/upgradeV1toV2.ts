import type { IcpVersionRules as IcpVersionRulesV1 } from "../icpRulesSchema";
import { DICTIONARY_VERSIONS } from "./dictionaries/index";
import type { CompanyTypeV2, IcpVersionRulesV2 } from "./schema-v2";

// SC1: best-effort lift of a v1 ruleset into the v2 shape.
//
// This is a structural migration, not a re-authoring. v1 carried fewer dimensions,
// so the v2 dimensions it could not express (region expansion, office-location,
// priority tiers, persona allowlist/denylist/tiers, qualitative size bands,
// account-supplied lists, sub-ICPs) come out EMPTY and must be filled by an author
// in SC5. The lift preserves everything v1 actually had: target/excluded geography,
// employee size bounds, services/consulting + website disqualifiers, required
// evidence, weights, and policies. Pure function — no I/O.

const KNOWN_COMPANY_TYPES: ReadonlySet<string> = new Set<CompanyTypeV2>([
  "PRODUCT_SAAS",
  "PRODUCT_PLATFORM",
  "SERVICE_ONLY",
  "SERVICE_PLUS_PRODUCT",
  "MARKETPLACE",
  "AGENCY",
  "UNKNOWN",
]);

function v1HasServicesDisqualifier(v1: IcpVersionRulesV1): boolean {
  return v1.hardGates.some(
    (gate) =>
      gate.severity === "terminal" &&
      (gate.id.includes("services") ||
        gate.id.includes("consulting") ||
        gate.reasonCode.includes("services_consulting"))
  );
}

function v1HasOnePersonGate(v1: IcpVersionRulesV1): boolean {
  return v1.hardGates.some(
    (gate) => gate.severity === "terminal" && gate.id.includes("one_person")
  );
}

function v1AllowedCompanyTypes(v1: IcpVersionRulesV1): CompanyTypeV2[] {
  const allow = new Set<CompanyTypeV2>();

  for (const rule of v1.companyTypeRules) {
    if (KNOWN_COMPANY_TYPES.has(rule.type)) {
      allow.add(rule.type as CompanyTypeV2);
    }
  }

  return [...allow];
}

/**
 * Convert a validated v1 ruleset into a schema-v2-shaped object. The result is
 * structurally valid v2 (validate it with `validateIcpVersionRulesV2`), with empty
 * lists for the dimensions v1 never modeled.
 */
export function upgradeV1toV2(v1: IcpVersionRulesV1): IcpVersionRulesV2 {
  const websiteOfflineDisqualifies = v1.missingWebsitePolicy === "terminal";

  return {
    schemaVersion: "v2",
    ruleSetId: v1.ruleSetId,
    displayName: v1.displayName,
    geography: {
      targetCountries: [...v1.geography.targetCountries],
      excludedCountries: [...v1.geography.excludedCountries],
      targetRegions: [],
      locationScope: "hq",
      requiredOfficeCountries: [],
      excludedOfficeCountries: [],
      priorityTiers: [],
      subNationalRegions: [],
      unknownCountryPolicy: v1.geography.unknownCountryPolicy,
    },
    industry: {
      // v1 had no explicit industry block; signals approximated it.
      mode: "all",
      targetIndustries: [],
      excludedIndustries: [],
      industryKeywords: v1.positiveSignals.flatMap((signal) => signal.keywords),
      subIndustries: [],
    },
    companyType: {
      allow: v1AllowedCompanyTypes(v1),
      deny: [],
      servicesConsultingPolicy: {
        disqualify: v1HasServicesDisqualifier(v1),
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
      requirePersonaForFinalQualification:
        v1.requiredEvidenceForFinalQualification.personaTitle,
    },
    size: {
      minEmployees: v1.companySize.minEmployees,
      maxEmployees: v1.companySize.maxEmployees,
      sizeBands: [],
      excludeTooSmall:
        v1.companySize.minEmployees !== undefined &&
        v1.companySize.minEmployees > 1,
      unknownSizePolicy: v1.companySize.unknownSizePolicy,
    },
    disqualifiers: {
      genericEmailContact: { disqualify: false },
      onePersonCompany: {
        disqualify: v1HasOnePersonGate(v1),
        threshold: v1.companySize.minEmployees,
      },
      websiteOffline: { disqualify: websiteOfflineDisqualifies },
      projectBased: { disqualify: false },
      competitorDenylist: [],
    },
    accountSupplied: {
      mode: "score",
      companyList: [],
    },
    requiredEvidenceForFinalQualification: {
      explicitGeo: v1.requiredEvidenceForFinalQualification.explicitGeo,
      employeeSize: v1.requiredEvidenceForFinalQualification.employeeSize,
      personaTitle: v1.requiredEvidenceForFinalQualification.personaTitle,
      websiteReachable:
        v1.requiredEvidenceForFinalQualification.websiteReachable ?? false,
    },
    scoringWeights: {
      geo: v1.scoringWeights.geography,
      industry: v1.scoringWeights.industry,
      companyType: v1.scoringWeights.companyType,
      size: v1.scoringWeights.size,
      persona: v1.scoringWeights.persona,
      signals: v1.scoringWeights.positiveSignals,
    },
    scorePolicy: {
      minScore: v1.scorePolicy.minScore,
      maxScore: v1.scorePolicy.maxScore,
      qualifiedMinFitScore: v1.scorePolicy.qualifiedMinFitScore,
      needsReviewMinFitScore: v1.scorePolicy.needsReviewMinFitScore,
    },
    confidencePolicy: {
      highConfidenceThreshold: v1.confidencePolicy.highConfidenceThreshold,
      mediumConfidenceThreshold: v1.confidencePolicy.mediumConfidenceThreshold,
    },
    dictionaryVersions: { ...DICTIONARY_VERSIONS },
    blocksFinalQualificationFromCompanyOnlyEvidence:
      v1.blocksFinalQualificationFromCompanyOnlyEvidence,
  };
}
