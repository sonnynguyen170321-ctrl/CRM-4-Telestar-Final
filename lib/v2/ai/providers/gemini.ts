// AI2: Gemini (live — key present in .env). REST generateContent.
import { asNumber, makeProvider, pick } from "./base";
import type { AiHttpRequest, AiParsedResponse, AiCompletionRequest } from "./types";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function buildRequest(req: AiCompletionRequest, apiKey: string): AiHttpRequest {
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: req.prompt }] }],
    generationConfig: {
      maxOutputTokens: req.maxOutputTokens,
      temperature: req.temperature,
    },
  };
  if (req.system) {
    body.systemInstruction = { parts: [{ text: req.system }] };
  }
  return {
    // Key travels in the header, not the URL, so it never lands in request logs.
    url: `${BASE}/${encodeURIComponent(req.modelId)}:generateContent`,
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
  };
}

function parseResponse(json: unknown): AiParsedResponse {
  const parts = pick(json, "candidates", 0, "content", "parts");
  let text = "";
  if (Array.isArray(parts)) {
    text = parts.map((p) => (typeof pick(p, "text") === "string" ? (pick(p, "text") as string) : "")).join("");
  }
  return {
    text: text.trim(),
    inputTokens: asNumber(pick(json, "usageMetadata", "promptTokenCount")),
    outputTokens: asNumber(pick(json, "usageMetadata", "candidatesTokenCount")),
  };
}

export const geminiProvider = makeProvider({ kind: "GEMINI", buildRequest, parseResponse });
export const __gemini = { buildRequest, parseResponse };
