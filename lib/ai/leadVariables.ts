/**
 * The AI merge variables ({{ai.icebreaker}} ...): request checks, the prompt, and the parsing of the
 * model's answer. Nothing here calls a provider or reads the database; the route does both.
 *
 * The standard is the one lib/ai/leadEnrichment.ts set: use only the facts given, say nothing rather
 * than invent, and an empty variable is a true statement (it renders as its fallback and the composer
 * warns). A key the model could not ground in a fact is left out, not filled.
 */

import { z } from 'zod';

import { AI_VARIABLE_KEYS, type AiVariableKey } from '@/lib/templates/render';
import { MAX_AI_VARIABLE_LENGTH, sanitizeAiVariableValue, type AiVariables } from '@/lib/leads/aiVariablesShape';
import { MAX_INSTRUCTION_LENGTH } from '@/lib/ai/leadEnrichment';

export { buildInstructionBlock } from '@/lib/ai/leadEnrichment';

const valuesSchema = z
  .object(Object.fromEntries(AI_VARIABLE_KEYS.map((key) => [key, z.string().max(MAX_AI_VARIABLE_LENGTH * 2).optional()])))
  .strict();

export const generateVariablesRequestSchema = z.object({
  leadId: z.string().min(1, 'leadId is required'),
  instruction: z
    .string()
    .trim()
    .max(MAX_INSTRUCTION_LENGTH, `Instruction must be ${MAX_INSTRUCTION_LENGTH} characters or fewer`)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

/** A rep's hand edit of the saved variables: only known keys, each bounded. */
export const saveVariablesRequestSchema = z.object({
  leadId: z.string().min(1, 'leadId is required'),
  values: valuesSchema,
});

export const VARIABLES_SYSTEM_PROMPT = `You prepare personalization lines for ONE B2B cold email. You are given everything the CRM knows about the prospect.

Hard rules - breaking any of them makes the output unusable:
- Use ONLY the facts provided. Never invent customers, case studies, results, numbers, funding, news, tools, events or technology the company uses.
- If a field cannot be written from the facts given, OMIT its key. An omitted key is correct; a guess is not.
- Never claim to have seen, read, watched or noticed anything the facts do not say. No "I saw your post", no "congrats on".
- Each value is plain text on one line, under 40 words, peer-to-peer, no greetings, no sign-off, no quotation marks, no markup, no curly braces.
- Write in English unless the rep instruction asks for another language.

Keys (all optional):
- icebreaker: one opening sentence tied to one provided fact about the company or the role.
- painPoint: a likely friction for this role, phrased as likely ("teams like yours often"), never as a fact about this company.
- valueProp: one sentence on how we could help, only from the campaign and company facts given.
- companySummary: 1 sentence on what the company does, only from the facts.
- whyNow: a reason to reach out now, ONLY if a provided fact is timely; otherwise omit.
- personalLine: one sentence referring to the person's role or background, only from the facts.

Output valid JSON with only those keys, e.g. { "icebreaker": "...", "painPoint": "..." }.`;

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed: unknown = JSON.parse(cleaned);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The model's variables, cleaned. Null when there is no usable object or nothing survived cleaning. */
export function parseVariablesOutput(raw: string): AiVariables | null {
  const parsed = parseJsonObject(raw);
  if (!parsed) return null;
  const out: AiVariables = {};
  for (const key of AI_VARIABLE_KEYS as readonly AiVariableKey[]) {
    const clean = sanitizeAiVariableValue(parsed[key]);
    if (clean) out[key] = clean;
  }
  return Object.keys(out).length > 0 ? out : null;
}
