"use server";

import { revalidatePath } from "next/cache";

import { requirePermission, V2TenantError } from "@/lib/v2/tenant";
import { updateAiRateLimit, updateAiSettings } from "@/lib/v2/ai/settings";
import { testAiConnection } from "@/lib/v2/ai/runAiCompletion";
import { AI_PROVIDERS, type AiMode, type AiProviderKind } from "@/lib/v2/ai/types";

// AI4: admin-gated (ai.admin) settings + diagnostics for /v2/ai. AI is advisory and
// optional; these only write config / run a manual connection test. Keys are never
// accepted from the client — they live in server env (Invariant 9).

export type ActionResult = { ok: boolean; message: string };

const MODES: AiMode[] = ["OFF", "UNCERTAIN_ONLY", "ALL"];

function isProvider(v: string): v is AiProviderKind {
  return (AI_PROVIDERS as string[]).includes(v);
}
function clampInt(raw: FormDataEntryValue | null, min: number, max: number, fallback: number): number {
  const n = Number.parseInt((raw?.toString() ?? "").trim(), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export async function saveAiSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  let context;
  try {
    context = await requirePermission("ai.admin");
  } catch (error) {
    if (error instanceof V2TenantError) return { ok: false, message: "Not authorized to manage AI settings." };
    throw error;
  }

  const modeRaw = formData.get("mode")?.toString() ?? "UNCERTAIN_ONLY";
  const providerRaw = formData.get("provider")?.toString() ?? "GEMINI";
  const mode: AiMode = (MODES as string[]).includes(modeRaw) ? (modeRaw as AiMode) : "UNCERTAIN_ONLY";
  const provider: AiProviderKind = isProvider(providerRaw) ? providerRaw : "GEMINI";
  const defaultModelId = (formData.get("defaultModelId")?.toString() ?? "").trim() || null;

  await updateAiSettings(context.organizationId, {
    enabled: formData.get("enabled") === "on",
    mode,
    provider,
    defaultModelId,
    dailyCreditBudget: clampInt(formData.get("dailyCreditBudget"), 0, 1_000_000, 2000),
    maxRowsPerUpload: clampInt(formData.get("maxRowsPerUpload"), 1, 100_000, 100),
  });

  revalidatePath("/v2/ai");
  return { ok: true, message: "AI settings saved." };
}

export async function saveAiRateLimitAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  let context;
  try {
    context = await requirePermission("ai.admin");
  } catch (error) {
    if (error instanceof V2TenantError) return { ok: false, message: "Not authorized to manage AI settings." };
    throw error;
  }

  const providerRaw = formData.get("provider")?.toString() ?? "GEMINI";
  if (!isProvider(providerRaw)) return { ok: false, message: "Unknown provider." };

  await updateAiRateLimit(context.organizationId, providerRaw, {
    rpmSoftLimit: clampInt(formData.get("rpmSoftLimit"), 0, 100_000, 6),
    tpmSoftLimit: clampInt(formData.get("tpmSoftLimit"), 0, 100_000_000, 50_000),
    requestDelayMs: clampInt(formData.get("requestDelayMs"), 0, 600_000, 0),
    maxRetries: clampInt(formData.get("maxRetries"), 0, 10, 3),
  });

  revalidatePath("/v2/ai");
  return { ok: true, message: `Rate limit saved for ${providerRaw}.` };
}

export type TestConnectionState = {
  ok: boolean;
  provider: AiProviderKind | null;
  latencyMs: number | null;
  message: string;
};

export async function testConnectionAction(_prev: TestConnectionState | null, formData: FormData): Promise<TestConnectionState> {
  let context;
  try {
    context = await requirePermission("ai.admin");
  } catch (error) {
    if (error instanceof V2TenantError) return { ok: false, provider: null, latencyMs: null, message: "Not authorized." };
    throw error;
  }

  const providerRaw = formData.get("provider")?.toString() ?? "";
  if (!isProvider(providerRaw)) return { ok: false, provider: null, latencyMs: null, message: "Unknown provider." };
  const modelId = (formData.get("modelId")?.toString() ?? "").trim() || undefined;

  const result = await testAiConnection(context.organizationId, providerRaw, modelId, context.userId);
  revalidatePath("/v2/ai");
  return {
    ok: result.ok,
    provider: result.provider,
    latencyMs: result.latencyMs,
    message: result.ok ? `Connected in ${result.latencyMs ?? "?"}ms.` : result.error ?? "Connection failed.",
  };
}
