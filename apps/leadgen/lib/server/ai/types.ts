export type AiProviderId = "gemini" | "openai" | "anthropic";

export type AiGenerateTextRequest = {
  systemPrompt?: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: "application/json" | "text/plain";
  responseSchema?: Record<string, unknown>;
  requestId?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type AiGenerateTextResponse = {
  provider: AiProviderId;
  model: string;
  text: string;
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  usage?: Record<string, string | number | boolean | null>;
};

export type AiProvider = {
  id: AiProviderId;
  defaultModel: string;
  generateText(
    request: AiGenerateTextRequest
  ): Promise<AiGenerateTextResponse>;
};

export class AiProviderError extends Error {
  readonly provider: AiProviderId;
  readonly status?: number;

  constructor({
    provider,
    message,
    status,
  }: {
    provider: AiProviderId;
    message: string;
    status?: number;
  }) {
    super(message);
    this.name = "AiProviderError";
    this.provider = provider;
    this.status = status;
  }
}
