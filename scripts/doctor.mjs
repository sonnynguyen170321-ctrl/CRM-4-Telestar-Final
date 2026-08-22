#!/usr/bin/env node
/**
 * Telestar CRM — Doctor.
 *
 * Two-phase environment diagnostic. Proves that a machine's code, runtime,
 * dependencies, configuration, schema-migration state, and service
 * prerequisites are aligned with the canonical project environment.
 *
 * Phase 1 (pre-install): uses only Node builtins. Runs on a genuine fresh
 * clone with no node_modules — missing dependencies is expected, not a failure.
 *
 * Phase 2 (full): runs after npm ci. Spawns doctor-env-check.ts for
 * credential-bearing checks and receives structured JSON — this script owns
 * ALL human-readable terminal output.
 *
 * Flags:
 *   --pre-install    Force pre-install mode (auto-detected when node_modules absent)
 *   --require-main   Fail if not on main or HEAD differs from remote main
 *
 * SECURITY RULE: Doctor NEVER writes raw child-process stderr/stdout from
 * commands that receive environment credentials. All subprocess output is
 * captured, sanitized, then only the required diagnostic is printed.
 *
 * Exit 0 = READY.  Exit 1 = NOT READY or ACTION REQUIRED.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CANONICAL_NODE,
  CANONICAL_NPM,
  sanitizeDiagnosticText,
  evaluateVersionState,
  evaluateGitState,
  ENV_FILES,
  TYPECHECK_ARGS,
  TYPECHECK_NODE_OPTIONS,
  classifyTypecheckResult,
  PRISMA_MIGRATE_STATUS_ARGS,
  summarizeDependencyProblems,
  mergeEnvFiles,
  parseEnvFile,
} from './doctor-core.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------
const PAD = 25;
const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const WARN_ICON = '\x1b[33m⚠\x1b[0m';

let hasFailure = false;
const actionItems = [];

function line(label, value, status) {
  const padded = label.padEnd(PAD);
  const icon = status === true ? `  ${PASS}` : status === false ? `  ${FAIL}` : '';
  console.log(`${padded} ${value}${icon}`);
}

function warn(msg) {
  console.log(`\n  ${WARN_ICON} ${msg}`);
}

function fail(label, value) {
  hasFailure = true;
  line(label, value, false);
}

function actionRequired(msg) {
  hasFailure = true;
  actionItems.push(msg);
}

// ---------------------------------------------------------------------------
// Credential sanitization wrapper
// ---------------------------------------------------------------------------

function safeExec(cmd, options = {}) {
  try {
    const stdout = execSync(cmd, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 60_000,
      ...options,
    });
    return { ok: true, stdout: sanitizeDiagnosticText(stdout), stderr: '' };
  } catch (err) {
    return {
      ok: false,
      stdout: sanitizeDiagnosticText(err?.stdout ?? ''),
      stderr: sanitizeDiagnosticText(err?.stderr ?? ''),
    };
  }
}

function safeExecCode(cmd, options = {}) {
  try {
    execSync(cmd, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120_000,
      ...options,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: sanitizeDiagnosticText(err?.stderr ?? err?.stdout ?? '') };
  }
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const forcePreInstall = args.includes('--pre-install');
const requireMain = args.includes('--require-main');
const hasNodeModules = existsSync(resolve(ROOT, 'node_modules'));
const isPreInstall = forcePreInstall || !hasNodeModules;

// ---------------------------------------------------------------------------
// Phase 1: Pre-install checks
// ---------------------------------------------------------------------------

console.log('\x1b[1mTelestar CRM environment\x1b[0m');
console.log('─'.repeat(40));
console.log();

// --- Version checks ---
const nvmrcPath = resolve(ROOT, '.nvmrc');
const nodeVersionPath = resolve(ROOT, '.node-version');
const nvmrc = existsSync(nvmrcPath) ? readFileSync(nvmrcPath, 'utf8') : null;
const nodeVersionFile = existsSync(nodeVersionPath) ? readFileSync(nodeVersionPath, 'utf8') : null;
const npmResult = safeExec('npm --version');
const actualNpm = npmResult.stdout.trim();
const actualNode = process.versions.node;

const versionState = evaluateVersionState({ nvmrc, nodeVersionFile, actualNode, actualNpm });

if (!versionState.ok) {
  hasFailure = true;
}

if (nvmrc && nodeVersionFile && nvmrc.trim() === nodeVersionFile.trim()) {
  line('.nvmrc / .node-version', 'consistent', true);
} else {
  line('.nvmrc / .node-version', 'DIVERGENT or missing', false);
}

if (actualNode === CANONICAL_NODE) {
  line('Node', actualNode, true);
} else {
  line('Node', `${actualNode} (expected ${CANONICAL_NODE})`, false);
}

if (actualNpm === CANONICAL_NPM) {
  line('npm', actualNpm, true);
} else {
  line('npm', `${actualNpm} (expected ${CANONICAL_NPM})`, false);
}

console.log();

// --- Git & Remote checks ---
const branchResult = safeExec('git branch --show-current');
const branch = branchResult.stdout.trim() || '(detached)';
line('Git branch', branch, null);

const shaResult = safeExec('git rev-parse --short HEAD');
const sha = shaResult.stdout.trim();
line('Git SHA', sha, null);

const statusResult = safeExec('git status --porcelain');
const isClean = statusResult.ok && statusResult.stdout.trim() === '';

if (isClean) {
  line('Working tree', 'clean', true);
} else if (requireMain) {
  fail('Working tree', 'dirty');
} else {
  line('Working tree', 'dirty', null);
  warn('Working tree has uncommitted changes');
}

const fullShaResult = safeExec('git rev-parse HEAD');
const localSha = fullShaResult.stdout.trim();
const remoteResult = safeExec('git ls-remote origin refs/heads/main');
const remoteAvailable = remoteResult.ok && !!remoteResult.stdout.trim();
const remoteSha = remoteAvailable ? remoteResult.stdout.trim().split(/\s+/)[0] : null;

const gitState = evaluateGitState({
  branch,
  isClean,
  localSha,
  remoteSha,
  remoteAvailable,
  requireMain,
});

if (!gitState.ok) {
  hasFailure = true;
}

if (!remoteAvailable) {
  if (requireMain) {
    fail('Remote main', 'unavailable (network required for --require-main)');
  } else {
    line('Remote main', 'unavailable (network)', null);
  }
} else if (branch === 'main') {
  if (gitState.status === 'PASS') {
    line('Remote main', 'synchronized', true);
  } else {
    fail('Remote main', gitState.message);
  }
} else {
  line('Remote main', gitState.message, null);
}

if (requireMain && branch !== 'main') {
  fail('Branch', 'not on main — use git switch main');
}

console.log();

// ---------------------------------------------------------------------------
// Pre-install: stop here
// ---------------------------------------------------------------------------
if (isPreInstall) {
  line('Dependencies', 'not installed yet — expected', null);
  console.log();

  if (hasFailure) {
    console.log(`\x1b[1mEnvironment              ${FAIL} NOT READY — BASIC CHECKS FAILED\x1b[0m`);
    process.exit(1);
  } else {
    console.log(`\x1b[1mEnvironment              ${PASS} READY — BASIC CHECKS ONLY\x1b[0m`);
    process.exit(0);
  }
}

// ---------------------------------------------------------------------------
// Phase 2: Full checks (node_modules present)
// ---------------------------------------------------------------------------

// --- Dependency tree valid ---
// `npm ls` exits non-zero when it finds problems and prints the tree on stdout regardless, so
// this reads stdout rather than treating the exit code as the whole answer. Naming the packages
// is the point: "installed tree has problems" hid two peer-dependency violations for weeks.
// Read stdout RAW. `safeExec` runs it through `sanitizeDiagnosticText`, which rewrites
// credential-shaped URLs — and an npm tree is full of registry URLs, so the sanitized text is no
// longer valid JSON. Nothing printed from here comes from the raw text: only the extracted
// problem lines are shown, and those are package names.
let npmLsStdout = '';
try {
  npmLsStdout = execSync('npm ls --all --json', {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (err) {
  // Non-zero exit is the normal case when problems exist; the tree is still on stdout.
  npmLsStdout = err?.stdout ?? '';
}
const deps = summarizeDependencyProblems(npmLsStdout);
if (!deps.parsed) {
  fail('Dependencies', 'could not read the installed tree');
} else if (deps.problems.length === 0) {
  line('Dependencies', 'installed tree valid', true);
} else {
  fail('Dependencies', `${deps.problems.length} problem${deps.problems.length === 1 ? '' : 's'}`);
  for (const problem of deps.problems.slice(0, 10)) console.log(`    ${problem}`);
}

// --- Prisma client ---
const prismaClientPath = resolve(ROOT, 'node_modules', '.prisma', 'client', 'index.js');
if (existsSync(prismaClientPath)) {
  line('Prisma client', 'generated', true);
} else {
  fail('Prisma client', 'not generated — run: npx prisma generate');
}

console.log();

// --- Env check via structured JSON helper ---
let envResult = null;
try {
  let tsxCli;
  try {
    const tsxResolve = safeExec('node -e "process.stdout.write(require.resolve(\'tsx/cli\'))"');
    tsxCli = tsxResolve.stdout.trim();
  } catch {
    tsxCli = null;
  }

  if (tsxCli && existsSync(tsxCli)) {
    const envCheckScript = resolve(__dirname, 'doctor-env-check.ts');
    const envCheckResult = safeExec(
      `"${process.execPath}" "${tsxCli}" "${envCheckScript}"`,
      { timeout: 30_000 },
    );

    if (envCheckResult.stdout.trim()) {
      try {
        envResult = JSON.parse(envCheckResult.stdout.trim());
      } catch {
        envResult = null;
      }
    }
  }
} catch {
  envResult = null;
}

if (envResult && envResult._error) {
  fail('Env check', `error: ${envResult._error}`);
  envResult = null;
}

if (envResult) {
  // --- Database identity ---
  if (envResult.database.application) {
    const db = envResult.database.application;
    line('Application DB', `${db.host} / ${db.database}  (from ${db.source === 'env-file' ? '.env file' : 'env'})`, null);
  } else {
    fail('Application DB', 'not configured');
  }

  if (envResult.database.direct) {
    const db = envResult.database.direct;
    line('Direct DB', `${db.host} / ${db.database}  (from ${db.source === 'env-file' ? '.env file' : 'env'})`, null);
  } else {
    fail('Direct DB', 'not configured');
  }

  // --- Topology ---
  if (envResult.database.topology === 'all-local') {
    line('Topology', 'all local', true);
  } else if (envResult.database.topology === 'all-remote') {
    line('Topology', 'all remote', true);
  } else if (envResult.database.topology === 'hybrid') {
    line('Topology', 'hybrid', null);
    warn('HYBRID DEVELOPMENT TOPOLOGY');
    console.log('    Verify that the worker used for this session connects');
    console.log('    to the same Redis and database instances as this machine.');
  } else {
    line('Topology', 'unknown', null);
  }
} else if (!envResult) {
  // Every file the application and the certification ladder read, not just `.env`. Checking
  // `.env` alone reported a machine configured through `.env.local` as having no configuration.
  if (!ENV_FILES.some((file) => existsSync(resolve(ROOT, file)))) {
    fail('Application DB', 'not configured');
    fail('Direct DB', 'not configured');
    actionRequired(
      `No ${ENV_FILES.join(' or ')} file found. Provision environment variables from\n` +
      '  the team\'s secure secrets source. See docs/NEW_MACHINE.md.\n' +
      '  Reference template: .env.example\n\n' +
      '  Do NOT copy .env.example directly — it contains placeholder\n' +
      '  values, not working credentials.',
    );
  } else {
    fail('Env check', 'failed to run environment validation');
  }
}

// --- Migration order ---
const migOrderResult = safeExecCode('node scripts/check-migration-order.mjs');
if (migOrderResult.ok) {
  line('Migration order', 'valid', true);
} else {
  fail('Migration order', 'invalid');
}

// --- Migration status (READINESS GATE) ---
if (envResult && (envResult.database.application || envResult.database.direct)) {
  // Spawned through node, not `npx prisma` — see PRISMA_MIGRATE_STATUS_ARGS.
  //
  // The env files have to be loaded HERE. `doctor-env-check.ts` merges them into its own
  // process, which is a child; nothing propagates back, so this process still has no
  // DATABASE_URL and Prisma failed with `Environment variable not found: DIRECT_URL` — reported
  // as "status check failed", which reads as a schema problem rather than a missing variable.
  const parsedEnvFiles = {};
  for (const file of ENV_FILES) {
    const filePath = resolve(ROOT, file);
    if (!existsSync(filePath)) continue;
    try {
      parsedEnvFiles[file] = parseEnvFile(readFileSync(filePath, 'utf8'));
    } catch {
      // An unreadable env file is reported by the checks above; do not fail the whole run here.
    }
  }
  const migStatusResult = safeExec(
    `"${process.execPath}" ${PRISMA_MIGRATE_STATUS_ARGS.map((a) => `"${a}"`).join(' ')}`,
    { timeout: 120_000, env: mergeEnvFiles(process.env, parsedEnvFiles) },
  );
  const migrationsDir = resolve(ROOT, 'prisma', 'migrations');
  let totalMigrations = 0;
  if (existsSync(migrationsDir)) {
    try {
      const entries = execSync(`node -e "const fs=require('fs');const d=fs.readdirSync('${migrationsDir.replace(/\\/g, '\\\\')}');console.log(d.filter(e=>!e.startsWith('.')).length)"`, {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      totalMigrations = Math.max(0, parseInt(entries, 10) - 1);
    } catch {
      totalMigrations = 0;
    }
  }

  if (migStatusResult.ok) {
    const migrationInfo = totalMigrations > 0 ? `${totalMigrations} / ${totalMigrations} applied` : 'up to date';
    line('Migrations', migrationInfo, true);
  } else {
    fail('Migrations', 'status check failed');
    // Prisma says which migrations are pending, or why it could not connect. Reporting only
    // "status check failed" made a broken invocation look like a schema that was behind.
    const detail = `${migStatusResult.stdout}\n${migStatusResult.stderr}`;
    for (const detailLine of detail.split('\n').slice(0, 12)) {
      if (detailLine.trim()) console.log(`    ${detailLine.trimEnd()}`);
    }
  }
}

console.log();

// --- Redis ---
if (envResult) {
  if (envResult.redis.configured) {
    if (envResult.redis.reachable) {
      line('Redis', 'reachable', true);
    } else if (envResult.redis.reachable === false) {
      fail('Redis', 'unreachable');
    } else {
      line('Redis', 'configured but untested', null);
    }
  } else {
    line('Redis', 'not configured', null);
  }

  // --- Worker config ---
  if (envResult.workerConfig.valid) {
    line('Worker config', 'valid', true);
  } else {
    fail('Worker config', 'invalid');
    for (const reason of envResult.workerConfig.reasons) {
      console.log(`    - ${reason}`);
    }
  }

  console.log();

  // --- Env vars ---
  if (envResult.envVars.missing.length === 0 && envResult.envVars.placeholders.length === 0) {
    line('Required env vars', 'present', true);
  } else {
    if (envResult.envVars.missing.length > 0) {
      fail('Required env vars', `missing: ${envResult.envVars.missing.join(', ')}`);
    }
    if (envResult.envVars.placeholders.length > 0) {
      fail('Placeholder values', envResult.envVars.placeholders.join(', '));
    }
  }

  // --- AI keys ---
  const aiParts = [];
  if (envResult.aiKeys.groq) aiParts.push('GROQ set');
  else aiParts.push('GROQ missing');
  if (envResult.aiKeys.gemini) aiParts.push('GEMINI set');
  else aiParts.push('GEMINI missing');
  line('AI provider keys', `optional (${aiParts.join(', ')})`, null);

  // --- Email safety (HARD FAIL) ---
  if (envResult.dryRunEnabled) {
    line('Email dry-run', 'enabled', true);
  } else {
    fail(
      'Email dry-run',
      envResult.dryRunSet
        ? 'DISABLED — live email sending is active'
        : 'not set (defaults to dry-run ON, but must be explicit)',
    );
    actionRequired(
      'EMAIL_SEND_DRY_RUN is not "true". Set it to "true" in .env\n' +
      '  to prevent live email sending in development.',
    );
  }

  if (envResult.autosendDisabled) {
    line('Sequence autosend', 'disabled', true);
  } else {
    fail(
      'Sequence autosend',
      envResult.autosendSet
        ? 'ENABLED — sequences will send live email'
        : 'not set (defaults to autosend OFF, but must be explicit)',
    );
    actionRequired(
      'SEQUENCE_AUTOSEND_ENABLED is not "false". Set it to "false" in .env\n' +
      '  to prevent automated sequence email sending in development.',
    );
  }
}

// --- TypeScript ---
console.log();
// Spawned through node directly. `npx tsc` cannot run in a checkout whose path contains an
// `&`, and the failure was reported as "TypeScript errors" on a tree that has none.
const tscResult = safeExecCode(
  `"${process.execPath}" ${TYPECHECK_ARGS.map((a) => `"${a}"`).join(' ')}`,
  { timeout: 600_000, env: { ...process.env, NODE_OPTIONS: TYPECHECK_NODE_OPTIONS } },
);
const tscVerdict = classifyTypecheckResult(tscResult);
if (tscVerdict.ok) {
  line('TypeScript', tscVerdict.summary, true);
} else {
  fail('TypeScript', tscVerdict.summary);
  // Print the diagnostics. Reporting only the word "errors" made a broken invocation and a
  // genuine type error indistinguishable, which is how this went unnoticed.
  for (const detailLine of tscVerdict.detail.split('\n').slice(0, 15)) {
    if (detailLine.trim()) console.log(`    ${detailLine.trimEnd()}`);
  }
}

// ---------------------------------------------------------------------------
// Final verdict
// ---------------------------------------------------------------------------
console.log();

if (actionItems.length > 0) {
  console.log(`  ${WARN_ICON} \x1b[1mACTION REQUIRED\x1b[0m`);
  for (const item of actionItems) {
    console.log(`  ${item}`);
    console.log();
  }
}

if (hasFailure) {
  console.log(`\x1b[1mEnvironment              ${FAIL} NOT READY\x1b[0m`);
  process.exit(1);
} else {
  console.log(`\x1b[1mEnvironment              ${PASS} READY\x1b[0m`);
  console.log();
  console.log('Code, runtime, dependencies, configuration, schema-migration');
  console.log('state, and service prerequisites are aligned.');
  console.log('Database contents and remote service state are not compared.');
  process.exit(0);
}
