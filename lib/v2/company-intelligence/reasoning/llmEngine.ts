import "server-only";

import { createHash } from "node:crypto";

import { runAiCompletion } from "../../ai/runAiCompletion";
import { getAiSettings, getProviderKey } from "../../ai/settings";
import type { AiProviderKind } from "../../ai/types";
import { COMPANY_INTEL_PIPELINE_VERSION } from "../pipelineVersion";
import {
  emptyReasoning,
  type CompanyIntelligenceReasoning,
  type ReasoningEngine,
  type ReasoningInput,
} from "./contract";
import { HybridReasoningEngine } from "./hybridEngine";
import { buildEvidenceIndex, buildLlmPrompt, LLM_SYSTEM_PROMPT, parseLlmReasoning } from "./llmPrompt";
import { RuleReasoningEngine } from "./ruleEngine";

// AI3: the LLM reasoning engine. Implements the SAME contract as the rule engine, so
// HybridReasoningEngine merges it field-by-field and scoring/UI stay untouched. The
// call goes through runAiCompletion, which enforces the never-forced gate (enabled /
// mode / daily budget / rate limit) — a skip or error degrades to rules-only.

// The completion seam: production wraps runAiCompletion; the golden test injects a
// deterministic stub (no live API).
export type LlmComplete = (args: {
  organizationId: string;
  prompt: string;
  system: string;
  provider?: AiProviderKind;
  modelId?: string;
  companyId?: string | null;
  uncertain?: boolean;
}) => Promise<{ ok: true; text: string; modelId: string } | { ok: false; reason: string }>;

const defaultComplete: LlmComplete = async (args) => {
  const out = await runAiCompletion({
    organizationId: args.organizationId,
    purpose: "company_intel_reasoning",
    prompt: args.prompt,
    system: args.system,
    uncertain: args.uncertain ?? true,
    provider: args.provider,
    modelId: args.modelId,
    companyId: args.companyId ?? null,
    maxOutputTokens: 1024,
  });
  if (out.ok) return { ok: true, text: out.text, modelId: out.modelId };
  return { ok: false, reason: out.skipped ? out.reason : out.reason };
};

export type LlmEngineContext = {
  organizationId: string;
  provider?: AiProviderKind;
  modelId?: string;
  companyId?: string | null;
  complete?: LlmComplete;
};

// Process-local idempotent cache: identical evidence + model + pipeline version => the
// same parsed reasoning without a second LLM call (Inv 6 throughput). Bounded LRU-ish.
const reasoningCache = new Map<string, CompanyIntelligenceReasoning>();
const CACHE_MAX = 500;

export function evidenceCacheKey(input: ReasoningInput, modelId: string, pipelineVersion: number): string {
  const shape = {
    company: input.companyName,
    domain: input.canonicalDomain,
    pages: input.pages.map((p) => ({ u: p.url, t: p.pageType, m: p.metaDescription, h: p.headings, x: p.mainText?.slice(0, 2000) ?? null })),
    search: input.searchResults.map((r) => ({ u: r.url, t: r.text })),
  };
  return createHash("sha256").update(`${pipelineVersion}:${modelId}:${JSON.stringify(shape)}`).digest("hex");
}

export class LlmReasoningEngine implements ReasoningEngine {
  readonly id = "llm" as const;
  private readonly complete: LlmComplete;

  constructor(private readonly ctx: LlmEngineContext) {
    this.complete = ctx.complete ?? defaultComplete;
  }

  async reason(input: ReasoningInput): Promise<CompanyIntelligenceReasoning> {
    const index = buildEvidenceIndex(input);
    if (index.list.length === 0) return emptyReasoning(COMPANY_INTEL_PIPELINE_VERSION, "llm");

    const modelKey = this.ctx.modelId ?? this.ctx.provider ?? "default";
    const cacheKey = evidenceCacheKey(input, modelKey, COMPANY_INTEL_PIPELINE_VERSION);
    const cached = reasoningCache.get(cacheKey);
    if (cached) return cached;

    const prompt = buildLlmPrompt(input, index);
    const result = await this.complete({
      organizationId: this.ctx.organizationId,
      prompt,
      system: LLM_SYSTEM_PROMPT,
      provider: this.ctx.provider,
      modelId: this.ctx.modelId,
      companyId: this.ctx.companyId ?? null,
      uncertain: true,
    });

    if (!result.ok) {
      // Skip/error => empty (rules-only via hybrid). Not cached (transient).
      return emptyReasoning(COMPANY_INTEL_PIPELINE_VERSION, "llm");
    }

    const reasoning = parseLlmReasoning(result.text, index, COMPANY_INTEL_PIPELINE_VERSION);
    cachePut(cacheKey, reasoning);
    return reasoning;
  }
}

function cachePut(key: string, value: CompanyIntelligenceReasoning): void {
  if (reasoningCache.size >= CACHE_MAX) {
    const oldest = reasoningCache.keys().next().value;
    if (oldest) reasoningCache.delete(oldest);
  }
  reasoningCache.set(key, value);
}

/** Build the hybrid engine with the LLM slot enabled when AI is on for this org and a
 *  provider key is present; otherwise return undefined so the caller uses the default
 *  rules-only hybrid. The precise budget / uncertainty gate runs per-call in
 *  runAiCompletion — this is the coarse "is the LLM even available" check. */
export async function selectReasoningEngine(organizationId: string): Promise<ReasoningEngine | undefined> {
  const settings = await getAiSettings(organizationId);
  if (!settings.enabled || settings.mode === "OFF") return undefined;
  if (getProviderKey(settings.provider) === null) return undefined;
  const llm = new LlmReasoningEngine({
    organizationId,
    provider: settings.provider,
    modelId: settings.defaultModelId ?? undefined,
  });
  return new HybridReasoningEngine(new RuleReasoningEngine(), llm, { llmEnabled: true });
}
