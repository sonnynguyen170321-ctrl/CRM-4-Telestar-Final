import type { IcpQualification } from '@prisma/client';
import type { IcpRulesV2Assessment } from '@telestar/core-scoring/rules/deriveQualification';
import type { DimensionKey, RawScoringEvidence } from '@telestar/core-scoring/rules/evidence';
import { normalizeEvidence } from '@telestar/core-scoring/rules/normalize/index';
import { servicesSignal } from '@telestar/core-scoring/rules/gates/terminalGates';
import type { IcpVersionRulesV2 } from '@telestar/core-scoring/rules/schema-v2';

/**
 * The stored ICP verdict, from weighted points.
 *
 * It replaces `deriveSimpleIcpQualification`, whose rule was "any single mismatch is No fit": a CEO
 * at a perfect SaaS company in the wrong country, or a VP whose title missed the list by one word,
 * was `unqualified` exactly like a gambling site. The owner's words — "mất 1 element là unqualify
 * luôn" — and their decision (2026-10-02) was weighted points, with only the disqualifiers fatal.
 *
 * ## The rule
 *
 * 1. **Fatal**: a terminal gate (the disqualifiers — excluded HQ country, services/consulting, a
 *    one-person company, a free-mail contact, an offline website, a competitor) or an **explicit
 *    exclusion** the operator wrote (an excluded industry, a denied title, an excluded seniority).
 *    Those are lists of "never", and a "never" is not outweighed by a good score.
 * 2. **Points**: the weighted average of the dimensions this ICP actually *scores* — see
 *    `scoredDimensions`. A dimension the ICP does not constrain is left out rather than counted at
 *    the engine's neutral 60–70, which is what made a perfect lead score 69 under an ICP that only
 *    named an industry. A dimension whose data is missing is left out too: no data is not a mismatch.
 * 3. **Thresholds**: `scorePolicy.qualifiedMinFitScore` and `needsReviewMinFitScore`, which until now
 *    were stored, editable in the schema, and ignored by the verdict.
 * 4. **Core evidence**: geography, industry and job title are what a qualification claims. When the
 *    ICP constrains one and the lead has no data for it, the best verdict is `needs_review` — the
 *    points cannot have checked what they never saw. Company size and type are not core: almost no
 *    lead carries them, and requiring them made the TeleStar ICP (min 3 employees) unable to qualify
 *    anyone at all.
 */

/**
 * Bumped whenever this rule changes, and hashed into the assessment fingerprint. Assessments are
 * insert-only and reused by fingerprint, so without it a rescore under a new rule would find the
 * old row — evidence and ICP unchanged — and hand back the old verdict.
 */
// v2 (2026-10-06): country aliases on the ICP side, title word-set matching, services words send
// a lead to review instead of ruling it out.
// v3 (2026-10-10): the dictionaries underneath changed — worldwide titles (president, chairman, board,
// GM, Vietnamese/European/Asian forms, former/intern/assistant-to guards) and whole-word industry
// matching (docs/scoring/TAXONOMY_2026-10.md). Same evidence can now score differently.
export const ICP_VERDICT_VERSION = 'weighted-v3';

export type WeightedVerdictReason =
  | 'disqualified'
  | 'explicit_exclusion'
  | 'weighted_qualified'
  | 'core_evidence_missing'
  | 'weighted_borderline'
  | 'weighted_below_threshold'
  | 'exclusions_only_passed'
  | 'services_review';

export type WeightedVerdict = {
  qualification: IcpQualification;
  /** 0-100 over the dimensions that were scored. 0 when none were. */
  fitScore: number;
  reason: WeightedVerdictReason;
  scoredDimensions: DimensionKey[];
  /** Core dimensions the ICP constrains and the lead had no data for. */
  missingCoreEvidence: DimensionKey[];
};

const CORE_DIMENSIONS: ReadonlySet<DimensionKey> = new Set(['geo', 'industry', 'persona']);

const EXCLUSION_HIT_IDS = new Set(['industry_excluded']);
const EXCLUSION_REASON_CODES = new Set(['persona_title_denylisted', 'persona_seniority_excluded']);

type DimensionRole = {
  /** Scored when the lead has data: the ICP names what it wants here. */
  positive: boolean;
  /** Checked for "never" only: an exclusion list with nothing it positively asks for. */
  exclusionOnly: boolean;
};

