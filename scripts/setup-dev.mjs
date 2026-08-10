#!/usr/bin/env node
/**
 * Telestar CRM — Development bootstrap.
 *
 * Sequence:
 *   1. doctor --pre-install   (fail fast on wrong Node/npm/git)
 *   2. npm ci                 (exact lockfile install)
 *   3. npx prisma generate    (Prisma client)
 *   4. migration order check  (preflight)
 *   5. migration status       (report only if .env present — never apply)
 *   6. summary + next steps
 *
 * This script NEVER:
 *   - generates fake secrets
 *   - copies .env.example to .env
 *   - runs prisma migrate deploy
 *   - creates placeholder credentials
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';

function run(label, cmd) {
  console.log(`\n\x1b[1m▸ ${label}\x1b[0m`);
  console.log(`  $ ${cmd}\n`);
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

function banner(msg) {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(msg);
  console.log('─'.repeat(50));
}

// ---------------------------------------------------------------------------
// 1. Pre-install checks
// ---------------------------------------------------------------------------
banner('Step 1: Pre-install verification');

if (!run('Doctor (pre-install)', 'node scripts/doctor.mjs --pre-install')) {
  console.log(`\n${FAIL} Pre-install checks failed. Fix the issues above before continuing.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. npm ci
// ---------------------------------------------------------------------------
banner('Step 2: Install dependencies');

if (!run('npm ci', 'npm ci')) {
  console.log(`\n${FAIL} npm ci failed.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 3. Prisma generate
// ---------------------------------------------------------------------------
banner('Step 3: Generate Prisma client');

if (!run('Prisma generate', 'npx prisma generate')) {
  console.log(`\n${FAIL} Prisma generate failed.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 4. Migration order check
// ---------------------------------------------------------------------------
banner('Step 4: Migration order preflight');

if (!run('Migration order', 'node scripts/check-migration-order.mjs')) {
  console.log(`\n${FAIL} Migration order check failed.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 5. Migration status (only if .env exists)
// ---------------------------------------------------------------------------
const envExists = existsSync(resolve(ROOT, '.env'));

if (envExists) {
  banner('Step 5: Migration status (read-only)');
  // This may fail if the database is unreachable — that's informational, not fatal
  run('Migration status', 'npx prisma migrate status');
}

// ---------------------------------------------------------------------------
// 6. Summary
// ---------------------------------------------------------------------------
banner('Setup complete');

if (!envExists) {
  console.log(`
${PASS} Dependencies installed and Prisma client generated.

${FAIL} ACTION REQUIRED: provision environment variables.

  1. Copy values from the team's secure secrets source into .env
     Reference template: .env.example
     Do NOT copy .env.example directly — it contains placeholders.

  2. Then run:  npm run doctor

  See docs/NEW_MACHINE.md for the full procedure.
`);
  process.exit(0);
} else {
  console.log(`
${PASS} Setup complete.

  Run:  npm run doctor

  for full environment verification.
`);
  process.exit(0);
}
