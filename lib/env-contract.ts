/**
 * Shared environment-validation primitives.
 *
 * Both `scripts/prod-check-env.ts` (production deploy gate) and
 * `scripts/doctor-env-check.ts` (local dev diagnostic) import from here so
 * their definitions of "placeholder", "local host", "safe email config" and
 * "sanitised URL identity" can never diverge.
 *
 * RULE: this module must NEVER export raw credentials, full URLs, usernames,
 * passwords, query parameters, or API keys. Every public function that touches
 * a URL returns only the hostname and database name.
 */

// ---------------------------------------------------------------------------
// Placeholder detection
// ---------------------------------------------------------------------------

/** Matches common placeholder / example / local-dev sentinels in production env values. */
export const placeholderPattern =
  /<[^>]+>|replace|change-me|todo|localhost|example\.com/i;

/** Matches placeholder / example sentinels in development env values (ALLOWS localhost). */
export const devPlaceholderPattern =
  /<[^>]+>|replace|change-me|todo|example\.com|^your_|your_[a-z0-9_]*_here$/i;

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/** Safe URL parse — returns null instead of throwing on garbage input. */
export const parseUrl = (value: string | undefined): URL | null => {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres']);

/** True when the hostname is a well-known local/container alias. */
export const isLocalHost = (host: string): boolean =>
  LOCAL_HOSTS.has(host.toLowerCase());

/** Classify a hostname as local or remote. */
export const classifyHost = (hostname: string): 'local' | 'remote' =>
  isLocalHost(hostname) ? 'local' : 'remote';

// ---------------------------------------------------------------------------
// URL identity (safe to print)
// ---------------------------------------------------------------------------

export interface DbIdentity {
  host: string;
  database: string;
}

/**
 * Extract only the hostname and database name from a Postgres URL.
 *
 * Returns null when the value is missing/unparseable. NEVER returns username,
 * password, port, query parameters, or the original URL string.
 */
export const sanitizeDbUrl = (value: string | undefined): DbIdentity | null => {
  const url = parseUrl(value);
  if (!url) return null;
  // pathname is "/<dbname>" — strip the leading slash.
  const database = url.pathname.replace(/^\//, '') || '(none)';
  return { host: url.hostname, database };
};

// ---------------------------------------------------------------------------
// Email safety
// ---------------------------------------------------------------------------

const normalize = (value: string | undefined): string =>
  (value ?? '').trim().toLowerCase();

export interface EmailSafetyResult {
  dryRunEnabled: boolean;
  autosendDisabled: boolean;
  safe: boolean;
}

/**
 * Check whether outbound email settings are in the safe (non-sending) state.
 *
 * Mirrors the logic in lib/emailSafety.ts:
 *   EMAIL_SEND_DRY_RUN — safe when NOT explicitly 'false'
 *   SEQUENCE_AUTOSEND_ENABLED — safe when NOT explicitly 'true'
 */
export const checkEmailSafety = (env: Record<string, string | undefined>): EmailSafetyResult => {
  const dryRunEnabled = normalize(env.EMAIL_SEND_DRY_RUN) !== 'false';
  const autosendDisabled = normalize(env.SEQUENCE_AUTOSEND_ENABLED) !== 'true';
  return {
    dryRunEnabled,
    autosendDisabled,
    safe: dryRunEnabled && autosendDisabled,
  };
};

// ---------------------------------------------------------------------------
// Dev-context required env vars
// ---------------------------------------------------------------------------

/**
 * Variables required for a functional development environment.
 *
 * This is a SUBSET of the production required keys in prod-check-env.ts.
 * Production-only keys (CRM_IMAGE, BACKUP_DATABASE_URL, CRM_DOMAIN,
 * CADDY_SITE_ADDRESS) are deliberately excluded.
 */
export const DEV_REQUIRED_KEYS = [
  'DATABASE_URL',
  'DIRECT_URL',
  'REDIS_URL',
  'AUTH_SECRET',
  'ENCRYPTION_KEY',
  'NEXTAUTH_URL',
  'CRON_SECRET',
  'EMAIL_SEND_DRY_RUN',
  'SEQUENCE_AUTOSEND_ENABLED',
] as const;
