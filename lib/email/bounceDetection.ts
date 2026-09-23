/**
 * Pure classifiers for inbox-sync messages. Heuristic by design — NDR formats
 * vary by mail server, so we match the common senders and subject lines.
 */

import type { InboxMessage } from './EmailService';

const BOUNCE_SENDER_RE = /^(mailer-daemon|postmaster|mail delivery (subsystem|system))@/i;

const BOUNCE_SUBJECT_RE =
  /undeliverable|undelivered mail|delivery (status notification|has failed|failure)|returned mail|failure notice|mail delivery failed|delivery incomplete/i;

const AUTO_REPLY_SUBJECT_RE =
  /out of (the )?office|auto.?reply|automatic reply|autorespond|away from (the )?office|on vacation|annual leave/i;

export function isBounceMessage(msg: Pick<InboxMessage, 'fromEmail' | 'subject'>): boolean {
  return BOUNCE_SENDER_RE.test(msg.fromEmail) || BOUNCE_SUBJECT_RE.test(msg.subject ?? '');
}

/** Out-of-office / auto-replies must not count as real replies. */
export function isAutoReply(msg: Pick<InboxMessage, 'subject'>): boolean {
  return AUTO_REPLY_SUBJECT_RE.test(msg.subject ?? '');
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

/**
 * The DSN fields that name the address, as RFC 3464 defines them.
 *
 * `Final-Recipient` is the address delivery was last attempted to; `Original-Recipient` is what
 * the sender wrote. Either identifies the mailbox to stop using. Both live in the message
 * *body* — the machine-readable `message/delivery-status` part — which is why reading only the
 * subject found nothing.
 */
const DSN_RECIPIENT_RE =
  /^(?:final|original|x-actual)-recipient:\s*(?:rfc822;)?\s*<?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?/im;

/** Wording used by servers that send a prose NDR instead of a DSN part. */
const PROSE_RECIPIENT_RE =
  /<?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?[\s\S]{0,40}?(?:could not be delivered|was not delivered|delivery failed|user unknown|does not exist|not found|rejected)/i;

/** Never mistake the bounce daemon, or our own sending address, for the prospect. */
const NOT_A_PROSPECT = /^(mailer-daemon|postmaster|no-?reply|noreply|bounce[s]?|mail)@/i;

/**
 * Best-effort extraction of the address that bounced.
 *
 * Order matters: the explicit header first, then the DSN body fields, then prose, then the
 * subject, and only then any address quoted in the body. Production proves why the body has to
 * be read at all — 42 hard bounces were stored with `bouncedRecipient` null, every single one,
 * because the address sat in the DSN part while this function looked only at
 * `X-Failed-Recipients` and the subject. No address meant no lead matched, so
 * `handleApplyBounce` never ran, so nothing was ever suppressed, so those 42 mailboxes stayed
 * in the sending pool and kept being written to.
 */
export function extractBouncedRecipient(msg: InboxMessage): string | null {
  const body = `${msg.body ?? ''}\n${msg.bodyHtml ?? ''}`;
  const candidates: (string | null | undefined)[] = [
    msg.failedRecipient?.match(EMAIL_RE)?.[0],
    body.match(DSN_RECIPIENT_RE)?.[1],
    body.match(PROSE_RECIPIENT_RE)?.[1],
    (msg.subject ?? '').match(EMAIL_RE)?.[0],
    // Last resort: a bounce quotes the original message, so the prospect's address is in there
    // even when no field names it.
    ...(body.match(new RegExp(EMAIL_RE.source, 'g')) ?? []),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const email = candidate.toLowerCase().replace(/^<|>$/g, '');
    if (NOT_A_PROSPECT.test(email)) continue;
    return email;
  }
  return null;
}
