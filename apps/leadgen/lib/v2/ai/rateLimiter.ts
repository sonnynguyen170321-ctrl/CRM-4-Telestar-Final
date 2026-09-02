// AI2: in-memory soft rate limiting (rpm/tpm) per org+provider, plus the pure
// call-resolution decision that folds the AI gate, key presence, and rate state into a
// single verdict. The daily-credit budget lives in decideAiGate (AI1); this adds the
// short-window throttle. Pure + clock-injectable so the smoke can test it without time.

import type { AiCallReason } from "./aiGate";

export type RpmDecision = { ok: boolean; retryAfterMs: number; usedInWindow: number };

type Hit = { at: number; tokens: number };

export class RateLimiterState {
  private windows = new Map<string, Hit[]>();
  constructor(private windowMs = 60_000) {}

  /** Check (and, when allowed, reserve) one request against the rpm/tpm soft limits. */
  check(
    key: string,
    limits: { rpmSoftLimit: number; tpmSoftLimit: number; estTokens?: number },
    now: number
  ): RpmDecision {
    const hits = (this.windows.get(key) ?? []).filter((h) => now - h.at < this.windowMs);
    const reqInWindow = hits.length;
    const tokInWindow = hits.reduce((s, h) => s + h.tokens, 0);
    const est = Math.max(0, limits.estTokens ?? 0);

    const overRpm = limits.rpmSoftLimit > 0 && reqInWindow >= limits.rpmSoftLimit;
    const overTpm = limits.tpmSoftLimit > 0 && tokInWindow + est > limits.tpmSoftLimit;
    if (overRpm || overTpm) {
      const oldest = hits.length ? hits[0].at : now;
      this.windows.set(key, hits);
      return { ok: false, retryAfterMs: Math.max(0, this.windowMs - (now - oldest)), usedInWindow: reqInWindow };
    }
    hits.push({ at: now, tokens: est });
    this.windows.set(key, hits);
    return { ok: true, retryAfterMs: 0, usedInWindow: reqInWindow + 1 };
  }

  reset(): void {
    this.windows.clear();
  }
}

// Runtime singleton (process-local soft throttle; the durable budget gate is in the DB).
export const sharedRateLimiter = new RateLimiterState();

export type AiCallVerdict =
  | { action: "call" }
  | { action: "skip"; reason: AiCallReason | "no_key" | "rate_limited"; retryAfterMs?: number };

/** Pure fold: gate result + key presence + rpm decision -> a single verdict. */
export function resolveAiCall(input: {
  gate: { allow: boolean; reason: AiCallReason };
  keyPresent: boolean;
  rpm: RpmDecision;
}): AiCallVerdict {
  if (!input.gate.allow) return { action: "skip", reason: input.gate.reason };
  if (!input.keyPresent) return { action: "skip", reason: "no_key" };
  if (!input.rpm.ok) return { action: "skip", reason: "rate_limited", retryAfterMs: input.rpm.retryAfterMs };
  return { action: "call" };
}
