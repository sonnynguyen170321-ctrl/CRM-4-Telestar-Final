import { readFileSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { Pool } = require("pg");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

loadEnvFiles([".env.local", ".env", ".env.production"]);

const { processNextV2Job, reclaimStaleV2Jobs } = loadTsModule(
  "lib/v2/jobs/index.ts"
);

const args = parseArgs(process.argv.slice(2));
const once = readBooleanArg(args, "once", false);
const pollMs = readPositiveIntArg(args, "pollMs", 1000);
const maxPollMs = readPositiveIntArg(args, "maxPollMs", 10000);
const limit = readPositiveIntArg(args, "limit", 1);
const staleAfterMs = readPositiveIntArg(args, "staleAfterMs", 30 * 60 * 1000);
const shutdownTimeoutMs = readPositiveIntArg(args, "shutdownTimeoutMs", 30000);
const organizationId = readStringArg(args, "organizationId");
const jobType = readStringArg(args, "jobType");
// Default ON: a worker that crashed mid-job leaves the row RUNNING; without reclaim
// it never re-executes. Pass --reclaimStale=false to opt out.
const reclaimStale = readBooleanArg(args, "reclaimStale", true);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = createPgJobDb(pool);
const shutdownController = new AbortController();

let stopping = false;
let activeJobPromise = null;
let currentDelayMs = pollMs;

process.on("SIGINT", () => requestShutdown("SIGINT"));
process.on("SIGTERM", () => requestShutdown("SIGTERM"));

logEvent("v2_job_worker_started", {
  once,
  pollMs,
  maxPollMs,
  limit,
  organizationId,
  jobType,
  reclaimStale,
  staleAfterMs,
});

try {
  do {
    if (reclaimStale) {
      const reclaimed = await reclaimStaleV2Jobs(db, {
        organizationId,
        jobType,
        staleAfterMs,
      });
      logEvent("v2_job_worker_reclaimed_stale", reclaimed);
    }

    let claimed = 0;
    let succeeded = 0;
    let failed = 0;
    let retryScheduled = 0;

    for (let index = 0; index < limit && !stopping; index += 1) {
      activeJobPromise = processNextV2Job(db, {
        organizationId,
        jobType,
        signal: shutdownController.signal,
      });
      const result = await activeJobPromise;
      activeJobPromise = null;

      if (result.kind === "no_job") {
        break;
      }

      claimed += 1;
      succeeded += result.kind === "succeeded" ? 1 : 0;
      failed += result.kind === "failed" ? 1 : 0;
      retryScheduled += result.kind === "retry_scheduled" ? 1 : 0;

      logEvent("v2_job_worker_processed", {
        jobId: result.job.id,
        organizationId: result.job.organizationId,
        jobType: result.job.jobType,
        status: result.job.status,
        retryCount: result.job.retryCount,
        result: result.kind,
      });
    }

    logEvent("v2_job_worker_cycle", {
      claimed,
      processed: claimed,
      succeeded,
      failed,
      retryScheduled,
      noJob: claimed === 0,
      delayMs: once ? 0 : currentDelayMs,
    });

    if (once) {
      break;
    }

    currentDelayMs = claimed > 0 ? pollMs : Math.min(currentDelayMs * 2, maxPollMs);
    await delay(currentDelayMs);
  } while (!stopping);
} finally {
  await waitForActiveJob();
  await pool.end();
  logEvent("v2_job_worker_stopped", {
    shutdownReason: stopping ? "signal" : "completed",
  });
}

function requestShutdown(reason) {
  if (stopping) {
    return;
  }

  stopping = true;
  shutdownController.abort();
  logEvent("v2_job_worker_shutdown_requested", { shutdownReason: reason });
}

async function waitForActiveJob() {
  if (!activeJobPromise) {
    return;
  }

  await Promise.race([
    activeJobPromise.catch(() => undefined),
    delay(shutdownTimeoutMs),
  ]);
}

function logEvent(event, data = {}) {
  console.log(
    JSON.stringify({
      event,
      ...data,
    })
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(rawArgs) {
  const parsed = new Map();

  for (const arg of rawArgs) {
    if (!arg.startsWith("--")) {
      continue;
    }

    const [rawKey, ...rawValue] = arg.slice(2).split("=");
    parsed.set(rawKey, rawValue.length > 0 ? rawValue.join("=") : "true");
  }

  return parsed;
}

function readStringArg(argsMap, name) {
  const value = argsMap.get(name);

  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readBooleanArg(argsMap, name, fallback) {
  const value = argsMap.get(name);

  if (value === undefined) {
    return fallback;
  }

  return value === "true";
}

function readPositiveIntArg(argsMap, name, fallback) {
  const value = Number(argsMap.get(name));

  return Number.isInteger(value) && value > 0 ? value : fallback;
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
  const absolutePath = isAbsolute(relativePath)
    ? relativePath
    : resolve(rootDir, relativePath);

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
      return loadTsModule(resolveTsModulePath(rootDir, specifier.slice(2)));
    }

    if (!specifier.startsWith(".")) {
      return require(specifier);
    }

    return loadTsModule(resolveTsModulePath(dirname(absolutePath), specifier));
  };

  new Function("require", "module", "exports", output)(
    localRequire,
    loadedModule,
    loadedModule.exports
  );

  return loadedModule.exports;
}

function resolveTsModulePath(baseDir, specifier) {
  const modulePath = resolve(baseDir, specifier);
  const candidates = [
    modulePath,
    `${modulePath}.ts`,
    `${modulePath}.tsx`,
    resolve(modulePath, "index.ts"),
    resolve(modulePath, "index.tsx"),
  ];
  const resolvedPath = candidates.find(isReadableFile);

  if (!resolvedPath) {
    throw new Error(`Unable to resolve TypeScript module '${specifier}' from '${baseDir}'.`);
  }

  return resolvedPath;
}

function isReadableFile(path) {
  return existsSync(path) && statSync(path).isFile();
}
