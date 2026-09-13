import { z } from "zod";

export type Qualification = "QUALIFIED" | "NEEDS_REVIEW" | "UNQUALIFIED";

export type ConfidenceBand = "HIGH" | "MEDIUM" | "LOW";

export type AssessmentMode =
  | "COMPANY_PRE_RANK"
  | "FULL_ICP_QUALIFICATION";

export type AccountPreRank =
  | "STRONG_ACCOUNT_FIT"
  | "POSSIBLE_ACCOUNT_FIT"
  | "WEAK_FIT"
  | "CLEAR_MISMATCH";

export type CompanyType =
  | "PRODUCT_SAAS"
  | "PRODUCT_PLATFORM"
  | "SERVICE_ONLY"
  | "SERVICE_PLUS_PRODUCT"
  | "MARKETPLACE"
  | "AGENCY"
  | "UNKNOWN";

export type MissingWebsitePolicy =
  | "terminal"
  | "review_required"
  | "low_confidence_continue";

export type UnknownDataPolicy =
  | "review_required"
  | "low_confidence_continue"
  | "soft_penalty"
  | "fail";

export type RuleSeverity =
  | "terminal"
  | "strong_penalty"
  | "soft_penalty"
  | "review_only";

export type RuleOperator =
  | "equals"
  | "not_equals"
  | "in"
  | "not_in"
  | "contains"
  | "not_contains"
  | "exists"
  | "missing"
  | "lt"
  | "lte"
  | "gt"
  | "gte";

export type EvidenceSourceType =
  | "csv_field"
  | "website_homepage"
  | "website_subpage"
  | "website_metadata"
  | "manual_flag"
  | "pipeline_context";

export type RequiredEvidenceForFinalQualification = {
  explicitGeo: boolean;
  employeeSize: boolean;
  personaTitle: boolean;
  websiteReachable?: boolean;
};

export type ScorePolicy = {
  minScore: number;
  maxScore: number;
  qualifiedMinFitScore: number;
  needsReviewMinFitScore: number;
};

export type ConfidencePolicy = {
  highConfidenceThreshold: number;
  mediumConfidenceThreshold: number;
};

export type ScoringWeights = {
  geography: number;
  companyType: number;
  industry: number;
  size: number;
  persona: number;
  positiveSignals: number;
  negativeSignals: number;
};

export type GeographyRules = {
  targetCountries: string[];
  excludedCountries: string[];
  unknownCountryPolicy: UnknownDataPolicy;
};

export type CompanySizeRules = {
  minEmployees?: number;
  maxEmployees?: number;
  unknownSizePolicy: UnknownDataPolicy;
};

export type HardGateRule = {
  id: string;
  label: string;
  field: string;
  operator: RuleOperator;
  value?: unknown;
  severity: RuleSeverity;
  confidence: ConfidenceBand;
  evidenceSource: string;
  reasonCode: string;
};

export type ScoringSignalRule = {
  id: string;
  label: string;
  keywords: string[];
  evidenceSources: EvidenceSourceType[];
  reasonCode: string;
};

export type CompanyTypeRule = {
  id: string;
  type: CompanyType;
  positiveKeywords: string[];
  negativeKeywords?: string[];
};

export type IcpVersionRules = {
  schemaVersion: "v1";
  ruleSetId: string;
  displayName: string;
  missingWebsitePolicy: MissingWebsitePolicy;
  geography: GeographyRules;
  companySize: CompanySizeRules;
  hardGates: HardGateRule[];
  positiveSignals: ScoringSignalRule[];
  negativeSignals: ScoringSignalRule[];
  companyTypeRules: CompanyTypeRule[];
  confidencePolicy: ConfidencePolicy;
  scorePolicy: ScorePolicy;
  scoringWeights: ScoringWeights;
  requiredEvidenceForFinalQualification: RequiredEvidenceForFinalQualification;
  blocksFinalQualificationFromCompanyOnlyEvidence: boolean;
};

