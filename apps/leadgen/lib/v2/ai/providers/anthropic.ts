// AI2: Anthropic (slot — key optional). Messages API.
import { asNumber, makeProvider, pick } from "./base";
import type { AiHttpRequest, AiParsedResponse, AiCompletionRequest } from "./types";

function buildRequest(req: AiCompletionRequest, apiKey: string): AiHttpRequest {
  const body: Record<string, unknown> = {
    model: req.modelId,
    max_tokens: req.maxOutputTokens,
    temperature: req.temperature,
    messages: [{ role: "user", content: req.prompt }],
  };
  if (req.system) body.system = req.system;
  return {
    url: "https://api.anthropic.com/v1/messages",
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  };
}

function parseResponse(json: unknown): AiParsedResponse {
  const blocks = pick(json, "content");
  let text = "";
  if (Array.isArray(blocks)) {
    text = blocks
      .map((b) => (pick(b, "type") === "text" && typeof pick(b, "text") === "string" ? (pick(b, "text") as string) : ""))
      .join("");
  }
  return {
    text: text.trim(),
    inputTokens: asNumber(pick(json, "usage", "input_tokens")),
    outputTokens: asNumber(pick(json, "usage", "output_tokens")),
  };
}

export const anthropicProvider = makeProvider({ kind: "ANTHROPIC", buildRequest, parseResponse });
export const __anthropic = { buildRequest, parseResponse };
