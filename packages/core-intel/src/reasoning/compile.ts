import "server-only";

import type { CompanyIntelligenceReasoning, ReasoningEngine, ReasoningInput } from "./contract";
import { HybridReasoningEngine } from "./hybridEngine";
import { compileBrief } from "./brief";

// CINT3: top-level company-intelligence compiler. Runs the (hybrid) reasoning engine
// over the evidence bundle and produces the persistable result: the reasoning
// contract + the one-line brief + controlled tokens. CINT4 maps this onto the
// existing profile JSON columns (companySummary / classificationJson /
// evidenceItemsJson / factsJson / confidenceJson / sourceCoverageJson) and wires it
// into scoring. Engine is injectable so a future stronger AI swaps in here only.

export type CompiledCompanyIntelligence = {
  reasoning: CompanyIntelligenceReasoning;
  brief: string;
  controlledTokens: string[];
};

export async function compileCompanyIntelligence(
  input: ReasoningInput,
  options: { engine?: ReasoningEngine } = {}
): Promise<CompiledCompanyIntelligence> {
  const engine = options.engine ?? new HybridReasoningEngine();
  const reasoning = await engine.reason(input);
  const brief = compileBrief(reasoning, input.companyName);
  return { reasoning, brief, controlledTokens: reasoning.controlledTokens };
}
