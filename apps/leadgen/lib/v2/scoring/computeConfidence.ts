import type {
  CompanyTypeClassificationResult,
  ConfidenceBreakdownComponent,
  ConfidenceResult,
  DataQualityAssessment,
  EvidenceCollectionResult,
  FitScoreResult,
  HardGateEvaluation,
  NormalizedScoringContext,
} from "./types";

export function computeConfidence(
  context: NormalizedScoringContext,
  dataQuality: DataQualityAssessment,
  evidence: EvidenceCollectionResult,
  hardGateEvaluation: HardGateEvaluation,
  companyTypeResult: CompanyTypeClassificationResult,
  fitScoreResult: FitScoreResult
): ConfidenceResult {
  const baseReliability = computeBaseReliability(evidence);
  const components: ConfidenceBreakdownComponent[] = [
    {
      id: "base_reliability",
      label: "Evidence reliability baseline",
      impact: baseReliability,
    },
    ...dataQualityPenaltyComponents(context, dataQuality),
    ...hardGatePenaltyComponents(hardGateEvaluation),
    ...companyTypePenaltyComponents(companyTypeResult),
    ...fitScoreContextComponents(context, fitScoreResult),
  ];
  const confidence = clampConfidence(
    baseReliability +
      components
        .filter((component) => component.id !== "base_reliability")
        .reduce((total, component) => total + component.impact, 0)
  );
  const confidenceLevel =
    confidence >= context.icpRules.confidencePolicy.highConfidenceThreshold
      ? "high"
      : confidence <= context.icpRules.confidencePolicy.lowConfidenceThreshold
        ? "low"
        : "medium";

  return {
    confidence,
    confidenceLevel,
    baseReliability,
    components,
    reviewRequired:
      dataQuality.reviewRequired ||
      hardGateEvaluation.summary.reviewRequired ||
      companyTypeResult.reviewRequired ||
      confidenceLevel === "low",
    reasonCodes: confidenceReasonCodes({
      dataQuality,
      evidence,
      hardGateEvaluation,
      companyTypeResult,
      confidenceLevel,
    }),
  };
}

function computeBaseReliability(evidence: EvidenceCollectionResult): number {
  if (evidence.items.length === 0) {
    return 0.35;
  }

  const totalReliability = evidence.items.reduce(
    (total, item) => total + item.reliabilityPrior,
    0
  );

  return clampConfidence(totalReliability / evidence.items.length);
}

function dataQualityPenaltyComponents(
  context: NormalizedScoringContext,
  dataQuality: DataQualityAssessment
): ConfidenceBreakdownComponent[] {
  const policy = context.icpRules.confidencePolicy;
  const missingCriticalCount = dataQuality.issues.filter(
    (issue) => issue.severity === "critical" || issue.severity === "review_pressure"
  ).length;
  const missingCriticalPenalty = Math.min(
    0.45,
    missingCriticalCount * policy.missingCriticalFieldPenalty
  );
  const qualityPenalty =
    dataQuality.qualityLevel === "low"
      ? -0.2
      : dataQuality.qualityLevel === "medium"
        ? -0.1
        : 0;

  return [
    ...(missingCriticalPenalty > 0
      ? [
          {
            id: "missing_critical_fields",
            label: "Missing critical scoring fields",
            impact: -missingCriticalPenalty,
          },
        ]
      : []),
    ...(qualityPenalty !== 0
      ? [
          {
            id: "data_quality",
            label: `${dataQuality.qualityLevel} data quality`,
            impact: qualityPenalty,
          },
        ]
      : []),
  ];
}

function hardGatePenaltyComponents(
  hardGateEvaluation: HardGateEvaluation
): ConfidenceBreakdownComponent[] {
  const components: ConfidenceBreakdownComponent[] = [];

  if (hardGateEvaluation.summary.terminalCount > 0) {
    components.push({
      id: "terminal_hard_gate",
      label: "Terminal hard gate triggered",
      impact: 0.1,
    });
  }

  if (hardGateEvaluation.summary.missingDataCount > 0) {
    const reviewPressureMissingDataCount = hardGateEvaluation.results.filter(
      (result) =>
        result.outcome === "missing_data" &&
        (result.policyAction === "review_required" ||
          result.policyAction === "soft_penalty" ||
          result.policyAction === "strong_penalty" ||
          result.policyAction === "terminal")
    ).length;

    if (reviewPressureMissingDataCount > 0) {
    components.push({
      id: "hard_gate_missing_data",
      label: "Hard gate input data is missing",
      impact: -0.15,
    });
    }
  }

  if (hardGateEvaluation.summary.reviewRequired) {
    components.push({
      id: "hard_gate_review_pressure",
      label: "Hard gate result requires review",
      impact: -0.1,
    });
  }

  return components;
}

function companyTypePenaltyComponents(
  companyTypeResult: CompanyTypeClassificationResult
): ConfidenceBreakdownComponent[] {
  return [
    ...(companyTypeResult.ambiguous
      ? [
          {
            id: "ambiguous_company_type",
            label: "Company type is ambiguous",
            impact: -0.05,
          },
        ]
      : []),
    ...(companyTypeResult.reviewRequired && !companyTypeResult.ambiguous
      ? [
          {
            id: "company_type_review",
            label: "Company type requires review",
            impact: -0.1,
          },
        ]
      : []),
  ];
}

function fitScoreContextComponents(
  context: NormalizedScoringContext,
  fitScoreResult: FitScoreResult
): ConfidenceBreakdownComponent[] {
  const hasBorderlineScore =
    fitScoreResult.fitScore >= context.icpRules.scorePolicy.unqualifiedThreshold &&
    fitScoreResult.fitScore < context.icpRules.scorePolicy.qualifiedThreshold;

  return hasBorderlineScore
    ? [
        {
          id: "borderline_fit_score",
          label: "Fit score is in the uncertain band",
          impact: -0.05,
        },
      ]
    : [];
}

function confidenceReasonCodes({
  dataQuality,
  evidence,
  hardGateEvaluation,
  companyTypeResult,
  confidenceLevel,
}: {
  dataQuality: DataQualityAssessment;
  evidence: EvidenceCollectionResult;
  hardGateEvaluation: HardGateEvaluation;
  companyTypeResult: CompanyTypeClassificationResult;
  confidenceLevel: ConfidenceResult["confidenceLevel"];
}): string[] {
  return [
    ...(evidence.items.length === 0 ? ["no_evidence"] : []),
    ...(evidence.items.length > 0 ? ["evidence_reliability_available"] : []),
    ...(dataQuality.reviewRequired ? ["data_quality_review_required"] : []),
    ...(hardGateEvaluation.summary.reviewRequired
      ? ["hard_gate_review_required"]
      : []),
    ...(companyTypeResult.reviewRequired ? ["company_type_review_required"] : []),
    ...(confidenceLevel === "low" ? ["low_confidence"] : []),
  ];
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}
