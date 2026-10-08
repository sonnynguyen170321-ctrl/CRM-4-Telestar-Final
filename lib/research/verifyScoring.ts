import type { FitJudgement } from '@telestar/core-research/fitJudge';
import { classificationToEvidence } from '@telestar/core-research/rulesFromParams';
import type { KindPolicy } from '@telestar/core-research/targetPolicy';
import type { ClassificationConfidence, CompanyClassificationInput } from '@telestar/core-research/verificationTypes';
import { assessIcpRulesV2, type IcpRulesV2Assessment } from '@telestar/core-scoring/rules/deriveQualification';
import { canonicalizeIndustry, type IndustryKey } from '@telestar/core-scoring/rules/dictionaries/industry';
import { INDUSTRY_ALLOWLIST_MISS_SCORE } from '@telestar/core-scoring/rules/dimensions/industryScore';
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
 *   2. The company's KIND is one the ICP does not want, or a competitor    -> rejected
 *   3. A terminal gate or an explicit exclusion (excluded country, denylist) -> rejected
 *   3a. An exclude keyword the company's own industry names (word match)    -> rejected
 *   3b. An unambiguous fact outside the ICP (country, headcount, industry family) -> rejected (researchFitGate)
 *   4. Below the fit threshold                                              -> rejected
 *   5. Qualified, classified with at least medium confidence, wanted kind   -> verified_fit
 *   6. Everything else                                                      -> needs_review
 *
 * A rejection resting on a LOW-confidence classification becomes needs_review: the classifier was
 * guessing, and a guess must not delete a candidate. Deterministic code rejects only on facts that cannot be
 * argued (a resolved country outside a fully resolved geography, a headcount outside the range, an industry in
 * no sector family of the targets); anything lexical or semantic is needs_review, and the optional ICP fit
 * judge (`combineWithJudge`) reads synonyms, regions and competitors. Keywords are matched for ranking only
 * and never change the outcome.
 *
 * Exclude keywords are matched here, on word boundaries, NOT by the engine's `excludedIndustries`: that list is
 * a terminal substring match ("bank" would exclude "Bankruptcy software"). A hit in the company's industry
 * text rejects; a hit only in what it sells is a mention for a person to read.
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
  /** `BuilderRules.geoGate`: false when any builder geography was unresolved or Worldwide. Defaults to true. */
  geoGate?: boolean;
  /** `BuilderRules.excludeKeywords`. */
  excludeKeywords?: readonly string[];
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
  /** The ICP fit judge's reason, when `combineWithJudge` changed the outcome. */
  judgeReason?: string;
};

type Outcome = { verification: ResearchVerification; reason: string };
type GateOptions = { geoGate: boolean };

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

// Sector families: an industry in the same family as a target is not an unambiguous miss (a fintech for a
// banking ICP, a hosting company for a telecom ICP). Overlaps are deliberate (CLOUD_HOSTING).
const SECTOR_FAMILIES: ReadonlyArray<ReadonlySet<IndustryKey>> = [
  new Set<IndustryKey>(['BANKING', 'FINTECH', 'FINANCE', 'INSURANCE', 'CRYPTO']),
  new Set<IndustryKey>(['TELECOM', 'ISP', 'CLOUD_HOSTING']),
  new Set<IndustryKey>(['SOFTWARE', 'SAAS', 'IT_SERVICES', 'CYBERSECURITY', 'CLOUD_HOSTING']),
  new Set<IndustryKey>(['RETAIL', 'ECOMMERCE', 'FMCG', 'FNB', 'HOSPITALITY']),
  new Set<IndustryKey>(['MEDIA', 'ENTERTAINMENT', 'GAMING', 'ADVERTISING', 'MARKETING']),
  new Set<IndustryKey>(['LOGISTICS', 'TRANSPORTATION']),
  new Set<IndustryKey>(['ENERGY', 'UTILITY']),
];

const sameFamily = (a: IndustryKey, b: IndustryKey): boolean =>
  a === b || SECTOR_FAMILIES.some((family) => family.has(a) && family.has(b));

/**
 * Research holds a company to what it is KNOWN to be, but only on facts that cannot be argued.
 *
 * Lead scoring forgives one soft miss on purpose; a research shortlist should not fill with off-target
 * companies (owner, 2026-10-08). A review of the first version found it rejected real prospects, so each
 * rejection now needs an unambiguous fact:
 *
 *   - country: the headquarters resolved to a country outside a geography that resolved COMPLETELY
 *     (`geoGate`); a region name or place the builder could not place never rejects anyone.
 *   - headcount: a known number outside the range.
 *   - industry: every target is a canonical industry, the company's classified key is known, confidence is
 *     high, and the key is in no sector family of any target. Free-text targets ("MRO") never reject on
 *     industry: whether a company matches them is for the judge or a person.
 *
 * Any other industry miss (the score named by INDUSTRY_ALLOWLIST_MISS_SCORE in core-scoring industryScore.ts)
 * is a review, `industry_unconfirmed`.
 */
