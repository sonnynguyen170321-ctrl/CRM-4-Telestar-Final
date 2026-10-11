import type { IcpVersionRulesV2 } from '@telestar/core-scoring/rules/schema-v2';

/**
 * Human-readable view of an ICP rule set, and the difference between two of them.
 *
 * A reviewer approves rules for a whole campaign, so what they read is the plain statement of each
 * rule ("Accepted buyer titles: CEO, VP Sales"), not JSON, and a change reads before -> after.
 * `packages/core-icp` has a summary too, but it reads a different rule shape (`companySize`,
 * `companyTypes`) than the one stored here (`size`, `companyType`), so it would show a stored rule
 * set as empty. This reads the shape the editor writes: the same fields the rule editor shows.
 */

const NONE = 'Not set';

const list = (values: readonly string[] | undefined): string => (values && values.length ? values.join(', ') : NONE);

const INDUSTRY_MODE: Record<string, string> = {
  all: 'Any industry',
  allowlist: 'Must match target industries',
  denylist: 'Exclude listed industries only',
};

const SENIORITY: Record<string, string> = {
  C_LEVEL: 'C-level',
  VP: 'VP',
  DIRECTOR: 'Director',
  MANAGER: 'Manager',
  IC: 'Individual contributor',
};

const yesNo = (value: boolean | undefined): string => (value ? 'On' : 'Off');

const signed = (points: number): string => (points > 0 ? `+${points}` : String(points));

function pointLines(rules: IcpVersionRulesV2): Record<string, string> {
  const points = rules.pointRules;
  if (!points || !points.enabled) return { 'Scoring points': 'Off (dimension weights are used)' };
  const lines: Record<string, string> = {
    'Scoring points': `On: Fit at ${points.fitAt}, Review at ${points.reviewAt}`,
  };
  const byGroup = new Map<string, string[]>();
  for (const rule of points.rules) {
    const label =
      rule.group === 'size'
        ? `${rule.minEmployees ?? 0}-${rule.maxEmployees ?? 'any'} employees`
        : rule.values.join(' / ');
    byGroup.set(rule.group, [...(byGroup.get(rule.group) ?? []), `${label} ${signed(rule.points)}`]);
  }
  for (const [group, rows] of byGroup) lines[`Points: ${group}`] = rows.join('; ');
  return lines;
}

/** Label -> plain-language value, in the order the editor shows them. */
export function describeIcpRules(rules: IcpVersionRulesV2): Record<string, string> {
  const weights = rules.scoringWeights;
  const lines: Record<string, string> = {
    'Target countries': list(rules.geography?.targetCountries),
    'Excluded countries': list(rules.geography?.excludedCountries),
    'Industry rule': INDUSTRY_MODE[rules.industry?.mode] ?? String(rules.industry?.mode ?? NONE),
    'Target industries': list(rules.industry?.targetIndustries),
    'Excluded industries': list(rules.industry?.excludedIndustries),
    'Accepted buyer titles': list(rules.persona?.titleAllowlist),
    'Excluded buyer titles': list(rules.persona?.titleDenylist),
    'Minimum seniority': rules.persona?.seniorityFloor
      ? (SENIORITY[rules.persona.seniorityFloor] ?? rules.persona.seniorityFloor)
      : NONE,
    'Minimum employees': rules.size?.minEmployees != null ? String(rules.size.minEmployees) : NONE,
    'Maximum employees': rules.size?.maxEmployees != null ? String(rules.size.maxEmployees) : NONE,
  };
  if (weights) {
    lines['Weights'] =
      `title ${weights.persona}, country ${weights.geo}, industry ${weights.industry}, size ${weights.size}, type ${weights.companyType}, keywords ${weights.signals}`;
  }
  if (rules.scorePolicy) {
    lines['Fit / Review score'] = `${rules.scorePolicy.qualifiedMinFitScore} / ${rules.scorePolicy.needsReviewMinFitScore}`;
  }
  Object.assign(lines, pointLines(rules));
  lines['No fit on a free email'] = yesNo(rules.disqualifiers?.genericEmailContact?.disqualify);
  lines['No fit when the website is offline'] = yesNo(rules.disqualifiers?.websiteOffline?.disqualify);
  lines['No fit for one-person companies'] = yesNo(rules.disqualifiers?.onePersonCompany?.disqualify);
  lines['No fit for services / consulting'] = yesNo(rules.companyType?.servicesConsultingPolicy?.disqualify);
  return lines;
}

export type IcpRuleChange = { label: string; before: string; after: string };

/**
 * What changed from `before` to `after`. With no `before` (the first version of an ICP) every rule
 * that is set is reported as new, so the reviewer reads the whole rule set instead of an empty diff.
 */
export function diffIcpRules(
  before: IcpVersionRulesV2 | null | undefined,
  after: IcpVersionRulesV2,
): IcpRuleChange[] {
  const next = describeIcpRules(after);
  const previous = before ? describeIcpRules(before) : null;
  const changes: IcpRuleChange[] = [];
  const labels = new Set([...Object.keys(next), ...Object.keys(previous ?? {})]);
  for (const label of labels) {
    const afterValue = next[label] ?? NONE;
    const beforeValue = previous ? (previous[label] ?? NONE) : NONE;
    if (previous ? beforeValue !== afterValue : afterValue !== NONE && afterValue !== 'Off') {
      changes.push({ label, before: beforeValue, after: afterValue });
    }
  }
  return changes;
}
