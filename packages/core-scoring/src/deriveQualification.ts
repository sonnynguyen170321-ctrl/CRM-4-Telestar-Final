import type {
  ConfidenceResult,
  FitScoreResult,
  HardGateEvaluation,
  NormalizedScoringContext,
  Qualification,
  QualificationReasonCode,
  QualificationResult,
} from "./types";

export function deriveQualification(
  context: NormalizedScoringContext,
  fitScoreResult: FitScoreResult,
  confidenceResult: ConfidenceResult,
  hardGateEvaluation: HardGateEvaluation
): QualificationResult {
  const scoreBand = deriveScoreBand(context, fitScoreResult.fitScore);
  const reasonCodes: QualificationReasonCode[] = [];
  const hasTerminalHardGate = hardGateEvaluation.summary.terminalCount > 0;
  const hasHardGateCapPreventingQualified = fitScoreResult.appliedCaps.some(
    (cap) =>
      Math.abs(cap.scoreImpact) < context.icpRules.scorePolicy.qualifiedThreshold
  );
  const hasMissingWebsiteReview = hardGateEvaluation.policyResults.some(
    (policy) =>
      policy.policyId === "missing_website" &&
      policy.policyAction === "review_required"
  );
  const hasWebsiteEvidenceReviewDowngrade =
    websiteEvidenceRequiresReview(context);

  if (scoreBand === "qualified") {
    reasonCodes.push("fit_score_qualified");
  } else if (scoreBand === "unqualified") {
    reasonCodes.push("fit_score_unqualified");
  } else {
    reasonCodes.push("fit_score_uncertain");
  }

  if (hasTerminalHardGate) {
    reasonCodes.push("terminal_hard_gate");
    return {
      qualification: "unqualified",
      reasonCodes,
      scoreBand,
    };
  }

  if (hasHardGateCapPreventingQualified) {
    reasonCodes.push("hard_gate_cap_prevents_qualified");
  }

  if (hasMissingWebsiteReview) {
    reasonCodes.push("missing_website_review");
  }

  if (scoreBand === "qualified" && hasWebsiteEvidenceReviewDowngrade) {
    reasonCodes.push("website_evidence_review_downgrade");
    return {
      qualification: "uncertain",
      reasonCodes,
      uncertainReason: "data_gap",
      scoreBand,
    };
  }

  if (
    scoreBand === "qualified" &&
    confidenceResult.confidence < context.icpRules.confidencePolicy.highConfidenceThreshold
  ) {
    reasonCodes.push("low_confidence_downgrade");
    return {
      qualification: "uncertain",
      reasonCodes,
      uncertainReason: "data_gap",
      scoreBand,
    };
  }

  if (scoreBand === "qualified" && !hasHardGateCapPreventingQualified) {
    return {
      qualification: "qualified",
      reasonCodes,
      scoreBand,
    };
  }

  if (scoreBand === "unqualified") {
    return {
      qualification: "unqualified",
      reasonCodes,
      scoreBand,
    };
  }

  return {
    qualification: "uncertain",
    reasonCodes,
    uncertainReason: hasMissingWebsiteReview ? "data_gap" : "borderline_score",
    scoreBand,
  };
}

function deriveScoreBand(
  context: NormalizedScoringContext,
  fitScore: number
): Qualification {
  if (fitScore >= context.icpRules.scorePolicy.qualifiedThreshold) {
    return "qualified";
  }

  if (fitScore <= context.icpRules.scorePolicy.unqualifiedThreshold) {
    return "unqualified";
  }

  return "uncertain";
}

function websiteEvidenceRequiresReview(
  context: NormalizedScoringContext
): boolean {
  const reviewStatuses = new Set([
    "missing",
    "unknown",
    "offline",
    "blocked",
    "parked",
    "empty",
    "error",
    "timeout",
    "invalid_url",
  ]);

  return (
    reviewStatuses.has(context.websiteEvidence.status) ||
    context.websiteEvidence.quality === "weak" ||
    context.websiteEvidence.quality === "unknown"
  );
}
