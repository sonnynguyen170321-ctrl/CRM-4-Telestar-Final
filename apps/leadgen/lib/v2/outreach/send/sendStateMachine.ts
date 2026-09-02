// O4 / design B2: exactly-once send across the non-transactional SMTP boundary.
// The SMTP call is not transactional with the DB, so a crash after send / before
// commit must NOT double-send on retry. The decision is pure + testable.

export type OutreachMessageStatus = "QUEUED" | "SENDING" | "SENT" | "FAILED" | "BOUNCED" | "REPLIED";

export type SendableMessageState = {
  status: OutreachMessageStatus;
  providerMessageId: string | null;
  sendingAt: Date | string | null;
};

export type SendAction =
  | "send" // QUEUED / FAILED retry — safe to hand to the provider
  | "skip_already_sent" // terminal — do nothing
  | "skip_in_flight" // SENDING with a Message-ID, recent claim — still in flight, wait
  | "retry_stale" // SENDING with no Message-ID and a stale claim — a single controlled retry
  | "reconcile"; // SENDING with a Message-ID but a STALE claim — handed to SMTP yet never
                 // confirmed (worker crashed mid-send). Do NOT re-send (could double-send);
                 // mark it FAILED/unconfirmed so it leaves the SENDING limbo and is visible.

const STALE_SENDING_MS = 5 * 60 * 1000; // a SENDING claim older than this is considered abandoned

/**
 * Decide what to do with a message when an EMAIL_SEND job runs. This is the
 * exactly-once guard: a message that already has a providerMessageId was handed to
 * SMTP and must never be re-sent. A FRESH SENDING is still in flight; a STALE
 * SENDING is reconciled (never silently stuck), via IMAP if a bounce/reply arrives.
 */
export function decideSendAction(state: SendableMessageState, now: Date = new Date()): SendAction {
  switch (state.status) {
    case "SENT":
    case "BOUNCED":
    case "REPLIED":
      return "skip_already_sent";
    case "QUEUED":
    case "FAILED":
      return "send";
    case "SENDING": {
      const sendingAt = toDate(state.sendingAt);
      const stale = !!sendingAt && now.getTime() - sendingAt.getTime() > STALE_SENDING_MS;
      if (state.providerMessageId) {
        // Handed to SMTP. Recent -> wait; stale -> reconcile (never re-send -> never stuck).
        return stale ? "reconcile" : "skip_in_flight";
      }
      // No Message-ID yet: a fresh claim waits, a stale one gets a single controlled retry.
      return stale ? "retry_stale" : "skip_in_flight";
    }
    default:
      return "skip_in_flight";
  }
}

export type SendOutcome = {
  accepted: boolean;
  providerMessageId: string;
  error?: string;
  syncBounce?: boolean; // synchronous SMTP 5xx
};

export type AppliedSendResult = {
  status: OutreachMessageStatus;
  sentAt: Date | null;
  failedAt: Date | null;
  providerMessageId: string;
  errorMessage: string | null;
  createSuppression: boolean; // sync hard bounce -> suppress (Link B)
};

/** Map a provider outcome onto the next persisted message state. Pure. */
export function applySendResult(outcome: SendOutcome, now: Date = new Date()): AppliedSendResult {
  if (outcome.accepted) {
    return {
      status: "SENT",
      sentAt: now,
      failedAt: null,
      providerMessageId: outcome.providerMessageId,
      errorMessage: null,
      createSuppression: false,
    };
  }
  if (outcome.syncBounce) {
    return {
      status: "BOUNCED",
      sentAt: null,
      failedAt: now,
      providerMessageId: outcome.providerMessageId,
      errorMessage: outcome.error ?? "synchronous bounce",
      createSuppression: true, // hard bounce at send time -> suppress future sends
    };
  }
  return {
    status: "FAILED",
    sentAt: null,
    failedAt: now,
    providerMessageId: outcome.providerMessageId,
    errorMessage: outcome.error ?? "send failed",
    createSuppression: false,
  };
}

function toDate(value: Date | string | null): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
