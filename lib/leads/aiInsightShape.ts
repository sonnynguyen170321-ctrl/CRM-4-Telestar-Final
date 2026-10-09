/**
 * The shape of the lead drawer's saved AI result (table LeadAiInsight), and the checks that keep a
 * bad row from reaching the drawer. Here rather than in lib/ai: the store is CRM code, and CRM code
 * must not depend on the optional AI layer (tests/ai-optional.test.ts). lib/ai builds on this.
 */

import { z } from 'zod';

const MAX_SUBJECT_LENGTH = 200;
const MAX_BODY_LENGTH = 4000;

export interface LeadEnrichmentResponse {
  companySummary: string;
  industryFocus: string;
  /** Always empty: no longer generated (it was invented). Kept so older clients do not break. */
  estimatedTechStack: string[];
  grounding?: { usedResearch: boolean; researchedFacts: number; hasTitle: boolean; hasNotes: boolean };
  keyPainPoints: string[];
  icebreakers: Array<{ id: string; style: string; hook: string; rationale: string }>;
}

export interface LeadEmailDraft {
  subject: string;
  body: string;
}

const text = (max: number) => z.string().trim().max(max);

/**
 * The hooks answer, checked field by field. It is saved and re-rendered on every drawer open, so a
 * wrong type (a string where a list belongs, a null icebreaker) must be refused — not render once
 * and then crash the drawer for that lead from then on.
 */
const hooksSchema = z.object({
  companySummary: text(2000).pipe(z.string().min(1)),
  industryFocus: text(200).default(''),
  estimatedTechStack: z.array(text(100)).max(20).default([]),
  keyPainPoints: z.array(text(300)).max(10).default([]),
  icebreakers: z
    .array(z.object({ id: text(80), style: text(120), hook: text(1000), rationale: text(600) }))
    .max(10),
  grounding: z
    .object({ usedResearch: z.boolean(), researchedFacts: z.number(), hasTitle: z.boolean(), hasNotes: z.boolean() })
    .optional(),
});

export const draftSchema = z.object({
  subject: z
    .string()
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(1).max(MAX_SUBJECT_LENGTH)),
  body: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1).max(MAX_BODY_LENGTH)),
});

/** A hooks result, or null when it does not have the shape the drawer renders. */
export function readStoredHooks(value: unknown): LeadEnrichmentResponse | null {
  const result = hooksSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** A draft, or null when it has no valid subject and body. */
export function readStoredDraft(value: unknown): LeadEmailDraft | null {
  const result = draftSchema.safeParse(value);
  return result.success ? result.data : null;
}
