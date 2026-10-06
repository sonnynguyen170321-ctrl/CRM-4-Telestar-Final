import type { Qualification } from './effectiveQualification';

/**
 * Why a person set a lead's qualification (lib/leads/effectiveQualification.ts). Codes, not a
 * database enum, so a new reason needs no migration; the API refuses any code not listed here.
 * Browser-safe: the review form renders these.
 */

export type QualificationReason = { code: string; label: string; verdicts: readonly Qualification[] };

export const QUALIFICATION_REASONS: readonly QualificationReason[] = [
  { code: 'decision_maker_confirmed', label: 'Confirmed decision maker', verdicts: ['qualified'] },
  { code: 'fits_icp_on_review', label: 'Fits the ICP after checking the company', verdicts: ['qualified'] },
  { code: 'expressed_interest', label: 'Showed interest / replied positively', verdicts: ['qualified'] },
  { code: 'title_misread', label: 'Score misread the title', verdicts: ['qualified', 'unqualified'] },
  { code: 'country_misread', label: 'Score misread the country', verdicts: ['qualified', 'unqualified'] },
  { code: 'size_misread', label: 'Company size is wrong', verdicts: ['qualified', 'unqualified'] },
  { code: 'needs_research', label: 'Needs more research', verdicts: ['needs_review'] },
  { code: 'wrong_person', label: 'Not the right person at the company', verdicts: ['unqualified', 'needs_review'] },
  { code: 'not_target_industry', label: 'Not a target industry or business model', verdicts: ['unqualified'] },
  { code: 'services_or_agency', label: 'Services firm, agency or consultancy', verdicts: ['unqualified'] },
  { code: 'too_small', label: 'Company too small', verdicts: ['unqualified'] },
  { code: 'competitor_or_partner', label: 'Competitor or existing partner', verdicts: ['unqualified'] },
  { code: 'company_closed', label: 'Company closed or acquired', verdicts: ['unqualified'] },
  { code: 'other', label: 'Other (explain in the note)', verdicts: ['qualified', 'needs_review', 'unqualified'] },
];

/** The reason a cleared verdict is recorded under. Not offered in the form. */
export const CLEARED_REASON = 'cleared';

export function reasonsFor(verdict: Qualification): QualificationReason[] {
  return QUALIFICATION_REASONS.filter((r) => r.verdicts.includes(verdict));
}

export function isReasonFor(code: string, verdict: Qualification): boolean {
  return reasonsFor(verdict).some((r) => r.code === code);
}

export function reasonLabel(code: string): string {
  if (code === CLEARED_REASON) return 'Verdict cleared — the score applies again';
  return QUALIFICATION_REASONS.find((r) => r.code === code)?.label ?? code;
}
