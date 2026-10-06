/**
 * Why a lead got its ICP verdict, in words an SDR can check (owner request, 2026-10-06: "it
 * doesn't show why it qualified that way").
 *
 * Everything here is already stored on the assessment — the sub-scores, the gates, what was
 * missing, the inputs the score read and the thresholds it used. This only turns them into a
 * headline and a short checklist. Pure and browser-safe; it decides nothing. Two evidence shapes
 * exist on production: assessments with a `verdict` block, and older ones with only `reasonCodes`.
 */

export type IcpCheck = {
  status: 'pass' | 'fail' | 'unknown';
  label: string;
  detail?: string;
};

export type IcpExplanation = { headline: string; checks: IcpCheck[] };

export type ExplainableAssessment = {
  fitScore: number;
  qualification: 'qualified' | 'needs_review' | 'unqualified';
  evidenceJson?: unknown;
  inputSnapshot?: unknown;
  rulesSummary?: {
    scorePolicy?: { qualifiedMinFitScore?: number; needsReviewMinFitScore?: number } | null;
    titleAllowlist?: string[];
    targetCountries?: string[];
    excludedCountries?: string[];
    minEmployees?: number | null;
  } | null;
};

type Evidence = {
  subScores?: Record<string, number>;
  gates?: { disqualified?: boolean; hits?: Array<{ label?: string; reasonCode?: string; evidence?: string }> };
  missingEvidence?: string[];
  verdict?: { reason?: string; scoredDimensions?: string[]; missingCoreEvidence?: string[] };
};

type Input = {
  company?: { country?: string; employeeCount?: number; industry?: string };
  contact?: { rawTitle?: string; contactCountry?: string };
};

const PASS_AT = 75;
const UNKNOWN_SCORES = new Set([50]);

function list(items: string[] | undefined, max = 6): string {
  if (!items || items.length === 0) return '';
  const shown = items.slice(0, max).join(', ');
  return items.length > max ? `${shown} and ${items.length - max} more` : shown;
}

function personaCheck(score: number | undefined, input: Input, allow: string[] | undefined): IcpCheck | null {
  const title = input.contact?.rawTitle?.trim();
  if (!title) return { status: 'unknown', label: 'No job title on file', detail: 'Add the title to score the role.' };
  if (score === undefined) return null;
  if (score >= PASS_AT) return { status: 'pass', label: `“${title}” is a target role` };
  return {
    status: 'fail',
    label: `“${title}” is not a target role`,
    detail: allow?.length ? `This ICP targets: ${list(allow, 8)}.` : undefined,
  };
}

function geoCheck(score: number | undefined, input: Input, rules: ExplainableAssessment['rulesSummary']): IcpCheck | null {
  const country = (input.company?.country ?? input.contact?.contactCountry)?.trim();
  if (!country) return { status: 'unknown', label: 'Country unknown', detail: 'Add the company’s country to score location.' };
  if (score === undefined) return null;
  const excluded = rules?.excludedCountries?.some((c) => c.toLowerCase() === country.toLowerCase());
  if (excluded) return { status: 'fail', label: `${country} is an excluded country` };
  if (score >= PASS_AT) return { status: 'pass', label: `${country} is a target country` };
  if (UNKNOWN_SCORES.has(score)) return { status: 'unknown', label: `Could not place “${country}”` };
  return {
    status: 'fail',
    label: `${country} is not a target country`,
    detail: rules?.targetCountries?.length ? `Targets: ${list(rules.targetCountries, 10)}.` : undefined,
  };
}

function sizeCheck(score: number | undefined, input: Input, minEmployees: number | null | undefined): IcpCheck | null {
  const count = input.company?.employeeCount;
  if (!count) return { status: 'unknown', label: 'Company size unknown' };
  if (score === undefined) return null;
  if (score >= PASS_AT) return { status: 'pass', label: `${count} employees` };
  return {
    status: 'fail',
    label: `${count} employees — too small`,
    detail: minEmployees ? `This ICP needs at least ${minEmployees}.` : undefined,
  };
}

const GATE_SENTENCE: Record<string, string> = {
  target_geo_mismatch_explicit: 'Based in an excluded country',
  company_too_small: 'Company too small',
  website_offline: 'Website appears offline',
  services_consulting_based: 'Looks like a services or consulting firm',
  generic_email_contact: 'Uses a personal email address',
  competitor_denylisted: 'On the avoid list',
  project_based: 'Project-based business',
};

export function explainIcp(assessment: ExplainableAssessment): IcpExplanation {
  const evidence = (assessment.evidenceJson ?? {}) as Evidence;
  const input = (assessment.inputSnapshot ?? {}) as Input;
  const rules = assessment.rulesSummary ?? null;
  const sub = evidence.subScores ?? {};
  const fitAt = rules?.scorePolicy?.qualifiedMinFitScore;
  const reviewAt = rules?.scorePolicy?.needsReviewMinFitScore;

  const checks: IcpCheck[] = [];
  for (const hit of evidence.gates?.hits ?? []) {
    const label = (hit.reasonCode && GATE_SENTENCE[hit.reasonCode]) || hit.label || 'Ruled out by a rule';
    checks.push({ status: 'fail', label, detail: hit.evidence || undefined });
  }
  const dimensions = evidence.verdict?.scoredDimensions?.length ? evidence.verdict.scoredDimensions : ['persona', 'geo', 'size'];
  const ordered = ['persona', 'geo', 'size'].filter((d) => dimensions.includes(d) || d in sub);
  for (const dimension of ordered) {
    const check =
      dimension === 'persona'
        ? personaCheck(sub.persona, input, rules?.titleAllowlist)
        : dimension === 'geo'
          ? geoCheck(sub.geo, input, rules)
          : sizeCheck(sub.size, input, rules?.minEmployees);
    if (check) checks.push(check);
  }

  return { headline: headline(assessment, evidence, checks, fitAt, reviewAt), checks };
}

function headline(
  assessment: ExplainableAssessment,
  evidence: Evidence,
  checks: IcpCheck[],
  fitAt: number | undefined,
  reviewAt: number | undefined
): string {
  const score = assessment.fitScore;
  const failing = checks.filter((c) => c.status === 'fail').map((c) => c.label);
  const unknown = checks.filter((c) => c.status === 'unknown').map((c) => c.label.toLowerCase());
  const reason = evidence.verdict?.reason;

  if (evidence.gates?.disqualified || reason === 'explicit_exclusion' || reason === 'disqualified') {
    return `Ruled out: ${failing[0] ?? 'an exclusion rule matched'}.`;
  }
  if (assessment.qualification === 'qualified') {
    return fitAt != null ? `Fits the ICP: ${score}/100, at or above the ${fitAt} needed.` : `Fits the ICP: ${score}/100.`;
  }
  if (assessment.qualification === 'needs_review') {
    if (reason === 'core_evidence_missing' || (failing.length === 0 && unknown.length > 0)) {
      return `Not enough to tell: ${unknown.join(', ') || 'key details are missing'}.`;
    }
    const band = fitAt != null && reviewAt != null ? ` (between ${reviewAt} and ${fitAt})` : '';
    return `Worth a look: ${score}/100${band}${failing.length ? ` — ${failing[0]}` : ''}.`;
  }
  const line = reviewAt != null ? `, under the ${reviewAt} review line` : '';
  return `Not a fit: ${score}/100${line}${failing.length ? ` — ${failing.slice(0, 2).join('; ')}` : ''}.`;
}
