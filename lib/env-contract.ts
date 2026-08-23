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
// The declared contract
// ---------------------------------------------------------------------------

/**
 * Which variables the application requires, and which groups are optional.
 *
 * Declared here rather than inside `lib/env.ts` because three separate consumers need the
 * same list — the boot validator, the production deploy gate, and the `agent facts`
 * generator — and they had already drifted apart. `lib/env.ts` warned about a single
 * `GROQ_API_KEY` for the whole "AI assistant" group, while `scripts/prod-check-env.ts` and
 * `.env.production.example` correctly required all three providers. A deployment missing
 * OpenAI and Gemini credentials would therefore boot with no warning at all, and the failover
 * the three-provider contract exists to guarantee would silently not exist.
 *
 * Names only. This module never holds a value.
 */

/** Absent at boot, the application cannot run at all. */
export const RUNTIME_REQUIRED_ENV = ['DATABASE_URL', 'AUTH_SECRET', 'ENCRYPTION_KEY'] as const;

/**
 * Telestar AI routes across three providers and fails over between them.
 *
 * All three are one group on purpose: a deployment holding one key has no failover, and the
 * production chat outage this guards against was exactly that — one provider, one withdrawn
 * model, nothing else reachable.
 */
export const AI_PROVIDER_ENV = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY'] as const;

/**
 * Optional integration groups. Partially configured is a warning; entirely absent disables
 * the feature and, in production, says so.
 */
export const OPTIONAL_ENV_GROUPS: Record<string, readonly string[]> = {
  'Gmail OAuth': ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'],
  'Microsoft OAuth': ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_REDIRECT_URI'],
  'Cron auth': ['CRON_SECRET'],
  'Telestar AI providers': AI_PROVIDER_ENV,
};

/** Additionally required in a production deployment, beyond the runtime set above. */
export const PRODUCTION_REQUIRED_ENV = [
  'DEPLOY_TARGET',
  'CRM_IMAGE',
  'DATABASE_URL',
  'DIRECT_URL',
  'BACKUP_DATABASE_URL',
  'REDIS_URL',
  'CRM_DOMAIN',
  'NEXTAUTH_URL',
  'CADDY_SITE_ADDRESS',
  'AUTH_SECRET',
  'ENCRYPTION_KEY',
  'CRON_SECRET',
  'EMAIL_SEND_DRY_RUN',
  'SEQUENCE_AUTOSEND_ENABLED',
  ...AI_PROVIDER_ENV,
] as const;

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
// RLS enablement contract
// ---------------------------------------------------------------------------

export type RlsContractResult = {
  /** Whether PostgreSQL is expected to be enforcing the policies. */
  enforced: boolean;
  /** Whether a cross-tenant connection is configured. */
  maintenanceConfigured: boolean;
  ok: boolean;
  reason: string | null;
};

/**
 * `DB_RLS_ENFORCED=true` without `CRM_MAINTENANCE_URL` is a silent outage.
 *
 * Since `supabase/rls.sql` made the policies role-targeted, the application role has no
 * policy that consults `app.bypass_rls` — setting that flag grants it nothing. Everything
 * that legitimately crosses tenants (the workers, the seeds, the operational scripts, and
 * the public share-link lookup, which answers with no session and therefore no tenant) has
 * to connect as `crm_maintenance` instead.
 *
 * Misconfigured, none of that raises. A worker reads zero rows and reports a clean, empty,
 * wrong answer; a share link reads as revoked; outbound stops because the quota reserve
 * matches nothing. That exact shape has now been found four separate times in this codebase,
 * which is why this is a startup check and not a line in a runbook.
 *
 * Pure, so it is tested without a database or a process to boot — see
 * `tests/rls-env-contract.test.ts`.
 */
export const checkRlsContract = (env: Record<string, string | undefined>): RlsContractResult => {
  const enforced = normalize(env.DB_RLS_ENFORCED) === 'true';
  const maintenanceConfigured = Boolean((env.CRM_MAINTENANCE_URL || '').trim());

  if (enforced && !maintenanceConfigured) {
    return {
      enforced,
      maintenanceConfigured,
      ok: false,
      reason:
        'DB_RLS_ENFORCED=true but CRM_MAINTENANCE_URL is not set. The policies in ' +
        'supabase/rls.sql are role-targeted, so the application role cannot read across ' +
        'tenants at all — workers, seeds, scripts and the public share-link lookup would ' +
        'silently read zero rows. Set CRM_MAINTENANCE_URL to the crm_maintenance DSN.',
    };
  }

  return { enforced, maintenanceConfigured, ok: true, reason: null };
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