/** What this ICP does with each dimension. Exported for the panel that explains a verdict. */
export function dimensionRoles(rules: IcpVersionRulesV2): Record<DimensionKey, DimensionRole> {
  const geoPositive = rules.geography.targetCountries.length > 0 || rules.geography.targetRegions.length > 0;
  const geoExclusion = rules.geography.excludedCountries.length > 0;

  const industryPositive = rules.industry.mode === 'allowlist' && rules.industry.targetIndustries.length > 0;
  const industryExclusion = rules.industry.excludedIndustries.length > 0 || rules.industry.mode === 'denylist';

  const persona = rules.persona;
  const personaPositive =
    persona.titleAllowlist.length > 0 ||
    persona.titleTiers.length > 0 ||
    persona.titleKeywords.length > 0 ||
    persona.seniorityFloor !== undefined ||
    persona.departmentAllowlist.length > 0;
  const personaExclusion = persona.titleDenylist.length > 0 || persona.seniorityExclusions.length > 0;

  const sizePositive =
    rules.size.minEmployees != null || rules.size.maxEmployees != null || rules.size.sizeBands.length > 0;

  const companyTypePositive = rules.companyType.allow.length > 0;

  // Industry keywords already move the industry score when industry is an allowlist; counting them
  // again as the signals dimension let a keyword rescue an allowlist miss all the way to Fit. They
  // score as signals only where nothing else reads them.
  const signalsPositive =
    (rules.industry.industryKeywords.length > 0 && !industryPositive) ||
    Boolean(rules.negativeSignals && rules.negativeSignals.length > 0);

  return {
    geo: { positive: geoPositive, exclusionOnly: !geoPositive && geoExclusion },
    industry: { positive: industryPositive, exclusionOnly: !industryPositive && industryExclusion },
    persona: { positive: personaPositive, exclusionOnly: !personaPositive && personaExclusion },
    size: { positive: sizePositive, exclusionOnly: false },
    companyType: { positive: companyTypePositive, exclusionOnly: false },
    signals: { positive: signalsPositive, exclusionOnly: false },
  };
}

function hasExplicitExclusion(assessed: IcpRulesV2Assessment): boolean {
  return Object.values(assessed.dimensionResults).some((result) =>
    result.hits.some((hit) => EXCLUSION_HIT_IDS.has(hit.id) || EXCLUSION_REASON_CODES.has(hit.reasonCode))
  );
}

/** Whether the lead carries the data a dimension is judged on. */
function evidenceMissing(
  dimension: DimensionKey,
  assessed: IcpRulesV2Assessment,
  evidence: ReturnType<typeof normalizeEvidence>
): boolean {
  switch (dimension) {
    case 'geo':
      return !evidence.company.countryKnown;
    case 'industry':
      return (
        !evidence.company.industryCanonical &&
        !evidence.company.industryRaw &&
        evidence.company.industryTags.length === 0
      );
    case 'persona':
      // An unrecognised seniority is missing evidence, not proof the person is junior.
      return !evidence.contact?.titlePresent;
    default:
      return assessed.dimensionResults[dimension].missingEvidence.length > 0;
  }
}

export function deriveWeightedIcpQualification(
  assessed: IcpRulesV2Assessment,
  rules: IcpVersionRulesV2,
  rawEvidence: RawScoringEvidence
): WeightedVerdict {
  const evidence = normalizeEvidence(rawEvidence);
  const roles = dimensionRoles(rules);
  const weights = rules.scoringWeights;
  const { qualifiedMinFitScore, needsReviewMinFitScore } = rules.scorePolicy;

  const scored: DimensionKey[] = [];
  const missingCore: DimensionKey[] = [];
  let weightSum = 0;
  let pointSum = 0;

  for (const dimension of Object.keys(roles) as DimensionKey[]) {
    const role = roles[dimension];
    if (!role.positive && !role.exclusionOnly) continue;
    if (evidenceMissing(dimension, assessed, evidence)) {
      if (CORE_DIMENSIONS.has(dimension)) missingCore.push(dimension);
      continue;
    }
    if (!role.positive) continue;
    const weight = weights[dimension] ?? 0;
    if (weight <= 0) continue;
    scored.push(dimension);
    weightSum += weight;
    pointSum += assessed.dimensionResults[dimension].score * weight;
  }

  const fitScore = weightSum > 0 ? Math.round(pointSum / weightSum) : 0;
  const verdict = (qualification: IcpQualification, reason: WeightedVerdictReason): WeightedVerdict => ({
    qualification,
    fitScore,
    reason,
    scoredDimensions: scored,
    missingCoreEvidence: missingCore,
  });

  if (assessed.gates.disqualified) return verdict('unqualified', 'disqualified');
  if (hasExplicitExclusion(assessed)) return verdict('unqualified', 'explicit_exclusion');

  // Nothing positive to score. Either every check is an exclusion list and all of them passed, or
  // the lead lacks the data the ICP needs — the second is a human's call, never a pass.
  // A lead that would qualify, but the ICP excludes services firms and the words appear somewhere
  // (packages/core-scoring servicesSignal): a person checks what they actually sell.
  const servicesMentioned = servicesSignal(evidence, rules) === 'mentioned';

  if (scored.length === 0) {
    if (missingCore.length > 0) return verdict('needs_review', 'core_evidence_missing');
    if (servicesMentioned) return verdict('needs_review', 'services_review');
    return verdict('qualified', 'exclusions_only_passed');
  }

  if (fitScore >= qualifiedMinFitScore) {
    if (missingCore.length > 0) return verdict('needs_review', 'core_evidence_missing');
    if (servicesMentioned) return verdict('needs_review', 'services_review');
    return verdict('qualified', 'weighted_qualified');
  }
  if (fitScore >= needsReviewMinFitScore) return verdict('needs_review', 'weighted_borderline');
  return verdict('unqualified', 'weighted_below_threshold');
}
