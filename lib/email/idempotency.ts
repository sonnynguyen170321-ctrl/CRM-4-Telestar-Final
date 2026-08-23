/**
 * Deterministic idempotency keys for outbound email.
 *
 * The key identifies *the intent to send*, so it must be derivable from durable
 * identifiers alone. It must never include subject, body, or anything else that a
 * template re-render can change: the previous scheme hashed
 * `leadId:accountId:subject`, which failed in both directions at once —
 *
 *   - two legitimately different sends sharing a subject (a re-enrollment, a
 *     follow-up step reusing a subject line) collided on one key and the second
 *     email was silently dropped;
 *   - the same task retried after a re-render produced a *different* key, so the
 *     duplicate-suppressing unique constraint never fired and the recipient got the
 *     email twice.
 *
 * Every key is prefixed by its source so keys from different origins can never
 * collide, and so an operator reading the column can tell where a send came from.
 */

/** Where a send originated. One variant per caller of `createOutboundMessage`. */
export type OutboundSendSource =
  /** Driven by a CRM task row (sequence auto-send and manual task completion). */
  | { kind: 'task'; taskId: string }
  /**
   * A sequence step with no task row backing it. Enrollment + step is stable across
   * retries and unique per (lead, sequence run, step).
   */
  | { kind: 'sequenceStep'; enrollmentId: string; stepId: string }
  /** A reply typed into the inbox thread view. */
  | { kind: 'reply'; threadKey: string; requestId: string }
  /** An ad-hoc compose with no task behind it. `requestId` comes from the client. */
  | { kind: 'manual'; requestId: string };

/**
 * Build the durable idempotency key for a send.
 *
 * Throws on an empty component rather than emitting a key like `manual-task:` that
 * would collide with every other caller that made the same mistake.
 */
export function buildIdempotencyKey(source: OutboundSendSource): string {
  switch (source.kind) {
    case 'task':
      return `manual-task:${required(source.taskId, 'taskId')}`;
    case 'sequenceStep':
      return `sequence-step:${required(source.enrollmentId, 'enrollmentId')}:${required(source.stepId, 'stepId')}`;
    case 'reply':
      return `reply:${required(source.threadKey, 'threadKey')}:${required(source.requestId, 'requestId')}`;
    case 'manual':
      return `manual-send:${required(source.requestId, 'requestId')}`;
  }
}

function required(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Cannot build an idempotency key: ${field} is empty`);
  }
  return value.trim();
}

/**
 * A request id for a send that has no durable id of its own (ad-hoc compose, inbox
 * reply). The client supplies one so that a retried HTTP request reuses the same key;
 * when it does not, we mint one here. A server-minted id gives no cross-request
 * deduplication, but it is still strictly better than the old subject hash: it cannot
 * false-dedup two different sends, and the worker-side guarantee (one delivery per
 * OutboundMessage row) still holds for every retry after this point.
 */
export function newRequestId(): string {
  return globalThis.crypto.randomUUID();
}

// ─── Outbound status model ───────────────────────────────────────────────────
// `OutboundMessage.status` is a plain string column. These are the only values the
// send pipeline writes.

export const OUTBOUND_STATUS = {
  /** Recorded, not yet claimed by a worker. */
  PENDING: 'pending',
  /** Claimed. A provider call may be in flight — never resend from this state. */
  SENDING: 'sending',
  /** Provider confirmed. Terminal. */
  SENT: 'sent',
  /** Known *not* to have reached the provider. Safe to claim again. */
  FAILED: 'failed',
  /**
   * The provider call's outcome is unknown — it may or may not have delivered.
   * Resolved by the reconciliation pass, never by a blind resend.
   */
  RECONCILIATION_REQUIRED: 'reconciliation_required',
  /** Given up on. Terminal; requires a human to start a new send. */
  PERMANENTLY_FAILED: 'permanently_failed',
} as const;

export type OutboundStatus = (typeof OUTBOUND_STATUS)[keyof typeof OUTBOUND_STATUS];

/** Statuses a worker may claim and send from. Everything else is left alone. */
export const CLAIMABLE_STATUSES: readonly string[] = [
  OUTBOUND_STATUS.PENDING,
  OUTBOUND_STATUS.FAILED,
];

/** Statuses that must never be sent again under any circumstances. */
export const TERMINAL_STATUSES: readonly string[] = [
  OUTBOUND_STATUS.SENT,
  OUTBOUND_STATUS.PERMANENTLY_FAILED,
];

/**
 * How long a `sending` claim is presumed live.
 *
 * A worker that finds a row already `sending` cannot tell, from the status alone, whether the
 * previous attempt **crashed** or is **still running right now**. Treating both as a dead claim
 * is what turned healthy concurrent sends into `reconciliation_required`: the winner claims,
 * and a loser reading a moment later sees `sending` with no `providerMessageId` yet and parks
 * the row — a state nothing in the send path may move out of, requiring a human.
 *
 * `claimedAt` distinguishes them. Within this window the claim is someone else's live work and
 * the loser must simply stand down; beyond it, `workers/maintenance.ts` owns the row and sweeps
 * it on exactly this threshold. Shared from here so the send path and the sweeper cannot drift
 * into disagreeing about what "stale" means — if the sweeper's window were shorter, both would
 * act on the same row.
 */
export const SENDING_CLAIM_LEASE_MS = 30 * 60 * 1000;

/**
 * Is this `sending` claim still someone else's live work?
 *
 * A row with no `claimedAt` is treated as stale: it predates the claim timestamp, so there is
 * no evidence anyone is working on it.
 */
export function isClaimLive(claimedAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!claimedAt) return false;
  return now.getTime() - claimedAt.getTime() < SENDING_CLAIM_LEASE_MS;
}

/**
 * Decide whether a failed provider call definitely did not deliver.
 *
 * Only errors that prove the message never left are treated as `not_sent` and made
 * re-sendable. Anything else — a timeout, a dropped socket, an unrecognised error —
 * is `ambiguous`: the message may be in flight, so the row goes to
 * `reconciliation_required` instead of back into the claimable pool.
 *
 * Pure, so the classification is unit-testable without a provider.
 */
export function classifySendFailure(error: unknown): 'not_sent' | 'ambiguous' {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();

  // SMTP 5xx permanent rejections and auth/config failures: the provider refused the
  // message outright, so nothing was queued for delivery.
  const definitelyNotSent = [
    /\b5\d{2}\b.*(rejected|denied|refused|not allowed|unauthenticated|unauthorized)/,
    /invalid[_ ]grant/,
    /authentication fail/,
    /invalid login/,
    /no recipients defined/,
    /invalid recipient/,
    /mailbox unavailable/,
    /relay access denied/,
    /message rejected/,
    /quota exceeded/,
    /unknown email provider/,
    // The connection was never established, so no bytes reached the provider. Distinct
    // from a socket that opened and then dropped (`socket hang up`, `ECONNRESET`), where
    // the message may already have been accepted.
    /econnrefused|connection refused/,
    /enotfound|getaddrinfo/,
  ];
  if (definitelyNotSent.some((pattern) => pattern.test(message))) return 'not_sent';

  // Errors raised by our own preflight, before any provider object exists.
  if (/^email account not found/.test(message)) return 'not_sent';

  return 'ambiguous';
}
