/**
 * The saved AI merge variables for one lead ({{ai.icebreaker}} and friends): their shape and the
 * clean-up every value goes through, whether the model wrote it or the rep edited it. Here rather
 * than in lib/ai because the store is CRM code, and CRM code must not depend on the optional AI
 * layer (tests/ai-optional.test.ts); lib/ai builds on this.
 */

import { AI_VARIABLE_KEYS, type AiVariableKey } from '@/lib/templates/render';

export type AiVariables = Partial<Record<AiVariableKey, string>>;

export const MAX_AI_VARIABLE_LENGTH = 600;

/**
 * One value, made safe to sit in an email: plain text on one line, no markup, no merge syntax
 * (`{{`, `{a|b}`) that a later render pass could act on, bounded. Anything but a string is empty.
 */
export function sanitizeAiVariableValue(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<[^>]*>/g, ' ')
    // Contact details and links are not personalization: they would be text a model could be talked into
    // planting (a phishing link, someone's number) in an email that carries the rep's name.
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ')
    .replace(/\S+@\S+\.\S+/g, ' ')
    .replace(/(?:\+\d|\b\d)[\d\s().-]{6,}\d/g, ' ')
    .replace(/[<>{}|]/g, ' ')
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_AI_VARIABLE_LENGTH);
}

/** Only the known keys, cleaned, empty ones dropped. A stored row that no longer fits reads as nothing. */
export function readAiVariables(value: unknown): AiVariables {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const out: AiVariables = {};
  for (const key of AI_VARIABLE_KEYS) {
    const clean = sanitizeAiVariableValue(source[key]);
    if (clean) out[key] = clean;
  }
  return out;
}
