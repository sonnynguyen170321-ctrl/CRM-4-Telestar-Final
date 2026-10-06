import type { IcpQualification } from '@prisma/client';
import type { IcpRulesV2Assessment } from '@telestar/core-scoring/rules/deriveQualification';
import type { RawScoringEvidence } from '@telestar/core-scoring/rules/evidence';
import { foldText, normalizeCountry, normalizeEvidence } from '@telestar/core-scoring/rules/normalize/index';
import type { IcpVersionRulesV2, PointRule, PointRuleGroup, PointRules } from '@telestar/core-scoring/rules/schema-v2';
import { titleContainsEntry } from '@telestar/core-scoring/rules/dimensions/personaScore';
import { servicesSignal } from '@telestar/core-scoring/rules/gates/terminalGates';

import {
  ICP_VERDICT_VERSION,
  deriveWeightedIcpQualification,
  type WeightedVerdict,
} from '@/lib/leadgen/weightedQualification';

/**
 * The ICP verdict from per-value points — "CEO +30, United States +20" (owner request, 2026-10-03).
 *
 * Used instead of the dimension weights when an ICP's `pointRules.enabled` is on. The rules:
 *
 *   - **Fatal stays fatal.** Disqualifier gates and the exclusion lists (excluded country, industry,
 *     title) decide before any point is counted. Points cannot buy back a free-mail contact.
 *   - **One row per group.** Within a group the best positive match counts once, and the worst
 *     negative match counts once: "CEO & Founder" is +30, not +60, and "Sales Intern" can carry a
 *     −40 next to a +15. Across groups, points add.
 *   - **Missing data is never a miss.** A lead with no title scores 0 for title, and if the title
 *     rows could have lifted it into Review, it is Review — never No fit for want of data. Missing
 *     country / industry / title also caps the verdict at Review, as under the weighted model.
 *   - **Thresholds are in points** (`fitAt`, `reviewAt`), so they mean what the operator typed.
 *
 * The stored `fitScore` column is clamped to 0–100 because every list and filter reads it as a
 * percentage; the raw total is kept in the assessment's `evidenceJson.verdict.points`.
 */

// v2 (2026-10-06): the engine's country and title matching changed underneath (see ICP_VERDICT_VERSION).
export const POINTS_VERDICT_VERSION = 'points-v2';

export type PointMatch = { ruleId: string; group: PointRuleGroup; points: number; matched: string };

export type IcpVerdict = WeightedVerdict & {
  points?: { total: number; matches: PointMatch[]; fitAt: number; reviewAt: number };
};

/** The verdict rule a rule set is scored under; hashed into the assessment fingerprint. */
export function verdictVersionFor(rules: IcpVersionRulesV2): string {
  return rules.pointRules?.enabled ? POINTS_VERDICT_VERSION : ICP_VERDICT_VERSION;
}

/** One entry point for both models, so no caller can pick the wrong one. */
export function deriveIcpVerdict(
  assessed: IcpRulesV2Assessment,
  rules: IcpVersionRulesV2,
  rawEvidence: RawScoringEvidence
): IcpVerdict {
  if (rules.pointRules?.enabled) return derivePointsVerdict(assessed, rules, rules.pointRules, rawEvidence);
  return deriveWeightedIcpQualification(assessed, rules, rawEvidence);
}

const EXCLUSION_HIT_IDS = new Set(['industry_excluded']);
const EXCLUSION_REASON_CODES = new Set(['persona_title_denylisted', 'persona_seniority_excluded']);
const CORE_GROUPS: ReadonlySet<PointRuleGroup> = new Set(['title', 'country', 'industry']);

const matcherCache = new Map<string, RegExp>();
function wordMatcher(value: string): RegExp {
  const key = foldText(value);
  let re = matcherCache.get(key);
  if (!re) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu');
    matcherCache.set(key, re);
  }
  return re;
}

type Normalized = ReturnType<typeof normalizeEvidence>;

/** The text each group is judged on, or null when the lead has no data for it. */
function subjectOf(group: PointRuleGroup, evidence: Normalized): string | null {
  switch (group) {
    case 'title':
      return evidence.contact?.titlePresent && evidence.contact.rawTitle ? foldText(evidence.contact.rawTitle) : null;
    case 'country':
      return evidence.company.countryKnown && evidence.company.country ? evidence.company.country : null;
    case 'industry': {
      const parts = [
        evidence.company.industryRaw,
        evidence.company.industryCanonical,
        ...evidence.company.industryTags,
      ].filter((part): part is string => Boolean(part));
      return parts.length ? foldText(parts.join(' | ')) : null;
    }
    case 'keyword':
      return evidence.company.evidenceText ? foldText(evidence.company.evidenceText) : null;
    case 'size':
      return evidence.company.employeeCount != null ? String(evidence.company.employeeCount) : null;
  }
}

function ruleMatches(rule: PointRule, subject: string, evidence: Normalized): string | null {
  if (rule.group === 'size') {
    const count = evidence.company.employeeCount;
    if (count == null) return null;
    if (rule.minEmployees != null && count < rule.minEmployees) return null;
    if (rule.maxEmployees != null && count > rule.maxEmployees) return null;
    if (rule.minEmployees == null && rule.maxEmployees == null) return null;
    return `${count} staff`;
  }
  if (rule.group === 'country') {
    return rule.values.find((value) => normalizeCountry(value) === subject) ?? null;
  }
  // Word-set title matching only adds points; a negative row is an exclusion and stays exact.
  return (
    rule.values.find(
      (value) => value.trim() && (wordMatcher(value).test(subject) || (rule.group === 'title' && rule.points > 0 && titleContainsEntry(subject, value)))
    ) ?? null
  );
}

