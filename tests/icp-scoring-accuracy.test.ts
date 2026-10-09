import { describe, expect, it } from 'vitest';

import { assessIcpRulesV2 } from '@telestar/core-scoring/rules/deriveQualification';
import { emptyIcpRulesV2 } from '@telestar/core-scoring/rules/emptyIcpRulesV2';
import { normalizeCountry } from '@telestar/core-scoring/rules/normalize/normalizeCountry';
import { servicesSignal } from '@telestar/core-scoring/rules/gates/terminalGates';
import { normalizeEvidence } from '@telestar/core-scoring/rules/normalize/index';
import type { IcpVersionRulesV2 } from '@telestar/core-scoring/rules/schema-v2';

import { explainIcp } from '@/lib/leads/explainIcp';
import { assessmentFingerprint, buildScoringEvidence } from '@/lib/leadgen/scorePoolItem';
import { deriveIcpVerdict, verdictVersionFor } from '@/lib/leadgen/pointsQualification';

/**
 * Lead ICP scoring accuracy (owner report, 2026-10-06: "it can score now but still a lot of
 * wrong"). Each case is one production saw: the rule set mirrors the live TeleStar ICPs.
 */

function telestarRules(over: Partial<IcpVersionRulesV2> = {}): IcpVersionRulesV2 {
  const rules = emptyIcpRulesV2('accuracy', 'TeleStar');
  rules.persona = {
    ...rules.persona,
    titleAllowlist: ['Founder', 'CEO', 'COO', 'CRO', 'VP Sales', 'Head of Sales', 'Director of Sales', 'Director of Business Development', 'VP Business Development'],
  };
  rules.geography = {
    ...rules.geography,
    locationScope: 'hq',
    targetCountries: ['USA', 'UK', 'Australia', 'Singapore'],
    excludedCountries: ['India'],
  };
  rules.scorePolicy = { ...rules.scorePolicy, qualifiedMinFitScore: 75, needsReviewMinFitScore: 45 };
  return { ...rules, ...over };
}

function evidenceFor(input: { title?: string; country?: string; industry?: string; summary?: string; employees?: number }) {
  return buildScoringEvidence(
    {
      id: 'lead-1',
      company: 'Acme',
      title: input.title ?? 'CEO',
      email: 'pat@acme.test',
      country: input.country ?? 'United States',
      industry: input.industry ?? 'Software',
      website: 'https://acme.test',
      employeeCount: input.employees ?? 50,
      accountId: 'acc-1',
    } as never,
    input.summary ? { industryCategory: null, facts: [], summary: input.summary } : null
  );
}

const persona = (title: string) => assessIcpRulesV2(evidenceFor({ title }), telestarRules()).dimensionResults.persona.score;
const geo = (country: string) => assessIcpRulesV2(evidenceFor({ country }), telestarRules()).dimensionResults.geo.score;

describe('country', () => {
  it.each([
    ['United Kingdom Uk', 'United Kingdom'],
    ['United Kingdom (UK)', 'United Kingdom'],
    ['United States USA', 'United States'],
    ['USA', 'United States'],
    ['  uk. ', 'United Kingdom'],
    ['U.K.', 'United Kingdom'],
    ['U.S.A.', 'United States'],
    ['United States U.S.A.', 'United States'],
    ['America USA', 'United States'],
    ['Georgia US', 'Georgia US'],
    ['Korea (North)', 'Korea (north)'],
    ['Vietnam (VN)', 'Vietnam'],
    ['United States (USA)', 'United States'],
    ['Germany (DE).', 'Germany'],
    ['Korea (DPRK)', 'Korea (dprk)'],
    ['Congo (Brazzaville)', 'Congo (brazzaville)'],
    ['Korea', 'South Korea'],
    ['Vietnam', 'Vietnam'],
  ])('reads "%s" as %s', (raw, canonical) => {
    expect(normalizeCountry(raw)).toBe(canonical);
  });

  it('matches a lead country against an ICP that spells its targets differently', () => {
    // A "USA" / "UK" target list never met "United States" / "United Kingdom": geo scored 10.
    expect(geo('United States')).toBe(100);
    expect(geo('United Kingdom Uk')).toBe(100);
    expect(geo('U.K.')).toBe(100);
    expect(geo('Germany')).toBe(10);
  });

  it('still excludes an excluded country however it is written, on either side', () => {
    expect(assessIcpRulesV2(evidenceFor({ country: 'india' }), telestarRules()).gates.disqualified).toBe(true);
    const ukOut = telestarRules();
    ukOut.geography = { ...ukOut.geography, excludedCountries: ['UK'] };
    expect(assessIcpRulesV2(evidenceFor({ country: 'United Kingdom' }), ukOut).gates.disqualified).toBe(true);
    expect(assessIcpRulesV2(evidenceFor({ country: 'Germany' }), ukOut).gates.disqualified).toBe(false);
  });
});

