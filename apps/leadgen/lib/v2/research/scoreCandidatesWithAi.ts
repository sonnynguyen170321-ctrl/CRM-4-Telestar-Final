import "server-only";

import { getAiSettings, getProviderKey } from "@/lib/v2/ai/settings";
import { getProvider } from "@/lib/v2/ai/providers";
import { DEFAULT_AI_MODELS } from "@/lib/v2/ai/types";
import { buildFitPrompt, parseFitResponse, MAX_CANDIDATES_PER_CALL, type AiFit, type AiFitInput } from "@telestar/core-research/fitPrompt";

// Opt-in AI re-rank layer over the deterministic heuristic. Gated by the org's AI settings +
// provider key + the run's aiFit flag. One batched call scores the batch's candidates for ICP
// fit and pulls a location. ANY failure (disabled, no key, timeout, bad JSON) returns null so
// the caller silently keeps the heuristic score — nothing depends on AI being on. Keys/prompts
// are never logged (Inv 9). Pure prompt/parse live in ./fitPrompt (offline-testable).

export type { AiFit, AiFitInput } from "@telestar/core-research/fitPrompt";
export { buildFitPrompt, parseFitResponse } from "@telestar/core-research/fitPrompt";

/** Live: resolve org AI settings, call the provider, parse. null on any gate/failure. */
export async function scoreCandidatesWithAi(
  organizationId: string,
  input: { kind: "COMPANY" | "CONTACT"; targetSignals: string[]; candidates: AiFitInput[]; aiFit?: boolean }
): Promise<Map<number, AiFit> | null> {
  if (input.candidates.length === 0) return null;
  if (input.aiFit === false) return null;
  try {
    const settings = await getAiSettings(organizationId);
    if (!settings.enabled) return null;
    const apiKey = getProviderKey(settings.provider);
    if (!apiKey) return null;
    const modelId = settings.defaultModelId ?? DEFAULT_AI_MODELS.find((m) => m.provider === settings.provider)?.modelId;
    if (!modelId) return null;

    const provider = getProvider(settings.provider);
    const result = await provider.complete(
      {
        modelId,
        system: "You are a precise B2B prospecting analyst. Respond with JSON only.",
        prompt: buildFitPrompt(input.kind, input.targetSignals, input.candidates),
        maxOutputTokens: 2048,
        temperature: 0.1,
        timeoutMs: 20000,
      },
      apiKey
    );
    const parsed = parseFitResponse(result.text, Math.min(input.candidates.length, MAX_CANDIDATES_PER_CALL));
    return parsed.size > 0 ? parsed : null;
  } catch {
    // Advisory only: never fail the run because AI scoring hiccuped.
    return null;
  }
}
