import { classificationToEvidence } from '@telestar/core-research/rulesFromParams';
import type { KindPolicy } from '@telestar/core-research/targetPolicy';
import type { CompanyClassificationInput } from '@telestar/core-research/verificationTypes';
import { assessIcpRulesV2, type IcpRulesV2Assessment } from '@telestar/core-scoring/rules/deriveQualification';
import { canonicalizeIndustry } from '@telestar/core-scoring/rules/dictionaries/industry';
import { foldText } from '@telestar/core-scoring/rules/normalize/index';
import type { IcpVersionRulesV2 } from '@telestar/core-scoring/rules/schema-v2';

import { deriveIcpVerdict, type IcpVerdict } from '@/lib/leadgen/pointsQualification';
import { assessmentFingerprint } from '@/lib/leadgen/scorePoolItem';

/**
 * Score one classified company candidate with the SAME engine the lead pool uses (owner report,
 * 2026-10-08). Research had its own keyword score, so a candidate and a lead with identical facts got
 * different verdicts, and a school or an analyst firm could outrank a bank. Pure: no I/O, no provider
 * calls; the caller persists the result.
 *
 * The decision, in order — the first line that applies wins:
 *
 *   1. Not a company site (article, listicle, job posting, parked page)   -> rejected
 *   2. The company's KIND is one the ICP does not want                     -> rejected
 *   3. A terminal gate or an explicit exclusion (excluded country, denylist) -> rejected
 *   3b. A known fact outside the ICP (country, headcount, industry)        -> rejected (researchFitGate)
 *   4. Below the fit threshold                                              -> rejected
 *   5. Qualified, classified with at least medium confidence, wanted kind   -> verified_fit
 *   6. Everything else                                                      -> needs_review
 *
 * A rejection resting on a LOW-confidence classification becomes needs_review: the classifier was
 * guessing, and a guess must not delete a candidate. Keywords are matched for ranking only and never
 * change the outcome; nothing here reads them before the verdict is final.
 */

export type ResearchVerification = 'verified_fit' | 'needs_review' | 'rejected';

export type VerifyCandidateFacts = { name: string; domain: string | null };

export type ScoreClassifiedCandidateInput = {
  classification: CompanyClassificationInput;
  candidate: VerifyCandidateFacts;
  /** Account rules: pass `toAccountRules(rules)`, never the persona-bearing rules. */
  rules: IcpVersionRulesV2;
  policy: KindPolicy;
  /** Stands in for the ICP version id in the fingerprint, e.g. `research:<runId>`. */
  rulesKey: string;
  site?: { reachable?: boolean };
  /** Ranking terms from the builder. They produce `keywordMatches` and nothing else. */
  keywords?: readonly string[];
};

export type VerificationResult = {
  verification: ResearchVerification;
  reason: string;
  /** Set when a low-confidence classification turned a rejection into a review. */
  downgradedFrom: string | null;
  /** Null when the page is not a company site, so there was nothing to score. */
  fitScore: number | null;
  verdict: IcpVerdict | null;
  assessed: Pick<IcpRulesV2Assessment, 'subScores' | 'gates' | 'missingEvidence'> | null;
  fingerprint: string | null;
  keywordMatches: string[];
};

type Outcome = { verification: ResearchVerification; reason: string };

const EXCLUSION_HIT_IDS = new Set(['industry_excluded']);
const EXCLUSION_REASON_CODES = new Set(['persona_title_denylisted', 'persona_seniority_excluded']);

/** The id of what ruled a candidate out, for the reason shown beside it. */
function exclusionReason(assessed: IcpRulesV2Assessment, verdict: IcpVerdict): string {
  if (verdict.reason === 'disqualified') return assessed.gates.hits[0]?.id ?? 'disqualified';
  const hit = Object.values(assessed.dimensionResults)
    .flatMap((result) => result.hits)
    .find((candidate) => EXCLUSION_HIT_IDS.has(candidate.id) || EXCLUSION_REASON_CODES.has(candidate.reasonCode));
  return hit?.id ?? 'explicit_exclusion';
}

/** The industry dimension's "known industry, nothing in the allowlist matched" score. */
const INDUSTRY_KNOWN_MISS_SCORE = 20;

/**
 * Research holds a company to what it is known to be; lead scoring does not.
 *
 * The weighted lead rule forgives one soft miss on purpose — a lead is a person someone already chose.
 * A research shortlist is the opposite: every off-target company in it costs a rep's time, and with the
 * weighted rule alone a Saudi construction firm for a network-security ICP, or a bank in Brazil, came out
 * "needs review" (owner, 2026-10-08: the list is wrong too often). So a fact the classifier established —
 * headquarters country, headcount, industry — that falls outside the ICP rejects the company here. A fact it
 * does not have never does, and a low-confidence classification is turned back into a review by the caller.
 *
 * Industry needs one more distinction. When every target is a canonical industry ("Banking", "ISP") and the
 * company has one too, the comparison is exact. When the ICP names free text the dictionary does not know
 * ("MRO", "Part 145"), the engine can only look for those words in what the company says it does, so only a
 * high-confidence description that never mentions them is a rejection; a medium one goes to a person.
 */