describe('title', () => {
  it.each([
    ['Vice President of Sales', 'VP Sales'],
    ['VP, Sales', 'VP Sales'],
    ['Senior Vice President of Sales', 'VP Sales'],
    ['Sales Director', 'Director of Sales'],
    ['Director, Business Development', 'Director of Business Development'],
    ['Chief Executive Officer', 'CEO'],
    ['Co-Founder', 'Founder'],
  ])('reads "%s" as a target role (matches "%s")', (title) => {
    expect(persona(title)).toBe(100);
  });

  it('spells out a compound abbreviation on the ICP side too ("SVP Sales" vs "Senior VP of Sales")', () => {
    const rules = telestarRules();
    rules.persona = { ...rules.persona, titleAllowlist: ['SVP Sales'] };
    expect(assessIcpRulesV2(evidenceFor({ title: 'Senior VP of Sales' }), rules).dimensionResults.persona.score).toBe(100);
  });

  it('keeps the exclusion list exact: word order alone never rules a lead out', () => {
    const rules = telestarRules();
    rules.persona = { ...rules.persona, titleDenylist: ['Marketing Manager'] };
    const assessed = assessIcpRulesV2(evidenceFor({ title: 'Senior Manager, Sales and Marketing' }), rules);
    expect(assessed.dimensionResults.persona.hits.map((h) => h.reasonCode)).not.toContain('persona_title_denylisted');
    expect(assessIcpRulesV2(evidenceFor({ title: 'Marketing Manager' }), rules).dimensionResults.persona.score).toBe(0);
  });

  it('does not spell out a one-word entry into a looser match ("GM")', () => {
    const rules = telestarRules();
    rules.persona = { ...rules.persona, titleAllowlist: ['GM'] };
    expect(assessIcpRulesV2(evidenceFor({ title: 'General Counsel / Sales Manager' }), rules).dimensionResults.persona.score).toBeLessThan(100);
    expect(assessIcpRulesV2(evidenceFor({ title: 'GM, North America' }), rules).dimensionResults.persona.score).toBe(100);
  });

  it.each(['Sales Assistant', 'Vice President, Engineering', 'Managing Director', 'Marketing Manager'])(
    'does not read "%s" as a target role on this list',
    (title) => {
      expect(persona(title)).toBeLessThan(100);
    }
  );
});

