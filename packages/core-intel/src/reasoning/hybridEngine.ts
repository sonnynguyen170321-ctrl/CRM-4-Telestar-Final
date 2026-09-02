import "server-only";

import {
  dropUncitedClaims,
  emptyReasoning,
  type CompanyIntelligenceReasoning,
  type Confidence,
  type ReasonedField,
  type ReasoningEngine,
  type ReasoningInput,
} from "./contract";
import { deriveControlledTokens, RuleReasoningEngine } from "./ruleEngine";
import { COMPANY_INTEL_PIPELINE_VERSION } from "../pipelineVersion";

// CINT3: hybrid reasoning. Rules run first; the LLM engine is a PLUGGABLE slot that
// only fires on low-confidence/gap fields (cost-capped). The LLM is disabled by
// default this phase (DisabledLlmEngine => hybrid == rules), so no live LLM call is
// added now — a future stronger AI just implements ReasoningEngine and is injected
// here, with scoring/UI untouched (engine-agnostic contract).

export class DisabledLlmEngine implements ReasoningEngine {
  readonly id = "llm" as const;
  async reason(_input: ReasoningInput): Promise<CompanyIntelligenceReasoning> {
    return emptyReasoning(COMPANY_INTEL_PIPELINE_VERSION, "llm");
  }
}

const RANK: Record<Confidence, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

export class HybridReasoningEngine implements ReasoningEngine {
  readonly id = "hybrid" as const;
  constructor(
    private readonly rules: ReasoningEngine = new RuleReasoningEngine(),
    private readonly llm: ReasoningEngine = new DisabledLlmEngine(),
    private readonly options: { llmEnabled?: boolean } = {}
  ) {}

  async reason(input: ReasoningInput): Promise<CompanyIntelligenceReasoning> {
    const base = await this.rules.reason(input);

    const hasGaps =
      base.overallConfidence !== "HIGH" ||
      base.offering.confidence === "LOW" ||
      base.businessModel.confidence === "LOW";

    if (!this.options.llmEnabled || this.llm instanceof DisabledLlmEngine || !hasGaps) {
      return { ...base, engineTrace: { ...base.engineTrace, engine: "hybrid", llmUsed: false } };
    }

    let refined: CompanyIntelligenceReasoning;
    try {
      refined = await this.llm.reason(input);
    } catch {
      return { ...base, engineTrace: { ...base.engineTrace, engine: "hybrid", llmUsed: false, notes: [...base.engineTrace.notes, "llm_error"] } };
    }

    const merged = mergeReasoning(base, refined);
    const cleaned = dropUncitedClaims({
      ...merged,
      engineTrace: {
        ...merged.engineTrace,
        engine: "hybrid",
        llmUsed: true,
        pipelineVersion: COMPANY_INTEL_PIPELINE_VERSION,
        notes: [...base.engineTrace.notes, "llm_merged"],
      },
    });
    // The LLM may have upgraded offering/model/channels — recompute the controlled
    // tokens (scoring vocabulary) from the cleaned result so factsJson reflects them.
    // Reuse the taxonomy id the rule engine already resolved (carried in its tokens).
    const taxonomyId = base.controlledTokens.find((t) => t.startsWith("category."))?.slice("category.".length) ?? null;
    cleaned.controlledTokens = deriveControlledTokens(cleaned, taxonomyId, input.companyName);
    return cleaned;
  }
}

// Field-level merge: keep the higher-confidence cited answer. LLM only wins where it
// is strictly more confident AND grounded. Signals/partnerships union (dedupe).
function mergeReasoning(
  base: CompanyIntelligenceReasoning,
  llm: CompanyIntelligenceReasoning
): CompanyIntelligenceReasoning {
  const better = <T>(a: ReasonedField<T>, b: ReasonedField<T>): ReasonedField<T> =>
    b.evidence.length > 0 && RANK[b.confidence] > RANK[a.confidence] ? b : a;

  const partnerships = [...base.partnerships];
  const seen = new Set(partnerships.map((p) => p.name.toLowerCase()));
  for (const p of llm.partnerships) {
    if (p.evidence.length > 0 && !seen.has(p.name.toLowerCase())) {
      seen.add(p.name.toLowerCase());
      partnerships.push(p);
    }
  }

  const signals = [...base.growth.signals];
  for (const s of llm.growth.signals) if (s.evidence.length > 0 && !signals.some((x) => x.kind === s.kind && x.detail === s.detail)) signals.push(s);

  const offering = better(base.offering, llm.offering);
  const businessModel = better(base.businessModel, llm.businessModel);
  const channels = better(base.channels, llm.channels);
  const hiring = better(base.growth.hiring, llm.growth.hiring);

  const overallConfidence: Confidence =
    RANK[llm.overallConfidence] > RANK[base.overallConfidence] && llm.evidenceQuality.usefulPages > 0
      ? llm.overallConfidence
      : base.overallConfidence;

  return {
    offering,
    businessModel,
    channels,
    growth: { hiring, signals },
    partnerships,
    overallConfidence,
    evidenceQuality: base.evidenceQuality,
    controlledTokens: base.controlledTokens, // recomputed by caller if engine changed fields
    engineTrace: base.engineTrace,
  };
}
