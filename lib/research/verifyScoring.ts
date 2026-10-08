import { classificationToEvidence } from '@telestar/core-research/rulesFromParams';
import type { KindPolicy } from '@telestar/core-research/targetPolicy';
import type { CompanyClassificationInput } from '@telestar/core-research/verificationTypes';
import { assessIcpRulesV2, type IcpRulesV2Assessment } from '@telestar/core-scoring/rules/deriveQualification';
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

function decide(
  classification: CompanyClassificationInput,
  policy: KindPolicy,
  assessed: IcpRulesV2Assessment,
  verdict: IcpVerdict,
): Outcome {
  const kind = classification.companyKind;
  if (kind && policy[kind] === 'reject') return { verification: 'rejected', reason: `company_type:${kind}` };

  if (verdict.reason === 'disqualified' || verdict.reason === 'explicit_exclusion') {
    return { verification: 'rejected', reason: exclusionReason(assessed, verdict) };
  }
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
    ...withLowConfidenceDowngrade(decide(classification, policy, assessed, verdict), classification),
    fitScore: verdict.fitScore,
    verdict,
    assessed: { subScores: assessed.subScores, gates: assessed.gates, missingEvidence: assessed.missingEvidence },
    fingerprint: assessmentFingerprint(evidence, rules, rulesKey),
    keywordMatches,
  };
}
