import type { AiProviderId } from "@/lib/server/ai/types";

const providerIds: AiProviderId[] = ["gemini", "openai", "anthropic"];
const defaultProvider = "gemini" satisfies AiProviderId;
const defaultGeminiModel = "gemini-flash-latest";
const defaultMaxRowsPerUpload = 200;
const defaultQueueConcurrency = 1;
const defaultRequestDelayMs = 8000;
const defaultMaxRetries = 5;
const defaultBackoffBaseSeconds = 60;
const defaultBackoffMaxSeconds = 1800;
const defaultDailyRequestBudget = 200;
const defaultRpmSoftLimit = 6;
const defaultTpmSoftLimit = 50000;
const defaultMaxInputChars = 2500;
const defaultMaxWebsiteSignalChars = 1200;
const defaultMaxReasonChars = 300;

export type AiScoringMode = "disabled" | "uncertain_only" | "all_companies";

export type AiRuntimeOverrides = {
  enabled?: boolean | null;
  scoringMode?: AiScoringMode | null;
  maxRowsPerUpload?: number | null;
};

export type AiStatus = {
  enabled: boolean;
  provider: string;
  model: string;
  mode: AiScoringMode;
  maxRowsPerUpload: number;
  keyConfigured: boolean;
  usable: boolean;
  reason: string | null;
};

export type AiConfig = {
  enabled: boolean;
  provider: AiProviderId | "unsupported";
  providerRaw: string;
  timeoutMs: number;
  maxOutputTokens: number;
  maxRowsPerUpload: number;
  scoringMode: AiScoringMode;
  gemini: {
    apiKey?: string;
    model: string;
  };
  openai: {
    apiKey?: string;
    model?: string;
  };
  anthropic: {
    apiKey?: string;
    model?: string;
  };
};

export type AiQueueConfig = {
  mode: "queue" | "direct";
  concurrency: number;
  requestDelayMs: number;
  maxRetries: number;
  backoffBaseSeconds: number;
  backoffMaxSeconds: number;
  dailyRequestBudget: number;
  rpmSoftLimit: number;
  tpmSoftLimit: number;
  maxInputChars: number;
  maxWebsiteSignalChars: number;
  maxReasonChars: number;
  cacheEnabled: boolean;
};

export function getAiConfig(): AiConfig {
  const provider = parseProvider(process.env.AI_PROVIDER);

  return {
    enabled: process.env.AI_ENABLED?.trim().toLowerCase() === "true",
    provider: provider.id,
    providerRaw: provider.raw,
    timeoutMs: parsePositiveInt(process.env.AI_TIMEOUT_MS, 15000),
    maxOutputTokens: parsePositiveInt(
      process.env.AI_MAX_OUTPUT_TOKENS,
      450
    ),
    maxRowsPerUpload: parsePositiveInt(
      process.env.AI_MAX_ROWS_PER_UPLOAD,
      defaultMaxRowsPerUpload
    ),
    scoringMode: parseScoringMode(process.env.AI_SCORING_MODE),
    gemini: {
      apiKey: normalizeOptionalSecret(process.env.GEMINI_API_KEY),
      model: process.env.GEMINI_MODEL?.trim() || defaultGeminiModel,
    },
    openai: {
      apiKey: normalizeOptionalSecret(process.env.OPENAI_API_KEY),
      model: process.env.OPENAI_MODEL?.trim() || undefined,
    },
    anthropic: {
      apiKey: normalizeOptionalSecret(process.env.ANTHROPIC_API_KEY),
      model: process.env.ANTHROPIC_MODEL?.trim() || undefined,
    },
  };
}

