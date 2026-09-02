import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { Pool } = require("pg");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

loadEnvFiles([".env.local", ".env", ".env.production"]);

const {
  claimNextV2Job,
  createNonRetryableJobError,
  createRetryableJobError,
  enqueueV2Job,
  processV2Job,
  reclaimStaleV2Jobs,
  serializeJobError,
  updateV2JobProgress,
} = loadTsModule("lib/v2/jobs/index.ts");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = createPgJobDb(pool);
const organizationId = "job0_smoke_org";
const idempotencyPrefix = "job0-smoke-";

try {
  await ensureSmokeOrganization();
  await cleanupSmokeJobs();

  const createResult = await enqueueV2Job(db, {
    organizationId,
    jobType: "INGESTION_PARSE",
    sourceType: "MANUAL",
    idempotencyKey: `${idempotencyPrefix}create`,
    payload: { scenario: "create", value: 1 },
  });
  assert.equal(createResult.kind, "created");
  assert.equal(createResult.job.status, "QUEUED");
  console.log("PASS enqueue creates one V2Job");

  const duplicateSame = await enqueueV2Job(db, {
    organizationId,
    jobType: "INGESTION_PARSE",
    sourceType: "MANUAL",
    idempotencyKey: `${idempotencyPrefix}create`,
    payload: { scenario: "create", value: 1 },
  });
  assert.equal(duplicateSame.kind, "existing");
  assert.equal(duplicateSame.job.id, createResult.job.id);
  console.log("PASS duplicate enqueue with same payload returns existing job");

  const duplicateConflict = await enqueueV2Job(db, {
    organizationId,
    jobType: "INGESTION_PARSE",
    sourceType: "MANUAL",
    idempotencyKey: `${idempotencyPrefix}create`,
    payload: { scenario: "create", value: 2 },
  });
  assert.equal(duplicateConflict.kind, "conflict");
  assert.equal(duplicateConflict.code, "PAYLOAD_MISMATCH");
  console.log("PASS duplicate enqueue with different payload returns conflict");

  await cleanupSmokeJobs();
  await enqueueV2Job(db, {
    organizationId,
    jobType: "INGESTION_NORMALIZE",
    sourceType: "MANUAL",
    idempotencyKey: `${idempotencyPrefix}claim`,
    payload: { scenario: "claim" },
  });
  const claimed = await claimNextV2Job(db, {
    organizationId,
    jobType: "INGESTION_NORMALIZE",
  });
  assert.ok(claimed);
  assert.equal(claimed.status, "RUNNING");
  assert.equal(claimed.retryCount, 1);
  console.log("PASS claim moves one due job to RUNNING");

  const secondClaim = await claimNextV2Job(db, {
    organizationId,
    jobType: "INGESTION_NORMALIZE",
  });
  assert.equal(secondClaim, null);
  console.log("PASS two claim attempts do not claim the same job");

  await cleanupSmokeJobs();
  await enqueueV2Job(db, {
    organizationId,
    jobType: "EXPORT_GENERATE",
    sourceType: "MANUAL",
    idempotencyKey: `${idempotencyPrefix}succeed`,
    payload: { scenario: "succeed" },
  });
  const stubClaim = await claimRequired("EXPORT_GENERATE");
  const stubResult = await processV2Job(db, stubClaim);
  assert.equal(stubResult.kind, "succeeded");
  assert.equal(stubResult.job.status, "SUCCEEDED");
  assert.equal(stubResult.job.progressCurrent, 1);
  console.log("PASS stub handler processes to SUCCEEDED");

  await cleanupSmokeJobs();
  await enqueueV2Job(db, {
    organizationId,
    jobType: "LEAD_ASSIGNMENT_UPSERT",
    sourceType: "MANUAL",
    idempotencyKey: `${idempotencyPrefix}retry`,
    payload: { scenario: "retry" },
  });
  const retryClaim = await claimRequired("LEAD_ASSIGNMENT_UPSERT");
  const retryResult = await processV2Job(db, retryClaim, {
    handlers: {
      LEAD_ASSIGNMENT_UPSERT: async () => {
        throw createRetryableJobError("SMOKE_RETRYABLE", "temporary smoke failure");
      },
    },
  });
  assert.equal(retryResult.kind, "retry_scheduled");
  assert.equal(retryResult.job.status, "RETRY_SCHEDULED");
  assert.ok(retryResult.job.nextAttemptAt);
  console.log("PASS retryable handler error moves to RETRY_SCHEDULED");

  await cleanupSmokeJobs();
  await enqueueV2Job(db, {
    organizationId,
    jobType: "ICP_SCORE",
    sourceType: "MANUAL",
    idempotencyKey: `${idempotencyPrefix}failed`,
    payload: { scenario: "failed" },
  });
  const failClaim = await claimRequired("ICP_SCORE");
  const failResult = await processV2Job(db, failClaim, {
    handlers: {
      ICP_SCORE: async () => {
        throw createNonRetryableJobError("SMOKE_FATAL", "permanent smoke failure");
      },
    },
  });
  assert.equal(failResult.kind, "failed");
  assert.equal(failResult.job.status, "FAILED");
  console.log("PASS non-retryable handler error moves to FAILED");

  await cleanupSmokeJobs();
  await enqueueV2Job(db, {
    organizationId,
    jobType: "ACTIVITY_APPLY",
    sourceType: "MANUAL",
    idempotencyKey: `${idempotencyPrefix}stale`,
    payload: { scenario: "stale" },
  });
  const staleClaim = await claimRequired("ACTIVITY_APPLY");
  await db.$executeRaw`
    UPDATE "V2Job"
    SET "startedAt" = CURRENT_TIMESTAMP - INTERVAL '2 hours',
        "updatedAt" = CURRENT_TIMESTAMP - INTERVAL '2 hours'
    WHERE "id" = ${staleClaim.id}
  `;
  const reclaimResult = await reclaimStaleV2Jobs(db, {
    organizationId,
    jobType: "ACTIVITY_APPLY",
    staleAfterMs: 1,
  });
  assert.equal(reclaimResult.scanned, 1);
  assert.equal(reclaimResult.retryScheduled, 1);
  console.log("PASS stale RUNNING job is reclaimed");

  await cleanupSmokeJobs();
  await insertTerminalJob("SUCCEEDED");
  await insertTerminalJob("FAILED");
  await insertTerminalJob("CANCELLED");
  const terminalClaim = await claimNextV2Job(db, { organizationId });
  assert.equal(terminalClaim, null);
  console.log("PASS terminal SUCCEEDED, FAILED, and CANCELLED jobs are not claimed");

  await cleanupSmokeJobs();
  await enqueueV2Job(db, {
    organizationId,
    jobType: "EXPORT_GENERATE",
    sourceType: "MANUAL",
    idempotencyKey: `${idempotencyPrefix}progress`,
    payload: { scenario: "progress" },
  });
  const progressClaim = await claimRequired("EXPORT_GENERATE");
  const progressUpdate = await updateV2JobProgress(db, {
    jobId: progressClaim.id,
    organizationId,
    current: 1,
    total: 2,
  });
  assert.equal(progressUpdate.status, "RUNNING");
  await processV2Job(db, progressClaim);
  const blockedProgress = await updateV2JobProgress(db, {
    jobId: progressClaim.id,
    organizationId,
    current: 2,
    total: 2,
  });
  assert.equal(blockedProgress, null);
  await assert.rejects(
    () =>
      updateV2JobProgress(db, {
        jobId: progressClaim.id,
        organizationId,
        current: 3,
        total: 2,
      }),
    /progressCurrent cannot exceed/
  );
  console.log("PASS progress updates are guarded to RUNNING jobs");

  const unsafe = serializeJobError(
    createRetryableJobError(
      "SMOKE_SECRET",
      `Bearer abc123 ${"x".repeat(700)} database_url=postgres://user:pass@localhost/db`,
      { apiKey: "real-key", nested: { token: "real-token" } }
    )
  );
  assert.equal(unsafe.metadata.apiKey, "[REDACTED]");
  assert.equal(unsafe.metadata.nested.token, "[REDACTED]");
  assert.ok(unsafe.errorMessage.length <= 500);
  assert.ok(!unsafe.errorMessage.includes("abc123"));
  assert.ok(!unsafe.errorMessage.includes("user:pass"));
  console.log("PASS safe error serializer redacts and truncates unsafe values");

  await cleanupSmokeJobs();
  console.log("PASS V2.JOB0 runtime smoke checks complete");
} finally {
  await pool.end();
}

