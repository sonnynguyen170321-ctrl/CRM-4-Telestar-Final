import { getAiConfig } from "@/lib/server/ai/config";
import type { AiProvider, AiProviderId } from "@/lib/server/ai/types";
import { AiProviderError } from "@/lib/server/ai/types";
import { createGeminiProvider } from "@/lib/server/ai/providers/gemini";

export function getConfiguredAiProvider() {
  const config = getAiConfig();

  if (config.provider === "unsupported") {
    throw new AiProviderError({
      provider: "gemini",
      message: `${config.providerRaw} provider is unsupported.`,
    });
  }

  return getAiProvider(config.provider);
}

export function getAiProvider(providerId?: AiProviderId): AiProvider {
  const config = getAiConfig();
  const id = providerId ?? config.provider;

  if (id === "gemini") {
    return createGeminiProvider({
      apiKey: config.gemini.apiKey,
      defaultModel: config.gemini.model,
      timeoutMs: config.timeoutMs,
      maxOutputTokens: config.maxOutputTokens,
    });
  }

  if (id === "openai" || id === "anthropic") {
    return createUnsupportedProvider(id);
  }

  throw new AiProviderError({
    provider: "gemini",
    message: "Unsupported AI provider.",
  });
}

export function listSupportedAiProviders(): AiProviderId[] {
  return ["gemini", "openai", "anthropic"];
}

function createUnsupportedProvider(id: Exclude<AiProviderId, "gemini">) {
  const defaultModel = id === "openai" ? "not-configured" : "not-configured";

  return {
    id,
    defaultModel,
    async generateText() {
      throw new AiProviderError({
        provider: id,
        message: `${id} provider is not implemented yet.`,
      });
    },
  } satisfies AiProvider;
}
