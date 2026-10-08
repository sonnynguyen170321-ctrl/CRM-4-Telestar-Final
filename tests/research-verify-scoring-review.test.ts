import { describe, expect, it } from 'vitest';

import type { ResearchBuilderParams } from '@telestar/core-research/buildDiscoveryQueries';
import { builderParamsToRulesV2, resolveCountry, toAccountRules } from '@telestar/core-research/rulesFromParams';
import { resolveKindPolicy } from '@telestar/core-research/targetPolicy';
import type { CompanyClassificationInput } from '@telestar/core-research/verificationTypes';

import { combineWithJudge, scoreClassifiedCandidate, type VerificationResult } from '@/lib/research/verifyScoring';

/**
 * Review of the research scoring branch (2026-10-08): deterministic code rejected real prospects on ambiguous
 * facts. Deterministic code now rejects only on facts that cannot be argued; the rest is a review, and the ICP
 * fit judge (a model, injected by the caller) reads synonyms, regions and competitors.
 */

const params = (over: Partial<ResearchBuilderParams>): ResearchBuilderParams => ({
  queryPlanVersion: 1,
  mode: 'BUILDER',
  queryLimit: 50,
  industries: [],
  keywords: [],
  titles: [],
  geos: [],
  seniority: [],
  excludeKeywords: [],
  excludeDomains: [],
  ...over,
});

function icp(p: ResearchBuilderParams, stored: unknown = null) {
  const built = builderParamsToRulesV2(p, 'run-1');
  const rules = toAccountRules(built.rules);
  return { rules, policy: resolveKindPolicy(stored, rules), geoGate: built.geoGate, excludeKeywords: built.excludeKeywords };
}

const classified = (over: Partial<CompanyClassificationInput> = {}): CompanyClassificationInput => ({
  isCompanySite: true,
  notCompanyReason: null,
  companyKind: 'operator',
  industryText: 'Banking',
  industryKey: 'BANKING',
  whatTheySell: 'Retail and corporate banking',
  hqCountry: 'Saudi Arabia',
  employeeCount: 25498,
  employeeBand: null,
  confidence: 'high',
  evidence: [],
  ...over,
});

const CAND = { name: 'Acme', domain: 'acme.com' };
const score = (target: ReturnType<typeof icp>, classification: CompanyClassificationInput) =>
  scoreClassifiedCandidate({
    classification,
    candidate: CAND,
    rules: target.rules,
    policy: target.policy,
    rulesKey: 'research:run-1',
    geoGate: target.geoGate,
    excludeKeywords: target.excludeKeywords,
  });

const STORMWALL = params({
  industries: ['ISP/Telecom', 'Banking', 'E-commerce', 'Gaming'],
  geos: ['Saudi Arabia', 'UAE', 'Turkey', 'Egypt', 'Indonesia', 'Vietnam', 'India', 'Morocco', 'Germany'],
  companySize: 'exclude very small',
});

describe('geography', () => {
  it('an unresolved builder geography switches the country gate off for the whole run', () => {
    const target = icp(params({ ...STORMWALL, geos: ['Saudi Arabia', 'Atlantis'] }));
    expect(target.geoGate).toBe(false);
    const brazil = score(target, classified({ hqCountry: 'Brazil' }));
    expect(brazil.reason).not.toBe('hq_outside_target');
    expect(brazil.verification).not.toBe('rejected');
  });

  it('Stormwall "Asia" and "Türkiye": a region never hard-rejects on geography — the judge reads it', () => {
    // "Asia" as listed has no Saudi Arabia or UAE; rejecting against it deleted Gulf prospects (re-review).
    const target = icp(params({ industries: ['telcos', 'hosters'], geos: ['Asia', 'Türkiye'] }));
    expect(target.geoGate).toBe(false);
    const telco = classified({ industryText: 'Telecommunications', industryKey: 'TELECOM', hqCountry: 'India', employeeCount: 20000 });
    expect(score(target, telco).reason).not.toBe('hq_outside_target');
    expect(score(target, classified({ ...telco, hqCountry: 'Saudi Arabia' })).reason).not.toBe('hq_outside_target');
    expect(score(target, classified({ ...telco, hqCountry: 'Brazil' })).reason).not.toBe('hq_outside_target');
  });

  it('an explicit country list does gate: Türkiye inside, Brazil outside', () => {
    const target = icp(params({ industries: ['telcos', 'hosters'], geos: ['Türkiye', 'India'] }));
    expect(target.geoGate).toBe(true);
    const turk = classified({ industryText: 'Internet service provider', industryKey: 'ISP', hqCountry: 'Republic of Türkiye', employeeCount: 3000 });
    expect(score(target, turk).reason).not.toBe('hq_outside_target');
    expect(score(target, classified({ ...turk, hqCountry: 'Brazil' })).reason).toBe('hq_outside_target');
  });

  it('a two-letter state in "City, ST" is not read as a country', () => {
    expect(resolveCountry('Boston, MA')).toBeNull();
    expect(resolveCountry('DE')).toBe('Germany');
  });

  it('a country spelled KSA or "City, Kingdom of Saudi Arabia" on the company side matches Saudi Arabia', () => {
    const target = icp(STORMWALL);
    expect(score(target, classified({ hqCountry: 'KSA' })).reason).not.toBe('hq_outside_target');
    expect(score(target, classified({ hqCountry: 'Riyadh, Kingdom of Saudi Arabia' })).reason).not.toBe('hq_outside_target');
  });
});