async function claimRequired(jobType) {
  const job = await claimNextV2Job(db, { organizationId, jobType });
  assert.ok(job, `Expected ${jobType} job to be claimed`);
  return job;
}

async function insertTerminalJob(status) {
  await enqueueV2Job(db, {
    organizationId,
    jobType: "AI_INSIGHT_GENERATE",
    sourceType: "MANUAL",
    idempotencyKey: `${idempotencyPrefix}terminal-${status}`,
    payload: { scenario: "terminal", status },
  });
  await db.$executeRaw`
    UPDATE "V2Job"
    SET "status" = ${status}::"V2JobStatus", "updatedAt" = CURRENT_TIMESTAMP
    WHERE "organizationId" = ${organizationId}
      AND "idempotencyKey" = ${`${idempotencyPrefix}terminal-${status}`}
  `;
}

async function ensureSmokeOrganization() {
  await db.$queryRaw`
    INSERT INTO "V2Organization" ("id", "name", "slug", "status", "createdAt", "updatedAt")
    VALUES (${organizationId}, 'JOB0 Smoke Organization', 'job0-smoke-organization', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("slug")
    DO UPDATE SET "updatedAt" = CURRENT_TIMESTAMP
    RETURNING *
  `;
}

async function cleanupSmokeJobs() {
  await db.$executeRaw`
    DELETE FROM "V2Job"
    WHERE "organizationId" = ${organizationId}
      AND "idempotencyKey" LIKE ${`${idempotencyPrefix}%`}
  `;
}

