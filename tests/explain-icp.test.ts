import { describe, expect, it } from 'vitest';

import { effectiveQualification, qualificationWhere } from '@/lib/leads/effectiveQualification';
import { explainIcp, type ExplainableAssessment } from '@/lib/leads/explainIcp';
import { isReasonFor, reasonsFor } from '@/lib/leads/qualificationReasons';

/**
 * The drawer's explanation of an ICP verdict (owner request, 2026-10-06). The fixtures follow the
 * two evidence shapes stored on production — with a `verdict` block, and the older one without —
 * with made-up values.
 */

const RULES: ExplainableAssessment['rulesSummary'] = {
  scorePolicy: { qualifiedMinFitScore: 75, needsReviewMinFitScore: 45 },
  titleAllowlist: ['Founder', 'CEO', 'COO', 'VP Sales', 'Head of Sales'],
  targetCountries: ['United States', 'United Kingdom', 'Australia'],
  excludedCountries: ['India'],
  minEmployees: 3,
};

function assessment(over: Partial<ExplainableAssessment> & { sub: Record<string, number>; title?: string; country?: string; employees?: number; reason?: string }): ExplainableAssessment {
  return {
    fitScore: over.fitScore ?? 50,
    qualification: over.qualification ?? 'needs_review',
    evidenceJson: {
      gates: { hits: [], disqualified: false },
      subScores: over.sub,
      ...(over.reason ? { verdict: { reason: over.reason, scoredDimensions: ['geo', 'persona', 'size'], missingCoreEvidence: [] } } : {}),
    },
    inputSnapshot: {
      company: { country: over.country, employeeCount: over.employees },
      contact: { rawTitle: over.title, contactCountry: over.country },
    },
    rulesSummary: RULES,
  };
}

describe('explainIcp', () => {
  it('explains a fit with the threshold it cleared and the checks it passed', () => {
    const result = explainIcp(
      assessment({ fitScore: 100, qualification: 'qualified', reason: 'weighted_qualified', sub: { geo: 100, persona: 100, size: 100 }, title: 'Founder', country: 'Australia', employees: 40 })
    );
    expect(result.headline).toBe('Fits the ICP: 100/100, at or above the 75 needed.');
    expect(result.checks.map((c) => c.status)).toEqual(['pass', 'pass', 'pass']);
    expect(result.checks[0].label).toBe('“Founder” is a target role');
  });

  it('names the role and the country that held a lead back, and lists what the ICP targets', () => {
    const result = explainIcp(
      assessment({ fitScore: 33, qualification: 'unqualified', reason: 'weighted_below_threshold', sub: { geo: 10, persona: 25, size: 100 }, title: 'Managing Director', country: 'New Zealand', employees: 12 })
    );
    expect(result.headline).toBe('Not a fit: 33/100, under the 45 review line — “Managing Director” is not a target role; New Zealand is not a target country.');
    expect(result.checks[0]).toEqual({ status: 'fail', label: '“Managing Director” is not a target role', detail: 'This ICP targets: Founder, CEO, COO, VP Sales, Head of Sales.' });
    expect(result.checks[1].detail).toBe('Targets: United States, United Kingdom, Australia.');
  });

  it('puts a borderline lead between the two lines, with what pulled it down', () => {
    const result = explainIcp(
      assessment({ fitScore: 70, qualification: 'needs_review', reason: 'weighted_borderline', sub: { geo: 10, persona: 100, size: 100 }, title: 'COO', country: 'Malaysia', employees: 25 })
    );
    expect(result.headline).toBe('Worth a look: 70/100 (between 45 and 75) — Malaysia is not a target country.');
  });

  it('says what is missing when it cannot tell, and handles the older evidence shape', () => {
    const result = explainIcp(assessment({ fitScore: 88, qualification: 'needs_review', sub: { geo: 100, persona: 100, size: 50 }, title: 'Founder', country: 'United Kingdom' }));
    expect(result.headline).toBe('Not enough to tell: company size unknown.');
    expect(result.checks.find((c) => c.status === 'unknown')?.label).toBe('Company size unknown');
  });

  it('calls out an excluded country and a missing title', () => {
    const result = explainIcp(assessment({ sub: { geo: 0, persona: 0, size: 100 }, country: 'India', employees: 30 }));
    expect(result.checks).toEqual(
      expect.arrayContaining([
        { status: 'unknown', label: 'No job title on file', detail: 'Add the title to score the role.' },
        { status: 'fail', label: 'India is an excluded country' },
      ])
    );
  });

  it('leads with the rule that ruled a lead out', () => {
    const result = explainIcp({
      fitScore: 0,
      qualification: 'unqualified',
      evidenceJson: { gates: { disqualified: true, hits: [{ reasonCode: 'generic_email_contact', label: 'generic email', evidence: 'gmail.com' }] }, subScores: {} },
      inputSnapshot: { contact: { rawTitle: 'CEO' } },
      rulesSummary: RULES,
    });
    expect(result.headline).toBe('Ruled out: Uses a personal email address.');
    expect(result.checks[0]).toEqual({ status: 'fail', label: 'Uses a personal email address', detail: 'gmail.com' });
  });

  it('never throws on an empty or malformed assessment', () => {
    expect(() => explainIcp({ fitScore: 0, qualification: 'unqualified', evidenceJson: null, inputSnapshot: null, rulesSummary: null })).not.toThrow();
  });
});

describe('effectiveQualification', () => {
  it('lets a person’s verdict win, and says when the score disagrees', () => {
    expect(effectiveQualification({ qualificationOverride: 'qualified', icpQualification: 'unqualified' })).toEqual({
      value: 'qualified',
      source: 'human',
      computed: 'unqualified',
      disagrees: true,
    });
    expect(effectiveQualification({ qualificationOverride: null, icpQualification: 'needs_review' })).toEqual({
      value: 'needs_review',
      source: 'computed',
      computed: 'needs_review',
      disagrees: false,
    });
    expect(effectiveQualification({})).toEqual({ value: null, source: 'none', computed: null, disagrees: false });
  });

  it('filters on the person’s verdict first and the score only where there is none', () => {
    expect(qualificationWhere('qualified')).toEqual({
      OR: [{ qualificationOverride: 'qualified' }, { qualificationOverride: null, icpQualification: 'qualified' }],
    });
  });
});

describe('qualification reasons', () => {
  it('offers only reasons that fit the verdict, and "other" for every verdict', () => {
    expect(isReasonFor('decision_maker_confirmed', 'qualified')).toBe(true);
    expect(isReasonFor('decision_maker_confirmed', 'unqualified')).toBe(false);
    for (const v of ['qualified', 'needs_review', 'unqualified'] as const) {
      expect(reasonsFor(v).map((r) => r.code)).toContain('other');
    }
  });
});
