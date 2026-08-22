#!/usr/bin/env tsx
/**
 * Doctor environment check — structured JSON output.
 *
 * This script is spawned by doctor.mjs (post-install phase only) and returns
 * a JSON blob on stdout. doctor.mjs owns ALL human-readable terminal output.
 * This boundary exists so that credential-bearing env vars never reach
 * uncontrolled formatting code.
 *
 * RULE: stdout must contain ONLY the JSON result object — no log lines,
 * no warnings, no diagnostics. Anything else breaks the JSON parse in
 * doctor.mjs and is treated as an error.
 */

import { existsSync, readFileSync } from 'fs';
import dotenv from 'dotenv';
import {
  sanitizeDbUrl,
  classifyHost,
  DEV_REQUIRED_KEYS,
  devPlaceholderPattern,
} from '@/lib/env-contract';
import {
  classifyTopology,
  evaluateStrictEmailSafety,
  ENV_FILES,
  mergeEnvFiles,
} from './doctor-core.mjs';

// ---------------------------------------------------------------------------
// Snapshot inherited process environment BEFORE loading .env file
// ---------------------------------------------------------------------------
const inheritedEnvKeys = new Set(Object.keys(process.env));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DbInfo {
  host: string;
  database: string;
  source: 'env' | 'env-file';
  classification: 'local' | 'remote';
}

interface DoctorEnvResult {
  database: {
    application: DbInfo | null;
    direct: DbInfo | null;
    topology: 'all-local' | 'all-remote' | 'hybrid' | 'unknown';
  };
  redis: {
    configured: boolean;
    reachable: boolean | null;
    host: string | null;
    classification: 'local' | 'remote' | null;
  };
  envVars: {
    present: string[];
    missing: string[];
    placeholders: string[];
  };
  emailSafe: boolean;
  dryRunEnabled: boolean;
  autosendDisabled: boolean;
  /** Whether the variable was set at all — an unset variable is safe, just not explicit. */
  dryRunSet: boolean;
  autosendSet: boolean;
  aiKeys: {
    groq: boolean;
    gemini: boolean;
  };
  workerConfig: {
    valid: boolean;
    reasons: string[];
  };
  envFileExists: boolean;
  /** Which of ENV_FILES were actually present, so doctor.mjs can name them. */
  envFiles: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectSource(key: string): 'env' | 'env-file' {
  return inheritedEnvKeys.has(key) ? 'env' : 'env-file';
}

function buildDbInfo(key: string): DbInfo | null {
  const value = process.env[key];
  const identity = sanitizeDbUrl(value);
  if (!identity) return null;
  return {
    host: identity.host,
    database: identity.database,
    source: detectSource(key),
    classification: classifyHost(identity.host),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Read every file Next.js and the certification ladder read, in the same precedence order.
  // Reading `.env` alone made Doctor report a correctly configured machine as NOT READY.
  const parsedFiles: Record<string, Record<string, string>> = {};
  const presentFiles: string[] = [];
  for (const file of ENV_FILES) {
    if (!existsSync(file)) continue;
    presentFiles.push(file);
    parsedFiles[file] = dotenv.parse(readFileSync(file));
  }
  const envFileExists = presentFiles.length > 0;

  // process.env keeps precedence over every file, exactly as before.
  const merged = mergeEnvFiles(process.env, parsedFiles);
  for (const [key, value] of Object.entries(merged)) {
    if (!process.env[key]) process.env[key] = value as string;
  }

  // --- Database ---
  const appDb = buildDbInfo('DATABASE_URL');
  const directDb = buildDbInfo('DIRECT_URL');

  // --- Redis ---
  const redisUrl = process.env.REDIS_URL;
  let redisConfigured = false;
  let redisReachable: boolean | null = null;
  let redisHost: string | null = null;
  let redisClassification: 'local' | 'remote' | null = null;

  if (redisUrl) {
    redisConfigured = true;
    try {
      const parsed = new URL(redisUrl);
      redisHost = parsed.hostname;
      redisClassification = classifyHost(parsed.hostname);
    } catch {
      redisHost = null;
    }

    // Attempt ping with 3s timeout
    try {
      const { default: Redis } = await import('ioredis');
      const redis = new Redis(redisUrl, {
        connectTimeout: 3000,
        maxRetriesPerRequest: 0,
        lazyConnect: true,
        enableOfflineQueue: false,
      });
      try {
        await redis.connect();
        const pong = await redis.ping();
        redisReachable = pong === 'PONG';
      } catch {
        redisReachable = false;
      } finally {
        try { redis.disconnect(); } catch { /* ignore */ }
      }
    } catch {
      redisReachable = null;
    }
  }

  // Topology includes App DB, Direct DB, and Redis
  const topology = classifyTopology(
    appDb?.classification,
    directDb?.classification,
    redisClassification ?? undefined
  );

  // --- Env vars ---
  const present: string[] = [];
  const missing: string[] = [];
  const placeholders: string[] = [];

  for (const key of DEV_REQUIRED_KEYS) {
    const value = process.env[key];
    if (!value) {
      missing.push(key);
    } else if (devPlaceholderPattern.test(value)) {
      placeholders.push(key);
    } else {
      present.push(key);
    }
  }

  // --- Email safety ---
  const strictEmail = evaluateStrictEmailSafety(process.env);

  // --- AI keys ---
  const groq = !!process.env.GROQ_API_KEY;
  const gemini = !!process.env.GEMINI_API_KEY;

  // --- Worker config ---
  const workerReasons: string[] = [];
  if (!process.env.REDIS_URL) workerReasons.push('REDIS_URL not set');
  else if (redisReachable === false) workerReasons.push('Redis unreachable');
  if (!process.env.DIRECT_URL) workerReasons.push('DIRECT_URL not set');
  if (!existsSync('workers/index.ts')) workerReasons.push('workers/index.ts missing');
  if (!existsSync('scripts/worker-start.cjs')) workerReasons.push('scripts/worker-start.cjs missing');
  if (!existsSync('scripts/worker-dev.cjs')) workerReasons.push('scripts/worker-dev.cjs missing');
  if (!strictEmail.dryRunStrict) workerReasons.push('EMAIL_SEND_DRY_RUN is not "true"');
  if (!strictEmail.autosendStrict) workerReasons.push('SEQUENCE_AUTOSEND_ENABLED is not "false"');

  // --- Result ---
  const result: DoctorEnvResult = {
    database: {
      application: appDb,
      direct: directDb,
      topology,
    },
    redis: {
      configured: redisConfigured,
      reachable: redisReachable,
      host: redisHost,
      classification: redisClassification,
    },
    envVars: { present, missing, placeholders },
    emailSafe: strictEmail.ok,
    dryRunEnabled: strictEmail.dryRunStrict,
    autosendDisabled: strictEmail.autosendStrict,
    dryRunSet: strictEmail.dryRunSet,
    autosendSet: strictEmail.autosendSet,
    aiKeys: { groq, gemini },
    workerConfig: {
      valid: workerReasons.length === 0,
      reasons: workerReasons,
    },
    envFileExists,
    envFiles: presentFiles,
  };

  // Structured JSON — doctor.mjs parses this. No other output allowed.
  process.stdout.write(JSON.stringify(result));
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({
    _error: String(err?.message ?? err).replace(/postgresql:\/\/[^\s]+/gi, '<redacted-url>'),
  }));
  process.exit(1);
});
