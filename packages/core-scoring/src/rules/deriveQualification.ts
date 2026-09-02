import type {
  DimensionKey,
  GateHit,
  NormalizedScoringEvidence,
  RawScoringEvidence,
} from "./evidence";
import { evaluateTerminalGates } from "./gates/terminalGates";
import { scoreDimensions, type DimensionScoringResult } from "./dimensions/index";
import { normalizeEvidence } from "./normalize/index";
import type { IcpVersionRulesV2, ScoringWeightsV2 } from "./schema-v2";

// SC3: pure qualification derivation over SC2 gates + dimension subScores.
// No DB, no provider calls, no production persistence wiring.

export type QualificationV2 =
  | "QUALIFIED"
  | "COMPANY_QUALIFIED_NEEDS_CONTACT"
  | "NEEDS_REVIEW"
  | "UNQUALIFIED";

export type ConfidenceBandV2 = "HIGH" | "MEDIUM" | "LOW";

export type AccountPreRankV2 =
  | "STRONG_ACCOUNT_FIT"
  | "POSSIBLE_ACCOUNT_FIT"
  | "WEAK_FIT"
  | "CLEAR_MISMATCH";

export type QualificationReasonCodeV2 =
  | "terminal_gate"
  | "fit_score_qualified"
  | "fit_score_needs_review"
  | "fit_score_unqualified"
  | "required_evidence_missing"
  | "company_fit_needs_contact"
  | "low_confidence_downgrade";

export type IcpRulesV2Assessment = {
  qualification: QualificationV2;
  fitScore: number;
  confidenceScore: number;
  confidenceBand: ConfidenceBandV2;
  accountPreRank: AccountPreRankV2;
  accountFitScore: number;
  subScores: Record<DimensionKey, number>;
  gates: {
    disqualified: boolean;
    hits: GateHit[];
  };
  dimensionResults: DimensionScoringResult["results"];
  missingEvidence: string[];
  requiredEvidenceMissing: string[];
  reasonCodes: QualificationReasonCodeV2[];
};

export function assessIcpRulesV2(
  rawEvidence: RawScoringEvidence,
  rules: IcpVersionRulesV2
): IcpRulesV2Assessment {
  return assessNormalizedIcpRulesV2(normalizeEvidence(rawEvidence), rules);
}

export function assessNormalizedIcpRulesV2(
  evidence: NormalizedScoringEvidence,
  rules: IcpVersionRulesV2
): IcpRulesV2Assessment {
  let gates = evaluateTerminalGates(evidence, rules);
  
  const badFit = rules.badFitExamples || [];
  const goodFit = rules.goodFitExamples || [];
  const domain = evidence.company.domain?.toLowerCase();
  const name = evidence.company.companyName?.toLowerCase();

  let matchedBadFit = false;
  let matchedGoodFit = false;

  if (domain || name) {
    if (badFit.some(x => {
      const match = x.toLowerCase().trim();
      return (domain && domain.includes(match)) || (name && name.includes(match));
    })) {
      matchedBadFit = true;
    }
    if (goodFit.some(x => {
      const match = x.toLowerCase().trim();
      return (domain && domain.includes(match)) || (name && name.includes(match));
    })) {
      matchedGoodFit = true;
    }
  }

  if (matchedBadFit) {
    gates = {
      disqualified: true,
      hits: [...gates.hits, { id: "bad_fit_example", label: "Matched Bad Fit Example", reasonCode: "bad_fit_example_match", evidence: name || domain || "" }]
    };
  }

  const dimensions = scoreDimensions(evidence, rules);
  const subScores = dimensions.subScores;
  const missingEvidence = unique(dimensions.missingEvidence);
  const requiredEvidenceMissing = collectRequiredEvidenceMissing(
    evidence,
    rules,
    missingEvidence
  );
  let fitScore = weightedScore(subScores, rules.scoringWeights);
  if (matchedGoodFit && !gates.disqualified) {
    fitScore = 100;
  }
  const accountFitScore = weightedScore(
    subScores,
    companyOnlyWeights(rules.scoringWeights)
  );
  const accountPreRank = gates.disqualified
    ? "CLEAR_MISMATCH"
    : deriveAccountPreRank(accountFitScore, rules);
  const confidenceScore = deriveConfidenceScore({
    gatesHit: gates.hits.length,
    missingEvidenceCount: missingEvidence.length,
    requiredEvidenceMissingCount: requiredEvidenceMissing.length,
  });
  const confidenceBand = deriveConfidenceBand(confidenceScore, rules);
  const reasonCodes: QualificationReasonCodeV2[] = [];
  let qualification: QualificationV2;

  if (gates.disqualified) {
    reasonCodes.push("terminal_gate", "fit_score_unqualified");
    qualification = "UNQUALIFIED";
  } else if (
    fitScore >= rules.scorePolicy.qualifiedMinFitScore &&
    confidenceScore >= rules.confidencePolicy.highConfidenceThreshold &&
    requiredEvidenceMissing.length === 0
  ) {
    reasonCodes.push("fit_score_qualified");
    qualification = "QUALIFIED";
  } else if (
    accountPreRank === "STRONG_ACCOUNT_FIT" &&
    needsContactEvidence(evidence, rules, requiredEvidenceMissing)
  ) {
    reasonCodes.push("company_fit_needs_contact", "required_evidence_missing");
    qualification = "COMPANY_QUALIFIED_NEEDS_CONTACT";
  } else if (
    fitScore >= rules.scorePolicy.needsReviewMinFitScore ||
    accountPreRank === "STRONG_ACCOUNT_FIT" ||
    accountPreRank === "POSSIBLE_ACCOUNT_FIT"
  ) {
    reasonCodes.push(
      fitScore >= rules.scorePolicy.qualifiedMinFitScore
        ? "low_confidence_downgrade"
        : "fit_score_needs_review"
    );
    if (requiredEvidenceMissing.length > 0) {
      reasonCodes.push("required_evidence_missing");
    }
    qualification = "NEEDS_REVIEW";
  } else {
    reasonCodes.push("fit_score_unqualified");
    qualification = "UNQUALIFIED";
  }

  return {
    qualification,
    fitScore,
    confidenceScore,
    confidenceBand,
    accountPreRank,
    accountFitScore,
    subScores,
    gates,
    dimensionResults: dimensions.results,
    missingEvidence,
    requiredEvidenceMissing,
    reasonCodes: unique(reasonCodes),
  };
}

