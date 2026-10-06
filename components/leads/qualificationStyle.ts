import type { Qualification } from '@/lib/leads/effectiveQualification';

/**
 * One vocabulary for a lead's qualification wherever it is shown — the leads table chip and the
 * drawer's ICP card used different words ("No fit" / "Not a fit", "ICP review" / "Needs review")
 * and different colours, which reads as two different things.
 */

export const QUALIFICATION_LABEL: Record<Qualification, string> = {
  qualified: 'Qualified',
  needs_review: 'Needs review',
  unqualified: 'Not a fit',
};

/** Light and dark variants: text on a 10% tint must hold contrast in both themes. */
export const QUALIFICATION_CHIP: Record<Qualification, string> = {
  qualified: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
  needs_review: 'bg-brand-gold/10 text-brand-gold-text border-brand-gold/20',
  unqualified: 'bg-brand-red/10 text-brand-red border-brand-red/20',
};

export const QUALIFICATION_BAR: Record<Qualification, string> = {
  qualified: 'bg-green-500',
  needs_review: 'bg-brand-gold',
  unqualified: 'bg-brand-red',
};
