import { describe, expect, it } from 'vitest';
import { assessIcpRulesV2 } from '@telestar/core-scoring/rules/deriveQualification';
import { emptyIcpRulesV2 } from '@telestar/core-scoring/rules/emptyIcpRulesV2';
import { safeValidateIcpVersionRulesV2, type IcpVersionRulesV2 } from '@telestar/core-scoring/rules/schema-v2';

import { normalizeManagerRules } from '@/lib/leadgen/icpManagerRules';
import {
  POINTS_VERDICT_VERSION,
  deriveIcpVerdict,
  starterPointRules,
  verdictVersionFor,
} from '@/lib/leadgen/pointsQualification';
import { ICP_VERDICT_VERSION } from '@/lib/leadgen/weightedQualification';

/**
 * Per-value scoring points — the owner's spec of 2026-10-03: "CEO +30, VP Sales +25, United States
 * +20", thresholds in points, and the existing disqualifiers still fatal.
 */

function telestar(): IcpVersionRulesV2 {
  const rules = emptyIcpRulesV2('points', 'Points');
  rules.geography.targetCountries = ['United States', 'United Kingdom'];
  rules.geography.excludedCountries = ['India'];
  rules.persona.titleDenylist = ['Intern'];
  rules.disqualifiers.genericEmailContact = { disqualify: true };
  rules.pointRules = {
    enabled: true,
    fitAt: 45,
    reviewAt: 25,
    rules: [
      { id: 't1', group: 'title', values: ['CEO', 'Founder'], points: 30 },
      { id: 't2', group: 'title', values: ['VP Sales', 'CRO'], points: 25 },
      { id: 't3', group: 'title', values: ['Director of Sales'], points: 15 },
      { id: 't4', group: 'title', values: ['Assistant'], points: -40 },
      { id: 'c1', group: 'country', values: ['United States'], points: 20 },
      { id: 'c2', group: 'country', values: ['UK', 'Australia'], points: 15 },
      { id: 's1', group: 'size', values: [], minEmployees: 50, maxEmployees: 200, points: 10 },
    ],
  };
  return rules;
}

const lead = (
  title: string | null,
  country: string | null,
  extra: { email?: string; employeeCount?: number } = {}
) => ({
  company: {
    companyName: 'Acme',
    ...(country ? { country } : {}),
    websiteStatus: 'reachable' as const,
    ...(extra.employeeCount != null ? { employeeCount: extra.employeeCount } : {}),
  },
  contact: { ...(title ? { rawTitle: title } : {}), email: extra.email ?? 'jane@acme.io' },
});

const verdictOf = (input: ReturnType<typeof lead>, rules = telestar()) =>
  deriveIcpVerdict(assessIcpRulesV2(input, rules), rules, input);

describe('points add up across groups and count once within one', () => {
  it('CEO in the US is 30 + 20 = 50 → Fit', () => {
    const verdict = verdictOf(lead('CEO', 'United States'));
    expect(verdict.points?.total).toBe(50);
    expect(verdict.qualification).toBe('qualified');
  });

  it('"CEO & Founder" scores the title once, not twice', () => {
    expect(verdictOf(lead('CEO & Founder', 'United States')).points?.total).toBe(50);
  });

  it('counts only the best of two matching rows in one group, not both', () => {
    // "Founder & CRO" matches the CEO/Founder row (+30) and the VP Sales/CRO row (+25). The title is
    // one fact about one person; adding both rows would score it 55.
    const verdict = verdictOf(lead('Founder & CRO', 'United States'));
    expect(verdict.points?.matches.filter((m) => m.group === 'title')).toHaveLength(1);
    expect(verdict.points?.total).toBe(50);
  });

  it('takes the best row of a group: a VP Sales in the UK is 25 + 15', () => {
    const verdict = verdictOf(lead('VP Sales', 'United Kingdom'));
    expect(verdict.points?.total).toBe(40);
    expect(verdict.qualification).toBe('needs_review');
  });

  it('matches country aliases — a "UK" row scores a United Kingdom company', () => {
    expect(verdictOf(lead('CRO', 'United Kingdom')).points?.matches.map((m) => m.matched)).toContain('UK');
  });

  it('adds a negative row next to a positive one', () => {
    // CEO +30, Assistant −40: "Assistant to the CEO" is not the CEO.
    expect(verdictOf(lead('Assistant to the CEO', 'United States')).points?.total).toBe(10);
  });

  it('scores size only inside the range, and only when the headcount is known', () => {
    expect(verdictOf(lead('CRO', 'United Kingdom', { employeeCount: 120 })).points?.total).toBe(50);
    expect(verdictOf(lead('CRO', 'United Kingdom', { employeeCount: 12 })).points?.total).toBe(40);
  });
});

