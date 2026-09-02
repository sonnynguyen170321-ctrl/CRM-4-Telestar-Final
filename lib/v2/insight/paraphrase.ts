import "server-only";

import { getAiSettings, getProviderKey } from "@/lib/v2/ai/settings";
import { getProvider } from "@/lib/v2/ai/providers";
import { DEFAULT_AI_MODELS } from "@/lib/v2/ai/types";
import { buildParaphrasePrompt, distill, parseParaphrase, type ParaphrasePurpose } from "./paraphrasePrompt";

// Server orchestrator: turn raw web/bio text into a concise, SDR-useful line. Uses the org's AI
// provider when enabled (same gate as research AI-fit); otherwise returns the deterministic
// distillation. Never throws, never returns raw multi-paragraph dumps. Keys/prompts never logged.

export { distill } from "./paraphrasePrompt";
export type { ParaphrasePurpose } from "./paraphrasePrompt";

export async function paraphrase(
  organizationId: string,
  input: { purpose: ParaphrasePurpose; text: string | null | undefined; maxChars?: number }
): Promise<string | null> {
  const fallback = distill(input.text, input.maxChars ?? 160);
  if (!input.text || input.text.trim().length < 12) return fallback;
  try {
    const settings = await getAiSettings(organizationId);
    if (!settings.enabled) return fallback;
    const apiKey = getProviderKey(settings.provider);
    if (!apiKey) return fallback;
    const modelId = settings.defaultModelId ?? DEFAULT_AI_MODELS.find((m) => m.provider === settings.provider)?.modelId;
    if (!modelId) return fallback;

    const provider = getProvider(settings.provider);
    const result = await provider.complete(
      {
        modelId,
        system: "You are a concise B2B sales-intelligence writer. One sentence, no fluff.",
        prompt: buildParaphrasePrompt(input.purpose, input.text),
        maxOutputTokens: 120,
        temperature: 0.2,
        timeoutMs: 15000,
      },
      apiKey
    );
    return parseParaphrase(result.text) ?? fallback;
  } catch {
    return fallback;
  }
}
