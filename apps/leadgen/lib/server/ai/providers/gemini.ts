import type {
  AiGenerateTextRequest,
  AiProvider,
} from "@/lib/server/ai/types";
import { AiProviderError } from "@/lib/server/ai/types";

type GeminiProviderConfig = {
  apiKey?: string;
  defaultModel: string;
  timeoutMs: number;
  maxOutputTokens: number;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

export function createGeminiProvider({
  apiKey,
  defaultModel,
  timeoutMs,
  maxOutputTokens,
}: GeminiProviderConfig): AiProvider {
  return {
    id: "gemini",
    defaultModel,
    async generateText(request) {
      if (!apiKey) {
        throw new AiProviderError({
          provider: "gemini",
          message: "Gemini API key is not configured.",
        });
      }

      const startedAt = Date.now();
      const model = request.model?.trim() || defaultModel;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
            model
          )}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-goog-api-key": apiKey,
            },
            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts: [{ text: buildPrompt(request) }],
                },
              ],
              generationConfig: {
                temperature: request.temperature,
                maxOutputTokens:
                  request.maxOutputTokens ?? maxOutputTokens,
                responseMimeType: request.responseMimeType,
                responseSchema: request.responseSchema,
              },
            }),
            signal: controller.signal,
          }
        );

        const body = (await response.json().catch(() => ({}))) as
          | GeminiResponse
          | { error?: { message?: string } };

        if (!response.ok) {
          throw new AiProviderError({
            provider: "gemini",
            status: response.status,
            message: getProviderFailureMessage(body, response.status),
          });
        }

        const candidate = "candidates" in body ? body.candidates?.[0] : null;
        const text = candidate?.content?.parts
          ?.map((part) => part.text)
          .filter(Boolean)
          .join("")
          .trim();

        if (!text) {
          throw new AiProviderError({
            provider: "gemini",
            message: "Gemini response did not include text.",
          });
        }

        const usage = "usageMetadata" in body ? body.usageMetadata : undefined;

        return {
          provider: "gemini",
          model,
          text,
          finishReason: candidate?.finishReason,
          inputTokens: usage?.promptTokenCount,
          outputTokens: usage?.candidatesTokenCount,
          latencyMs: Date.now() - startedAt,
          usage: usage
            ? {
                promptTokenCount: usage.promptTokenCount ?? null,
                candidatesTokenCount: usage.candidatesTokenCount ?? null,
                totalTokenCount: usage.totalTokenCount ?? null,
              }
            : undefined,
        };
      } catch (error) {
        if (error instanceof AiProviderError) {
          throw error;
        }

        if (error instanceof DOMException && error.name === "AbortError") {
          throw new AiProviderError({
            provider: "gemini",
            message: "Gemini request timed out.",
          });
        }

        throw new AiProviderError({
          provider: "gemini",
          message: "Gemini request failed.",
        });
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function buildPrompt(request: AiGenerateTextRequest) {
  if (!request.systemPrompt?.trim()) {
    return request.userPrompt;
  }

  return `System:\n${request.systemPrompt.trim()}\n\nUser:\n${request.userPrompt}`;
}

function getProviderFailureMessage(body: unknown, status: number) {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "object" &&
    body.error !== null &&
    "message" in body.error &&
    typeof body.error.message === "string"
  ) {
    return `Gemini request failed with status ${status}: ${body.error.message}`;
  }

  return `Gemini request failed with status ${status}.`;
}