describe('fatal stays fatal, missing stays unknown', () => {
  it('a free-mail contact is No fit whatever its points', () => {
    const verdict = verdictOf(lead('CEO', 'United States', { email: 'jane@gmail.com' }));
    expect(verdict.qualification).toBe('unqualified');
    expect(verdict.reason).toBe('disqualified');
  });

  it('an excluded HQ country and a denied title are No fit', () => {
    expect(verdictOf(lead('CEO', 'India')).qualification).toBe('unqualified');
    expect(verdictOf(lead('Marketing Intern', 'United States')).qualification).toBe('unqualified');
  });

  it('a lead with no title is Review, not No fit, when the title rows could have carried it', () => {
    // 20 for the US is under Review (25), but a title could add up to 30.
    const verdict = verdictOf(lead(null, 'United States'));
    expect(verdict.qualification).toBe('needs_review');
    expect(verdict.missingCoreEvidence).toContain('persona');
  });

  it('a known title that scores nothing, in a non-target country, is No fit', () => {
    expect(verdictOf(lead('Software Engineer', 'Germany')).qualification).toBe('unqualified');
  });

  it('caps a Fit total at Review while the country is unknown', () => {
    const rules = telestar();
    rules.pointRules!.fitAt = 30;
    rules.pointRules!.reviewAt = 10;
    expect(verdictOf(lead('CEO', null), rules).qualification).toBe('needs_review');
  });
});

describe('the rule set', () => {
  it('scores with points only when enabled, and versions the verdict accordingly', () => {
    const rules = telestar();
    expect(verdictVersionFor(rules)).toBe(POINTS_VERDICT_VERSION);
    rules.pointRules!.enabled = false;
    expect(verdictVersionFor(rules)).toBe(ICP_VERDICT_VERSION);
    expect(verdictOf(lead('CEO', 'United States'), rules).points).toBeUndefined();
  });

  it('refuses a Fit threshold at or below Review', () => {
    const rules = telestar();
    rules.pointRules!.fitAt = 20;
    expect(safeValidateIcpVersionRulesV2(rules).success).toBe(false);
  });

  it('keeps the point rules through a save', () => {
    const saved = normalizeManagerRules(telestar());
    expect(saved.pointRules).toEqual(telestar().pointRules);
  });

  it('generates starter points from an ICP\'s own lists', () => {
    const rules = emptyIcpRulesV2('starter', 'Starter');
    rules.persona.titleAllowlist = ['CEO', 'VP Sales'];
    rules.geography.targetCountries = ['Denmark'];
    rules.size.minEmployees = 3;

    const starter = starterPointRules(rules);

    expect(starter.enabled).toBe(true);
    expect(starter.rules.find((r) => r.group === 'title')).toMatchObject({ values: ['CEO', 'VP Sales'], points: 30 });
    expect(starter.rules.find((r) => r.group === 'country')).toMatchObject({ values: ['Denmark'], points: 20 });
    expect(starter.rules.find((r) => r.group === 'size')).toMatchObject({ minEmployees: 3, points: 10 });
    expect(starter.fitAt).toBe(50);
    expect(starter.fitAt).toBeGreaterThan(starter.reviewAt);
    expect(safeValidateIcpVersionRulesV2({ ...rules, pointRules: starter }).success).toBe(true);
  });
});
