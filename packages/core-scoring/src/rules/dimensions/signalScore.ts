import type { DimensionHit, DimensionResult, NormalizedScoringEvidence } from "../evidence";
import type { IcpVersionRulesV2 } from "../schema-v2";
import { foldText } from "../normalize/normalizeCountry";

// SC2: signals dimension — coverage of authored industry/product keywords in the
// company's evidence text. Lightweight positive signal (small weight). Pure.

export function signalScore(
  evidence: NormalizedScoringEvidence,
  rules: IcpVersionRulesV2
): DimensionResult {
  const hits: DimensionHit[] = [];
  const keywords = rules.industry.industryKeywords;
  const negativeKeywords = rules.negativeSignals || [];
  const text = evidence.company.evidenceText;

  const matched = keywords.filter((keyword) => text.includes(foldText(keyword)));
  for (const keyword of matched) {
    hits.push({ id: `signal_${foldText(keyword).replace(/\s+/g, "_")}`, label: `Signal: ${keyword}`, reasonCode: "positive_signal_match" });
  }

  const matchedNegatives = negativeKeywords.filter((keyword) => text.includes(foldText(keyword)));
  for (const keyword of matchedNegatives) {
    hits.push({ id: `signal_neg_${foldText(keyword).replace(/\s+/g, "_")}`, label: `Negative Signal: ${keyword}`, reasonCode: "negative_signal_match" });
  }

  const coverage = keywords.length > 0 ? matched.length / keywords.length : 1;
  const baseScore = Math.round(50 + 50 * coverage);
  const penalty = matchedNegatives.length * 15;
  const score = Math.max(0, baseScore - penalty);

  return { dimension: "signals", score, hits, missingEvidence: [] };
}