describe('services / consulting', () => {
  const rules = (() => {
    const r = telestarRules();
    r.companyType = { ...r.companyType, servicesConsultingPolicy: { disqualify: true, exceptMarkets: [] } };
    return r;
  })();
  const verdictFor = (input: Parameters<typeof evidenceFor>[0]) => {
    const evidence = evidenceFor(input);
    return deriveIcpVerdict(assessIcpRulesV2(evidence, rules), rules, evidence);
  };

  it('sends a lead whose only services signal is the industry label to review, not out', () => {
    const verdict = verdictFor({ industry: 'IT Services and IT Consulting' });
    expect(verdict.qualification).toBe('needs_review');
    expect(verdict.reason).toBe('services_review');
  });

  it('sends a description that mentions consulting to review too — a word is not a classification', () => {
    const verdict = verdictFor({ industry: 'Software', summary: 'A boutique consulting firm for retail brands.' });
    expect(verdict).toMatchObject({ qualification: 'needs_review', reason: 'services_review' });
  });

  it('matches services words as whole words only', () => {
    const n = normalizeEvidence(evidenceFor({ industry: 'Software', summary: 'Teleconsulting platform for clinics.' }));
    expect(servicesSignal(n, rules)).toBe('none');
  });

  it('rules out a company classified as an agency', () => {
    const evidence = evidenceFor({ industry: 'Software' });
    const agency = { ...evidence, company: { ...evidence.company, companyType: 'AGENCY' } } as typeof evidence;
    expect(deriveIcpVerdict(assessIcpRulesV2(agency, rules), rules, agency)).toMatchObject({ qualification: 'unqualified', reason: 'disqualified' });
  });

  it('applies the same review on a points-based ICP', () => {
    const points = {
      ...rules,
      pointRules: {
        enabled: true,
        fitAt: 40,
        reviewAt: 20,
        rules: [
          { id: 'titles', group: 'title', values: ['VP Sales'], points: 30 },
          { id: 'juniors', group: 'title', values: ['Sales Assistant'], points: -40 },
          { id: 'countries', group: 'country', values: ['USA'], points: 20 },
        ],
      },
    } as IcpVersionRulesV2;
    const verdict = (input: Parameters<typeof evidenceFor>[0]) => {
      const evidence = evidenceFor(input);
      return deriveIcpVerdict(assessIcpRulesV2(evidence, points), points, evidence);
    };
    expect(verdict({ title: 'Vice President of Sales', industry: 'Software' })).toMatchObject({ qualification: 'qualified', fitScore: 50 });
    expect(verdict({ title: 'Vice President of Sales', industry: 'IT Services and IT Consulting' })).toMatchObject({ qualification: 'needs_review', reason: 'services_review' });
    // A negative row is an exclusion: it stays exact, so word order does not pull it in.
    expect(verdict({ title: 'Assistant VP, Sales', industry: 'Software' }).points?.total).toBe(50);
  });

  it('applies it when an ICP has nothing positive to score', () => {
    const bare = emptyIcpRulesV2('bare', 'Bare');
    bare.companyType = { ...bare.companyType, servicesConsultingPolicy: { disqualify: true, exceptMarkets: [] } };
    const clean = evidenceFor({ industry: 'Software' });
    const services = evidenceFor({ industry: 'IT Services and IT Consulting' });
    expect(deriveIcpVerdict(assessIcpRulesV2(clean, bare), bare, clean).reason).toBe('exclusions_only_passed');
    expect(deriveIcpVerdict(assessIcpRulesV2(services, bare), bare, services)).toMatchObject({ qualification: 'needs_review', reason: 'services_review' });
  });

  it('leaves services alone where the ICP does not exclude them, or in an excepted market however it is spelled', () => {
    const consultancy = { industry: 'Management Consulting', summary: 'A consulting firm.' };
    const allowAll = { ...rules, companyType: { ...rules.companyType, servicesConsultingPolicy: { disqualify: false, exceptMarkets: [] } } };
    const evidence = evidenceFor(consultancy);
    expect(servicesSignal(normalizeEvidence(evidence), allowAll)).toBe('none');
    expect(servicesSignal(normalizeEvidence(evidence), rules)).toBe('mentioned');

    const vietnam = { ...rules, geography: { ...rules.geography, targetCountries: ['Vietnam'] }, companyType: { ...rules.companyType, servicesConsultingPolicy: { disqualify: true, exceptMarkets: ['Viet Nam'] } } };
    const vnEvidence = evidenceFor({ ...consultancy, country: 'Vietnam' });
    expect(servicesSignal(normalizeEvidence(vnEvidence), vietnam)).toBe('none');
    expect(deriveIcpVerdict(assessIcpRulesV2(vnEvidence, vietnam), vietnam, vnEvidence).qualification).not.toBe('unqualified');
  });

  it('treats a services/agency classification as strong without any keyword', () => {
    const n = normalizeEvidence(evidenceFor({ industry: 'Software' }));
    expect(servicesSignal({ ...n, company: { ...n.company, companyType: 'AGENCY' } }, rules)).toBe('strong');
    expect(servicesSignal(n, rules)).toBe('none');
  });

  it('qualifies a clean software company', () => {
    expect(verdictFor({ industry: 'Software' }).qualification).toBe('qualified');
  });

  it('explains the review in words', () => {
    expect(explainIcp({ fitScore: 90, qualification: 'needs_review', evidenceJson: { verdict: { reason: 'services_review' } } }).headline).toMatch(
      /described with services or consulting words/
    );
  });
});

describe('verdict version', () => {
  it('moved, so a rescore after this change writes a fresh assessment instead of reusing the old one', () => {
    const rules = telestarRules();
    expect(verdictVersionFor(rules)).toBe('weighted-v3');
    expect(verdictVersionFor({ ...rules, pointRules: { ...rules.pointRules, enabled: true } } as IcpVersionRulesV2)).toBe('points-v3');
    const evidence = evidenceFor({});
    expect(assessmentFingerprint(evidence, rules, 'v1')).toBe(assessmentFingerprint(evidence, rules, 'v1'));
    expect(assessmentFingerprint(evidence, rules, 'v1')).not.toBe(assessmentFingerprint(evidence, rules, 'v2'));
  });
});
