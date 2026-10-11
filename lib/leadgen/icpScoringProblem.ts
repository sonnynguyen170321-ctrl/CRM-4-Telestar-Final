import type { IcpVersionRulesV2 } from '@telestar/core-scoring/rules/schema-v2';

/**
 * Why a rule set cannot be saved yet, said before the save round-trip. The schema rejects weights
 * that do not sum to 100 and a Fit bar at or under the Review bar; naming the problem in the editor
 * is what makes those numbers safe to edit. Shared by every surface that edits rules.
 */
export function sumScoringWeights(weights: IcpVersionRulesV2['scoringWeights']): number {
  return Object.values(weights).reduce((total, value) => total + (Number(value) || 0), 0);
}

export function describeScoringProblem(rules: IcpVersionRulesV2): string | null {
  if (rules.pointRules && rules.pointRules.fitAt <= rules.pointRules.reviewAt) {
    return 'Points: the Fit total must be higher than the Review total.';
  }
  const sum = sumScoringWeights(rules.scoringWeights);
  if (sum !== 100) return `Points must add up to 100 (now ${sum}).`;
  if (rules.scorePolicy.qualifiedMinFitScore <= rules.scorePolicy.needsReviewMinFitScore) {
    return 'The Fit score must be higher than the Review score.';
  }
  return null;
}

/** True when the editor's rules differ from what the server holds for this version. */
export function hasUnsavedRules(
  rules: IcpVersionRulesV2 | null,
  rulesVersionId: string,
  version: { id: string; rulesJson: IcpVersionRulesV2 } | null,
): boolean {
  return Boolean(rules && version && rulesVersionId === version.id) &&
    JSON.stringify(rules) !== JSON.stringify(version?.rulesJson);
}
