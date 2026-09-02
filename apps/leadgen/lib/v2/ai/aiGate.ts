import type { AiSettings } from "./types";

// AI1: the pure decision of WHETHER AI may run for a given case. AI is never forced:
// disabled or over-budget => always skip and the caller degrades to deterministic /
// rules-only behavior. Pure (no I/O) so it is unit-testable.

export type AiGateContext = {
  // For company reasoning: is the deterministic result low-confidence / uncertain?
  // UNCERTAIN_ONLY mode fires AI only for these; ALL fires for every case.
  uncertain: boolean;
  creditsUsedToday: number;
};

export type AiCallReason =
  | "ok"
  | "disabled"
  | "mode_off"
  | "not_uncertain"
  | "over_budget";

export type AiGateDecision = {
  allow: boolean;
  reason: AiCallReason;
};

export function decideAiGate(settings: AiSettings, ctx: AiGateContext): AiGateDecision {
  if (!settings.enabled) return { allow: false, reason: "disabled" };
  if (settings.mode === "OFF") return { allow: false, reason: "mode_off" };
  if (settings.mode === "UNCERTAIN_ONLY" && !ctx.uncertain) {
    return { allow: false, reason: "not_uncertain" };
  }
  if (settings.dailyCreditBudget > 0 && ctx.creditsUsedToday >= settings.dailyCreditBudget) {
    return { allow: false, reason: "over_budget" };
  }
  return { allow: true, reason: "ok" };
}

export function creditsRemaining(settings: AiSettings, creditsUsedToday: number): number {
  return Math.max(0, settings.dailyCreditBudget - creditsUsedToday);
}

export function budgetPercentUsed(settings: AiSettings, creditsUsedToday: number): number {
  if (settings.dailyCreditBudget <= 0) return 0;
  return Math.min(100, Math.round((creditsUsedToday / settings.dailyCreditBudget) * 100));
}
