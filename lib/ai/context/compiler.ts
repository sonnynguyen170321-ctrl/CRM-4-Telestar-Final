/**
 * Assembles the smallest, highest-value context block a turn needs.
 *
 * ## What this replaced
 *
 * `app/api/ai/chat/route.ts` pushed strings onto an array in whatever order the code ran:
 * page hint, workload counters, end-of-day summary, lead fields, commercial claims. That is
 * fine while the list is short and has two properties that stop being acceptable as it grows —
 * no budget, so the block grows without limit, and no ranking, so when something has to give it
 * is whatever was appended last rather than whatever mattered least.
 *
 * ## What it deliberately does not do
 *
 * **It does not authorize.** Every item handed to it has already passed the authorization
 * governing its source: `loadAuthorizedLeadContext` decided the caller may see that lead,
 * `readClaims` is tenant-scoped, workload metrics are read under the session's own ids. A
 * compiler that filtered by permission would be a second authorization decision sitting beside
 * the real one, and when two disagree the weaker one is the one that matters.
 *
 * Unauthorized information must never reach this function in the first place. That is the
 * invariant; this file is not where it is enforced.
 *
 * ## Why it returns a trace rather than a string
 *
 * Given a wrong answer, the first question is "what was the model actually told". That has to
 * be answerable without re-running anything, so the compiler reports what it included, what it
 * dropped, and why.
 */

/**
 * Priority order, most authoritative first. Taken from the directive's context-budget section.
 *
 * The ordering encodes one judgement: a fact the CRM is certain of outranks something the AI
 * inferred, and both outrank background colour. When the budget binds, the model loses the
 * bottom of this list.
 */
export const CONTEXT_TIER_ORDER = [
  /** CRM records and session identity. True by definition. */
  'authoritative_fact',
  /** The record the user is looking at right now. */
  'current_task_record',
  /** What has happened recently — replies, activity, task state. */
  'recent_interaction',
  /** Sourced commercial claims: someone said it, and we can say where. */
  'commercial_evidence',
  /** Inference and preference. Held with confidence, not certainty. */
  'memory',
  /** Institutional rules for how this work should be done. */
  'playbook',
  /** Everything else worth saying if there is room. */
  'background',
] as const;

export type ContextTier = (typeof CONTEXT_TIER_ORDER)[number];

export interface ContextItem {
  tier: ContextTier;
  /**
   * Stable identity for this fact. Two items with the same key are the same fact, and the
   * first one wins — loaders are allowed to overlap without the model reading a thing twice
   * and mistaking repetition for emphasis.
   */
  key: string;
  text: string;
}

export interface DroppedItem {
  key: string;
  reason: 'budget' | 'duplicate' | 'empty';
}

export interface CompiledContext {
  /** The block to embed, newline-joined. Empty string when nothing survived. */
  text: string;
  /** Keys included, in emitted order. */
  included: string[];
  dropped: DroppedItem[];
  estimatedTokens: number;
}

/**
 * Four characters per token — a rule of thumb for English prose, not a tokenizer.
 *
 * Deliberately not exact. Pulling in a real tokenizer would add a dependency and a model-specific
 * vocabulary to a number used only to decide when to stop appending optional lines. The budget
 * is a soft ceiling on a prose block; the provider's own context limit is what actually protects
 * a request, and that is enforced by the provider.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface CompileOptions {
  /** Soft ceiling for the whole block. Items are dropped from the least important tier up. */
  budgetTokens: number;
}

/**
 * Ranks, deduplicates and budgets a set of context items.
 *
 * Stable within a tier: items keep the order they were added, so lines that belong together —
 * a lead's name, company and stage — stay together and read as one thing.
 */
export function compileContext(items: ContextItem[], options: CompileOptions): CompiledContext {
  const dropped: DroppedItem[] = [];
  const seenKeys = new Set<string>();
  const seenText = new Set<string>();
  const kept: ContextItem[] = [];

  // Rank first, so "which item is dropped when the budget binds" is decided by tier rather than
  // by arrival. `sort` is stable in every engine this runs on, which is what preserves
  // within-tier order.
  const ranked = [...items].sort(
    (a, b) => CONTEXT_TIER_ORDER.indexOf(a.tier) - CONTEXT_TIER_ORDER.indexOf(b.tier),
  );

  for (const candidate of ranked) {
    const text = candidate.text.trim();
    if (!text) {
      dropped.push({ key: candidate.key, reason: 'empty' });
      continue;
    }
    if (seenKeys.has(candidate.key) || seenText.has(text)) {
      dropped.push({ key: candidate.key, reason: 'duplicate' });
      continue;
    }
    seenKeys.add(candidate.key);
    seenText.add(text);
    kept.push({ ...candidate, text });
  }

  // Then spend the budget from the top. Anything that will not fit is dropped rather than
  // truncated: half a fact is worse than no fact, because the model cannot tell it is half.
  const included: ContextItem[] = [];
  let spent = 0;
  for (const candidate of kept) {
    const cost = estimateTokens(candidate.text);
    if (spent + cost > options.budgetTokens) {
      dropped.push({ key: candidate.key, reason: 'budget' });
      continue;
    }
    spent += cost;
    included.push(candidate);
  }

  return {
    text: included.map((i) => i.text).join('\n'),
    included: included.map((i) => i.key),
    dropped,
    estimatedTokens: spent,
  };
}
