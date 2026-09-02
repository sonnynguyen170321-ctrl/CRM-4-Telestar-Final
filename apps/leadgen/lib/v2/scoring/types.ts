export type Qualification = "qualified" | "unqualified" | "uncertain";

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

export type EvidenceDirection = "positive" | "negative" | "neutral";

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
};

export type GeographyRules = {
  targetCountries: string[];
  excludedCountries: string[];
  unknownCountryPolicy: UnknownDataPolicy;
  targetCountryScoreBoost?: number;
  excludedCountrySeverity: RuleSeverity;
};

export type CompanySizeRules = {
  minEmployees?: number;
  maxEmployees?: number;
  unknownSizePolicy: UnknownDataPolicy;
  minEmployeesSeverity?: RuleSeverity;
};

export type HardGateRule = {
  id: string;
  label: string;
  description?: string;
  field: string;
  operator: RuleOperator;
  value?: unknown;
  severity: RuleSeverity;
  missingDataPolicy: UnknownDataPolicy;
  maxScoreIfTriggered?: number;
  reasonCode: string;
};

export type ScoringSignalRule = {
  id: string;
  label: string;
  description?: string;
  direction: EvidenceDirection;
  weight: number;
  reliabilityPrior: number;
  evidenceSources: EvidenceSourceType[];
  keywords?: string[];
  websitePaths?: string[];
  reasonCode: string;
};

export type CompanyTypeRule = {
  id: string;
  type:
    | "product_saas"
    | "product_platform"
    | "service_only"
    | "service_plus_product"
    | "marketplace"
    | "agency"
    | "unknown";
  positiveKeywords?: string[];
  negativeKeywords?: string[];
  defaultScoreImpact: number;
  defaultConfidenceImpact: number;
  reviewRequired?: boolean;
};

export type EvidenceSourceType =
  | "csv_field"
  | "website_homepage"
  | "website_subpage"
  | "website_metadata"
  | "manual_flag"
  | "legacy_feedback"
  | "activity_recap"
  | "ai_insight";

export type ConfidencePolicy = {
  minimumEvidenceCountForHighConfidence: number;
  highConfidenceThreshold: number;
  lowConfidenceThreshold: number;
  missingCriticalFieldPenalty: number;
  conflictingEvidencePenalty: number;
};

export type ScorePolicy = {
  minScore: number;
  maxScore: number;
  qualifiedThreshold: number;
  unqualifiedThreshold: number;
  preserveV1BranchScoresUntilParity: boolean;
};

export type NormalizedCompanyScoringInput = {
  companyName: string;
  canonicalDomain?: string | null;
  website?: string | null;
  companyCountry?: string | null;
  companyIndustry?: string | null;
  companyStaffCountRange?: string | null;
  companyLinkedInUrl?: string | null;
  notes?: string | null;
  normalizedCompanyName?: string | null;
  csvSignalHash?: string | null;
};

export type NormalizedContactScoringInput = {
  contactName?: string | null;
  title?: string | null;
  contactLinkedInUrl?: string | null;
  emailDomainType?: "business" | "personal" | "generic" | "unknown";
};

export type WebsiteEvidenceSnapshot = {
  normalizedDomain?: string | null;
  finalUrl?: string | null;
  status:
    | "reachable"
    | "blocked"
    | "offline"
    | "timeout"
    | "invalid_url"
    | "error"
    | "parked"
    | "empty"
    | "unknown";
  quality?: "weak" | "medium" | "strong" | "unknown";
  evidenceHash?: string | null;
  productSignals?: string[];
  serviceSignals?: string[];
  pricingSignals?: string[];
  apiSignals?: string[];
  aiSignals?: string[];
  cloudSignals?: string[];
  dataSignals?: string[];
  securitySignals?: string[];
  researchedAt?: string | null;
};

export type FeedbackSignalSnapshot = {
  feedbackExampleId: string;
  finalQualification: Qualification;
  finalCompanyType?: string | null;
  finalCompanyScore?: number | null;
  signalCorrections?: Record<string, unknown>;
};

