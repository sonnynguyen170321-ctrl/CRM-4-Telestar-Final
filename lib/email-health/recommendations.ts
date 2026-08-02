import type { HealthReasonCode } from './types';

/**
 * Human-readable labels and remediation steps, keyed by reason code.
 *
 * Kept separate from scoring.ts on purpose: the scorer owns the thresholds, this
 * file owns the wording. Neither duplicates the other's condition checks.
 */

export const REASON_LABEL: Record<HealthReasonCode, string> = {
  mailbox_inactive: 'Mailbox is disconnected or marked inactive',
  send_paused: 'Sending is paused by a manager',
  stale_sync: 'Last inbox sync is more than 24 hours old',
  hard_bounce_critical: 'Hard bounce rate is above the critical threshold',
  hard_bounce_elevated: 'Hard bounce rate is elevated',
  soft_bounce_elevated: 'Soft bounce rate is elevated',
  spam_signals: 'Recipients are marking messages as spam',
  daily_cap_nearly_exhausted: 'Daily sending cap is nearly exhausted',
  no_replies_at_volume: 'No replies despite meaningful send volume',
  dns_unverified: 'Sending domain DNS is unverified or failing',
};

export const RECOMMENDED_ACTION: Record<HealthReasonCode, string> = {
  mailbox_inactive: 'Reconnect the mailbox in Settings, then run a sync',
  send_paused: 'Review the pause reason and resume sending when the issue is resolved',
  stale_sync: 'Run a sync now; if it fails, reconnect the mailbox credentials',
  hard_bounce_critical: 'Pause auto-send for this inbox and audit the source lead list',
  hard_bounce_elevated: 'Review recent bounces and verify the most recent lead import',
  soft_bounce_elevated: 'Reduce daily volume temporarily; soft bounces often signal throttling',
  spam_signals: 'Review message content and cadence; consider switching to LinkedIn or calls',
  daily_cap_nearly_exhausted: 'Spread sends across the day or raise the cap if the domain is warm',
  no_replies_at_volume: 'Check that outbound mail is landing in the inbox; review copy and targeting',
  dns_unverified: 'Run a DNS check and fix SPF, DKIM, DMARC and MX records for the domain',
};

/** Maps reason codes to their labels, preserving order and dropping duplicates. */
export function labelsFor(reasonCodes: readonly HealthReasonCode[]): string[] {
  return Array.from(new Set(reasonCodes)).map((code) => REASON_LABEL[code]);
}

/** Maps reason codes to remediation steps, preserving order and dropping duplicates. */
export function recommendationsFor(reasonCodes: readonly HealthReasonCode[]): string[] {
  return Array.from(new Set(reasonCodes)).map((code) => RECOMMENDED_ACTION[code]);
}
