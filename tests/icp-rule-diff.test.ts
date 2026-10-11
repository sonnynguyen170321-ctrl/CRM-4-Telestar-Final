import { describe, expect, it } from 'vitest';
import { emptyIcpRulesV2 } from '@telestar/core-scoring/rules/emptyIcpRulesV2';

import { describeIcpRules, diffIcpRules } from '@/lib/leadgen/icpRuleDiff';
import { describeScoringProblem, hasUnsavedRules } from '@/lib/leadgen/icpScoringProblem';

const base = () => emptyIcpRulesV2('rs', 'ICP');

describe('diffIcpRules', () => {
  it('reports nothing when the rules are identical', () => {
    expect(diffIcpRules(base(), base())).toEqual([]);
  });

  it('names each changed rule in plain language with before and after', () => {
    const before = base();
    const after = base();
    after.persona.titleAllowlist = ['CEO', 'VP Sales'];
    after.geography.targetCountries = ['Vietnam'];
    after.size.minEmployees = 50;
    const changes = diffIcpRules(before, after);
    expect(changes).toEqual(
      expect.arrayContaining([
        { label: 'Accepted buyer titles', before: 'Not set', after: 'CEO, VP Sales' },
        { label: 'Target countries', before: 'Not set', after: 'Vietnam' },
        { label: 'Minimum employees', before: 'Not set', after: '50' },
      ]),
    );
    expect(changes).toHaveLength(3);
  });

  it('with no earlier version lists every rule that is set', () => {
    const after = base();
    after.industry.mode = 'allowlist';
    after.industry.targetIndustries = ['Software'];
    const labels = diffIcpRules(null, after).map((c) => c.label);
    expect(labels).toContain('Industry rule');
    expect(labels).toContain('Target industries');
    expect(labels).not.toContain('Excluded countries');
  });

  it('describes per-value points per group, with sign', () => {
    const rules = base();
    rules.pointRules = {
      enabled: true,
      fitAt: 50,
      reviewAt: 20,
      rules: [
        { id: 'title-1', group: 'title', values: ['CEO'], points: 30 },
        { id: 'title-2', group: 'title', values: ['Intern'], points: -20 },
      ],
    };
    const lines = describeIcpRules(rules);
    expect(lines['Points: title']).toBe('CEO +30; Intern -20');
    expect(lines['Scoring points']).toContain('Fit at 50');
  });
});

describe('describeScoringProblem / hasUnsavedRules', () => {
  it('flags weights that do not add up and a Fit bar under the Review bar', () => {
    const rules = base();
    expect(describeScoringProblem(rules)).toBeNull();
    rules.scoringWeights = { ...rules.scoringWeights, geo: rules.scoringWeights.geo + 5 };
    expect(describeScoringProblem(rules)).toMatch(/add up to 100/);
  });

  it('is only dirty when the editor holds this version and differs from it', () => {
    const rules = base();
    const version = { id: 'v1', rulesJson: base() };
    expect(hasUnsavedRules(rules, 'v1', version)).toBe(false);
    rules.geography.targetCountries = ['VN'];
    expect(hasUnsavedRules(rules, 'v1', version)).toBe(true);
    expect(hasUnsavedRules(rules, 'other', version)).toBe(false);
    expect(hasUnsavedRules(null, 'v1', version)).toBe(false);
  });
});
