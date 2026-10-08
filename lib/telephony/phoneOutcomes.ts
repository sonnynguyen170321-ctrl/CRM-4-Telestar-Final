/**
 * What a rep can say happened on a call they placed outside the CRM — on their own phone, or on
 * MicroSIP until the browser dialer replaces it (docs/dialer/TASKS.md, owner 2026-10-08: "for
 * Vietnam, reps call on their phone and log it").
 *
 * The same nine outcomes, with the same ids, as the task Call Logging modal on the dashboard
 * (app/page.tsx), so a call logged from the lead drawer and one logged from a task count alike.
 * Client-safe: no server imports.
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

export type PhoneOutcome = {
  id: PhoneOutcomeId;
  label: string;
  group: 'No contact' | 'Connected' | 'Follow-up';
};

export const PHONE_OUTCOMES: readonly PhoneOutcome[] = [
  { id: 'no_answer', label: 'No Answer', group: 'No contact' },
  { id: 'voicemail_left', label: 'Voicemail Left', group: 'No contact' },
  { id: 'voicemail_not_left', label: 'Went to Voicemail — No Message', group: 'No contact' },
  { id: 'connected_interested', label: 'Interested', group: 'Connected' },
  { id: 'connected_not_interested', label: 'Not Interested', group: 'Connected' },
  { id: 'connected_meeting_booked', label: 'Meeting Booked', group: 'Connected' },
  { id: 'callback_requested', label: 'Call Back Requested', group: 'Follow-up' },
  { id: 'wrong_number', label: 'Wrong Number', group: 'Follow-up' },
  { id: 'do_not_call', label: 'Do Not Call', group: 'Follow-up' },
];

export function isPhoneOutcomeId(value: unknown): value is PhoneOutcomeId {
  return PHONE_OUTCOMES.some((outcome) => outcome.id === value);
}

/** The tag an outcome puts on the lead, so it leaves the calling queue. */
export function outcomeLeadTag(id: PhoneOutcomeId): 'do_not_call' | 'wrong_number' | null {
  if (id === 'do_not_call') return 'do_not_call';
  if (id === 'wrong_number') return 'wrong_number';
  return null;
}

/**
 * The `tel:` link a phone opens when it scans the code: the E.164 number, nothing else. A link built
 * from the raw stored string would dial "0948…" from a foreign SIM, or carry spaces some dialers drop.
 */
export function telUri(e164: string): string {
  if (!/^\+[1-9]\d{6,14}$/.test(e164)) throw new Error('telUri needs an E.164 number');
  return `tel:${e164}`;
}
