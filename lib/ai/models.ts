/**
 * Model identifiers and their UI labels.
 *
 * Deliberately import-free. The model picker is a Client Component, so anything it
 * imports is bundled for the browser — and `provider.ts` reaches the database through
 * `usage.ts`, which pulls in `async_hooks`, `dns` and `net`. Keeping the constants in a
 * leaf module is what stops a server-only dependency from following them into the client
 * bundle. `tests/ai-optional.test.ts` pins that boundary.
 *
 * Server code may keep importing these from `provider.ts`, which re-exports them.
 */

export type ModelId =
  | 'llama-3.3-70b-versatile'    // ⚡ Smart & Balanced
  | 'llama-3.1-8b-instant'        // 🚀 Ultra Fast
  | 'gemma2-9b-it'                // ✍️ Email & Writing
  | 'gemini-flash-latest';        // 🎨 Creative & Polished

export const MODEL_LABELS: Record<ModelId, string> = {
  'llama-3.3-70b-versatile': '⚡ Smart & Balanced',
  'llama-3.1-8b-instant': '🚀 Ultra Fast',
  'gemma2-9b-it': '✍️ Email & Writing',
  'gemini-flash-latest': '🎨 Creative & Polished',
};

export const MODEL_DESCRIPTIONS: Record<ModelId, string> = {
  'llama-3.3-70b-versatile':
    'Best overall quality. Use for coaching, objection handling, research, and morning briefings.',
  'llama-3.1-8b-instant':
    'Replies in under 1 second. Best for quick questions and creating tasks on the fly.',
  'gemma2-9b-it':
    'Great at following instructions. Best for writing cold emails and LinkedIn messages.',
  'gemini-flash-latest':
    'Google\'s fast multimodal model. Best for creative writing, subject lines, and brainstorming.',
};

export const DEFAULT_MODEL: ModelId = 'llama-3.3-70b-versatile';
