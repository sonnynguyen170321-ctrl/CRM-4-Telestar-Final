#!/usr/bin/env node
/**
 * Production worker runner.
 * Usage: node scripts/worker-start.cjs
 *
 * Starts the worker entry point with tsx. Designed for process managers
 * like PM2, Supervisord, or container entrypoints.
 *
 * Environment variables expected:
 *   REDIS_URL   - Redis connection string (required in production)
 *   DIRECT_URL  - Direct Postgres connection string for workers (required in production)
 *   NODE_ENV    - 'production' (defaults to 'production' if not set)
 */
const { spawn } = require('child_process');
const path = require('path');

const required = ['REDIS_URL', 'DIRECT_URL'];
const missing = required.filter((v) => !process.env[v]);
if (missing.length > 0) {
  console.error(`[worker] FATAL: missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

const workerEntry = path.resolve(__dirname, '..', 'workers', 'index.ts');

// Resolve tsx from node_modules rather than shelling out to `npx`.
//
// `npx tsx` downloads tsx when it is not installed locally, which is what production was
// doing on every boot: the logs showed `npm warn exec ... will be installed: tsx@4.23.11`
// while package-lock.json pins 4.23.7. That meant the worker could not start without
// network access to the npm registry, and the "immutable" image digest did not fully
// describe what ran. tsx is a runtime dependency now, so it is present in the image.
//
// Spawning node with tsx's CLI also drops `shell: true`, which Node flags (DEP0190) because
// arguments are concatenated rather than escaped.
let tsxCli;
try {
  tsxCli = require.resolve('tsx/cli');
} catch {
  console.error(
    '[worker] FATAL: tsx is not installed. It is a runtime dependency — run `npm ci` ' +
      '(without --omit=dev being applied to it) or rebuild the image.'
  );
  process.exit(1);
}

const child = spawn(process.execPath, [tsxCli, workerEntry], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || 'production',
    IS_WORKER: 'true',
  },
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
