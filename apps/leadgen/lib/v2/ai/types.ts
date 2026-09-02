// AI1: V2 AI governance contracts + defaults. AI is advisory + optional + admin-gated
// and NEVER overwrites the deterministic qualification. "Credit" = 1 AI request.

export type AiProviderKind = "GEMINI" | "OPENAI" | "ANTHROPIC";
export type AiMode = "OFF" | "UNCERTAIN_ONLY" | "ALL";
export type AiRunStatus = "OK" | "TIMEOUT" | "ERROR" | "RATE_LIMITED" | "SKIPPED";

export const AI_PROVIDERS: AiProviderKind[] = ["GEMINI", "OPENAI", "ANTHROPIC"];

export type AiSettings = {
  organizationId: string;
  enabled: boolean;
  mode: AiMode;
  provider: AiProviderKind;
  defaultModelId: string | null;
  maxRowsPerUpload: number;
  dailyCreditBudget: number;
  resultHandling: string;
  environment: string;
};

export const DEFAULT_AI_SETTINGS: Omit<AiSettings, "organizationId"> = {
  enabled: false,
  mode: "UNCERTAIN_ONLY",
  provider: "GEMINI",
  defaultModelId: "gemini-flash-latest",
  maxRowsPerUpload: 100,
  dailyCreditBudget: 2000,
  resultHandling: "APPEND_ONLY",
  environment: "production",
};

export type AiModelDef = {
  provider: AiProviderKind;
  modelId: string;
  label: string;
  maxOutputTokens: number;
  defaultTemperature: number;
};

// Seed registry — what each provider offers out of the box. Cheap/fast models first
// (AI here is an advisory enrichment assist, not deep research).
export const DEFAULT_AI_MODELS: AiModelDef[] = [
  { provider: "GEMINI", modelId: "gemini-flash-latest", label: "Gemini Flash", maxOutputTokens: 1024, defaultTemperature: 0.2 },
  { provider: "GEMINI", modelId: "gemini-2.0-flash", label: "Gemini 2.0 Flash", maxOutputTokens: 1024, defaultTemperature: 0.2 },
  { provider: "OPENAI", modelId: "gpt-4o-mini", label: "GPT-4o mini", maxOutputTokens: 1024, defaultTemperature: 0.2 },
  { provider: "OPENAI", modelId: "gpt-4o", label: "GPT-4o", maxOutputTokens: 1024, defaultTemperature: 0.2 },
  { provider: "ANTHROPIC", modelId: "claude-haiku-4-5", label: "Claude Haiku 4.5", maxOutputTokens: 1024, defaultTemperature: 0.2 },
  { provider: "ANTHROPIC", modelId: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", maxOutputTokens: 1024, defaultTemperature: 0.2 },
];

// Env var that holds each provider's key (server-only; value never returned/logged).
export const PROVIDER_ENV_KEY: Record<AiProviderKind, string> = {
  GEMINI: "GEMINI_API_KEY",
  OPENAI: "OPENAI_API_KEY",
  ANTHROPIC: "ANTHROPIC_API_KEY",
};

export type AiRateLimit = {
  provider: AiProviderKind;
  rpmSoftLimit: number;
  tpmSoftLimit: number;
  requestDelayMs: number;
  maxRetries: number;
  backoffBaseSeconds: number;
  backoffMaxSeconds: number;
};

export const DEFAULT_AI_RATE_LIMIT: Omit<AiRateLimit, "provider"> = {
  rpmSoftLimit: 6,
  tpmSoftLimit: 50000,
  requestDelayMs: 0,
  maxRetries: 3,
  backoffBaseSeconds: 30,
  backoffMaxSeconds: 600,
};
