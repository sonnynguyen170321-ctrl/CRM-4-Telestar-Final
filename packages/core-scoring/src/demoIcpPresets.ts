import { IcpVersionRules } from "./icpRulesSchema";
import {
  validateIcpVersionRulesV2,
  type IcpVersionRulesV2,
} from "./rules/schema-v2";
import { upgradeV1toV2 } from "./rules/upgradeV1toV2";
import { TELESTAR_SAAS_OUTBOUND_ICP_RULES } from "./__fixtures__/sampleIcpRules";

type DemoIcpPresetBase = {
  id: string;
  displayName: string;
  ruleSetId: string;
  description: string;
  expectedBehaviorNotes: {
    qualifiedExamples: string[];
    needsReviewExamples: string[];
    unqualifiedExamples: string[];
    missingEvidenceBehavior: string[];
  };
};

// Internal authoring source: presets are still written against the well-tested v1
// rule shape, then upgraded to schema-v2 at the export boundary (below).
type DemoIcpPresetSource = DemoIcpPresetBase & { rulesJson: IcpVersionRules };

// Exported preset: rulesJson is ALWAYS schema-v2 so "Create from preset" persists
// a v2 ICP and its leads score through the rules-v2 engine + rules-v2 drawer.
// v1 remains only for read-compat of pre-existing assessments.
export type DemoIcpPreset = DemoIcpPresetBase & { rulesJson: IcpVersionRulesV2 };

const baseRules: IcpVersionRules = {
  schemaVersion: "v1",
  ruleSetId: "base",
  displayName: "Base",
  missingWebsitePolicy: "review_required",
  geography: {
    targetCountries: ["Singapore", "Australia", "Vietnam"],
    excludedCountries: ["Russia", "North Korea"],
    unknownCountryPolicy: "review_required",
  },
  companySize: {
    minEmployees: 10,
    maxEmployees: 1000,
    unknownSizePolicy: "soft_penalty",
  },
  hardGates: [],
  positiveSignals: [],
  negativeSignals: [],
  companyTypeRules: [],
  confidencePolicy: {
    highConfidenceThreshold: 75,
    mediumConfidenceThreshold: 45,
  },
  scorePolicy: {
    minScore: 0,
    maxScore: 100,
    qualifiedMinFitScore: 80,
    needsReviewMinFitScore: 40,
  },
  scoringWeights: {
    geography: 20,
    companyType: 20,
    industry: 20,
    size: 15,
    persona: 15,
    positiveSignals: 10,
    negativeSignals: 10,
  },
  requiredEvidenceForFinalQualification: {
    explicitGeo: false,
    employeeSize: false,
    personaTitle: false,
  },
  blocksFinalQualificationFromCompanyOnlyEvidence: false,
};

