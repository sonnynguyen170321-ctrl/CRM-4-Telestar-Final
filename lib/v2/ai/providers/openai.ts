// AI2: OpenAI (slot — key optional). Chat Completions.
import { asNumber, makeProvider, pick } from "./base";
import type { AiHttpRequest, AiParsedResponse, AiCompletionRequest } from "./types";

function buildRequest(req: AiCompletionRequest, apiKey: string): AiHttpRequest {
  const messages: Array<{ role: string; content: string }> = [];
  if (req.system) messages.push({ role: "system", content: req.system });
  messages.push({ role: "user", content: req.prompt });
  return {
    url: "https://api.openai.com/v1/chat/completions",
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: req.modelId,
      messages,
      max_tokens: req.maxOutputTokens,
      temperature: req.temperature,
    }),
  };
}

function parseResponse(json: unknown): AiParsedResponse {
  const content = pick(json, "choices", 0, "message", "content");
  return {
    text: typeof content === "string" ? content.trim() : "",
    inputTokens: asNumber(pick(json, "usage", "prompt_tokens")),
    outputTokens: asNumber(pick(json, "usage", "completion_tokens")),
  };
}

export const openaiProvider = makeProvider({ kind: "OPENAI", buildRequest, parseResponse });
export const __openai = { buildRequest, parseResponse };
