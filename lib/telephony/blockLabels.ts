import type { BlockReason } from './compliance';

/**
 * What a rep reads when the calling gate says no: a plain sentence per reason and, where the rep can
 * fix it, what to do. One entry per `BLOCK_REASONS` value (tests/telephony-softphone.test.ts fails
 * when a reason is added without one). Client-safe: a type import only.
 */

export type BlockLabel = {
  label: string;
  /** What the rep can do about it; null when only a manager or the platform can. */
  fix: string | null;
};

export const BLOCK_LABELS: Record<BlockReason | 'dry_run', BlockLabel> = {
  dialer_disabled: { label: 'The dialer is switched off for the whole system.', fix: 'Ask an administrator to enable it.' },
  team_disabled: { label: 'The dialer is not enabled for your team.', fix: 'Ask a manager to turn it on in the dialer settings.' },
  kill_switch: { label: 'Calling has been paused by a manager.', fix: 'Wait for a manager to resume calling.' },
  no_credential: { label: 'You do not have a phone login yet.', fix: 'Reload the page; if this stays, ask a manager.' },
  credential_revoked: { label: 'Your dialer access has been revoked.', fix: 'Ask a manager to restore it.' },
  lead_access_denied: { label: 'You cannot work this lead.', fix: null },
  no_phone: { label: 'This lead has no phone number.', fix: 'Add a number to the lead, then call again.' },
  invalid_number: { label: 'The number is not a valid phone number.', fix: 'Correct the number on the lead (with its country code), then call again.' },
  number_type_not_allowed: { label: 'This kind of number (premium rate or shared cost) is never called.', fix: 'Use a different number for this lead.' },
  country_not_allowed: { label: 'Calls to this country are not enabled.', fix: 'Ask a manager to allow the country, or call from your own phone.' },
  suppressed: { label: 'This number is on the do-not-call list.', fix: null },
  lead_do_not_call: { label: 'This lead is marked do not call.', fix: null },
  contact_do_not_call: { label: 'This contact is marked do not call.', fix: null },
  tz_unknown: { label: 'The lead’s local time could not be worked out.', fix: 'Set the lead’s country or timezone, then call again.' },
  day_not_allowed: { label: 'Calling is not allowed on this day.', fix: 'Try again on an allowed day.' },
  outside_hours: { label: 'It is outside the calling hours for this lead.', fix: 'Try again within calling hours.' },
  gate_error: { label: 'The calling check failed.', fix: 'Try again in a moment; tell a manager if it keeps happening.' },
  dry_run: { label: 'The dialer is in test mode, so no call is placed.', fix: null },
};

export function blockLabel(reason: string): BlockLabel {
  return (BLOCK_LABELS as Record<string, BlockLabel | undefined>)[reason] ?? { label: 'The call is not allowed.', fix: null };
}
