#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Run a command with the project's env loaded, identically on every machine.
 *
 * Next.js loads `.env.local` automatically; **the Prisma CLI does not.** So a machine that keeps
 * its values in `.env.local` — as this project's `.gitignore` and `.env.example` both assume —
 * fails every documented `prisma` command with:
 *
 * ```text
 * Error: P1012  Environment variable not found: DIRECT_URL
 * ```
 *
 * while a machine that happens to also have a `.env` works fine. Same repo, same command, same
 * commit, different outcome. That is the drift this wrapper removes: `npm run db:status` behaves
 * the same wherever it runs.
 *
 *     node scripts/with-env.mjs <command> [args...]
 *
 * `{{VAR}}` in any argument is replaced with that variable's value after loading, which is how a
 * command that needs a URL *as an argument* (`--shadow-database-url`) stays cross-platform —
 * `$VAR` would not expand on Windows, and `%VAR%` would not expand anywhere else.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Precedence: `.env.local` wins over `.env`, and a variable already in the real environment wins
 * over both. That matches Next.js and means CI — which sets everything in the environment and
 * ships no env file — is unaffected by this wrapper.
 */
const ENV_FILES = ['.env.local', '.env'];

function parseEnvFile(contents) {
  const out = {};
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip one layer of matching quotes; leave inner content alone.
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

export function loadProjectEnv(root = ROOT, base = process.env) {
  const loaded = { ...base };
  const sources = [];

  for (const file of ENV_FILES) {
    const full = path.join(root, file);
    if (!existsSync(full)) continue;
    sources.push(file);
    const parsed = parseEnvFile(readFileSync(full, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      // First file wins, and the real environment wins over every file.
      if (loaded[key] === undefined) loaded[key] = value;
    }
  }

  return { env: loaded, sources };
}

/** Replace `{{VAR}}` with the loaded value. An unknown variable is left as-is, not blanked. */
export function substitute(arg, env) {
  return arg.replace(/\{\{([A-Z0-9_]+)\}\}/g, (whole, name) =>
    env[name] === undefined ? whole : env[name]
  );
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command) {
    console.error('usage: node scripts/with-env.mjs <command> [args...]');
    return 1;
  }

  const { env } = loadProjectEnv();
  const args = rest.map((arg) => substitute(arg, env));

  const result = spawnSync(command, args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
  if (result.error) {
    console.error(`[with-env] failed to run "${command}": ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exit(main());
}
