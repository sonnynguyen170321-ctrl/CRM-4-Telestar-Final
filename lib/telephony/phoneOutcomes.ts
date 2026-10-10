/**
 * What a rep can say happened on a call they placed outside the CRM — on their own phone, or on
 * MicroSIP until the browser dialer replaces it (docs/dialer/TASKS.md, owner 2026-10-08: "for
 * Vietnam, reps call on their phone and log it").
 *
 * The same nine outcomes, with the same ids, as the task Call Logging modal on the dashboard
 * (app/page.tsx), so a call logged from the lead drawer and one logged from a task count alike.
 * The list itself lives in lib/telephony/outcomes.ts; this re-exports it for the panel.
 * Client-safe: no server imports.
 */

export {
  getPhoneOutcome,
  isPhoneOutcomeId,
  outcomeLeadTag,
  PHONE_OUTCOMES,
  type PhoneOutcome,
  type PhoneOutcomeId,
} from './outcomes';

/**
 * The `tel:` link a phone opens when it scans the code: the E.164 number, nothing else. A link built
 * from the raw stored string would dial "0948…" from a foreign SIM, or carry spaces some dialers drop.
 */
export function telUri(e164: string): string {
  if (!/^\+[1-9]\d{6,14}$/.test(e164)) throw new Error('telUri needs an E.164 number');
  return `tel:${e164}`;
}
