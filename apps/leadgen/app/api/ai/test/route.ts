import { z } from "zod";

import { getEffectiveAiStatus } from "@/lib/server/ai/runtimeSettings";
import { AiProviderError, type AiProviderId } from "@/lib/server/ai/types";
import {
  getAiProvider,
  getConfiguredAiProvider,
  listSupportedAiProviders,
} from "@/lib/server/ai/providers";
import {
  errorResponse,
  serverError,
  validationError,
} from "@/lib/server/api/responses";

export const runtime = "nodejs";

const aiTestSchema = z.object({
  provider: z.enum(["gemini", "openai", "anthropic"]).optional(),
  model: z.string().trim().min(1).max(120).optional(),
  prompt: z.string().trim().min(1).max(2000),
});

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body.", 400);
  }

  const parsed = aiTestSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  try {
    const status = await getEffectiveAiStatus();

    if (!status.usable) {
      return errorResponse(status.reason ?? "AI is not usable.", 400);
    }

    if (parsed.data.provider && parsed.data.provider !== status.provider) {
      return errorResponse(
        `Configured AI provider is ${status.provider}.`,
        400
      );
    }

    const provider = parsed.data.provider
      ? getAiProvider(parsed.data.provider as AiProviderId)
      : getConfiguredAiProvider();

    if (!listSupportedAiProviders().includes(provider.id)) {
      return errorResponse("Unsupported AI provider.", 400);
    }

    const result = await provider.generateText({
      userPrompt: parsed.data.prompt,
      model: parsed.data.model,
      maxOutputTokens: 120,
      temperature: 0.2,
      requestId: crypto.randomUUID(),
      metadata: {
        route: "/api/ai/test",
      },
    });

    return Response.json({
      success: true,
      provider: result.provider,
      model: result.model,
      text: result.text,
      finishReason: result.finishReason,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: result.latencyMs,
    });
  } catch (error) {
    if (error instanceof AiProviderError) {
      return errorResponse(error.message, error.status ?? 400);
    }

    return serverError(error);
  }
}