function researchFitGate(
  classification: CompanyClassificationInput,
  rules: IcpVersionRulesV2,
  assessed: IcpRulesV2Assessment,
): Outcome | null {
  const hit = (dimension: keyof IcpRulesV2Assessment['dimensionResults'], ids: string[]) =>
    (assessed.dimensionResults[dimension]?.hits ?? []).some((h) => ids.includes(h.id));

  if (hit('geo', ['geo_outside_target'])) return { verification: 'rejected', reason: 'outside_target_geo' };
  if (classification.employeeCount != null && hit('size', ['size_too_small', 'size_too_large'])) {
    return { verification: 'rejected', reason: 'size_out_of_range' };
  }

  const targets = rules.industry.mode === 'allowlist' ? rules.industry.targetIndustries : [];
  if (targets.length === 0 || assessed.dimensionResults.industry?.score !== INDUSTRY_KNOWN_MISS_SCORE) return null;
  const targetsCanonical = targets.every((target) => {
    const key = canonicalizeIndustry(target);
    return key !== null && key !== 'OTHER';
  });
  const exact = targetsCanonical && Boolean(classification.industryKey);
  if (exact || (!targetsCanonical && classification.confidence === 'high')) {
    return { verification: 'rejected', reason: 'industry_not_targeted' };
  }
  return { verification: 'needs_review', reason: 'industry_unconfirmed' };
}

function decide(
  classification: CompanyClassificationInput,
  policy: KindPolicy,
  rules: IcpVersionRulesV2,
  assessed: IcpRulesV2Assessment,
  verdict: IcpVerdict,
): Outcome {
  const kind = classification.companyKind;
  if (kind && policy[kind] === 'reject') return { verification: 'rejected', reason: `company_type:${kind}` };

  if (verdict.reason === 'disqualified' || verdict.reason === 'explicit_exclusion') {
    return { verification: 'rejected', reason: exclusionReason(assessed, verdict) };
  }
  const fitGate = researchFitGate(classification, rules, assessed);
  if (fitGate) return fitGate;
  if (verdict.reason === 'weighted_below_threshold') return { verification: 'rejected', reason: 'below_fit_threshold' };

  if (verdict.qualification !== 'qualified') return { verification: 'needs_review', reason: verdict.reason };
  if (classification.confidence === 'low') return { verification: 'needs_review', reason: 'low_confidence' };
  // An unclassified kind cannot be accepted: the policy has nothing to say about it.
  if (!kind || policy[kind] !== 'accept') return { verification: 'needs_review', reason: 'company_type_review' };
  return { verification: 'verified_fit', reason: verdict.reason };
}

/** Terms from the builder that appear in what the classifier read about the company. Ranking only. */
export function matchKeywords(
  keywords: readonly string[] | undefined,
  classification: CompanyClassificationInput,
  candidate: VerifyCandidateFacts,
): string[] {
  if (!keywords?.length) return [];
  const haystack = foldText([candidate.name, classification.industryText, classification.whatTheySell].filter(Boolean).join(' | '));
  const seen = new Set<string>();
  const matches: string[] = [];
  for (const keyword of keywords) {
    const folded = foldText(keyword);
    if (!folded || seen.has(folded) || !haystack.includes(folded)) continue;
    seen.add(folded);
    matches.push(keyword.trim());
  }
  return matches;
}

const withLowConfidenceDowngrade = (outcome: Outcome, classification: CompanyClassificationInput): Outcome & { downgradedFrom: string | null } =>
  outcome.verification === 'rejected' && classification.confidence === 'low'
    ? { verification: 'needs_review', reason: 'low_confidence', downgradedFrom: outcome.reason }
    : { ...outcome, downgradedFrom: null };

export function scoreClassifiedCandidate(input: ScoreClassifiedCandidateInput): VerificationResult {
  const { classification, candidate, rules, policy, rulesKey } = input;
  const keywordMatches = matchKeywords(input.keywords, classification, candidate);

  if (!classification.isCompanySite) {
    const rejected = { verification: 'rejected' as const, reason: `not_company_site:${classification.notCompanyReason ?? 'unrelated'}` };
    return {
      ...withLowConfidenceDowngrade(rejected, classification),
      fitScore: null,
      verdict: null,
      assessed: null,
      fingerprint: null,
      keywordMatches,
    };
  }

  const evidence = classificationToEvidence(classification, candidate, input.site);
  const assessed = assessIcpRulesV2(evidence, rules);
  const verdict = deriveIcpVerdict(assessed, rules, evidence);

  return {
    ...withLowConfidenceDowngrade(decide(classification, policy, rules, assessed, verdict), classification),
    fitScore: verdict.fitScore,
    verdict,
    assessed: { subScores: assessed.subScores, gates: assessed.gates, missingEvidence: assessed.missingEvidence },
    fingerprint: assessmentFingerprint(evidence, rules, rulesKey),
    keywordMatches,
  };
}