export function getAiQueueConfig(): AiQueueConfig {
  return {
    mode: process.env.AI_MODE?.trim().toLowerCase() === "direct" ? "direct" : "queue",
    concurrency: parsePositiveInt(process.env.AI_CONCURRENCY, defaultQueueConcurrency),
    requestDelayMs: parsePositiveInt(
      process.env.AI_REQUEST_DELAY_MS,
      defaultRequestDelayMs
    ),
    maxRetries: parsePositiveInt(process.env.AI_MAX_RETRIES, defaultMaxRetries),
    backoffBaseSeconds: parsePositiveInt(
      process.env.AI_BACKOFF_BASE_SECONDS,
      defaultBackoffBaseSeconds
    ),
    backoffMaxSeconds: parsePositiveInt(
      process.env.AI_BACKOFF_MAX_SECONDS,
      defaultBackoffMaxSeconds
    ),
    dailyRequestBudget: parsePositiveInt(
      process.env.AI_DAILY_REQUEST_BUDGET,
      defaultDailyRequestBudget
    ),
    rpmSoftLimit: parsePositiveInt(
      process.env.AI_RPM_SOFT_LIMIT,
      defaultRpmSoftLimit
    ),
    tpmSoftLimit: parsePositiveInt(
      process.env.AI_TPM_SOFT_LIMIT,
      defaultTpmSoftLimit
    ),
    maxInputChars: parsePositiveInt(
      process.env.AI_MAX_INPUT_CHARS,
      defaultMaxInputChars
    ),
    maxWebsiteSignalChars: parsePositiveInt(
      process.env.AI_MAX_WEBSITE_SIGNAL_CHARS,
      defaultMaxWebsiteSignalChars
    ),
    maxReasonChars: parsePositiveInt(
      process.env.AI_MAX_REASON_CHARS,
      defaultMaxReasonChars
    ),
    cacheEnabled:
      process.env.AI_CACHE_ENABLED?.trim().toLowerCase() !== "false",
  };
}

export function getSafeAiStatus(overrides: AiRuntimeOverrides = {}): AiStatus {
  const config = getAiConfig();
  const model = getConfiguredModel(config);
  const keyConfigured = getConfiguredKeyState(config);
  const enabled = overrides.enabled ?? config.enabled;
  const mode = normalizeEffectiveMode(
    enabled,
    overrides.scoringMode ?? config.scoringMode
  );
  const maxRowsPerUpload = parseRuntimeMaxRows(
    overrides.maxRowsPerUpload,
    config.maxRowsPerUpload
  );

  if (!enabled || mode === "disabled") {
    return {
      enabled: false,
      provider: config.providerRaw,
      model,
      mode: "disabled",
      maxRowsPerUpload,
      keyConfigured,
      usable: false,
      reason: "AI is disabled.",
    };
  }

  if (config.provider === "unsupported") {
    return {
      enabled: true,
      provider: config.providerRaw,
      model,
      mode,
      maxRowsPerUpload,
      keyConfigured: false,
      usable: false,
      reason: `${config.providerRaw} provider is unsupported.`,
    };
  }

  if (config.provider !== "gemini") {
    return {
      enabled: true,
      provider: config.provider,
      model,
      mode,
      maxRowsPerUpload,
      keyConfigured,
      usable: false,
      reason: `${config.provider} provider is not implemented yet.`,
    };
  }

  if (!config.gemini.apiKey) {
    return {
      enabled: true,
      provider: config.provider,
      model,
      mode,
      maxRowsPerUpload,
      keyConfigured: false,
      usable: false,
      reason: "Gemini API key is not configured.",
    };
  }

  return {
    enabled: true,
    provider: config.provider,
    model,
    mode,
    maxRowsPerUpload,
    keyConfigured: true,
    usable: true,
    reason: null,
  };
}

function parseProvider(value: string | undefined): {
  id: AiProviderId | "unsupported";
  raw: string;
} {
  const normalized = value?.trim().toLowerCase() || defaultProvider;

  if (providerIds.includes(normalized as AiProviderId)) {
    return { id: normalized as AiProviderId, raw: normalized };
  }

  return { id: "unsupported", raw: normalized };
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseRuntimeMaxRows(value: number | null | undefined, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

export function parseScoringMode(value: string | undefined | null): AiScoringMode {
  const normalized = value?.trim().toLowerCase();

  if (
    normalized === "disabled" ||
    normalized === "uncertain_only" ||
    normalized === "all_companies"
  ) {
    return normalized;
  }

  return "all_companies";
}

function normalizeEffectiveMode(
  enabled: boolean,
  mode: AiScoringMode
): AiScoringMode {
  if (!enabled || mode === "disabled") {
    return "disabled";
  }

  return mode;
}

function normalizeOptionalSecret(value: string | undefined) {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

function getConfiguredModel(config: AiConfig) {
  if (config.provider === "gemini" || config.provider === "unsupported") {
    return config.gemini.model;
  }

  if (config.provider === "openai") {
    return config.openai.model ?? "not-configured";
  }

  return config.anthropic.model ?? "not-configured";
}

function getConfiguredKeyState(config: AiConfig) {
  if (config.provider === "gemini") {
    return Boolean(config.gemini.apiKey);
  }

  if (config.provider === "openai") {
    return Boolean(config.openai.apiKey);
  }

  if (config.provider === "anthropic") {
    return Boolean(config.anthropic.apiKey);
  }

  return false;
}
