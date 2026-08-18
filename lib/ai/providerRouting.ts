import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * One provider router for every AI mode (Revenue AI Phase 8a).
 *
 * `streamChat` and `generateStructured` differ in what they *do* with a provider — one streams a
 * conversation and runs the tool loop, the other wants a bounded tool-less JSON completion. They
 * must not differ in *which* provider runs, or in when a failure becomes a fallback. Phase 8a's
 * first revision proved why: it grew its own `if (GROQ_API_KEY) … else Gemini`, which turned a
 * Groq 429 into a degraded result while `streamChat`, given the same two keys, would have
 * retried on Gemini and succeeded.
 *
 * So availability, client construction, rate-limit classification and the fallback decision live
 * here, and both modes import them.
 */

import { type ModelId } from './models';

export type AiProviderId = 'groq' | 'gemini';

export const GEMINI_FALLBACK_MODEL: ModelId = 'gemini-flash-latest';

export function hasGroq(): boolean {
  return !!process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim().length > 0;
}

export function hasGemini(): boolean {
  return !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0;
}

/** True when at least one provider is configured. */
export function hasAnyProvider(): boolean {
  return hasGroq() || hasGemini();
}

/**
 * Which provider a call starts on.
 *
 * Groq first when configured — it is the primary in `streamChat` and the models the product is
 * tuned against. Null when nothing is configured.
 */
export function primaryProvider(): AiProviderId | null {
  if (hasGroq()) return 'groq';
  if (hasGemini()) return 'gemini';
  return null;
}

/**
 * Rate limiting is the one failure class worth separating: it is a budget signal, not a bug, and
 * it is the condition under which Gemini's separate quota is worth trying.
 */
export function isRateLimitError(err: unknown): boolean {
  if ((err as { status?: number })?.status === 429) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /rate.?limit|\b429\b|tokens per day|\bTPD\b|quota/i.test(msg);
}

/**
 * Whether a failed attempt on `provider` should be retried on the other one.
 *
 * The established policy, stated once: only a rate limit falls back, and only from Groq, and
 * only when Gemini is actually configured. A malformed request or a bad key fails on Gemini too,
 * and retrying it just spends a second call to produce the same error.
 */
export function shouldFallbackToGemini(provider: AiProviderId, err: unknown): boolean {
  return provider === 'groq' && isRateLimitError(err) && hasGemini();
}

export function createGroqClient(): Groq {
  return new Groq({ apiKey: (process.env.GROQ_API_KEY || '').trim() });
}

export function createGeminiClient(): GoogleGenerativeAI {
  return new GoogleGenerativeAI((process.env.GEMINI_API_KEY || '').trim());
}