export type EvaluateLeadAssignmentInput = {
  leadAssignmentId: string;
  companyInput: NormalizedCompanyScoringInput;
  contactInput?: NormalizedContactScoringInput;
  websiteEvidence?: WebsiteEvidenceSnapshot | null;
  icpVersionId: string;
  icpRules: IcpVersionRules;
  previousFeedbackSignals?: FeedbackSignalSnapshot[];
};

export type NormalizedStaffRange = {
  raw?: string | null;
  minEmployees?: number;
  maxEmployees?: number;
};

export type NormalizedWebsiteEvidence = {
  normalizedDomain?: string | null;
  finalUrl?: string | null;
  status: WebsiteEvidenceSnapshot["status"] | "missing";
  quality: NonNullable<WebsiteEvidenceSnapshot["quality"]>;
  evidenceHash?: string | null;
  productSignals: string[];
  serviceSignals: string[];
  pricingSignals: string[];
  apiSignals: string[];
  aiSignals: string[];
  cloudSignals: string[];
  dataSignals: string[];
  securitySignals: string[];
  researchedAt?: string | null;
};

export type NormalizedScoringContext = {
  leadAssignmentId: string;
  icpVersionId: string;
  icpRules: IcpVersionRules;
  company: {
    companyName: string;
    normalizedCompanyName: string;
    website?: string | null;
    canonicalDomain?: string | null;
    companyCountry?: string | null;
    normalizedCompanyCountry?: string | null;
    companyIndustry?: string | null;
    normalizedCompanyIndustry?: string | null;
    companyStaffCountRange?: string | null;
    staffRange: NormalizedStaffRange;
    companyLinkedInUrl?: string | null;
    notes?: string | null;
    csvSignalHash?: string | null;
  };
  contact?: {
    contactName?: string | null;
    title?: string | null;
    contactLinkedInUrl?: string | null;
    emailDomainType: NonNullable<NormalizedContactScoringInput["emailDomainType"]>;
  };
  websiteEvidence: NormalizedWebsiteEvidence;
  previousFeedbackSignals: FeedbackSignalSnapshot[];
};

export type DataQualityIssueSeverity =
  | "critical"
  | "review_pressure"
  | "confidence_penalty";

export type DataQualityIssue = {
  code:
    | "missing_company_name"
    | "missing_website"
    | "missing_country"
    | "missing_company_size"
    | "missing_website_evidence"
    | "weak_website_evidence"
    | "website_not_reachable";
  label: string;
  severity: DataQualityIssueSeverity;
  field: string;
};

export type DataQualityAssessment = {
  qualityScore: number;
  qualityLevel: "low" | "medium" | "high";
  hasCompanyIdentity: boolean;
  hasWebsiteIdentity: boolean;
  hasGeography: boolean;
  hasCompanySize: boolean;
  hasWebsiteEvidence: boolean;
  hasProductOrServiceEvidence: boolean;
  reviewRequired: boolean;
  confidencePressure: number;
  issues: DataQualityIssue[];
};

export type HardGateOutcome = "not_triggered" | "triggered" | "missing_data";

export type HardGatePolicyAction =
  | "none"
  | "terminal"
  | "review_required"
  | "low_confidence_continue"
  | "soft_penalty"
  | "strong_penalty";

export type HardGateEvaluationResult = {
  ruleId: string;
  label: string;
  field: string;
  operator: RuleOperator;
  expectedValue?: unknown;
  actualValue?: unknown;
  outcome: HardGateOutcome;
  triggered: boolean;
  severity: RuleSeverity;
  policyAction: HardGatePolicyAction;
  reasonCode: string;
  maxScoreIfTriggered?: number;
  missingDataPolicy: UnknownDataPolicy;
};

export type HardGatePolicyResult = {
  policyId: "missing_website";
  label: string;
  outcome: "not_applicable" | "policy_applied";
  policyAction: HardGatePolicyAction;
  reasonCode: string;
};

