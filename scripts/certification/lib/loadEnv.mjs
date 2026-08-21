import { existsSync } from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';

import { REPO_ROOT } from './paths.mjs';

/**
 * Load configuration the way the rest of this project does.
 *
 * The ladder used to `import 'dotenv/config'`, which reads `.env` and nothing else. This
 * repository keeps its local configuration in `.env.local` — the Next.js convention the app,
 * the dev server and `agent doctor` all follow — and has no `.env` at all. So on a machine set
 * up exactly as the project documents, gate 02 failed with:
 *
 *     DATABASE_URL is not set
 *     REDIS_URL is not set; the Redis-dependent gates cannot run
 *
 * That is a real failure of a real gate, correctly reported — but for an environment-loading
 * reason rather than anything about the candidate, and it wastes a full ladder run to discover.
 *
 * Precedence matches Next.js: `.env.local` wins over `.env`. Neither overrides a variable
 * already exported in the shell, so CI — which exports everything explicitly — is unaffected.
 */
export function loadCertificationEnv({ root = REPO_ROOT } = {}) {
  const files = ['.env.local', '.env']
    .map((name) => path.join(root, name))
    .filter((file) => existsSync(file));

  if (files.length > 0) {
    dotenv.config({ path: files, override: false, quiet: true });
  }

  return files.map((file) => path.basename(file));
}

/**
 * Variables the ladder cannot supply for itself.
 *
 * `E2E_PASSWORD` is deliberately not in any env file: it is run-scoped, and
 * `e2e/support/fixture.ts` refuses the published demo password. It has to come from the
 * operator, so the failure for a missing one should say that rather than surfacing as a
 * browser gate failing to sign in.
 */
export const OPERATOR_SUPPLIED = ['E2E_PASSWORD'];

export function missingOperatorEnv() {
  return OPERATOR_SUPPLIED.filter((key) => !(process.env[key] || '').trim());
}
