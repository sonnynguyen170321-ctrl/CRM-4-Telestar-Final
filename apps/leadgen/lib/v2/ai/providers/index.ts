// AI2: provider registry — resolve a provider by kind.
import type { AiProviderKind } from "../types";
import { anthropicProvider } from "./anthropic";
import { geminiProvider } from "./gemini";
import { openaiProvider } from "./openai";
import type { AiProvider } from "./types";

const REGISTRY: Record<AiProviderKind, AiProvider> = {
  GEMINI: geminiProvider,
  OPENAI: openaiProvider,
  ANTHROPIC: anthropicProvider,
};

export function getProvider(kind: AiProviderKind): AiProvider {
  return REGISTRY[kind];
}

export * from "./types";
export { geminiProvider, openaiProvider, anthropicProvider };
