import type {
  CompanyTypeClassificationResult,
  ConfidenceResult,
  DataQualityAssessment,
  EvidenceCollectionResult,
  ExplanationResult,
  FitScoreResult,
  HardGateEvaluation,
  NormalizedScoringContext,
  QualificationResult,
} from "./types";

export function explainAssessment(
  context: NormalizedScoringContext,
  dataQuality: DataQualityAssessment,
  evidence: EvidenceCollectionResult,
  hardGateEvaluation: HardGateEvaluation,
  companyTypeResult: CompanyTypeClassificationResult,
  fitScoreResult: FitScoreResult,
  confidenceResult: ConfidenceResult,
  qualificationResult: QualificationResult
): ExplanationResult {
  const sections = {
    positiveEvidence: topReasonCodes(evidence.positiveItems),
    negativeEvidence: topReasonCodes(evidence.negativeItems),
    hardGates: hardGateSummary(hardGateEvaluation),
    companyType: [
      `type=${companyTypeResult.selectedType}`,
      `reviewRequired=${companyTypeResult.reviewRequired}`,
      ...companyTypeResult.reasonCodes.slice(0, 3),
    ],
    dataQuality: [
      `quality=${dataQuality.qualityLevel}`,
      `reviewRequired=${dataQuality.reviewRequired}`,
      ...dataQuality.issues.map((issue) => issue.code).slice(0, 3),
    ],
    scoreConfidenceQualification: [
      `score=${fitScoreResult.fitScore}`,
      `confidence=${confidenceResult.confidence}`,
      `qualification=${qualificationResult.qualification}`,
      ...qualificationResult.reasonCodes.slice(0, 3),
    ],
  };

  return {
    summary: [
      `${context.company.companyName || "Company"} scored ${fitScoreResult.fitScore}`,
      `with ${confidenceResult.confidenceLevel} confidence`,
      `and ${qualificationResult.qualification} qualification.`,
    ].join(" "),
    sections,
  };
}

function topReasonCodes(
  items: EvidenceCollectionResult["items"]
): string[] {
  return Array.from(new Set(items.map((item) => item.reasonCode))).slice(0, 3);
}

function hardGateSummary(hardGateEvaluation: HardGateEvaluation): string[] {
  return [
    `triggered=${hardGateEvaluation.summary.triggeredCount}`,
    `missingData=${hardGateEvaluation.summary.missingDataCount}`,
    `strongest=${hardGateEvaluation.summary.strongestPolicyAction}`,
    ...hardGateEvaluation.summary.triggeredRuleIds.slice(0, 3),
  ];
}
