// AI2: provider abstraction. One uniform shape over Gemini / OpenAI / Anthropic REST.
// Keys are passed in by the server-only orchestrator and NEVER logged (Invariant 9).
// buildRequest/parseResponse are pure so they can be unit-tested without a network call.

import type { AiProviderKind } from "../types";

export type AiCompletionRequest = {
  modelId: string;
  prompt: string;
  system?: string;
  maxOutputTokens: number;
  temperature: number;
  timeoutMs: number;
};

export type AiCompletionResult = {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
};

export type AiParsedResponse = {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
};

export type AiHttpRequest = {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
};

export class AiProviderError extends Error {
  code: "TIMEOUT" | "ERROR" | "RATE_LIMITED";
  status?: number;
  constructor(code: AiProviderError["code"], message: string, status?: number) {
    super(message);
    this.name = "AiProviderError";
    this.code = code;
    this.status = status;
  }
}

export interface AiProvider {
  kind: AiProviderKind;
  /** Pure: assemble the HTTP request. apiKey is embedded but the request is never logged. */
  buildRequest(req: AiCompletionRequest, apiKey: string): AiHttpRequest;
  /** Pure: pull text + token usage out of the provider's JSON response. */
  parseResponse(json: unknown): AiParsedResponse;
  /** Live: buildRequest -> fetch (with timeout) -> parseResponse. */
  complete(req: AiCompletionRequest, apiKey: string): Promise<AiCompletionResult>;
}