function hasExplicitExclusion(assessed: IcpRulesV2Assessment): boolean {
  return Object.values(assessed.dimensionResults).some((result) =>
    result.hits.some((hit) => EXCLUSION_HIT_IDS.has(hit.id) || EXCLUSION_REASON_CODES.has(hit.reasonCode))
  );
}

export function derivePointsVerdict(
  assessed: IcpRulesV2Assessment,
  rules: IcpVersionRulesV2,
  pointRules: PointRules,
  rawEvidence: RawScoringEvidence
): IcpVerdict {
  const evidence = normalizeEvidence(rawEvidence);
  const groups = new Map<PointRuleGroup, PointRule[]>();
  for (const rule of pointRules.rules) {
    const list = groups.get(rule.group) ?? [];
    list.push(rule);
    groups.set(rule.group, list);
  }

  const matches: PointMatch[] = [];
  const missingCore: PointRuleGroup[] = [];
  // Points the missing groups could still have added: the gap between "No fit" and "we don't know".
  let missingUpside = 0;
  let total = 0;

  for (const [group, groupRules] of groups) {
    const subject = subjectOf(group, evidence);
    if (subject == null) {
      if (CORE_GROUPS.has(group)) missingCore.push(group);
      missingUpside += Math.max(0, ...groupRules.map((rule) => rule.points));
      continue;
    }
    let bestPositive: PointMatch | null = null;
    let worstNegative: PointMatch | null = null;
    for (const rule of groupRules) {
      const matched = ruleMatches(rule, subject, evidence);
      if (!matched) continue;
      const match = { ruleId: rule.id, group, points: rule.points, matched };
      if (rule.points >= 0 && (!bestPositive || rule.points > bestPositive.points)) bestPositive = match;
      if (rule.points < 0 && (!worstNegative || rule.points < worstNegative.points)) worstNegative = match;
    }
    for (const match of [bestPositive, worstNegative]) {
      if (!match) continue;
      matches.push(match);
      total += match.points;
    }
  }

  const { fitAt, reviewAt } = pointRules;
  const missingCoreEvidence = missingCore.map((group) =>
    group === 'title' ? 'persona' : group === 'country' ? 'geo' : 'industry'
  ) as WeightedVerdict['missingCoreEvidence'];
  const verdict = (qualification: IcpQualification, reason: IcpVerdict['reason']): IcpVerdict => ({
    qualification,
    fitScore: Math.max(0, Math.min(100, Math.round(total))),
    reason,
    scoredDimensions: [],
    missingCoreEvidence,
    points: { total, matches, fitAt, reviewAt },
  });

  if (assessed.gates.disqualified) return verdict('unqualified', 'disqualified');
  if (hasExplicitExclusion(assessed)) return verdict('unqualified', 'explicit_exclusion');

  if (total >= fitAt) {
    if (missingCore.length) return verdict('needs_review', 'core_evidence_missing');
    // Same rule as the weighted path: services words alone are for a person to judge.
    if (servicesSignal(evidence, rules) === 'mentioned') return verdict('needs_review', 'services_review');
    return verdict('qualified', 'weighted_qualified');
  }
  if (total >= reviewAt) return verdict('needs_review', 'weighted_borderline');
  if (total + missingUpside >= reviewAt) return verdict('needs_review', 'core_evidence_missing');
  return verdict('unqualified', 'weighted_below_threshold');
}

/**
 * Starter point rules from an ICP's existing lists, so an operator adjusts numbers instead of
 * retyping thirteen titles and ten countries. Every accepted title +30, every target country +20,
 * every target industry +10, the employee range +10, every excluded title −40 (the exclusion list
 * already makes those fatal; the row makes the reason visible in the points view).
 */
export function starterPointRules(rules: IcpVersionRulesV2): PointRules {
  const rows: PointRule[] = [];
  const titles = Array.from(new Set(rules.persona.titleAllowlist.map((t) => t.trim()).filter(Boolean)));
  if (titles.length) rows.push({ id: 'title-buyers', group: 'title', values: titles, points: 30 });
  const countries = Array.from(new Set(rules.geography.targetCountries.map((c) => c.trim()).filter(Boolean)));
  if (countries.length) rows.push({ id: 'country-targets', group: 'country', values: countries, points: 20 });
  const industries = Array.from(new Set(rules.industry.targetIndustries.map((i) => i.trim()).filter(Boolean)));
  if (industries.length) rows.push({ id: 'industry-targets', group: 'industry', values: industries, points: 10 });
  if (rules.size.minEmployees != null || rules.size.maxEmployees != null) {
    rows.push({
      id: 'size-range',
      group: 'size',
      values: [],
      ...(rules.size.minEmployees != null ? { minEmployees: rules.size.minEmployees } : {}),
      ...(rules.size.maxEmployees != null ? { maxEmployees: rules.size.maxEmployees } : {}),
      points: 10,
    });
  }
  const denied = Array.from(new Set(rules.persona.titleDenylist.map((t) => t.trim()).filter(Boolean)));
  if (denied.length) rows.push({ id: 'title-excluded', group: 'title', values: denied, points: -40 });

  // A lead matching the title and country rows is a Fit; either alone is worth a look.
  const fitAt = Math.max(1, (titles.length ? 30 : 0) + (countries.length ? 20 : 0)) || 30;
  const reviewAt = Math.max(0, Math.min(fitAt - 1, 20));
  return { enabled: true, rules: rows, fitAt, reviewAt };
}
