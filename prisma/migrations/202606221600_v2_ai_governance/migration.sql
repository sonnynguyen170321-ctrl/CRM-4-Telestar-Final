-- AI1: V2 AI governance — settings / providers / models / rate limits / usage / logs.
-- Additive only. AI is advisory + optional + admin-gated; never overwrites scoring.

DO $$ BEGIN CREATE TYPE "V2AiMode" AS ENUM ('OFF', 'UNCERTAIN_ONLY', 'ALL'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "V2AiProviderKind" AS ENUM ('GEMINI', 'OPENAI', 'ANTHROPIC'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "V2AiRunStatus" AS ENUM ('OK', 'TIMEOUT', 'ERROR', 'RATE_LIMITED', 'SKIPPED'); EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "V2AiSettings" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "mode" "V2AiMode" NOT NULL DEFAULT 'UNCERTAIN_ONLY',
  "provider" "V2AiProviderKind" NOT NULL DEFAULT 'GEMINI',
  "defaultModelId" TEXT,
  "maxRowsPerUpload" INTEGER NOT NULL DEFAULT 100,
  "dailyCreditBudget" INTEGER NOT NULL DEFAULT 2000,
  "resultHandling" TEXT NOT NULL DEFAULT 'APPEND_ONLY',
  "environment" TEXT NOT NULL DEFAULT 'production',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "V2AiSettings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "V2AiSettings_organizationId_key" ON "V2AiSettings" ("organizationId");

CREATE TABLE IF NOT EXISTS "V2AiProviderConfig" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "provider" "V2AiProviderKind" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "lastHealthAt" TIMESTAMP(3),
  "lastHealthOk" BOOLEAN,
  "lastHealthLatencyMs" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "V2AiProviderConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "V2AiProviderConfig_org_provider_key" ON "V2AiProviderConfig" ("organizationId", "provider");

CREATE TABLE IF NOT EXISTS "V2AiModel" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "provider" "V2AiProviderKind" NOT NULL,
  "modelId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "maxOutputTokens" INTEGER NOT NULL DEFAULT 1024,
  "defaultTemperature" DECIMAL(3,2) NOT NULL DEFAULT 0.20,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "V2AiModel_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "V2AiModel_org_provider_modelId_key" ON "V2AiModel" ("organizationId", "provider", "modelId");
CREATE INDEX IF NOT EXISTS "V2AiModel_org_active_idx" ON "V2AiModel" ("organizationId", "active");

CREATE TABLE IF NOT EXISTS "V2AiRateLimit" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "provider" "V2AiProviderKind" NOT NULL,
  "rpmSoftLimit" INTEGER NOT NULL DEFAULT 6,
  "tpmSoftLimit" INTEGER NOT NULL DEFAULT 50000,
  "requestDelayMs" INTEGER NOT NULL DEFAULT 0,
  "maxRetries" INTEGER NOT NULL DEFAULT 3,
  "backoffBaseSeconds" INTEGER NOT NULL DEFAULT 30,
  "backoffMaxSeconds" INTEGER NOT NULL DEFAULT 600,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "V2AiRateLimit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "V2AiRateLimit_org_provider_key" ON "V2AiRateLimit" ("organizationId", "provider");

CREATE TABLE IF NOT EXISTS "V2AiUsageDaily" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "usageDate" DATE NOT NULL,
  "provider" "V2AiProviderKind" NOT NULL,
  "modelId" TEXT NOT NULL,
  "requests" INTEGER NOT NULL DEFAULT 0,
  "creditsUsed" INTEGER NOT NULL DEFAULT 0,
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "errors" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "V2AiUsageDaily_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "V2AiUsageDaily_org_date_provider_model_key" ON "V2AiUsageDaily" ("organizationId", "usageDate", "provider", "modelId");
CREATE INDEX IF NOT EXISTS "V2AiUsageDaily_org_date_idx" ON "V2AiUsageDaily" ("organizationId", "usageDate");

CREATE TABLE IF NOT EXISTS "V2AiRunLog" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "provider" "V2AiProviderKind" NOT NULL,
  "modelId" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "status" "V2AiRunStatus" NOT NULL,
  "latencyMs" INTEGER,
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "creditsUsed" INTEGER NOT NULL DEFAULT 1,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "companyId" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "V2AiRunLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "V2AiRunLog_org_time_idx" ON "V2AiRunLog" ("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "V2AiRunLog_org_status_time_idx" ON "V2AiRunLog" ("organizationId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "V2AiRunLog_org_provider_time_idx" ON "V2AiRunLog" ("organizationId", "provider", "createdAt");
