// AI2: shared complete() — fetch with hard timeout, uniform error mapping. Pure
// buildRequest/parseResponse are supplied per provider; this wires the network.

import type { AiProviderKind } from "../types";
import {
  AiProviderError,
  type AiCompletionRequest,
  type AiCompletionResult,
  type AiHttpRequest,
  type AiParsedResponse,
  type AiProvider,
} from "./types";

type ProviderSpec = {
  kind: AiProviderKind;
  buildRequest: (req: AiCompletionRequest, apiKey: string) => AiHttpRequest;
  parseResponse: (json: unknown) => AiParsedResponse;
};

export function makeProvider(spec: ProviderSpec): AiProvider {
  return {
    kind: spec.kind,
    buildRequest: spec.buildRequest,
    parseResponse: spec.parseResponse,
    async complete(req, apiKey) {
      const started = Date.now();
      const http = spec.buildRequest(req, apiKey);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1000, req.timeoutMs));
      let res: Response;
      try {
        res = await fetch(http.url, {
          method: http.method,
          headers: http.headers,
          body: http.body,
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof Error && err.name === "AbortError") {
          throw new AiProviderError("TIMEOUT", `${spec.kind} request timed out after ${req.timeoutMs}ms`);
        }
        throw new AiProviderError("ERROR", `${spec.kind} request failed`);
      }
      clearTimeout(timer);
      if (!res.ok) {
        // Body may carry detail but can echo nothing sensitive about our key; truncate.
        const detail = (await safeText(res)).slice(0, 300);
        const code = res.status === 429 ? "RATE_LIMITED" : "ERROR";
        throw new AiProviderError(code, `${spec.kind} HTTP ${res.status}: ${detail}`, res.status);
      }
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw new AiProviderError("ERROR", `${spec.kind} returned non-JSON response`);
      }
      const parsed = spec.parseResponse(json);
      return {
        text: parsed.text,
        inputTokens: parsed.inputTokens,
        outputTokens: parsed.outputTokens,
        latencyMs: Date.now() - started,
      } satisfies AiCompletionResult;
    },
  };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

/** Read a nested path off an unknown JSON object without throwing. */
export function pick(obj: unknown, ...keys: Array<string | number>): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[k];
  }
  return cur;
}

export function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
