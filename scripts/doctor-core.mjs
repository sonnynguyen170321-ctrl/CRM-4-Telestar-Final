/**
 * Doctor core decision logic — pure functions for testing and runtime.
 *
 * Extracted so Vitest can test the EXACT decision logic Doctor uses
 * without mocking process.exit or whole CLI runs.
 */

// ---------------------------------------------------------------------------
// Canonical runtime versions
// ---------------------------------------------------------------------------
export const CANONICAL_NODE = '24.18.0';
export const CANONICAL_NPM = '11.16.0';

// ---------------------------------------------------------------------------
// Credential sanitization
// ---------------------------------------------------------------------------

/**
 * Strip credentials, passwords, and sensitive URL tokens from text.
 */
export function sanitizeDiagnosticText(text) {
  if (!text) return '';
  return text
    // Postgres URLs (handles postgresql:// and postgres:// with pass/user)
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, '<redacted-pg-url>')
    // Redis URLs
    .replace(/rediss?:\/\/[^\s'"]+/gi, '<redacted-redis-url>')
    // Generic credential-shaped URLs (scheme://user:pass@host)
    .replace(/[a-z]+:\/\/[^:]+:[^@]+@[^\s'"]+/gi, '<redacted-url>')
    // Hex keys (64-char) that look like ENCRYPTION_KEY values
    .replace(/[0-9a-f]{64}/gi, '<redacted-hex-key>')
    // Known env var assignment patterns
    .replace(/(?:API_KEY|SECRET|PASSWORD|TOKEN|ENCRYPTION_KEY)=\S+/gi, '<redacted>');
}

// ---------------------------------------------------------------------------
// Version validation
// ---------------------------------------------------------------------------

export function evaluateVersionState({ nvmrc, nodeVersionFile, actualNode, actualNpm }) {
  const errors = [];
  const warnings = [];

  // File consistency
  if (nvmrc && nodeVersionFile) {
    if (nvmrc.trim() !== nodeVersionFile.trim()) {
      errors.push(`.nvmrc (${nvmrc.trim()}) and .node-version (${nodeVersionFile.trim()}) diverge`);
    }
  } else if (!nvmrc && !nodeVersionFile) {
    errors.push('Neither .nvmrc nor .node-version file found');
  }

  // Node exact match
  if (actualNode !== CANONICAL_NODE) {
    errors.push(`Node version is ${actualNode} (expected ${CANONICAL_NODE})`);
  }

  // npm exact match
  if (actualNpm !== CANONICAL_NPM) {
    errors.push(`npm version is ${actualNpm} (expected ${CANONICAL_NPM})`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Git & Remote validation
// ---------------------------------------------------------------------------

export function evaluateGitState({ branch, isClean, localSha, remoteSha, remoteAvailable, requireMain }) {
  const isOnMain = branch === 'main';
  let status = 'PASS';
  let message = '';
  let isFailure = false;

  if (requireMain && !isOnMain) {
    return {
      ok: false,
      status: 'FAIL',
      message: 'not on main — use git switch main',
      workingTreeClean: isClean,
    };
  }

  if (!isClean && requireMain) {
    isFailure = true;
  }

  if (!remoteAvailable) {
    if (requireMain) {
      status = 'FAIL';
      message = 'remote unavailable (network required for --require-main)';
      isFailure = true;
    } else {
      status = 'WARN';
      message = 'remote: unavailable (network)';
    }
  } else if (isOnMain) {
    if (localSha === remoteSha) {
      status = 'PASS';
      message = 'synchronized';
    } else {
      status = 'FAIL';
      message = 'not synchronized with remote main';
      isFailure = true;
    }
  } else {
    const shortRemote = (remoteSha || '').slice(0, 7);
    status = 'INFO';
    message = `${shortRemote} (diverged — expected on feature branch)`;
  }

  return {
    ok: !isFailure,
    status,
    message,
    workingTreeClean: isClean,
  };
}

// ---------------------------------------------------------------------------
// Topology classification
// ---------------------------------------------------------------------------

export function classifyTopology(appClassification, directClassification, redisClassification) {
  const items = [
    appClassification,
    directClassification,
    redisClassification,
  ].filter(Boolean);

  if (items.length === 0) return 'unknown';

  const allLocal = items.every((c) => c === 'local');
  const allRemote = items.every((c) => c === 'remote');

  if (allLocal) return 'all-local';
  if (allRemote) return 'all-remote';
  return 'hybrid';
}

// ---------------------------------------------------------------------------
// Strict Email Safety Validation
// ---------------------------------------------------------------------------

export function evaluateStrictEmailSafety(env) {
  const dryRunValue = (env.EMAIL_SEND_DRY_RUN ?? '').trim().toLowerCase();
  const autosendValue = (env.SEQUENCE_AUTOSEND_ENABLED ?? '').trim().toLowerCase();

  const dryRunStrict = dryRunValue === 'true';
  const autosendStrict = autosendValue === 'false';

  // Whether the variable was set at all, which is a different failure from being set wrong.
  // `lib/emailSafety.ts` fails CLOSED: unset means dry-run on and autosend off. Doctor still
  // requires both to be set explicitly — that is deliberate defence in depth, so a later change
  // to the default cannot silently start sending — but it must not report an unset variable as
  // "live email sending is active", which is the opposite of what the code does.
  const dryRunSet = dryRunValue !== '';
  const autosendSet = autosendValue !== '';

  const actionItems = [];
  if (!dryRunStrict) {
    actionItems.push(
      'EMAIL_SEND_DRY_RUN is not "true". Set it to "true" in .env to prevent live email sending in development.'
    );
  }
  if (!autosendStrict) {
    actionItems.push(
      'SEQUENCE_AUTOSEND_ENABLED is not "false". Set it to "false" in .env to prevent automated sequence email sending in development.'
    );
  }

  return {
    ok: dryRunStrict && autosendStrict,
    dryRunStrict,
    autosendStrict,
    dryRunSet,
    autosendSet,
    actionItems,
  };
}

// ---------------------------------------------------------------------------
// Environment file resolution
// ---------------------------------------------------------------------------

/**
 * The env files Doctor reads, in precedence order (first wins).
 *
 * Doctor used to read `.env` alone. Next.js reads `.env.local` first and so does the
 * certification ladder's `loadEnv.mjs`, so on a machine configured the documented way Doctor
 * reported every required variable missing and printed NOT READY — while the application and
 * the certifier both started fine. A checker that disagrees with what actually runs teaches
 * operators to ignore it.
 */
export const ENV_FILES = ['.env.local', '.env'];

/**
 * Minimal `KEY=VALUE` parser, so `doctor.mjs` can load env files without depending on `dotenv`.
 *
 * `doctor.mjs` runs before `npm install` is guaranteed to have succeeded — that is most of its
 * job — so it cannot import a package. `doctor-env-check.ts` runs later and uses real `dotenv`.
 * This handles the subset the contract actually uses: comments, blank lines, `export ` prefixes,
 * and single- or double-quoted values.
 */
export function parseEnvFile(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, '');
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Merge parsed env files into a base environment.
 *
 * Precedence, highest first: the inherited process environment, then each file in `ENV_FILES`
 * order. Nothing already set is overwritten — the same rule `doctor-env-check.ts` applied to a
 * single file, extended to the list.
 *
 * @param base    the inherited environment (never mutated)
 * @param parsed  file contents keyed by filename, as returned by `dotenv.parse`
 * @returns a new environment object
 */
export function mergeEnvFiles(base, parsed) {
  const merged = { ...base };
  for (const file of ENV_FILES) {
    const vars = parsed[file];
    if (!vars) continue;
    for (const [key, value] of Object.entries(vars)) {
      if (merged[key] === undefined || merged[key] === '') merged[key] = value;
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Typecheck invocation
// ---------------------------------------------------------------------------

/**
 * Argv for the TypeScript check, to be spawned with `process.execPath`.
 *
 * Not `npx tsc`: this checkout's path contains an `&`, which cmd.exe treats as a command
 * separator, so the npx shim resolved `C:\Users\admin\Desktop\typescript\bin\tsc` and exited 1.
 * Doctor reported "TypeScript errors" on a tree with none — and, because it discarded the
 * subprocess output, gave the operator no way to tell a broken invocation from a real error.
 *
 * The heap ceiling is the same one `scripts/build.cjs` needs; the default is not enough for
 * this program and tsc dies with an allocation failure that also looks like "errors".
 */
export const TYPECHECK_ARGS = ['node_modules/typescript/bin/tsc', '--noEmit'];
export const TYPECHECK_NODE_OPTIONS = '--max-old-space-size=8192';

/**
 * Turn a typecheck subprocess result into a Doctor verdict.
 *
 * Distinguishes the two failures doctor used to collapse into one word. `detail` is already
 * sanitized by the caller.
 */
export function classifyTypecheckResult({ ok, detail = '' }) {
  if (ok) return { ok: true, summary: 'pass', detail: '' };

  const errorCount = (detail.match(/error TS\d+/g) ?? []).length;
  if (errorCount > 0) {
    return { ok: false, summary: `${errorCount} type error${errorCount === 1 ? '' : 's'}`, detail };
  }
  // No TS diagnostics in the output means tsc never got far enough to produce any.
  return { ok: false, summary: 'could not run tsc', detail };
}

// ---------------------------------------------------------------------------
// Prisma invocation
// ---------------------------------------------------------------------------

/**
 * Argv for `prisma migrate status`, to be spawned with `process.execPath`.
 *
 * `npx prisma` fails here for the same reason `npx tsc` did — see TYPECHECK_ARGS. Doctor
 * reported "Migrations status check failed" on a database whose 50 migrations were all applied,
 * which is the most misleading possible reading: it says the schema might be behind when it is
 * not, right next to a migration-order check that passes.
 */
export const PRISMA_MIGRATE_STATUS_ARGS = [
  'node_modules/prisma/build/index.js',
  'migrate',
  'status',
];

// ---------------------------------------------------------------------------
// Dependency tree
// ---------------------------------------------------------------------------

/**
 * Extract the package-level problems from `npm ls --all --json` output.
 *
 * Doctor reported "installed tree has problems" and stopped there, so nobody could tell a
 * cosmetic `extraneous` from a peer-dependency violation that will pick the wrong module at
 * runtime. The names are the whole point of running the check.
 *
 * `npm ls` exits non-zero for problems, so the JSON arrives on stdout of a *failed* command —
 * the caller has to pass stdout, not stderr.
 *
 * @param stdout raw stdout from `npm ls --all --json`
 * @returns { parsed, problems } — `parsed: false` means the output was not usable JSON, which
 *          is itself a failure rather than a clean tree.
 */
export function summarizeDependencyProblems(stdout) {
  let tree;
  try {
    tree = JSON.parse(stdout);
  } catch {
    return { parsed: false, problems: [] };
  }
  if (!tree || typeof tree !== 'object') return { parsed: false, problems: [] };

  const seen = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    for (const problem of node.problems ?? []) {
      // Strip the absolute path: it is noise, and on this machine it also contains the
      // checkout path, which sanitizeDiagnosticText does not treat as a secret but which
      // makes each line unreadably long.
      seen.add(String(problem).replace(/\s+[A-Za-z]:\\.*$/, '').trim());
    }
    for (const child of Object.values(node.dependencies ?? {})) visit(child);
  };
  visit(tree);

  return { parsed: true, problems: [...seen].sort() };
}
