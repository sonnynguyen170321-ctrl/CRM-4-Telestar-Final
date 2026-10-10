/**
 * The one list of call outcomes. A rep logging a call (lead drawer, task Call Logging modal), the
 * activity that records it, the `Call.outcome` column and the effect on the lead all read from here.
 *
 * The ids are stored in activities and reports already, so they are stable. Each id maps explicitly
 * to the Prisma `CallOutcome` enum value (the names differ for a meeting) and to what the outcome
 * does to the lead. Client-safe: no server imports.
 */

export type PhoneOutcomeId =
  | 'no_answer'
  | 'voicemail_left'
  | 'voicemail_not_left'
  | 'connected_interested'
  | 'connected_not_interested'
  | 'connected_meeting_booked'
  | 'callback_requested'
  | 'wrong_number'
  | 'do_not_call';

/** Mirrors the Prisma `CallOutcome` enum; checked against it by tests/telephony-outcomes.test.ts. */
export type CallOutcomeValue =
  | 'connected_interested'
  | 'connected_not_interested'
  | 'meeting_booked'
  | 'callback_requested'
  | 'gatekeeper'
  | 'voicemail_left'
  | 'voicemail_not_left'
  | 'no_answer'
  | 'wrong_number'
  | 'do_not_call';

export type OutcomeGroup = 'No contact' | 'Connected' | 'Follow-up';

/** What an outcome does to the lead beyond being recorded. */
export type OutcomeLeadEffect = 'do_not_call' | 'wrong_number' | 'callback' | 'meeting' | null;

export type PhoneOutcome = {
  id: PhoneOutcomeId;
  label: string;
  group: OutcomeGroup;
  callOutcome: CallOutcomeValue;
  leadEffect: OutcomeLeadEffect;
};

export const PHONE_OUTCOMES: readonly PhoneOutcome[] = [
  { id: 'no_answer', label: 'No Answer', group: 'No contact', callOutcome: 'no_answer', leadEffect: null },
  { id: 'voicemail_left', label: 'Voicemail Left', group: 'No contact', callOutcome: 'voicemail_left', leadEffect: null },
  {
    id: 'voicemail_not_left',
    label: 'Went to Voicemail — No Message',
    group: 'No contact',
    callOutcome: 'voicemail_not_left',
    leadEffect: null,
  },
  { id: 'connected_interested', label: 'Interested', group: 'Connected', callOutcome: 'connected_interested', leadEffect: null },
  {
    id: 'connected_not_interested',
    label: 'Not Interested',
    group: 'Connected',
    callOutcome: 'connected_not_interested',
    leadEffect: null,
  },
  { id: 'connected_meeting_booked', label: 'Meeting Booked', group: 'Connected', callOutcome: 'meeting_booked', leadEffect: 'meeting' },
  { id: 'callback_requested', label: 'Call Back Requested', group: 'Follow-up', callOutcome: 'callback_requested', leadEffect: 'callback' },
  { id: 'wrong_number', label: 'Wrong Number', group: 'Follow-up', callOutcome: 'wrong_number', leadEffect: 'wrong_number' },
  { id: 'do_not_call', label: 'Do Not Call', group: 'Follow-up', callOutcome: 'do_not_call', leadEffect: 'do_not_call' },
];

export const PHONE_OUTCOME_IDS = PHONE_OUTCOMES.map((outcome) => outcome.id) as [PhoneOutcomeId, ...PhoneOutcomeId[]];

export function getPhoneOutcome(id: string): PhoneOutcome | undefined {
  return PHONE_OUTCOMES.find((outcome) => outcome.id === id);
}

export function isPhoneOutcomeId(value: unknown): value is PhoneOutcomeId {
  return PHONE_OUTCOMES.some((outcome) => outcome.id === value);
}

/** The tag an outcome puts on the lead, so it leaves the calling queue. */
export function outcomeLeadTag(id: PhoneOutcomeId): 'do_not_call' | 'wrong_number' | null {
  const effect = getPhoneOutcome(id)?.leadEffect;
  return effect === 'do_not_call' || effect === 'wrong_number' ? effect : null;
}

/** Room `description` leaves for the notes: activities cap it at 500 (lib/validation/core.ts). */
export const DESCRIPTION_MAX = 500;
/** What the panel lets a rep type; the full text is kept in `metadata.notes`. */
export const NOTES_MAX = 2000;

/** "Call logged. Outcome: …: notes", shortened to fit; the notes themselves are never cut. */
export function callDescription(label: string, notes: string): string {
  const head = `Call logged. Outcome: ${label}`;
  if (!notes) return head;
  const full = `${head}: ${notes}`;
  return full.length <= DESCRIPTION_MAX ? full : `${full.slice(0, DESCRIPTION_MAX - 1)}…`;
}