export type PersonaEvidence = {
  title?: string;
  rawTitle?: string;
  department?: string;
  seniority?: string;
  seniorityTier?: "C_LEVEL" | "VP_LEVEL" | "DIRECTOR" | "MANAGER" | "IC" | "UNKNOWN";
  titleKeywords?: string[];
  contactLocation?: string;
};

export type CompanyEvidence = {
  companyName: string;
  website?: string;
  canonicalDomain?: string;
  description?: string;
  industry?: string;
  industryTags?: string[];
  /** Axis-1 category id from company intelligence (`category.<id>`), when one was assigned. */
  industryCategory?: string;
  country?: string;
  officeCountries?: string[];
  pipelineInferredCountry?: string;
  employeeRange?: string;
  employeeCount?: number;
  revenueUsd?: number;
  companyType?: CompanyType;
  productSignals?: string[];
  serviceSignals?: string[];
  pricingSignals?: string[];
  platformSignals?: string[];
  notes?: string;
  evidenceText?: string;
  isProjectBased?: boolean;
  locationCount?: number;
  websiteStatus?: "reachable" | "missing" | "offline" | "unknown";
  personaEvidence?: PersonaEvidence;
};

export type HardDisqualifierHit = {
  id: string;
  label: string;
  confidence: ConfidenceBand;
  evidenceSource: string;
};

export type SignalHit = {
  id: string;
  label: string;
  evidenceSource: string;
};

export type IcpAssessment = {
  assessmentMode: AssessmentMode;
  accountPreRank: AccountPreRank;
  qualification: Qualification;
  fitScore: number;
  confidenceScore: number;
  confidence: ConfidenceBand;
  companyType: CompanyType;
  industryTags: string[];
  hardDisqualifiersHit: HardDisqualifierHit[];
  positiveSignalsHit: SignalHit[];
  negativeSignalsHit: SignalHit[];
  reasonCodes: string[];
  reviewFlags: string[];
  missingEvidence: string[];
  shortReason: string;
  evidenceSummary: string[];
  inputSnapshot: CompanyEvidence;
  rulesSnapshot: IcpVersionRules;
};

const ConfidenceBandSchema = z.enum(["HIGH", "MEDIUM", "LOW"]);
const MissingWebsitePolicySchema = z.enum([
  "terminal",
  "review_required",
  "low_confidence_continue",
]);
const UnknownDataPolicySchema = z.enum([
  "review_required",
  "low_confidence_continue",
  "soft_penalty",
  "fail",
]);
const RuleSeveritySchema = z.enum([
  "terminal",
  "strong_penalty",
  "soft_penalty",
  "review_only",
]);
const RuleOperatorSchema = z.enum([
  "equals",
  "not_equals",
  "in",
  "not_in",
  "contains",
  "not_contains",
  "exists",
  "missing",
  "lt",
  "lte",
  "gt",
  "gte",
]);
const EvidenceSourceTypeSchema = z.enum([
  "csv_field",
  "website_homepage",
  "website_subpage",
  "website_metadata",
  "manual_flag",
  "pipeline_context",
]);
const CompanyTypeSchema = z.enum([
  "PRODUCT_SAAS",
  "PRODUCT_PLATFORM",
  "SERVICE_ONLY",
  "SERVICE_PLUS_PRODUCT",
  "MARKETPLACE",
  "AGENCY",
  "UNKNOWN",
]);

const RequiredEvidenceForFinalQualificationSchema = z.object({
  explicitGeo: z.boolean(),
  employeeSize: z.boolean(),
  personaTitle: z.boolean(),
  websiteReachable: z.boolean().optional(),
}).strict();

