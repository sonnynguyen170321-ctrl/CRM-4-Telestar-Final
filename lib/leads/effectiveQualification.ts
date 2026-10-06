import type { Prisma } from '@prisma/client';

/**
 * The qualification the CRM acts on (owner decision, 2026-10-06): a person's verdict, recorded
 * after reviewing the lead, wins over the computed ICP verdict wherever qualification is read —
 * list filters, counts, chips. The computed verdict stays visible beside it, and a later rescore
 * never overwrites the person's (it only moves `icpQualification`); when the two disagree the
 * drawer says what the score now says.
 *
 * Every reader goes through here. A place that reads `icpQualification` directly would show the
 * computed verdict after a rep had overruled it — `tests/lead-qualification-review.test.ts` pins
 * the consumers. Browser-safe: the Prisma import is types only.
 */

export type Qualification = 'qualified' | 'needs_review' | 'unqualified';

export type EffectiveQualification = {
  value: Qualification | null;
  source: 'human' | 'computed' | 'none';
  /** The ICP score's own verdict, whatever a person decided. */
  computed: Qualification | null;
  /** A person decided, and the current score says something else. */
  disagrees: boolean;
};

export function effectiveQualification(lead: {
  qualificationOverride?: Qualification | null;
  icpQualification?: Qualification | null;
}): EffectiveQualification {
  const computed = lead.icpQualification ?? null;
  const human = lead.qualificationOverride ?? null;
  if (human) return { value: human, source: 'human', computed, disagrees: computed !== null && computed !== human };
  return { value: computed, source: computed ? 'computed' : 'none', computed, disagrees: false };
}

/** Leads whose effective qualification is `q`: a person's verdict, or the score where there is none. */
export function qualificationWhere(q: Qualification): Prisma.LeadWhereInput {
  return { OR: [{ qualificationOverride: q }, { qualificationOverride: null, icpQualification: q }] };
}