const presets: DemoIcpPresetSource[] = [
  {
    id: "telestar-saas-outbound",
    displayName: "TeleStar SaaS / Software Outbound",
    ruleSetId: TELESTAR_SAAS_OUTBOUND_ICP_RULES.ruleSetId,
    description:
      "TeleStar ICP for software/SaaS/product companies in approved geographies. Excludes service, consulting, one-person, offline-site, and excluded-office geographies.",
    expectedBehaviorNotes: {
      qualifiedExamples: [
        "A US, UK, Singapore, Australia, Canada, Israel, Nordics, Norway, or Switzerland SaaS/product company with 3+ employees and a target sales/growth/executive persona.",
      ],
      needsReviewExamples: [
        "A likely software company with missing persona/title or missing required evidence.",
      ],
      unqualifiedExamples: [
        "One-person company, Gmail/personal-email prospect when available, offline website, excluded geography, or services/consulting/agency-based company.",
      ],
      missingEvidenceBehavior: [
        "Blocks final qualification without explicit geo, employee size, reachable website, and target persona/title evidence.",
      ],
    },
    rulesJson: TELESTAR_SAAS_OUTBOUND_ICP_RULES,
  },
  {
    id: "b2b-saas-apac-strict-persona",
    displayName: "B2B SaaS APAC (Strict Persona)",
    ruleSetId: "b2b-saas-apac-strict-persona",
    description: "Strict persona requirements. Blocks final qualification without persona/title/contact evidence.",
    expectedBehaviorNotes: {
      qualifiedExamples: ["A B2B SaaS company in Singapore with an explicitly matched Engineering Manager."],
      needsReviewExamples: ["A B2B SaaS company with unknown contact titles."],
      unqualifiedExamples: ["A B2B SaaS company with no persona evidence."],
      missingEvidenceBehavior: ["Blocks final qualification if personaTitle is missing."],
    },
    rulesJson: {
      ...baseRules,
      ruleSetId: "b2b-saas-apac-strict-persona",
      displayName: "B2B SaaS APAC (Strict Persona)",
      requiredEvidenceForFinalQualification: {
        explicitGeo: true,
        employeeSize: true,
        personaTitle: true,
      },
      blocksFinalQualificationFromCompanyOnlyEvidence: true,
    },
  },
  {
    id: "cybersecurity-banking",
    displayName: "Cybersecurity & Banking",
    ruleSetId: "cybersecurity-banking",
    description: "Targets cybersecurity and banking/financial institution evidence.",
    expectedBehaviorNotes: {
      qualifiedExamples: ["A Bank in Australia needing security software."],
      needsReviewExamples: ["A Fintech startup with unknown size."],
      unqualifiedExamples: ["A manufacturing company."],
      missingEvidenceBehavior: ["Requires explicit industry mapping."],
    },
    rulesJson: {
      ...baseRules,
      ruleSetId: "cybersecurity-banking",
      displayName: "Cybersecurity & Banking",
      positiveSignals: [
        {
          id: "cyber-bank-signal",
          label: "Cybersecurity or Banking Keywords",
          keywords: ["bank", "finance", "security", "cyber"],
          evidenceSources: ["website_homepage"],
          reasonCode: "matched_cyber_bank",
        }
      ],
    },
  },
  {
    id: "cloud-infrastructure-singapore",
    displayName: "Cloud Infrastructure (Singapore)",
    ruleSetId: "cloud-infrastructure-singapore",
    description: "Targets cloud infrastructure providers in Singapore.",
    expectedBehaviorNotes: {
      qualifiedExamples: ["A cloud hosting provider in Singapore."],
      needsReviewExamples: ["A generic IT services company in Singapore."],
      unqualifiedExamples: ["A cloud company in Vietnam (wrong country)."],
      missingEvidenceBehavior: ["Terminal disqualification if not Singapore."],
    },
    rulesJson: {
      ...baseRules,
      ruleSetId: "cloud-infrastructure-singapore",
      displayName: "Cloud Infrastructure (Singapore)",
      geography: {
        targetCountries: ["Singapore"],
        excludedCountries: [],
        unknownCountryPolicy: "fail",
      },
      positiveSignals: [
        {
          id: "cloud-infra-signal",
          label: "Cloud Infrastructure Keywords",
          keywords: ["cloud", "infrastructure", "aws", "gcp", "hosting"],
          evidenceSources: ["website_homepage"],
          reasonCode: "matched_cloud_infra",
        }
      ],
    },
  },
  {
    id: "erp-manufacturing-vietnam",
    displayName: "ERP & Manufacturing (Vietnam)",
    ruleSetId: "erp-manufacturing-vietnam",
    description: "Targets ERP, manufacturing, and factory operators in Vietnam.",
    expectedBehaviorNotes: {
      qualifiedExamples: ["A garment factory in Vietnam looking for ERP."],
      needsReviewExamples: ["A logistics company in Vietnam."],
      unqualifiedExamples: ["A software dev agency in Vietnam."],
      missingEvidenceBehavior: ["Fails if not in Vietnam."],
    },
    rulesJson: {
      ...baseRules,
      ruleSetId: "erp-manufacturing-vietnam",
      displayName: "ERP & Manufacturing (Vietnam)",
      geography: {
        targetCountries: ["Vietnam"],
        excludedCountries: [],
        unknownCountryPolicy: "fail",
      },
      positiveSignals: [
        {
          id: "erp-mfg-signal",
          label: "ERP/Manufacturing Keywords",
          keywords: ["erp", "manufacturing", "factory", "production"],
          evidenceSources: ["website_homepage"],
          reasonCode: "matched_erp_mfg",
        }
      ],
    },
  },
  {
    id: "negative-control-bad-fit",
    displayName: "Negative Control (Bad Fit)",
    ruleSetId: "negative-control-bad-fit",
    description: "Intentionally disqualifies common SaaS/cyber/cloud examples.",
    expectedBehaviorNotes: {
      qualifiedExamples: ["A local restaurant."],
      needsReviewExamples: ["A generic small business."],
      unqualifiedExamples: ["Any SaaS, cloud, or cybersecurity company."],
      missingEvidenceBehavior: ["Strict disqualification on any tech keywords."],
    },
    rulesJson: {
      ...baseRules,
      ruleSetId: "negative-control-bad-fit",
      displayName: "Negative Control (Bad Fit)",
      negativeSignals: [
        {
          id: "anti-tech-signal",
          label: "Anti-Tech Keywords",
          keywords: ["saas", "cloud", "cyber", "software", "platform", "app"],
          evidenceSources: ["website_homepage"],
          reasonCode: "matched_anti_tech",
        }
      ],
      hardGates: [
        {
          id: "hg-tech-block",
          label: "Block Tech Companies",
          field: "companyType",
          operator: "in",
          value: ["PRODUCT_SAAS", "PRODUCT_PLATFORM"],
          severity: "terminal",
          confidence: "HIGH",
          evidenceSource: "classifier",
          reasonCode: "tech_company_blocked",
        }
      ]
    },
  },
];

// Default to schema-v2 everywhere: upgrade each v1 authoring source to v2 and
// validate at load time so "Create from preset" persists v2 ICPs (rules-v2 engine
// + rules-v2 drawer). v1 is kept only as read-compat for pre-existing assessments.
export const DEMO_ICP_PRESETS: DemoIcpPreset[] = presets.map((preset) => ({
  ...preset,
  rulesJson: validateIcpVersionRulesV2(upgradeV1toV2(preset.rulesJson)),
}));