describe('industry', () => {
  const bankTarget = () => icp(params({ industries: ['Banking'], geos: ['Saudi Arabia'] }));

  it('an industry in the same sector family as a target is reviewed, not rejected', () => {
    const fintech = classified({ industryText: 'Payments', industryKey: 'FINTECH', whatTheySell: 'Card processing' });
    expect(score(bankTarget(), fintech).verification).not.toBe('rejected');
    const hosting = classified({ industryText: 'Data centres', industryKey: 'CLOUD_HOSTING', whatTheySell: 'Hosting' });
    expect(score(icp(params({ industries: ['Telecom'], geos: ['Saudi Arabia'] })), hosting).verification).not.toBe('rejected');
  });

  it('an industry in no family is rejected only at high confidence with a known key', () => {
    const build = (over: Partial<CompanyClassificationInput>) =>
      score(bankTarget(), classified({ industryText: 'Construction', industryKey: 'CONSTRUCTION', whatTheySell: 'Buildings', ...over }));
    expect(build({})).toMatchObject({ verification: 'rejected', reason: 'industry_not_targeted' });
    expect(build({ confidence: 'medium' })).toMatchObject({ verification: 'needs_review', reason: 'industry_unconfirmed' });
    expect(build({ industryKey: null })).toMatchObject({ verification: 'needs_review', reason: 'industry_unconfirmed' });
    expect(build({ industryKey: 'OTHER' })).toMatchObject({ verification: 'needs_review', reason: 'industry_unconfirmed' });
  });

  it('free-text targets never reject on industry', () => {
    const target = icp(params({ industries: ['Aviation', 'MRO'], geos: ['Germany'] }));
    const bakery = classified({ industryText: 'Bakery', industryKey: 'FNB', hqCountry: 'Germany', whatTheySell: 'Bread' });
    expect(score(target, bakery)).toMatchObject({ verification: 'needs_review', reason: 'industry_unconfirmed' });
  });

  it('targets typed as "Banking & Finance, Telecom and Hosting" keep an insurer', () => {
    const target = icp(params({ industries: ['Banking & Finance, Telecom and Hosting'], geos: ['Saudi Arabia'] }));
    expect(score(target, classified({ industryText: 'Insurance', industryKey: 'INSURANCE' })).verification).not.toBe('rejected');
  });

});

describe('exclude keywords', () => {
  it('"bank" does not wipe out "Bankruptcy software" (word match, not an engine substring)', () => {
    const target = icp(params({ industries: ['Software'], geos: ['Germany'], excludeKeywords: ['bank'] }));
    const result = score(target, classified({ industryText: 'Bankruptcy software', industryKey: 'SOFTWARE', hqCountry: 'Germany', employeeCount: 40 }));
    expect(result.verification).not.toBe('rejected');
  });

  it('a hit in the industry text rejects; a hit only in what they sell is a mention to review', () => {
    expect(score(icp(params({ ...STORMWALL, excludeKeywords: ['banking'] })), classified())).toMatchObject({
      verification: 'rejected',
      reason: 'excluded_keyword:banking',
    });
    const mention = score(icp(params({ ...STORMWALL, excludeKeywords: ['payments'] })), classified({ whatTheySell: 'Retail banking and payments' }));
    expect(mention).toMatchObject({ verification: 'needs_review', reason: 'excluded_keyword_mention' });
  });
});

describe('kind policy', () => {
  it('a software vendor is reviewed, not rejected, for an operator ICP', () => {
    const vendor = classified({ companyKind: 'software_vendor', industryText: 'Telecom billing software', industryKey: 'SOFTWARE' });
    expect(score(icp(STORMWALL), vendor).reason).not.toBe('company_type:software_vendor');
  });

  it('a competitor kind named by the run is rejected', () => {
    const target = icp(STORMWALL, { competitorKinds: ['services_agency'] });
    const agency = classified({ companyKind: 'services_agency', industryText: 'Marketing agency', industryKey: 'MARKETING' });
    expect(score(target, agency)).toMatchObject({ verification: 'rejected', reason: 'competitor:services_agency' });
  });
});

