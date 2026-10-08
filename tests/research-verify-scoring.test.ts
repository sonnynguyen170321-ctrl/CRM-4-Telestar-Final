import { describe, expect, it } from 'vitest';

import { builderParamsToRulesV2, toAccountRules } from '@telestar/core-research/rulesFromParams';
import type { ResearchBuilderParams } from '@telestar/core-research/buildDiscoveryQueries';
import { defaultKindPolicy, resolveKindPolicy, type KindPolicy } from '@telestar/core-research/targetPolicy';
import { COMPANY_KINDS, safeAlias, type CompanyClassificationInput } from '@telestar/core-research/verificationTypes';
import { assessIcpRulesV2 } from '@telestar/core-scoring/rules/deriveQualification';
import { validateIcpVersionRulesV2, type IcpVersionRulesV2 } from '@telestar/core-scoring/rules/schema-v2';

import { deriveIcpVerdict } from '@/lib/leadgen/pointsQualification';
import { buildScoringEvidence } from '@/lib/leadgen/scorePoolItem';
import { scoreClassifiedCandidate } from '@/lib/research/verifyScoring';

/**
 * Research used to score a candidate with its own keyword count, so a school or an analyst firm could
 * outrank a bank, and a candidate and a lead with identical facts disagreed (owner report, 2026-10-08).
 * These pin the scoring half of the fix: one rule set, one verdict, the kind judged before the score.
 *
 * The three ICPs are the owner's own.
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

const STORMWALL = params({
  industries: ['ISP/Telecom', 'Banking', 'E-commerce', 'Gaming'],
  geos: ['Saudi Arabia', 'UAE', 'Turkey', 'Egypt', 'Indonesia', 'Vietnam', 'India', 'Morocco', 'Germany'],
  titles: ['CISO', 'Head of Security'],
  seniority: ['director', 'c-level'],
  companySize: 'exclude very small',
});
const FINGERMIND = params({
  industries: ['Aviation', 'MRO', 'CAMO', 'Part 145'],
  geos: ['Europe', 'Middle East'],
  titles: ['Head of Maintenance'],
});
const SAIGON = params({
  industries: ['Banking', 'Healthcare', 'Financial services'],
  geos: ['New Zealand', 'Germany', 'Australia'],
  companySize: '2-500',
  titles: ['CTO', 'Head of Engineering'],
});

type Icp = { rules: IcpVersionRulesV2; policy: KindPolicy; geoGate: boolean; excludeKeywords: string[] };

function icp(p: ResearchBuilderParams, tweak: (rules: IcpVersionRulesV2) => IcpVersionRulesV2 = (r) => r, stored: unknown = null): Icp {
  const built = builderParamsToRulesV2(p, 'run-1');
  const rules = toAccountRules(tweak(built.rules));
  return { rules, policy: resolveKindPolicy(stored, rules), geoGate: built.geoGate, excludeKeywords: built.excludeKeywords };
}

const stormwall = icp(STORMWALL);
// Saigon Technology sells software development: outsourcing agencies are its competitors.
const saigon = icp(SAIGON, (rules) => ({
  ...rules,
  companyType: { ...rules.companyType, servicesConsultingPolicy: { disqualify: true, exceptMarkets: [] } },
}), { competitorKinds: ['services_agency'] });
const fingermind = icp(FINGERMIND);
// A run that wants operators only: the one way a software vendor is rejected on its kind alone.
const fingermindOperators = icp(FINGERMIND, (r) => r, { targetCompanyKinds: ['operator'] });

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

const RIYAD = { name: 'Riyad Bank', domain: 'riyadbank.com' };

const score = (target: Icp, classification: CompanyClassificationInput, candidate = RIYAD, extra: { keywords?: string[] } = {}) =>
  scoreClassifiedCandidate({ classification, candidate, rules: target.rules, policy: target.policy, rulesKey: 'research:run-1', geoGate: target.geoGate, excludeKeywords: target.excludeKeywords, ...extra });

describe('account rules reach qualified without a contact', () => {
  it('qualifies a company that fits every company dimension, though the ICP has persona rules', () => {
    const withPersona = builderParamsToRulesV2(STORMWALL, 'r').rules;
    expect(withPersona.persona.titleAllowlist.length).toBeGreaterThan(0);
    const evidence = { company: { companyName: 'Riyad Bank', country: 'Saudi Arabia', industry: 'bank', industryTags: ['Banking'], employeeCount: 25498 } };

    const asLead = deriveIcpVerdict(assessIcpRulesV2(evidence, withPersona), withPersona, evidence);
    expect(asLead.qualification).toBe('needs_review');
    expect(asLead.reason).toBe('core_evidence_missing');

    const account = toAccountRules(withPersona);
    const asAccount = deriveIcpVerdict(assessIcpRulesV2(evidence, account), account, evidence);
    expect(asAccount.qualification).toBe('qualified');
  });

  it('points mode: a company reaches qualified on the shifted thresholds, and an unmatched one does not', () => {
    const { rules } = builderParamsToRulesV2(STORMWALL, 'r');
    const pointed = toAccountRules(
      validateIcpVersionRulesV2({
        ...rules,
        pointRules: {
          enabled: true,
          rules: [
            { id: 't', group: 'title', values: ['CISO'], points: 30 },
            { id: 'c', group: 'country', values: ['Saudi Arabia', 'Turkey'], points: 20 },
            { id: 'i', group: 'industry', values: ['Banking'], points: 20 },
          ],
          fitAt: 60,
          reviewAt: 30,
        },
      }),
    );
    expect(pointed.pointRules!.fitAt).toBeGreaterThan(pointed.pointRules!.reviewAt);
    const policy = defaultKindPolicy(pointed);
    const run = (c: CompanyClassificationInput) =>
      scoreClassifiedCandidate({ classification: c, candidate: RIYAD, rules: pointed, policy, rulesKey: 'k' });
    expect(run(classified()).verification).toBe('verified_fit');
    expect(run(classified()).verdict?.points?.total).toBe(40);
    // Wrong country and wrong industry: no points at all.
    const none = run(classified({ hqCountry: 'France', industryText: 'Mining', industryKey: null, whatTheySell: 'Gold and copper mining' }));
    expect(none.verification).toBe('rejected');
    // A known country outside the targets is rejected before the score is read (research fit gate).
    expect(none.reason).toBe('hq_outside_target');
  });
});

describe('agreement with pool and lead scoring', () => {
  const facts: Array<[string, CompanyClassificationInput]> = [
    ['a bank in a target country', classified()],
    ['a bank in a non-target country', classified({ hqCountry: 'France' })],
    ['a bank with no known country', classified({ hqCountry: null })],
    ['a telecom in Turkey', classified({ industryText: 'Telecommunications', industryKey: 'TELECOM', hqCountry: 'Turkey', employeeCount: 900 })],
    ['a miner in a target country', classified({ industryText: 'Mining', industryKey: null, whatTheySell: 'Gold and copper mining', hqCountry: 'Egypt', employeeCount: 400 })],
    ['a tiny gaming studio', classified({ industryText: 'Video games', industryKey: 'GAMING', hqCountry: 'Germany', employeeCount: 4 })],
    ['a miner in a non-target country', classified({ industryText: 'Mining', industryKey: null, whatTheySell: 'Gold and copper mining', hqCountry: 'France', employeeCount: 400 })],
    ['a company with nothing known', classified({ industryText: null, industryKey: null, hqCountry: null, employeeCount: null, whatTheySell: null })],
  ];

  it.each(facts)('gives %s the verdict the pool gives the same facts', (_name, classification) => {
    const research = score(stormwall, classification);

    const item = {
      id: 'pool-1',
      company: RIYAD.name,
      title: null,
      email: null,
      country: classification.hqCountry,
      industry: safeAlias(classification.industryKey) ?? classification.industryText,
      website: `https://${RIYAD.domain}`,
      accountId: null,
      employeeCount: classification.employeeCount,
    };
    const evidence = buildScoringEvidence(item, {
      industryCategory: null,
      facts: classification.industryText ? [classification.industryText] : [],
      summary: classification.whatTheySell,
    });
    const poolVerdict = deriveIcpVerdict(assessIcpRulesV2(evidence, stormwall.rules), stormwall.rules, evidence);

    expect(research.verdict?.qualification).toBe(poolVerdict.qualification);
    expect(research.verdict?.fitScore).toBe(poolVerdict.fitScore);
    expect(research.verdict?.reason).toBe(poolVerdict.reason);
  });
});

describe('kind policy matrix', () => {
  const cases: Array<[string, Icp, CompanyClassificationInput, string, string]> = [
    ['an operator bank', stormwall, classified(), 'verified_fit', 'weighted_qualified'],
    ['an association of banks', stormwall, classified({ companyKind: 'association_nonprofit' }), 'rejected', 'company_type:association_nonprofit'],
    ['a school', stormwall, classified({ companyKind: 'education', industryText: 'Education', industryKey: 'EDUCATION' }), 'rejected', 'company_type:education'],
    ['an analyst firm', stormwall, classified({ companyKind: 'research_analyst' }), 'rejected', 'company_type:research_analyst'],
    ['a job board for an aviation ICP', fingermind, classified({ companyKind: 'directory_marketplace_jobboard' }), 'rejected', 'company_type:directory_marketplace_jobboard'],
    ['a gaming expo', stormwall, classified({ companyKind: 'event', industryText: 'Gaming', industryKey: 'GAMING' }), 'rejected', 'company_type:event'],
    ['an aviation-software vendor for an operators-only run', fingermindOperators, classified({ companyKind: 'software_vendor', industryText: 'Aviation software', industryKey: 'SOFTWARE', hqCountry: 'Germany' }), 'rejected', 'company_type:software_vendor'],
    ['an outsourcing agency for Saigon (a competitor)', saigon, classified({ companyKind: 'services_agency', industryText: 'Software outsourcing', industryKey: 'IT_SERVICES', hqCountry: 'Germany', employeeCount: 120 }), 'rejected', 'competitor:services_agency'],
    ['a wholesaler for a telecom ICP', stormwall, classified({ companyKind: 'reseller_wholesaler', industryText: 'Telecommunications', industryKey: 'TELECOM' }), 'needs_review', 'company_type_review'],
    ['an unclassified kind', stormwall, classified({ companyKind: null }), 'needs_review', 'company_type_review'],
  ];

  it.each(cases)('%s', (_name, target, classification, verification, reason) => {
    const result = score(target, classification);
    expect({ verification: result.verification, reason: result.reason }).toEqual({ verification, reason });
  });

  it('honours a stored kind list: services agencies accepted when the run says so', () => {
    const policy = resolveKindPolicy({ targetCompanyKinds: ['operator', 'services_agency'] }, saigon.rules);
    const agency = classified({ companyKind: 'services_agency', industryText: 'Banking', industryKey: 'BANKING', hqCountry: 'Germany', employeeCount: 120 });
    const result = scoreClassifiedCandidate({ classification: agency, candidate: RIYAD, rules: saigon.rules, policy, rulesKey: 'k' });
    // The kind is no longer the reason; the services gate in the rules still applies to it.
    expect(result.reason).not.toBe('company_type:services_agency');
  });

  it('knows every company kind', () => {
    expect(Object.keys(stormwall.policy).sort()).toEqual([...COMPANY_KINDS].sort());
  });
});

describe('verdict mapping order', () => {
  it('1. a page that is not a company is rejected before anything is scored', () => {
    const result = score(stormwall, classified({ isCompanySite: false, notCompanyReason: 'article', companyKind: null }));
    expect(result).toMatchObject({ verification: 'rejected', reason: 'not_company_site:article', fitScore: null, verdict: null, fingerprint: null });
  });

  it('1b. a non-company page with no reason is "unrelated"', () => {
    expect(score(stormwall, classified({ isCompanySite: false, companyKind: null })).reason).toBe('not_company_site:unrelated');
  });

  it('2. the kind is judged before the gates: a school in an excluded country is a school', () => {
    const rules = { ...stormwall.rules, geography: { ...stormwall.rules.geography, excludedCountries: ['Israel'] } };
    const result = scoreClassifiedCandidate({
      classification: classified({ companyKind: 'education', hqCountry: 'Israel' }),
      candidate: RIYAD,
      rules,
      policy: stormwall.policy,
      rulesKey: 'k',
    });
    expect(result.reason).toBe('company_type:education');
  });

  it('3. an excluded country is a gate, whatever the score would have been', () => {
    const rules = { ...stormwall.rules, geography: { ...stormwall.rules.geography, excludedCountries: ['Israel'] } };
    const result = scoreClassifiedCandidate({
      classification: classified({ hqCountry: 'Israel' }),
      candidate: RIYAD,
      rules,
      policy: stormwall.policy,
      rulesKey: 'k',
    });
    expect(result).toMatchObject({ verification: 'rejected', reason: 'excluded_country' });
    expect(result.assessed?.gates.disqualified).toBe(true);
  });

  it('3b. a competitor domain is a gate', () => {
    const target = icp(params({ ...STORMWALL, excludeDomains: ['riyadbank.com'] }));
    expect(score(target, classified())).toMatchObject({ verification: 'rejected', reason: 'competitor_denylisted' });
  });

  it('3c. an exclude keyword in the industry text rejects on a word match', () => {
    const target = icp(params({ ...STORMWALL, excludeKeywords: ['banking'] }));
    expect(score(target, classified())).toMatchObject({ verification: 'rejected', reason: 'excluded_keyword:banking' });
    // 'bank' is not the word 'banking', and a hit only in what they sell is a mention for a person.
    const bank = icp(params({ ...STORMWALL, excludeKeywords: ['bank'] }));
    expect(score(bank, classified()).verification).not.toBe('rejected');
    const mention = icp(params({ ...STORMWALL, excludeKeywords: ['payments'] }));
    expect(score(mention, classified({ whatTheySell: 'Retail banking and payments' }))).toMatchObject({ verification: 'needs_review', reason: 'excluded_keyword_mention' });
  });

  it('4. wrong industry AND wrong country: the known country rejects it before the score is read', () => {
    const result = score(stormwall, classified({ hqCountry: 'France', industryText: 'Mining', industryKey: null, whatTheySell: 'Gold and copper mining' }));
    expect(result).toMatchObject({ verification: 'rejected', reason: 'hq_outside_target' });
    expect(result.fitScore).toBeLessThan(stormwall.rules.scorePolicy.needsReviewMinFitScore);
  });

  it('5. qualified with confident, wanted-kind classification is verified_fit', () => {
    const result = score(stormwall, classified());
    expect(result).toMatchObject({ verification: 'verified_fit', reason: 'weighted_qualified' });
    expect(result.fitScore).toBeGreaterThanOrEqual(stormwall.rules.scorePolicy.qualifiedMinFitScore);
    expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(result.assessed?.subScores).toBeDefined();
  });

  it('5b. medium confidence still verifies; low confidence goes to review', () => {
    expect(score(stormwall, classified({ confidence: 'medium' })).verification).toBe('verified_fit');
    expect(score(stormwall, classified({ confidence: 'low' }))).toMatchObject({ verification: 'needs_review', reason: 'low_confidence' });
  });

  it('6. a missing country is review, never a rejection', () => {
    expect(score(stormwall, classified({ hqCountry: null }))).toMatchObject({ verification: 'needs_review', reason: 'core_evidence_missing' });
  });

  it('a low-confidence rejection becomes review and says what it would have been', () => {
    const school = score(stormwall, classified({ companyKind: 'education', confidence: 'low' }));
    expect(school).toMatchObject({ verification: 'needs_review', reason: 'low_confidence', downgradedFrom: 'company_type:education' });
    const page = score(stormwall, classified({ isCompanySite: false, notCompanyReason: 'listicle', companyKind: null, confidence: 'low' }));
    expect(page).toMatchObject({ verification: 'needs_review', reason: 'low_confidence', downgradedFrom: 'not_company_site:listicle' });
    expect(score(stormwall, classified()).downgradedFrom).toBeNull();
  });

  it('is deterministic: the same facts give the same fingerprint, and different facts do not', () => {
    const a = score(stormwall, classified());
    expect(score(stormwall, classified()).fingerprint).toBe(a.fingerprint);
    expect(score(stormwall, classified({ employeeCount: 100 })).fingerprint).not.toBe(a.fingerprint);
  });
});

describe('keywords rank and never gate', () => {
  it('matches keywords against what the classifier read, ignoring case and accents', () => {
    const result = score(stormwall, classified({ whatTheySell: 'Retail banking and Núcleo payments' }), RIYAD, {
      keywords: ['payments', 'NUCLEO', 'core banking', 'payments'],
    });
    expect(result.keywordMatches).toEqual(['payments', 'NUCLEO']);
  });

  it.each([
    ['verified', classified()],
    ['review', classified({ hqCountry: null })],
    ['rejected', classified({ companyKind: 'education' })],
    ['below threshold', classified({ hqCountry: 'France', industryText: 'Mining', industryKey: null, whatTheySell: 'Gold and copper mining' })],
  ])('keywords change nothing about a %s candidate', (_name, classification) => {
    const without = score(stormwall, classification);
    const withMatching = score(stormwall, classification, RIYAD, { keywords: ['banking', 'mining', 'education', 'payments', 'security'] });
    const withNone = score(stormwall, classification, RIYAD, { keywords: ['zzz-nothing-matches'] });
    for (const other of [withMatching, withNone]) {
      expect(other.verification).toBe(without.verification);
      expect(other.reason).toBe(without.reason);
      expect(other.fitScore).toBe(without.fitScore);
      expect(other.fingerprint).toBe(without.fingerprint);
    }
    expect(withMatching.keywordMatches.length).toBeGreaterThan(0);
    expect(without.keywordMatches).toEqual([]);
  });

  it('the builder never feeds keywords into the rules', () => {
    const withKeywords = builderParamsToRulesV2(params({ ...STORMWALL, keywords: ['firewall', 'ddos'] }), 'r').rules;
    expect(withKeywords.industry.industryKeywords).toEqual([]);
    expect(withKeywords).toEqual(builderParamsToRulesV2(STORMWALL, 'r').rules);
  });
});

describe('the owner ICPs on real-looking candidates', () => {
  it('FingerMind: an MRO operator is a fit, an aviation-software vendor is not', () => {
    const mro = classified({
      companyKind: 'operator',
      industryText: 'Aircraft maintenance, repair and overhaul (MRO)',
      industryKey: 'OTHER',
      whatTheySell: 'Part 145 line and base maintenance and CAMO for airlines',
      hqCountry: 'Germany',
      employeeCount: 20000,
    });
    const lufthansa = score(fingermind, mro, { name: 'Lufthansa Technik', domain: 'lufthansa-technik.com' });
    expect(lufthansa.verification).not.toBe('rejected');
    const vendor = score(
      fingermind,
      classified({ companyKind: 'software_vendor', industryText: 'Aviation software', industryKey: 'SOFTWARE', hqCountry: 'Germany' }),
      { name: 'AircraftCloud', domain: 'aircraftcloud.com' },
    );
    expect(vendor.verification).toBe('needs_review');
    const operatorsOnly = score(
      fingermindOperators,
      classified({ companyKind: 'software_vendor', industryText: 'Aviation software', industryKey: 'SOFTWARE', hqCountry: 'Germany' }),
      { name: 'AircraftCloud', domain: 'aircraftcloud.com' },
    );
    expect(operatorsOnly).toMatchObject({ verification: 'rejected', reason: 'company_type:software_vendor' });
  });

  it('Saigon Technology: a German bank of 300 staff is a fit; a 30,000-staff bank is off the size range', () => {
    const bank = classified({ hqCountry: 'Germany', employeeCount: 300 });
    expect(score(saigon, bank, { name: 'Muster Bank', domain: 'musterbank.de' }).verification).toBe('verified_fit');
    const fit = score(saigon, bank, { name: 'Muster Bank', domain: 'musterbank.de' });
    const huge = score(saigon, classified({ hqCountry: 'Germany', employeeCount: 30000 }), { name: 'Grossbank', domain: 'grossbank.de' });
    expect(huge.assessed?.subScores.size).toBeLessThan(100);
    expect(huge.fitScore).toBeLessThan(fit.fitScore!);
    // Lead scoring forgives one soft miss (owner, 2026-10-02); research does not, on a headcount it knows —
    // see "research fit gates" below.
    expect(huge).toMatchObject({ verification: 'rejected', reason: 'size_out_of_range' });
  });

  it('Stormwall: a three-person gaming shop is excluded as very small', () => {
    const tiny = score(stormwall, classified({ industryText: 'Video games', industryKey: 'GAMING', hqCountry: 'Germany', employeeCount: 3 }));
    expect(tiny).toMatchObject({ verification: 'rejected', reason: 'one_person_company' });
    // Unknown headcount is not small: it goes to a person, not the bin.
    const unknown = score(stormwall, classified({ industryText: 'Video games', industryKey: 'GAMING', hqCountry: 'Germany', employeeCount: null }));
    expect(unknown.verification).not.toBe('rejected');
  });
});

describe('research fit gates: what the company is known to be, it is held to', () => {
  // Lead scoring is weighted and forgiving on purpose: a lead is a person someone already chose. A research
  // shortlist is the opposite — every off-target company in it is a rep's time. With the weighted rule alone,
  // a Saudi construction firm for a network-security ICP came out "needs review" (fit ~60), and so did a
  // bank in Brazil. Owner, 2026-10-08: the list is wrong too often. Research rejects a company on a fact it
  // knows (with at least medium confidence); a fact it does not know still goes to a person.

  it('rejects a known industry the ICP does not target', () => {
    const builder = classified({ industryText: 'Construction', industryKey: 'CONSTRUCTION', whatTheySell: 'Commercial building contractor' });
    expect(score(stormwall, builder, { name: 'Al Bina', domain: 'albina.sa' })).toMatchObject({ verification: 'rejected', reason: 'industry_not_targeted' });
  });

  it('rejects a known headquarters outside the target countries', () => {
    expect(score(stormwall, classified({ hqCountry: 'Brazil' }), { name: 'Banco X', domain: 'bancox.com.br' })).toMatchObject({
      verification: 'rejected',
      reason: 'hq_outside_target',
    });
  });

  it('rejects a known headcount outside the size range, but only reviews a size band', () => {
    expect(score(saigon, classified({ hqCountry: 'Germany', employeeCount: 30000 })).reason).toBe('size_out_of_range');
    const bandOnly = score(saigon, classified({ hqCountry: 'Germany', employeeCount: null, employeeBand: 'ENTERPRISE' as never }));
    expect(bandOnly.verification).not.toBe('rejected');
  });

  it('does not reject on a fact the classifier only guessed', () => {
    const guessed = score(stormwall, classified({ industryText: 'Construction', industryKey: 'CONSTRUCTION', confidence: 'low' }));
    expect(guessed).toMatchObject({ verification: 'needs_review', reason: 'low_confidence' });
  });

  it('free-text targets (no canonical industry) never reject on industry, whatever the confidence', () => {
    // FingerMind names "Aviation", "MRO", "CAMO", "Part 145" — none is a canonical industry key.
    const bakery = (confidence: 'high' | 'medium') =>
      score(fingermind, classified({ industryText: 'Bakery', industryKey: 'FNB', whatTheySell: 'Bread and pastries', hqCountry: 'Germany', confidence }), {
        name: 'Backhaus',
        domain: 'backhaus.de',
      });
    expect(bakery('high')).toMatchObject({ verification: 'needs_review', reason: 'industry_unconfirmed' });
    expect(bakery('medium')).toMatchObject({ verification: 'needs_review', reason: 'industry_unconfirmed' });
  });

  it('keeps a free-text match a fit: an MRO named in what they sell', () => {
    const mro = classified({ industryText: 'Aviation and Aerospace', industryKey: null, whatTheySell: 'Aircraft MRO and CAMO services (EASA Part 145)', hqCountry: 'Germany', employeeCount: 9000 });
    expect(score(fingermind, mro, { name: 'Lufthansa Technik', domain: 'lufthansa-technik.com' }).verification).toBe('verified_fit');
  });

  it('never rejects on what it does not know', () => {
    const unknown = classified({ industryText: null, industryKey: null, whatTheySell: null, hqCountry: null, employeeCount: null });
    expect(score(stormwall, unknown).verification).toBe('needs_review');
  });
});