function weightedScore(
  subScores: Record<DimensionKey, number>,
  weights: ScoringWeightsV2
): number {
  const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  if (totalWeight === 0) {
    return 0;
  }

  const weighted =
    subScores.geo * weights.geo +
    subScores.industry * weights.industry +
    subScores.companyType * weights.companyType +
    subScores.size * weights.size +
    subScores.persona * weights.persona +
    subScores.signals * weights.signals;

  return clampScore(Math.round(weighted / totalWeight));
}

function companyOnlyWeights(weights: ScoringWeightsV2): ScoringWeightsV2 {
  return {
    ...weights,
    persona: 0,
  };
}

function deriveAccountPreRank(
  accountFitScore: number,
  rules: IcpVersionRulesV2
): AccountPreRankV2 {
  if (accountFitScore >= rules.scorePolicy.qualifiedMinFitScore) {
    return "STRONG_ACCOUNT_FIT";
  }
  if (accountFitScore >= rules.scorePolicy.needsReviewMinFitScore) {
    return "POSSIBLE_ACCOUNT_FIT";
  }
  if (accountFitScore > 0) {
    return "WEAK_FIT";
  }
  return "CLEAR_MISMATCH";
}

function deriveConfidenceScore(params: {
  gatesHit: number;
  missingEvidenceCount: number;
  requiredEvidenceMissingCount: number;
}): number {
  return clampScore(
    100 -
      params.gatesHit * 20 -
      params.missingEvidenceCount * 10 -
      params.requiredEvidenceMissingCount * 15
  );
}

function deriveConfidenceBand(
  confidenceScore: number,
  rules: IcpVersionRulesV2
): ConfidenceBandV2 {
  if (confidenceScore >= rules.confidencePolicy.highConfidenceThreshold) {
    return "HIGH";
  }
  if (confidenceScore >= rules.confidencePolicy.mediumConfidenceThreshold) {
    return "MEDIUM";
  }
  return "LOW";
}

function collectRequiredEvidenceMissing(
  evidence: NormalizedScoringEvidence,
  rules: IcpVersionRulesV2,
  missingEvidence: readonly string[]
): string[] {
  const required = rules.requiredEvidenceForFinalQualification;
  const missing = new Set<string>();

  if (required.explicitGeo && !evidence.company.countryKnown) {
    missing.add("required_geo_missing");
  }
  if (required.employeeSize && !evidence.company.sizeKnown) {
    missing.add("required_employee_size_missing");
  }
  if (required.personaTitle && !evidence.contact?.titlePresent) {
    missing.add("required_persona_title_missing");
  }
  if (required.websiteReachable && evidence.company.websiteStatus !== "reachable") {
    missing.add("required_website_reachable_missing");
  }
  if (missingEvidence.includes("target_persona_missing_required")) {
    missing.add("required_persona_title_missing");
  }

  return [...missing];
}

function needsContactEvidence(
  evidence: NormalizedScoringEvidence,
  rules: IcpVersionRulesV2,
  requiredEvidenceMissing: readonly string[]
): boolean {
  // A strong company fit becomes COMPANY_QUALIFIED_NEEDS_CONTACT only when the ICP's *required* persona
  // evidence is actually missing — the gated `required_persona_title_missing` signal (set only when the
  // ICP requires a persona title and it's absent), or when the ICP requires a persona for final
  // qualification and there is NO contact at all. A contact that merely lacks a title does NOT trigger
  // needs-contact unless that ICP requires the title. (Previously an ungated `!titlePresent` here marked
  // any titleless-but-present contact as "needs contact" — the reported bug: leads that HAVE a contact.)
  if (requiredEvidenceMissing.includes("required_persona_title_missing")) {
    return true;
  }

  return (
    rules.blocksFinalQualificationFromCompanyOnlyEvidence &&
    rules.persona.requirePersonaForFinalQualification &&
    !evidence.contact
  );
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