describe('combineWithJudge', () => {
  const base = (over: Partial<VerificationResult>): VerificationResult => ({
    verification: 'verified_fit',
    reason: 'weighted_qualified',
    downgradedFrom: null,
    fitScore: 90,
    verdict: { qualification: 'qualified', fitScore: 90, reason: 'weighted_qualified', scoredDimensions: [], missingCoreEvidence: [] },
    assessed: null,
    fingerprint: 'f',
    keywordMatches: [],
    ...over,
  });
  const yes = { fit: 'yes' as const, reason: 'Mobile operator', element: null };
  const no = (element: 'industry' | 'competitor') => ({ fit: 'no' as const, reason: 'A rival agency', element });
  const unsure = { fit: 'unsure' as const, reason: 'No facts', element: null };

  it('never changes a deterministic rejection', () => {
    const rejected = base({ verification: 'rejected', reason: 'hq_outside_target' });
    for (const judge of [yes, unsure, no('industry'), null]) expect(combineWithJudge(rejected, judge)).toBe(rejected);
  });

  it('a judge "no" rejects with the failed element and its reason', () => {
    expect(combineWithJudge(base({}), no('competitor'))).toMatchObject({
      verification: 'rejected',
      reason: 'not_icp_fit:competitor',
      judgeReason: 'A rival agency',
    });
    expect(combineWithJudge(base({ verification: 'needs_review', reason: 'weighted_borderline' }), no('industry')).reason).toBe('not_icp_fit:industry');
  });

  it('a judge "no" about a guessed company, or one that cannot say why, is a review, not a rejection', () => {
    expect(combineWithJudge(base({}), no('industry'), 'low')).toMatchObject({ verification: 'needs_review', reason: 'judge_doubt' });
    expect(combineWithJudge(base({}), { fit: 'no', reason: 'Not a fit', element: null })).toMatchObject({ verification: 'needs_review', reason: 'judge_doubt' });
  });

  it('a yes never lifts a guessed classification to a fit', () => {
    const unconfirmed = base({ verification: 'needs_review', reason: 'industry_unconfirmed' });
    expect(combineWithJudge(unconfirmed, yes, 'low').verification).toBe('needs_review');
  });

  it('verified_fit needs the judge to say yes', () => {
    expect(combineWithJudge(base({}), yes).verification).toBe('verified_fit');
    expect(combineWithJudge(base({}), unsure)).toMatchObject({ verification: 'needs_review', reason: 'judge_unsure' });
  });

  it('a yes lifts a review only when the sole doubt was wording and the engine rated it qualified', () => {
    const unconfirmed = base({ verification: 'needs_review', reason: 'industry_unconfirmed' });
    expect(combineWithJudge(unconfirmed, yes)).toMatchObject({ verification: 'verified_fit', reason: 'judge_confirmed' });
    expect(combineWithJudge(base({ verification: 'needs_review', reason: 'company_type_review' }), yes).verification).toBe('verified_fit');
    const borderline = base({
      verification: 'needs_review',
      reason: 'industry_unconfirmed',
      verdict: { qualification: 'needs_review', fitScore: 60, reason: 'weighted_borderline', scoredDimensions: [], missingCoreEvidence: [] },
    });
    expect(combineWithJudge(borderline, yes).verification).toBe('needs_review');
    expect(combineWithJudge(base({ verification: 'needs_review', reason: 'core_evidence_missing' }), yes).verification).toBe('needs_review');
    expect(combineWithJudge(unconfirmed, unsure).verification).toBe('needs_review');
  });

  it('an unavailable judge neither upgrades nor rejects', () => {
    const review = base({ verification: 'needs_review', reason: 'industry_unconfirmed' });
    expect(combineWithJudge(review, null)).toBe(review);
    const verified = base({});
    expect(combineWithJudge(verified, null)).toBe(verified);
  });

  it('owner ICPs: a rival agency (Dpoint) and an MSP (1CloudHub) are rejected by the judge, a Stormwall mobile operator is kept', () => {
    expect(combineWithJudge(base({ verification: 'needs_review', reason: 'company_type_review' }), no('competitor')).reason).toBe('not_icp_fit:competitor');
    expect(combineWithJudge(base({ verification: 'needs_review', reason: 'industry_unconfirmed' }), no('competitor')).verification).toBe('rejected');
    expect(combineWithJudge(base({}), yes).verification).toBe('verified_fit');
  });
});
