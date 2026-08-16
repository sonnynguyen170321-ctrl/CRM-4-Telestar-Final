/**
 * Outbound-email kill switches.
 *
 * Both flags used to be read inline as bare string comparisons, which made them
 * fail *open*: `SEQUENCE_AUTOSEND_ENABLED` only disabled autosend on the literal
 * string `"false"`, and `EMAIL_SEND_DRY_RUN` only engaged dry-run on the literal
 * `"true"`. Anything else — unset, empty, `"False"`, `"0"`, a typo — meant real
 * mail went to real prospects. A single forgotten `--set-env-vars` or a dropped
 * line in an env file was enough.
 *
 * These invert that. The dangerous state now requires an explicit, exact opt-in;
 * everything else is safe. Comparisons stay exact (trimmed, case-insensitive) on
 * purpose rather than accepting `1`/`yes`/`on`: `scripts/prod-check-env.ts`
 * asserts the literal strings `"true"` and `"false"`, and a deploy gate is only
 * meaningful if the runtime agrees on the same spelling.
 *
 * Note the asymmetry is deliberate — each flag's *safe* value is its default:
 *   SEQUENCE_AUTOSEND_ENABLED  unset -> autosend OFF
 *   EMAIL_SEND_DRY_RUN         unset -> dry-run ON
 */

const normalize = (value: string | undefined): string => (value ?? '').trim().toLowerCase();

/**
 * True only when sequence autosend has been explicitly turned on.
 *
 * Read by the sequence-engine cron route, which calls EmailService.send()
 * directly. On a deployment without a worker this is the *only* guard on that
 * path — EMAIL_SEND_DRY_RUN does not apply there.
 */
export function isAutosendEnabled(): boolean {
  return normalize(process.env.SEQUENCE_AUTOSEND_ENABLED) === 'true';
}

/**
 * True unless dry-run has been explicitly turned off.
 *
 * When true the email worker records the OutboundMessage as sent with a
 * `dry-run-<id>` provider id and never contacts a provider.
 */
export function isDryRun(): boolean {
  return normalize(process.env.EMAIL_SEND_DRY_RUN) !== 'false';
}

/**
 * Global emergency kill switch.
 *
 * When true, no email (manual, sequence, or automated) can leave the system,
 * even if dry-run is false.
 */
export function isGlobalEmailPaused(): boolean {
  return normalize(process.env.EMAIL_GLOBAL_PAUSE) === 'true';
}

/**
 * Canary mode protection.
 *
 * When enabled (default true during live-email onboarding), only explicitly
 * allowlisted recipients can receive live emails.
 */
export function isCanaryMode(): boolean {
  return normalize(process.env.LIVE_EMAIL_CANARY_MODE) === 'true';
}

/**
 * Evaluates whether a recipient email address is allowed under canary constraints.
 * If canary mode is off, allows all recipients.
 * If canary mode is on, checks against comma-separated LIVE_EMAIL_ALLOWED_RECIPIENTS.
 */
export function isCanaryRecipientAllowed(recipientEmail: string): boolean {
  if (!isCanaryMode()) return true;
  const rawList = process.env.LIVE_EMAIL_ALLOWED_RECIPIENTS ?? '';
  const allowed = rawList
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return false;

  const normalized = (recipientEmail ?? '').trim().toLowerCase();
  if (!normalized) return false;
  const domain = normalized.split('@')[1];

  return allowed.includes(normalized) ||
    Boolean(domain && (allowed.includes(`@${domain}`) || allowed.includes(`*@${domain}`)));
}
