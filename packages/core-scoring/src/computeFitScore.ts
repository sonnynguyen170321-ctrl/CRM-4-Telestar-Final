import type {
  CompanyTypeClassificationResult,
  EvidenceCollectionResult,
  FitScoreComponent,
  FitScoreResult,
  HardGateEvaluation,
  HardGateEvaluationResult,
  HardGatePolicyAction,
  NormalizedScoringContext,
} from "./types";

export function computeFitScore(
  context: NormalizedScoringContext,
  evidence: EvidenceCollectionResult,
  hardGateEvaluation: HardGateEvaluation,
  companyTypeResult: CompanyTypeClassificationResult
): FitScoreResult {
  const minScore = context.icpRules.scorePolicy.minScore;
  const maxScore = context.icpRules.scorePolicy.maxScore;
  const baseScore = Math.round((minScore + maxScore) / 2);
  const components: FitScoreComponent[] = [
    {
      id: "base_score",
      label: "Base fit score",
      kind: "base",
      scoreImpact: baseScore,
    },
    ...evidence.positiveItems.map((item) => ({
      id: `positive_${item.signalRuleId}_${item.source}`,
      label: item.label,
      kind: "positive_evidence" as const,
      scoreImpact: item.weight,
    })),
    ...evidence.negativeItems.map((item) => ({
      id: `negative_${item.signalRuleId}_${item.source}`,
      label: item.label,
      kind: "negative_evidence" as const,
      scoreImpact: -item.weight,
    })),
    ...hardGatePenaltyComponents(hardGateEvaluation.results),
    {
      id: `company_type_${companyTypeResult.selectedType}`,
      label: `Company type: ${companyTypeResult.selectedType}`,
      kind: "company_type",
      scoreImpact: companyTypeResult.scoreImpact,
    },
  ];
  const uncappedScore = components.reduce(
    (score, component) => score + component.scoreImpact,
    0
  );
  const appliedCaps = hardGateCapComponents(
    hardGateEvaluation.results,
    uncappedScore
  );
  const cappedScore = appliedCaps.reduce(
    (score, cap) => Math.min(score, Math.abs(cap.scoreImpact)),
    uncappedScore
  );

  return {
    fitScore: clampScore(cappedScore, minScore, maxScore),
    unclampedScore: uncappedScore,
    minScore,
    maxScore,
    components,
    appliedCaps,
  };
}

function hardGatePenaltyComponents(
  results: HardGateEvaluationResult[]
): FitScoreComponent[] {
  return results.reduce<FitScoreComponent[]>((components, result) => {
    if (!result.triggered) {
      return components;
    }

      const scoreImpact = hardGatePolicyPenalty(result.policyAction);

      if (scoreImpact === 0) {
      return components;
      }

    components.push({
        id: `hard_gate_penalty_${result.ruleId}`,
        label: result.label,
      kind: "hard_gate_penalty",
        scoreImpact,
    });

    return components;
  }, []);
}

function hardGateCapComponents(
  results: HardGateEvaluationResult[],
  scoreBeforeCaps: number
): FitScoreComponent[] {
  return results
    .filter(
      (result) =>
        result.triggered &&
        result.maxScoreIfTriggered !== undefined &&
        scoreBeforeCaps > result.maxScoreIfTriggered
    )
    .map((result) => ({
      id: `hard_gate_cap_${result.ruleId}`,
      label: `${result.label} cap`,
      kind: "hard_gate_cap" as const,
      scoreImpact: -Number(result.maxScoreIfTriggered),
    }));
}

function hardGatePolicyPenalty(action: HardGatePolicyAction): number {
  if (action === "terminal") {
    return -40;
  }

  if (action === "strong_penalty") {
    return -25;
  }

  if (action === "soft_penalty") {
    return -10;
  }

  return 0;
}

function clampScore(score: number, minScore: number, maxScore: number): number {
  return Math.max(minScore, Math.min(maxScore, Math.round(score)));
}
