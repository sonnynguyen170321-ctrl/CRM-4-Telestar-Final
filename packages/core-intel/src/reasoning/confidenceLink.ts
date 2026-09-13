import type { CompanyIntelligenceReasoning, Confidence } from "./contract";

// CINT1: the logical link between intelligence accuracy and scoring confidence.
// "Accurate intel => accurate + confident scoring": strong, well-sourced reasoning
// raises the assessment's confidence; thin / 404 / no-evidence intel lowers it even
// when fit keywords match. This module produces a normalized INPUT signal only —
// CINT4 feeds it into the EXISTING confidence computation. It does NOT change
// scoring weights, thresholds, qualification, or workflow status.

export type IntelConfidenceSignal = {
  // 0..1 normalized evidence confidence for the confidence breakdown input.
  evidenceConfidence: number;
  band: Confidence;
  hasUsableEvidence: boolean;
  reasons: string[];
};

const BAND_BASELINE: Record<Confidence, number> = { HIGH: 0.85, MEDIUM: 0.6, LOW: 0.3 };

/**
 * Map reasoning output -> a normalized evidence-confidence signal. Deterministic.
 * Baseline from overallConfidence, nudged by sufficiency score + source diversity,
 * floored low when there is effectively no usable evidence.
 */
export function deriveIntelConfidenceSignal(
  reasoning: CompanyIntelligenceReasoning
): IntelConfidenceSignal {
  const eq = reasoning.evidenceQuality;
  const reasons: string[] = [];

  const hasUsableEvidence = eq.usefulPages > 0 || eq.score >= 5;
  if (!hasUsableEvidence) {
    return {
      evidenceConfidence: 0.15,
      band: "LOW",
      hasUsableEvidence: false,
      reasons: ["no_usable_evidence"],
    };
  }

  let value = BAND_BASELINE[reasoning.overallConfidence];
  reasons.push(`baseline_${reasoning.overallConfidence.toLowerCase()}`);

  // Source diversity + evidence score nudge (bounded so it can't override the band).
  if (eq.uniqueSources >= 3) {
    value += 0.05;
    reasons.push("multi_source");
  }
  if (eq.score >= 8) {
    value += 0.05;
    reasons.push("strong_evidence_score");
  }
  if (eq.conflicts.length > 0) {
    value -= 0.1;
    reasons.push("evidence_conflicts");
  }

  const evidenceConfidence = Math.max(0, Math.min(1, Number(value.toFixed(3))));
  const band: Confidence = evidenceConfidence >= 0.75 ? "HIGH" : evidenceConfidence >= 0.45 ? "MEDIUM" : "LOW";
  return { evidenceConfidence, band, hasUsableEvidence: true, reasons };
}