function researchFitGate(
  classification: CompanyClassificationInput,
  rules: IcpVersionRulesV2,
  assessed: IcpRulesV2Assessment,
  options: GateOptions,
): Outcome | null {
  const hit = (dimension: keyof IcpRulesV2Assessment['dimensionResults'], ids: string[]) =>
    (assessed.dimensionResults[dimension]?.hits ?? []).some((h) => ids.includes(h.id));

  if (options.geoGate && hit('geo', ['geo_outside_target'])) return { verification: 'rejected', reason: 'hq_outside_target' };
  if (classification.employeeCount != null && hit('size', ['size_too_small', 'size_too_large'])) {
    return { verification: 'rejected', reason: 'size_out_of_range' };
  }

  const targets = rules.industry.mode === 'allowlist' ? rules.industry.targetIndustries : [];
  if (targets.length === 0 || assessed.dimensionResults.industry?.score !== INDUSTRY_ALLOWLIST_MISS_SCORE) return null;

  const targetKeys = targets.map((target) => canonicalizeIndustry(target));
  const allCanonical = targetKeys.every((key) => key !== null);
  const companyKey = classification.industryKey;
  const unambiguous =
    allCanonical &&
    companyKey != null &&
    companyKey !== 'OTHER' &&
    classification.confidence === 'high' &&
    !targetKeys.some((key) => key !== null && sameFamily(companyKey, key));
  return unambiguous
    ? { verification: 'rejected', reason: 'industry_not_targeted' }
    : { verification: 'needs_review', reason: 'industry_unconfirmed' };
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function mentions(text: string | null, keyword: string): boolean {
  const folded = foldText(keyword);
  if (!text || !folded) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(folded)}(?![\\p{L}\\p{N}])`, 'u').test(foldText(text));
}

/** An exclude keyword: in the industry text it rejects; only in what they sell, it is a mention to review. */
function excludedKeywordOutcome(
  classification: CompanyClassificationInput,
  excludeKeywords: readonly string[] | undefined,
): Outcome | null {
  for (const keyword of excludeKeywords ?? []) {
    if (mentions(classification.industryText, keyword)) return { verification: 'rejected', reason: `excluded_keyword:${keyword}` };
  }
  for (const keyword of excludeKeywords ?? []) {
    if (mentions(classification.whatTheySell, keyword)) return { verification: 'needs_review', reason: 'excluded_keyword_mention' };
  }
  return null;
}

function decide(
  classification: CompanyClassificationInput,
  policy: KindPolicy,
  rules: IcpVersionRulesV2,
  assessed: IcpRulesV2Assessment,
  verdict: IcpVerdict,
  options: GateOptions & { excludeKeywords?: readonly string[] },
): Outcome {
  const kind = classification.companyKind;
  if (kind && policy[kind] === 'reject') return { verification: 'rejected', reason: `company_type:${kind}` };
  if (kind && policy[kind] === 'competitor') return { verification: 'rejected', reason: `competitor:${kind}` };

  if (verdict.reason === 'disqualified' || verdict.reason === 'explicit_exclusion') {
    return { verification: 'rejected', reason: exclusionReason(assessed, verdict) };
  }
  const excluded = excludedKeywordOutcome(classification, options.excludeKeywords);
  if (excluded?.verification === 'rejected') return excluded;
  const fitGate = researchFitGate(classification, rules, assessed, options);
  if (fitGate?.verification === 'rejected') return fitGate;
  if (verdict.reason === 'weighted_below_threshold') return { verification: 'rejected', reason: 'below_fit_threshold' };

  // A review the fit gate or an exclusion mention asked for outranks the engine's own verdict reason.
  if (fitGate) return fitGate;
  if (excluded) return excluded;
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
    ...withLowConfidenceDowngrade(
      decide(classification, policy, rules, assessed, verdict, {
        geoGate: input.geoGate ?? true,
        excludeKeywords: input.excludeKeywords,
      }),
      classification,
    ),
    fitScore: verdict.fitScore,
    verdict,
    assessed: { subScores: assessed.subScores, gates: assessed.gates, missingEvidence: assessed.missingEvidence },
    fingerprint: assessmentFingerprint(evidence, rules, rulesKey),
    keywordMatches,
  };
}

/**
 * Fold the ICP fit judge's reading into a deterministic result.
 *
 * The judge can reject or confirm; it never overrides a deterministic rejection, and when it is unavailable
 * (null) nothing changes: it cannot upgrade or reject.
 *
 *   - rejected stays rejected;
 *   - judge "no" -> rejected `not_icp_fit:<element>`, carrying the judge's reason — but only when the
 *     classification it read was at least medium confidence and the judge named the part of the ICP that
 *     failed; a "no" about a guessed company, or one that cannot say why, is a review (`judge_doubt`). The
 *     same safeguard every deterministic rejection gets (review, 2026-10-08);
 *   - verified_fit needs the judge's "yes"; anything else becomes `judge_unsure`;
 *   - needs_review stays so, except that a "yes" lifts a candidate whose ONLY doubt was the industry wording or
 *     the company type, whom the engine itself rated qualified, and whose classification was not a guess.
 */
export function combineWithJudge(
  result: VerificationResult,
  judge: Pick<FitJudgement, 'fit' | 'reason' | 'element'> | null,
  confidence: ClassificationConfidence = 'medium',
): VerificationResult {
  if (!judge || result.verification === 'rejected') return result;
  if (judge.fit === 'no') {
    if (confidence === 'low' || !judge.element) {
      return { ...result, verification: 'needs_review', reason: 'judge_doubt', judgeReason: judge.reason };
    }
    return { ...result, verification: 'rejected', reason: `not_icp_fit:${judge.element}`, judgeReason: judge.reason };
  }
  if (result.verification === 'verified_fit') {
    return judge.fit === 'yes' ? result : { ...result, verification: 'needs_review', reason: 'judge_unsure', judgeReason: judge.reason };
  }
  const onlyDoubtWasWording = result.reason === 'industry_unconfirmed' || result.reason === 'company_type_review';
  if (judge.fit === 'yes' && onlyDoubtWasWording && confidence !== 'low' && result.verdict?.qualification === 'qualified') {
    return { ...result, verification: 'verified_fit', reason: 'judge_confirmed', judgeReason: judge.reason };
  }
  return result;
}