export type HardGateEvaluationSummary = {
  triggeredCount: number;
  missingDataCount: number;
  terminalCount: number;
  reviewRequired: boolean;
  strongestPolicyAction: HardGatePolicyAction;
  triggeredRuleIds: string[];
  missingDataRuleIds: string[];
};

export type HardGateEvaluation = {
  results: HardGateEvaluationResult[];
  policyResults: HardGatePolicyResult[];
  summary: HardGateEvaluationSummary;
};

export type CollectedEvidenceItem = {
  signalRuleId: string;
  label: string;
  direction: EvidenceDirection;
  source: EvidenceSourceType;
  matchedValue: string;
  matchedKeyword?: string;
  weight: number;
  reliabilityPrior: number;
  reasonCode: string;
};

export type EvidenceCollectionResult = {
  items: CollectedEvidenceItem[];
  positiveItems: CollectedEvidenceItem[];
  negativeItems: CollectedEvidenceItem[];
  summary: {
    totalCount: number;
    positiveCount: number;
    negativeCount: number;
    sourceCount: Partial<Record<EvidenceSourceType, number>>;
  };
};

export type CompanyTypeClassificationResult = {
  selectedType: CompanyTypeRule["type"];
  selectedRuleId?: string;
  matchedRuleIds: string[];
  scoreImpact: number;
  reviewRequired: boolean;
  ambiguous: boolean;
  reasonCodes: string[];
};

export type FitScoreComponentKind =
  | "base"
  | "positive_evidence"
  | "negative_evidence"
  | "hard_gate_cap"
  | "hard_gate_penalty"
  | "company_type";

export type FitScoreComponent = {
  id: string;
  label: string;
  kind: FitScoreComponentKind;
  scoreImpact: number;
};

export type FitScoreResult = {
  fitScore: number;
  unclampedScore: number;
  minScore: number;
  maxScore: number;
  components: FitScoreComponent[];
  appliedCaps: FitScoreComponent[];
};

export type ConfidenceBreakdownComponent = {
  id: string;
  label: string;
  impact: number;
};

export type ConfidenceResult = {
  confidence: number;
  confidenceLevel: "low" | "medium" | "high";
  baseReliability: number;
  components: ConfidenceBreakdownComponent[];
  reviewRequired: boolean;
  reasonCodes: string[];
};

export type QualificationReasonCode =
  | "terminal_hard_gate"
  | "hard_gate_cap_prevents_qualified"
  | "low_confidence_downgrade"
  | "missing_website_review"
  | "website_evidence_review_downgrade"
  | "fit_score_qualified"
  | "fit_score_uncertain"
  | "fit_score_unqualified";

export type QualificationResult = {
  qualification: Qualification;
  reasonCodes: QualificationReasonCode[];
  uncertainReason?:
    | "data_gap"
    | "borderline_score"
    | "signal_conflict"
    | "stale_input"
    | "missing_project_context";
  scoreBand: "qualified" | "uncertain" | "unqualified";
};

export type ExplanationResult = {
  summary: string;
  sections: {
    positiveEvidence: string[];
    negativeEvidence: string[];
    hardGates: string[];
    companyType: string[];
    dataQuality: string[];
    scoreConfidenceQualification: string[];
  };
};

export type EvidenceItem = {
  key: string;
  label: string;
  source: EvidenceSourceType;
  reliability: number;
  direction: EvidenceDirection;
  weight: number;
  value?: string | number | boolean;
  matchedText?: string;
  url?: string;
  detectedAt: string;
  evidenceVersion: string;
};

export type HardGateResult = {
  ruleId: string;
  triggered: boolean;
  severity: RuleSeverity;
  reasonCode: string;
  maxScoreIfTriggered?: number;
  evidence: EvidenceItem[];
};

export type HardRuleAssessmentOutput = {
  fitScore: number;
  confidence: number;
  qualification: Qualification;
  companyType: string;
  reason: string;
  evidence: EvidenceItem[];
  hardGateResults: HardGateResult[];
  uncertainReason?:
    | "data_gap"
    | "borderline_score"
    | "signal_conflict"
    | "stale_input"
    | "missing_project_context";
  inputFingerprint: string;
};