function createPgJobDb(poolOrClient) {
  return {
    async $queryRaw(strings, ...values) {
      const query = buildParameterizedQuery(strings, values);
      const result = await poolOrClient.query(query.text, query.values);
      return result.rows;
    },
    async $executeRaw(strings, ...values) {
      const query = buildParameterizedQuery(strings, values);
      const result = await poolOrClient.query(query.text, query.values);
      return result.rowCount ?? 0;
    },
    async $transaction(callback) {
      const client = await poolOrClient.connect();

      try {
        await client.query("BEGIN");
        const result = await callback(createPgJobDb(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

function buildParameterizedQuery(strings, values) {
  let text = "";

  for (let index = 0; index < strings.length; index += 1) {
    text += strings[index];

    if (index < values.length) {
      text += `$${index + 1}`;
    }
  }

  return { text, values };
}

function loadEnvFiles(fileNames) {
  for (const fileName of fileNames) {
    const filePath = resolve(rootDir, fileName);

    if (!existsSync(filePath)) {
      continue;
    }

    for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
        continue;
      }

      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      const rawValue = trimmed.slice(index + 1).trim();

      if (key && process.env[key] === undefined) {
        process.env[key] = rawValue.replace(/^["']|["']$/g, "");
      }
    }
  }
}

function loadTsModule(relativePath) {
  const absolutePath = resolve(rootDir, relativePath);

  if (moduleCache.has(absolutePath)) {
    return moduleCache.get(absolutePath).exports;
  }

  const source = readFileSync(absolutePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const loadedModule = { exports: {} };
  moduleCache.set(absolutePath, loadedModule);

  const localRequire = (specifier) => {
    if (specifier === "server-only") {
      return {};
    }

    if (specifier.startsWith("@/")) {
      const aliasPath = resolve(rootDir, specifier.slice(2));
      const resolvedPath = existsSync(`${aliasPath}.ts`)
        ? `${aliasPath}.ts`
        : resolve(aliasPath, "index.ts");

      return loadTsModule(resolvedPath.slice(rootDir.length + 1));
    }

    if (!specifier.startsWith(".")) {
      return require(specifier);
    }

    const modulePath = resolve(dirname(absolutePath), specifier);
    const resolvedPath = existsSync(`${modulePath}.ts`)
      ? `${modulePath}.ts`
      : resolve(modulePath, "index.ts");
    const relativeToRoot = resolvedPath.slice(rootDir.length + 1);

    return loadTsModule(relativeToRoot);
  };

  new Function("require", "module", "exports", output)(
    localRequire,
    loadedModule,
    loadedModule.exports
  );

  return loadedModule.exports;
}
