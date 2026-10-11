import type { PhoneOutcomeId } from './outcomes';

/**
 * Why a call ended, in words a rep can act on (softphone end states). Pure and client-safe.
 *
 * The browser SDK reports a hangup cause (`user_busy`, `call_rejected`, ...) and a SIP code/reason on
 * the call; the Call row carries the provider's `hangupCause` and final status. Both feed the same
 * mapping so the rep sees one answer however it was learned. Who hung up is known locally: the rep's
 * own hangup is `you_hung_up`; an end the SDK reports on its own is the other side (or the network).
 */

export type HangupKind =
  | 'you_hung_up'
  | 'they_hung_up'
  | 'busy'
  | 'declined'
  | 'no_answer'
  | 'unavailable'
  | 'network'
  | 'out_of_credit'
  | 'ended_unanswered'
  | 'unknown';

export type RawHangup = { cause?: string | null; sipCode?: number | null; sipReason?: string | null };

export type HangupInfo = {
  kind: HangupKind;
  /** The headline: "Busy", "Declined", ... */
  label: string;
  /** One sentence of what it means / what to do. */
  detail: string;
  /** The outcome the form starts on, or null when the rep should choose. */
  suggestedOutcome: PhoneOutcomeId | null;
};

const INFO: Record<HangupKind, Omit<HangupInfo, 'kind'>> = {
  you_hung_up: { label: 'You hung up', detail: 'The call is over.', suggestedOutcome: null },
  they_hung_up: { label: 'They hung up', detail: 'The other person ended the call.', suggestedOutcome: null },
  busy: { label: 'Busy', detail: 'The number is busy. Try again in a few minutes.', suggestedOutcome: 'no_answer' },
  declined: { label: 'Declined', detail: 'The call was declined on the other end.', suggestedOutcome: 'no_answer' },
  no_answer: { label: 'No answer', detail: 'Nobody picked up.', suggestedOutcome: 'no_answer' },
  unavailable: {
    label: 'Number unavailable',
    detail: 'The number does not exist or cannot be reached. Check it on the lead.',
    suggestedOutcome: 'wrong_number',
  },
  network: {
    label: 'Network or provider error',
    detail: 'The phone network or provider failed the call. This is not the lead; try again in a moment.',
    suggestedOutcome: null,
  },
  out_of_credit: {
    label: 'Out of credit',
    detail: 'The phone account has no balance left. Tell a manager.',
    suggestedOutcome: null,
  },
  ended_unanswered: { label: 'Call ended', detail: 'The call ended before it was answered.', suggestedOutcome: 'no_answer' },
  unknown: { label: 'Call ended', detail: 'The call ended for a reason the phone system did not give.', suggestedOutcome: null },
};

const BUSY_CAUSES = new Set(['user_busy', 'busy']);
const DECLINED_CAUSES = new Set(['call_rejected', 'rejected', 'declined']);
const NO_ANSWER_CAUSES = new Set(['no_answer', 'timeout', 'no_user_response', 'recovery_on_timer_expire', 'originator_cancel_timeout']);
const UNAVAILABLE_CAUSES = new Set([
  'unallocated_number',
  'no_route_destination',
  'invalid_number_format',
  'number_changed',
  'destination_out_of_order',
  'incompatible_destination',
  'subscriber_absent',
]);
const NETWORK_CAUSES = new Set([
  'normal_temporary_failure',
  'switch_congestion',
  'network_out_of_order',
  'service_unavailable',
  'requested_chan_unavail',
  'resource_unavailable',
  'protocol_error',
  'gateway_down',
  'manager_request',
]);
const CREDIT_PATTERN = /balance|credit|insufficient|payment required|account.*(suspend|disabled)/i;

/** Classify a hangup. `answered` and `localHangup` come from what the browser saw, not from the cause. */
export function describeHangup(input: RawHangup & { answered: boolean; localHangup?: boolean }): HangupInfo {
  const kind = classify(input);
  return { kind, ...INFO[kind] };
}

function classify(input: RawHangup & { answered: boolean; localHangup?: boolean }): HangupKind {
  const cause = (input.cause ?? '').trim().toLowerCase();
  const code = typeof input.sipCode === 'number' ? input.sipCode : null;
  const reason = input.sipReason ?? '';

  if (input.localHangup) return 'you_hung_up';
  if (code === 402 || CREDIT_PATTERN.test(reason) || CREDIT_PATTERN.test(cause)) return 'out_of_credit';
  // A call that was answered and then ended is a conversation ending, whatever the cause says.
  if (input.answered && !NETWORK_CAUSES.has(cause) && !(code !== null && code >= 500)) return 'they_hung_up';

  if (BUSY_CAUSES.has(cause) || code === 486 || code === 600) return 'busy';
  if (DECLINED_CAUSES.has(cause) || code === 603 || code === 403) return 'declined';
  if (NO_ANSWER_CAUSES.has(cause) || code === 480 || code === 408 || code === 487) return 'no_answer';
  if (UNAVAILABLE_CAUSES.has(cause) || code === 404 || code === 484 || code === 410 || code === 604) return 'unavailable';
  if (NETWORK_CAUSES.has(cause) || (code !== null && code >= 500 && code < 600)) return 'network';
  if (input.answered) return 'they_hung_up';
  if (cause === 'normal_clearing' || cause === 'originator_cancel' || cause === '') return cause === '' ? 'unknown' : 'ended_unanswered';
  return 'unknown';
}

/** The raw hangup facts a Call row holds: its final status says busy / no answer even when the cause is blank. */
export function rawHangupFromRow(row: { status: string; hangupCause: string | null }): RawHangup {
  if (row.status === 'busy') return { cause: 'user_busy' };
  if (row.status === 'no_answer') return { cause: 'no_answer' };
  return { cause: row.hangupCause };
}

/** The call row's statuses that mean the call is over (the poll fallback ends the softphone on these). */
export const FINAL_CALL_STATUSES = ['completed', 'no_answer', 'busy', 'failed', 'missed', 'canceled'] as const;

/** Kinds where an attempt was made and reached a person or a network answer: the rep logs an outcome. */
export function isAttemptKind(kind: HangupKind): boolean {
  return kind === 'busy' || kind === 'declined' || kind === 'no_answer' || kind === 'unavailable' || kind === 'ended_unanswered' || kind === 'they_hung_up';
}
