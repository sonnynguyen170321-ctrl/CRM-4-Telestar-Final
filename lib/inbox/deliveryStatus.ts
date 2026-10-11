/**
 * How the Sent folder says what happened to an outgoing message, in words a rep can act on.
 *
 * Browser-safe and pure. The input is `OutboundMessage.status` and `errorMessage` as
 * GET /api/inbox returns them (`deliveryStatus`, `deliveryError`); the statuses are those of
 * `OUTBOUND_STATUS` (lib/email/idempotency.ts). The label is the state, the detail is the reason.
 */

export type DeliveryTone = 'ok' | 'pending' | 'warn' | 'bad';

export interface DeliveryDisplay {
  /** Short state: Queued, Sent, Deferred, Failed, Bounced, ... */
  label: string;
  tone: DeliveryTone;
  /** The reason, in plain words, when there is one worth showing. */
  detail: string | null;
}

const DEFERRED = /deferred to (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/i;

function formatResume(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'later';
  return at.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * The reason, in our words. `OutboundMessage.errorMessage` can hold a provider's raw answer (an
 * SMTP transcript, a Graph error with tenant ids), which must never reach the browser; only a
 * known cause is named, and anything else becomes a generic sentence.
 */
export function plainReason(status: string, raw: string | null | undefined): string {
  const text = raw ?? '';
  if (/suppress/i.test(text)) return 'The recipient is on the do-not-contact list.';
  if (/bounced earlier/i.test(text)) return 'This address bounced earlier, so nothing more is sent to it.';
  if (/paused for this inbox|global email pause|auto-pause/i.test(text)) return 'Sending is paused for this mailbox.';
  if (/inactive|account not found|disconnected/i.test(text)) return 'The mailbox is no longer connected.';
  if (/canary|restriction/i.test(text)) return 'Sending to this address is switched off right now.';
  if (/quota|limit/i.test(text)) return 'A sending limit was reached.';
  if (status === 'bounced') return 'The recipient address did not accept the message.';
  return 'The mail provider did not accept the message.';
}

/** The wording for one outgoing message, or null for a message that is not ours (an inbound one). */
export function describeDelivery(
  status: string | null | undefined,
  error: string | null | undefined
): DeliveryDisplay | null {
  if (!status) return null;
  const rawReason = (error ?? '').trim() || null;
  const reason = rawReason ? plainReason(status, rawReason) : null;

  switch (status) {
    case 'sent':
      return { label: 'Sent', tone: 'ok', detail: null };
    case 'pending': {
      // A pending message with a reason was held back, not forgotten: a sending limit, with a time.
      const deferred = rawReason ? DEFERRED.exec(rawReason) : null;
      if (deferred) {
        const why = /daily/i.test(rawReason!)
          ? 'the daily sending limit was reached'
          : /hourly/i.test(rawReason!)
            ? 'the hourly sending limit was reached'
            : "the mailbox provider's sending limit was reached";
        return { label: 'Deferred', tone: 'warn', detail: `Held back because ${why}. It will be sent ${formatResume(deferred[1])}.` };
      }
      return { label: 'Queued', tone: 'pending', detail: 'Waiting to be sent.' };
    }
    case 'sending':
      return { label: 'Sending', tone: 'pending', detail: 'Being handed to the mailbox provider now.' };
    case 'reconciliation_required':
      return {
        label: 'Checking',
        tone: 'warn',
        detail: 'The provider did not confirm this message. It is being checked and will not be sent twice.',
      };
    case 'bounced':
      return { label: 'Bounced', tone: 'bad', detail: reason ?? 'The recipient address did not accept the message.' };
    case 'permanently_failed':
      return { label: 'Failed', tone: 'bad', detail: reason ?? 'It could not be confirmed as sent and was given up on.' };
    case 'failed':
      return { label: 'Failed', tone: 'bad', detail: reason ?? 'It was not sent.' };
    default:
      return { label: status, tone: 'warn', detail: reason };
  }
}
