/**
 * What the sequence worker does when eligibility says an email step may not go out.
 *
 * Every BLOCK or TERMINATE reason is one of three kinds, so none can fall through and leave a task
 * pending with no job behind it (overdue forever, completable into an advance with no send):
 *
 *  - closing: final. The task is skipped with outcome `send_blocked` and a reason code.
 *  - recheck: someone can undo the cause (reconnect a mailbox, add an email, unarchive, lift a
 *    suppression, switch a campaign or sequence back on). The step waits and looks again with a
 *    backoff, and is closed once it has waited `RECHECK_CAP_MS`. Reviving on the lifting event was
 *    rejected: it needs a hook on every path that can lift a cause, and one missed path strands the
 *    step; rechecking needs none.
 *  - hold: stays pending with the hold recorded, because a person decides (the lead replied, a
 *    meeting is booked and the rep may hand the prospect back).
 *
 * Pure and browser-safe. `tests/sequence-block-policy.test.ts` scans eligibility.ts so a new reason
 * cannot be added without being classified here.
 */

export type BlockKind = 'closing' | 'recheck' | 'hold';

/** A recheck that has waited this long is closed. */
export const RECHECK_CAP_MS = 7 * 24 * 3600 * 1000;
const FIRST_DAY_MS = 24 * 3600 * 1000;
const FIRST_DAY_INTERVAL_MS = 3600 * 1000;
const LATER_INTERVAL_MS = 6 * 3600 * 1000;

const CLOSING = new Set(['tenant_invalid', 'step_mismatch']);
const RECHECK = new Set([
  'mailbox_inactive',
  'user_inactive',
  'sequence_inactive',
  'lead_archived',
  'lead_email_invalid',
  'lead_email_missing',
  'recipient_suppressed',
  'campaign_paused',
]);
const HOLD = new Set(['lead_replied', 'meeting_booked']);

/** Classify one eligibility reason. Unknown reasons close: never leave a step with nothing behind it. */
export function classifyBlock(reason: string): BlockKind {
  if (CLOSING.has(reason)) return 'closing';
  if (RECHECK.has(reason)) return 'recheck';
  if (HOLD.has(reason)) return 'hold';
  // Any other campaign state (completed, archived, ...) is final; paused is listed above.
  if (reason.startsWith('campaign_')) return 'closing';
  if (reason.startsWith('lead_stage_') || reason.startsWith('enrollment_')) return 'closing';
  return 'closing';
}

/** How long to wait before looking again, given how long the step has been waiting. */
export function recheckDelayMs(waitedMs: number): number {
  return waitedMs < FIRST_DAY_MS ? FIRST_DAY_INTERVAL_MS : LATER_INTERVAL_MS;
}

const HELD_SINCE = 'held_since:';

/** The task note that records when a recheck began. */
export function heldSinceNote(since: Date): string {
  return `${HELD_SINCE}${since.toISOString()}`;
}

/** When the recheck began, from the task note; null when the step is not in a recheck. */
export function parseHeldSince(notes: string | null | undefined): Date | null {
  if (!notes?.startsWith(HELD_SINCE)) return null;
  const at = new Date(notes.slice(HELD_SINCE.length));
  return Number.isNaN(at.getTime()) ? null : at;
}

export const REASON_CODE_PREFIX = 'code:';

/** A fixed reason code as stored on a task, never provider text. */
export function reasonCodeNote(code: string): string {
  return `${REASON_CODE_PREFIX}${code}`;
}

export function parseReasonCode(notes: string | null | undefined): string | null {
  if (!notes?.startsWith(REASON_CODE_PREFIX)) return null;
  return notes.slice(REASON_CODE_PREFIX.length).trim() || null;
}

/** Map a raw failure (provider text, our own refusal text) to a fixed code. The raw text goes no further. */
export function failureCodeFor(raw: string | null | undefined): string {
  const text = raw ?? '';
  if (/suppress/i.test(text)) return 'suppressed';
  if (/bounced earlier/i.test(text)) return 'bounced_earlier';
  if (/paused for this inbox|global email pause|auto-pause/i.test(text)) return 'mailbox_paused';
  if (/inactive|account not found|disconnected/i.test(text)) return 'mailbox_disconnected';
  if (/canary|restriction/i.test(text)) return 'sending_off';
  if (/quota|limit/i.test(text)) return 'limit';
  return 'rejected';
}

const FAILURE_LABELS: Record<string, string> = {
  suppressed: 'The recipient is on the do-not-contact list',
  bounced_earlier: 'This address bounced earlier',
  mailbox_paused: 'Sending is paused for this mailbox',
  mailbox_disconnected: 'The mailbox is no longer connected',
  sending_off: 'Sending to this address is switched off right now',
  limit: 'A sending limit was reached',
  rejected: 'The mail provider did not accept the message',
  recheck_expired: 'It stayed blocked for 7 days',
};

/** Plain wording for a stored code: ours for failures, the hold wording for a block reason. */
export function describeReasonCode(code: string, holdLabel: (reason: string) => string | null): string {
  return FAILURE_LABELS[code] ?? holdLabel(code) ?? 'The email could not be sent';
}
