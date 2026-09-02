export type {
  CollectedEvidenceItem,
  CompanyTypeClassificationResult,
  CompanySizeRules,
  CompanyTypeRule,
  ConfidenceBreakdownComponent,
  ConfidencePolicy,
  ConfidenceResult,
  DataQualityAssessment,
  DataQualityIssue,
  DataQualityIssueSeverity,
  EvidenceCollectionResult,
  EvaluateLeadAssignmentInput,
  EvidenceDirection,
  EvidenceItem,
  EvidenceSourceType,
  ExplanationResult,
  FeedbackSignalSnapshot,
  FitScoreComponent,
  FitScoreComponentKind,
  FitScoreResult,
  GeographyRules,
  HardGateEvaluation,
  HardGateEvaluationResult,
  HardGateEvaluationSummary,
  HardGateOutcome,
  HardGatePolicyAction,
  HardGatePolicyResult,
  HardGateResult,
  HardGateRule,
  HardRuleAssessmentOutput,
  IcpVersionRules,
  MissingWebsitePolicy,
  NormalizedCompanyScoringInput,
  NormalizedContactScoringInput,
  NormalizedScoringContext,
  NormalizedStaffRange,
  NormalizedWebsiteEvidence,
  Qualification,
  QualificationReasonCode,
  QualificationResult,
  RuleOperator,
  RuleSeverity,
  ScorePolicy,
  ScoringSignalRule,
  UnknownDataPolicy,
  WebsiteEvidenceSnapshot,
} from "./types";

export { assessDataQuality } from "./dataQuality";
export { classifyCompanyType } from "./classifyCompanyType";
export { collectEvidence } from "./collectEvidence";
export { computeConfidence } from "./computeConfidence";
export { computeFitScore } from "./computeFitScore";
export { deriveQualification } from "./deriveQualification";
export { evaluateHardGates } from "./evaluateHardGates";
export { explainAssessment } from "./explainAssessment";
export { normalizeDomain, normalizeScoringInput } from "./normalizeInput";

// The coarse v1 assessor (assessCompanyAgainstIcp) was retired — production scores through the
// single graduated v2 engine (assessIcpRulesV2). The v1 schema below is kept only so legacy
// rulesJson can be lifted to v2 (upgradeV1toV2).
export {
  IcpVersionRulesSchema,
  validateIcpVersionRules,
} from "./icpRulesSchema";

export type {
  AccountPreRank as IcpAccountPreRank,
  AssessmentMode as IcpAssessmentMode,
  CompanyEvidence as IcpCompanyEvidence,
  CompanyType as IcpCompanyType,
  ConfidenceBand as IcpConfidenceBand,
  HardDisqualifierHit as IcpHardDisqualifierHit,
  IcpAssessment,
  IcpVersionRules as IcpRulesVersion,
  PersonaEvidence as IcpPersonaEvidence,
  Qualification as IcpQualification,
  RequiredEvidenceForFinalQualification as IcpRequiredEvidenceForFinalQualification,
  SignalHit as IcpSignalHit,
} from "./icpRulesSchema";
