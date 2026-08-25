/**
 * The credential the live-verification scripts sign in with.
 *
 * Fifteen scripts used to carry the literal `Telestar2026` inline, and twelve of them point
 * at `https://crm.telestar.cloud`. It was not a fixture: `restore-internal-users.ts` assigned
 * it to all 44 roster accounts, and `sync-users-to-production.ts` authenticated to production
 * with it as a director. This repository is public, so every one of those lines published a
 * working production login — and `.gitleaks.toml` carried the string on its allowlist under
 * "Test credentials & mock tokens", which is why no gate ever said so (TEL-P0-009).
 *
 * There is no default here, deliberately. A script that cannot find the credential must stop
 * and say so: the failure mode of a default is that it keeps working, silently, against
 * production, with a secret anyone can read.
 */

/** The environment variable every live-verification script reads. */
export const LIVE_PASSWORD_ENV = 'TELESTAR_LIVE_PASSWORD';

/**
 * The password for the live-verification account, from the environment.
 *
 * @throws if it is unset or empty — never returns a fallback.
 */
export function requireLivePassword(): string {
  const value = process.env[LIVE_PASSWORD_ENV];
  if (!value || value.trim() === '') {
    throw new Error(
      `REFUSED: ${LIVE_PASSWORD_ENV} is not set. This script signs in to a live deployment and has no ` +
        'default credential — the previous one was a literal committed to a public repository. Export ' +
        `${LIVE_PASSWORD_ENV} for this shell only, and never write it into a file in this tree.`
    );
  }
  return value;
}
