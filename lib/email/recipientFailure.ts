/**
 * Did the provider refuse the *recipient*, or refuse *us*?
 *
 * `classifySendFailure` answers a different question — whether the message reached the provider
 * at all — and both answers are needed at once. A refusal can be definite (`not_sent`) and still
 * say nothing about the address: on 2026-09-21 the provider refused 228 messages with
 * `550 5.4.6 Sender Hourly Quota Exceeded`, which is our hourly ceiling, not 228 dead mailboxes.
 * Suppressing on the `550` would have deleted a whole day's pipeline.
 *
 * So the split here is by DSN status code, not by the SMTP reply class:
 *
 * | code    | meaning                          | verdict     |
 * |---------|----------------------------------|-------------|
 * | 5.1.x   | bad destination address          | `recipient` |
 * | 5.2.x   | mailbox full, disabled, too big  | `recipient` |
 * | 5.4.6   | *our* sending limit              | `sender`    |
 * | 5.7.x   | policy, auth, blocklist          | `sender`    |
 * | 4.x.x   | temporary anything               | `sender`    |
 *
 * `sender` is deliberately the default. A message we cannot classify is one we do not act on:
 * wrongly suppressing a live prospect is silent and permanent, while wrongly retrying is
 * visible and bounded by the redrive cap.
 *
 * The user's rule (2026-09-23) is that *any* bounce suppresses immediately, hard or soft, with
 * no second attempt — so 5.2.x mailbox-full lands in `recipient` alongside 5.1.1 user-unknown.
 * That trades a few recoverable addresses for sender reputation, which is the trade they asked
 * for after watching a mailbox's health score fall.
 */

/** A refusal that is about the address, so the address must never be written to again. */
const RECIPIENT_DSN = /\b5\.[12]\.\d{1,3}\b/;

/**
 * Explicitly *not* about the address, checked first so it wins over anything below.
 * `5.4.6` is the hourly quota that caused the incident; `5.7.x` is policy, auth or a blocklist
 * against the sending domain — a problem with us, and suppressing the prospect would hide it.
 */
const SENDER_DSN = /\b5\.(4|5|7)\.\d{1,3}\b/;

/**
 * Wording used by providers that do not emit a DSN code. Each one names the *recipient* and
 * cannot be read as a sender-side limit. Kept narrow on purpose: `mailbox unavailable` is
 * absent because Gmail returns it for rate limiting as well as for a dead address.
 */
const RECIPIENT_PHRASES = [
  /user unknown/i,
  /no such user/i,
  /recipient (address )?(rejected|not found|unknown)/i,
  /address (does not exist|not found|unknown)/i,
  /does not exist at this (domain|address)/i,
  /unrouteable address/i,
  /invalid recipient/i,
  /mailbox (is )?(full|disabled|not found|does not exist|over quota)/i,
  /quota exceeded for (this )?(mailbox|recipient)/i,
  /account (is )?(disabled|inactive|closed)/i,
];

export type RecipientVerdict = 'recipient' | 'sender';

/**
 * `recipient` means: stop writing to this address. Everything else is `sender`.
 *
 * Callers must treat `sender` as "this was about us" and never suppress on it — see
 * `lib/email/suppress.ts`, which is the only thing allowed to act on a `recipient` verdict.
 */
export function classifyRecipientFailure(error: unknown): RecipientVerdict {
  const message =
    error instanceof Error ? `${error.message} ${String((error as { response?: unknown }).response ?? '')}` : String(error ?? '');

  // Order matters. A provider that sends `550 5.4.6 ... mailbox` would otherwise be read as a
  // dead address because of the trailing word, and a day's sending would be suppressed.
  if (SENDER_DSN.test(message)) return 'sender';
  if (RECIPIENT_DSN.test(message)) return 'recipient';
  if (RECIPIENT_PHRASES.some((pattern) => pattern.test(message))) return 'recipient';
  return 'sender';
}
