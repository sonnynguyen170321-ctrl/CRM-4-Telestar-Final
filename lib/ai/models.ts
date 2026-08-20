/**
 * Model identifiers and their UI labels.
 *
 * Deliberately import-free. The model picker is a Client Component, so anything it
 * imports is bundled for the browser — and the server-side AI modules reach the database
 * through `usage.ts`, which pulls in `async_hooks`, `dns` and `net`. Keeping the constants in
 * a leaf module is what stops a server-only dependency from following them into the client
 * bundle. `tests/ai-optional.test.ts` pins that boundary.
 *
 * These ids mirror `lib/ai/registry.ts`, plus `'auto'`. They are duplicated rather than
 * imported for exactly the reason above; `tests/ai-model-registry.test.ts` asserts the two
 * lists stay identical, so the duplication cannot rot.
 */

/** What a user may ask for. `'auto'` means "let the router decide", and is the default. */
export type ModelId =
  | 'auto'
  | 'gpt-5.6-luna'
  | 'gemini-3.6-flash'
  | 'openai/gpt-oss-20b';

/** The three approved production models, without `'auto'`. */
export const SELECTABLE_MODEL_IDS = [
  'gpt-5.6-luna',
  'gemini-3.6-flash',
  'openai/gpt-oss-20b',
] as const satisfies readonly ModelId[];

export const MODEL_LABELS: Record<ModelId, string> = {
  auto: 'Telestar AI · Auto',
  'gpt-5.6-luna': 'GPT-5.6 Luna',
  'gemini-3.6-flash': 'Gemini 3.6 Flash',
  'openai/gpt-oss-20b': 'Groq GPT-OSS 20B',
};

export const MODEL_DESCRIPTIONS: Record<ModelId, string> = {
  auto: 'Recommended. Telestar picks the best available model and fails over automatically.',
  'gpt-5.6-luna':
    'Strongest reasoning. Best for CRM analysis, coaching, meeting prep, and anything using CRM tools.',
  'gemini-3.6-flash':
    'Huge context window. Best for long documents, creative drafting, and subject lines.',
  'openai/gpt-oss-20b':
    'Fastest replies. Best for quick questions and lightweight transformations.',
};

/**
 * Auto, not a specific model.
 *
 * An SDR should not have to know which provider is healthy, and a stored preference for a
 * specific id is how a retired model outlives its retirement: the picker used to default to
 * `llama-3.3-70b-versatile`, and when Groq removed it every chat turn ended in a 404 that the
 * UI reported as "Sorry, I ran into a problem generating that."
 */
export const DEFAULT_MODEL: ModelId = 'auto';

/** True when `value` is a model id this build still recognises. */
export function isKnownModelId(value: unknown): value is ModelId {
  return typeof value === 'string' && value in MODEL_LABELS;
}
