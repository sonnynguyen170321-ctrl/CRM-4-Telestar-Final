import type { PhoneCallTarget } from './logPhoneCall';

/**
 * Which screen the lead drawer's Call button opens (docs/dialer/TASKS.md, owner decisions 2026-10-08).
 *
 * With the browser dialer available to this rep, every dialable number (Vietnam included, since the
 * Telnyx outbound profile is the only country lock) opens the softphone; the phone-call panel stays
 * one click away inside it ("Call from my own phone instead"). While the dialer is not available
 * (switched off, not configured, kill switch, or the status check has not answered) the panel is
 * the default for every number. A number that cannot be read goes to the panel, which says so. The
 * do-not-call warning blocks on both screens; it is not decided here.
 */
export type CallSurface = 'phone_panel' | 'softphone';

export function chooseCallSurface(input: { target: PhoneCallTarget; dialerEnabled: boolean }): CallSurface {
  if (!input.dialerEnabled) return 'phone_panel';
  if (!input.target.e164) return 'phone_panel';
  return 'softphone';
}
