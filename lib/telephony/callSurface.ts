import type { PhoneCallTarget } from './logPhoneCall';

/**
 * Which screen the lead drawer's Call button opens (docs/dialer/TASKS.md, owner decisions 2026-10-08).
 *
 * Vietnamese numbers are always called from the rep's own phone and logged: the phone-call panel. So
 * is every number while the browser dialer is not available to this rep (switched off, not
 * configured, kill switch, or the status check has not answered). Only a foreign number with the
 * dialer enabled opens the softphone. A number that cannot be read is not Vietnamese and not
 * dialable by the softphone either, so it too goes to the panel, which says so. The do-not-call
 * warning blocks on both screens; it is not decided here.
 */
export type CallSurface = 'phone_panel' | 'softphone';

export function chooseCallSurface(input: { target: PhoneCallTarget; dialerEnabled: boolean }): CallSurface {
  if (!input.dialerEnabled) return 'phone_panel';
  if (!input.target.e164 || input.target.isVietnam) return 'phone_panel';
  return 'softphone';
}
