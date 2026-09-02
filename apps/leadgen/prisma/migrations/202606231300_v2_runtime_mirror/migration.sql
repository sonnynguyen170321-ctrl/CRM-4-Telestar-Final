-- Phase R (R1): BullMQ runtime mirror tables. Additive, non-destructive (IF NOT EXISTS).
-- BullMQ executes; Postgres records run/stage/chunk truth + worker heartbeat for the UI.

CREATE TABLE IF NOT EXISTS "V2RuntimeRun" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "icpVersionId" TEXT,
  "runType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "totalUnits" INTEGER NOT NULL DEFAULT 0,
  "processedUnits" INTEGER NOT NULL DEFAULT 0,
  "succeededUnits" INTEGER NOT NULL DEFAULT 0,
  "failedUnits" INTEGER NOT NULL DEFAULT 0,
  "skippedUnits" INTEGER NOT NULL DEFAULT 0,
  "configJson" JSONB,
  "errorSummaryJson" JSONB,
  "createdByUserId" TEXT,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "V2RuntimeRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "V2RuntimeRun_org_type_status_idx" ON "V2RuntimeRun" ("organizationId", "runType", "status");
CREATE INDEX IF NOT EXISTS "V2RuntimeRun_org_project_status_idx" ON "V2RuntimeRun" ("organizationId", "projectId", "status");
CREATE INDEX IF NOT EXISTS "V2RuntimeRun_org_createdAt_idx" ON "V2RuntimeRun" ("organizationId", "createdAt");

CREATE TABLE IF NOT EXISTS "V2RuntimeStage" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "stageType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "totalUnits" INTEGER NOT NULL DEFAULT 0,
  "processedUnits" INTEGER NOT NULL DEFAULT 0,
  "failedUnits" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "V2RuntimeStage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "V2RuntimeStage_org_run_type_idx" ON "V2RuntimeStage" ("organizationId", "runId", "stageType");
CREATE INDEX IF NOT EXISTS "V2RuntimeStage_org_status_idx" ON "V2RuntimeStage" ("organizationId", "status");

CREATE TABLE IF NOT EXISTS "V2RuntimeChunk" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "stageId" TEXT NOT NULL,
  "chunkIndex" INTEGER NOT NULL,
  "chunkType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "bullJobId" TEXT,
  "dedupeKey" TEXT NOT NULL,
  "cursorStart" TEXT,
  "cursorEnd" TEXT,
  "unitCount" INTEGER NOT NULL DEFAULT 0,
  "processedUnits" INTEGER NOT NULL DEFAULT 0,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "workerId" TEXT,
  "errorCode" TEXT,
  "errorJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "V2RuntimeChunk_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "V2RuntimeChunk_org_dedupe_key" ON "V2RuntimeChunk" ("organizationId", "dedupeKey");
CREATE UNIQUE INDEX IF NOT EXISTS "V2RuntimeChunk_run_index_key" ON "V2RuntimeChunk" ("runId", "chunkIndex");
CREATE INDEX IF NOT EXISTS "V2RuntimeChunk_org_run_status_idx" ON "V2RuntimeChunk" ("organizationId", "runId", "status");
CREATE INDEX IF NOT EXISTS "V2RuntimeChunk_org_stage_status_idx" ON "V2RuntimeChunk" ("organizationId", "stageId", "status");

CREATE TABLE IF NOT EXISTS "V2RuntimeWorkerHeartbeat" (
  "id" TEXT NOT NULL,
  "workerId" TEXT NOT NULL,
  "organizationId" TEXT,
  "queueName" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ONLINE',
  "host" TEXT,
  "pid" INTEGER,
  "currentJobId" TEXT,
  "lastBeatAt" TIMESTAMP(3) NOT NULL,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "V2RuntimeWorkerHeartbeat_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "V2RuntimeWorkerHeartbeat_workerId_key" ON "V2RuntimeWorkerHeartbeat" ("workerId");
CREATE INDEX IF NOT EXISTS "V2RuntimeWorkerHeartbeat_queue_status_idx" ON "V2RuntimeWorkerHeartbeat" ("queueName", "status");
CREATE INDEX IF NOT EXISTS "V2RuntimeWorkerHeartbeat_lastBeatAt_idx" ON "V2RuntimeWorkerHeartbeat" ("lastBeatAt");