const ScorePolicySchema = z.object({
  minScore: z.number().int().min(0).max(100),
  maxScore: z.number().int().min(0).max(100),
  qualifiedMinFitScore: z.number().int().min(0).max(100),
  needsReviewMinFitScore: z.number().int().min(0).max(100),
}).strict().superRefine((policy, context) => {
  if (policy.maxScore <= policy.minScore) {
    context.addIssue({
      code: "custom",
      message: "scorePolicy.maxScore must be greater than minScore",
      path: ["maxScore"],
    });
  }

  if (policy.qualifiedMinFitScore <= policy.needsReviewMinFitScore) {
    context.addIssue({
      code: "custom",
      message:
        "scorePolicy.qualifiedMinFitScore must be greater than needsReviewMinFitScore",
      path: ["qualifiedMinFitScore"],
    });
  }
});

const ConfidencePolicySchema = z.object({
  highConfidenceThreshold: z.literal(75),
  mediumConfidenceThreshold: z.literal(45),
}).strict();

const ScoringWeightsSchema = z.object({
  geography: z.number().int().min(0).max(100),
  companyType: z.number().int().min(0).max(100),
  industry: z.number().int().min(0).max(100),
  size: z.number().int().min(0).max(100),
  persona: z.number().int().min(0).max(100),
  positiveSignals: z.number().int().min(0).max(100),
  negativeSignals: z.number().int().min(0).max(30),
}).strict().superRefine((weights, context) => {
  const positiveTotal =
    weights.geography +
    weights.companyType +
    weights.industry +
    weights.size +
    weights.persona +
    weights.positiveSignals;

  if (positiveTotal !== 100) {
    context.addIssue({
      code: "custom",
      message: "positive scoring weights must sum to 100",
    });
  }
});

const GeographyRulesSchema = z.object({
  targetCountries: z.array(z.string().min(1)),
  excludedCountries: z.array(z.string().min(1)),
  unknownCountryPolicy: UnknownDataPolicySchema,
}).strict();

const CompanySizeRulesSchema = z.object({
  minEmployees: z.number().int().min(0).optional(),
  maxEmployees: z.number().int().min(0).optional(),
  unknownSizePolicy: UnknownDataPolicySchema,
}).strict();

const HardGateRuleSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  field: z.string().min(1),
  operator: RuleOperatorSchema,
  value: z.unknown().optional(),
  severity: RuleSeveritySchema,
  confidence: ConfidenceBandSchema,
  evidenceSource: z.string().min(1),
  reasonCode: z.string().min(1),
}).strict();

const ScoringSignalRuleSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  keywords: z.array(z.string().min(1)),
  evidenceSources: z.array(EvidenceSourceTypeSchema),
  reasonCode: z.string().min(1),
}).strict();

const CompanyTypeRuleSchema = z.object({
  id: z.string().min(1),
  type: CompanyTypeSchema,
  positiveKeywords: z.array(z.string().min(1)),
  negativeKeywords: z.array(z.string().min(1)).optional(),
}).strict();

export const IcpVersionRulesSchema = z.object({
  schemaVersion: z.literal("v1"),
  ruleSetId: z.string().min(1),
  displayName: z.string().min(1),
  missingWebsitePolicy: MissingWebsitePolicySchema,
  geography: GeographyRulesSchema,
  companySize: CompanySizeRulesSchema,
  hardGates: z.array(HardGateRuleSchema),
  positiveSignals: z.array(ScoringSignalRuleSchema),
  negativeSignals: z.array(ScoringSignalRuleSchema),
  companyTypeRules: z.array(CompanyTypeRuleSchema),
  confidencePolicy: ConfidencePolicySchema,
  scorePolicy: ScorePolicySchema,
  scoringWeights: ScoringWeightsSchema,
  requiredEvidenceForFinalQualification:
    RequiredEvidenceForFinalQualificationSchema,
  blocksFinalQualificationFromCompanyOnlyEvidence: z.boolean(),
}).strict().superRefine((rules, context) => {
  const serializedRules = JSON.stringify(rules).toLowerCase();

  if (serializedRules.includes("\"uncertain\"")) {
    context.addIssue({
      code: "custom",
      message: "uncertain is not a canonical ICP1R qualification value",
    });
  }
});

export function validateIcpVersionRules(input: unknown): IcpVersionRules {
  return IcpVersionRulesSchema.parse(input);
}
