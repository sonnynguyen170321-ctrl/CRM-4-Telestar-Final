import "server-only";

import { getAiSettings, getProviderKey } from "@/lib/v2/ai/settings";
import { getProvider } from "@/lib/v2/ai/providers";
import { DEFAULT_AI_MODELS } from "@/lib/v2/ai/types";

// On-demand translate-to-English for a research candidate's harvested evidence (SERP snippets
// are often Vietnamese/other). Uses the org's AI provider (same gate as AI-fit: enabled + key).
// Returns null when AI is unavailable so the UI shows the original text + "translation
// unavailable". Keys/prompts never logged (Inv 9).

export type CandidateTranslation = { name: string | null; snippet: string | null };

export function buildTranslatePrompt(name: string, snippet: string | null): string {
  return [
    "Translate the following B2B prospect fields to natural English.",
    "Keep proper company/person names as-is if already a name; translate descriptive text.",
    'Return ONLY JSON: {"name": "<english>", "snippet": "<english or empty>"}.',
    JSON.stringify({ name, snippet: (snippet ?? "").slice(0, 600) }),
  ].join("\n");
}

export function parseTranslation(text: string): CandidateTranslation {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return { name: null, snippet: null };
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    return {
      name: typeof obj.name === "string" && obj.name.trim() ? obj.name.trim().slice(0, 200) : null,
      snippet: typeof obj.snippet === "string" && obj.snippet.trim() ? obj.snippet.trim().slice(0, 800) : null,
    };
  } catch {
    return { name: null, snippet: null };
  }
}

export async function translateText(
  organizationId: string,
  input: { name: string; snippet: string | null }
): Promise<CandidateTranslation | null> {
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
        system: "You are a professional translator. Respond with JSON only.",
        prompt: buildTranslatePrompt(input.name, input.snippet),
        maxOutputTokens: 1024,
        temperature: 0,
        timeoutMs: 20000,
      },
      apiKey
    );
    const parsed = parseTranslation(result.text);
    return parsed.name || parsed.snippet ? parsed : null;
  } catch {
    return null;
  }
}
