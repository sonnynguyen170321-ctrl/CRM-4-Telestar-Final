import type { DimensionHit, DimensionResult, NormalizedScoringEvidence } from "../evidence";
import type { IcpVersionRulesV2 } from "../schema-v2";

// SC2: size dimension. Numeric bounds and/or qualitative bands + multi-location.
// Pure.

export function sizeScore(
  evidence: NormalizedScoringEvidence,
  rules: IcpVersionRulesV2
): DimensionResult {
  const { size } = rules;
  const hits: DimensionHit[] = [];
  const missingEvidence: string[] = [];

  const hasNumericBound = size.minEmployees !== undefined || size.maxEmployees !== undefined;
  const hasBandConstraint = size.sizeBands.length > 0;
  const hasConstraint = hasNumericBound || hasBandConstraint || size.minRevenueUsd !== undefined;

  if (!hasConstraint) {
    return { dimension: "size", score: 70, hits, missingEvidence };
  }

  // Revenue threshold can satisfy size on its own (Antsomi: rev >$1M OR size >50).
  if (
    size.minRevenueUsd !== undefined &&
    evidence.company.revenueUsd !== null &&
    evidence.company.revenueUsd >= size.minRevenueUsd
  ) {
    hits.push({ id: "size_revenue_match", label: "Meets revenue threshold", reasonCode: "target_size_match" });
    return { dimension: "size", score: 100, hits, missingEvidence };
  }

  // Multi-location can satisfy when allowed (Camelo).
  if (
    size.multiLocationOk &&
    evidence.company.locationCount !== null &&
    evidence.company.locationCount > 1
  ) {
    hits.push({ id: "size_multi_location", label: "Multi-location business", reasonCode: "target_size_match" });
    return { dimension: "size", score: 100, hits, missingEvidence };
  }

  if (!evidence.company.sizeKnown) {
    missingEvidence.push("size_unknown");
    const policyScore =
      size.unknownSizePolicy === "fail"
        ? 0
        : size.unknownSizePolicy === "soft_penalty"
        ? 40
        : 50;
    return { dimension: "size", score: policyScore, hits, missingEvidence };
  }

  const count = evidence.company.employeeCount;

  if (count !== null && hasNumericBound) {
    const aboveMin = size.minEmployees === undefined || count >= size.minEmployees;
    const belowMax = size.maxEmployees === undefined || count <= size.maxEmployees;

    if (aboveMin && belowMax) {
      hits.push({ id: "size_in_range", label: `Headcount in range (${count})`, reasonCode: "target_size_match" });
      return { dimension: "size", score: 100, hits, missingEvidence };
    }
    if (!aboveMin) {
      hits.push({ id: "size_too_small", label: `Below minimum headcount (${count})`, reasonCode: "target_size_too_small" });
      return { dimension: "size", score: 20, hits, missingEvidence };
    }
    hits.push({ id: "size_too_large", label: `Above maximum headcount (${count})`, reasonCode: "target_size_too_large" });
    return { dimension: "size", score: 40, hits, missingEvidence };
  }

  if (hasBandConstraint && evidence.company.sizeBand !== null) {
    if (size.sizeBands.includes(evidence.company.sizeBand)) {
      hits.push({ id: "size_band_match", label: `In target size band (${evidence.company.sizeBand})`, reasonCode: "target_size_match" });
      return { dimension: "size", score: 100, hits, missingEvidence };
    }
    hits.push({ id: "size_band_off", label: `Off-target size band (${evidence.company.sizeBand})`, reasonCode: "target_size_mismatch" });
    return { dimension: "size", score: 30, hits, missingEvidence };
  }

  // Constraint exists but evidence type doesn't line up with it.
  missingEvidence.push("size_unknown");
  return { dimension: "size", score: 50, hits, missingEvidence };
}
