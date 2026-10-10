import type { PhoneOutcomeId } from './outcomes';

/**
 * The softphone's state machine (docs/dialer/TASKS.md D5.2). Pure, so every transition is a unit test;
 * components/dialer/Softphone.tsx only turns browser and SDK events into these events and renders the
 * state.
 *
 *   idle -> checking -> blocked | connecting -> ringing -> in_call -> wrap_up -> saved
 *                          \-> error  (the check, the provider or the microphone failed)
 *
 * Rules the shape enforces:
 *  - A call can be hung up from any live state (checking, connecting, ringing, in_call).
 *  - The outcome form exists only in `wrap_up`, which is reached only after a call that actually rang.
 *    A call that never got as far as ringing has nothing to log and goes back to idle or to an error.
 *  - A rep cannot leave `wrap_up` without a saved outcome (`canClose`).
 *  - An event that makes no sense in the current state is ignored, not an error: SDK events arrive late
 *    and out of order, and a late "ringing" must not revive a call the rep already hung up.
 *
 * Client-safe: no server imports.
 */

export type SoftphoneErrorCode =
  | 'check_failed'
  | 'dialer_disabled'
  | 'no_dialable_number'
  | 'rate_limited'
  | 'not_registered'
  | 'mic_denied'
  | 'mic_unavailable'
  | 'provider_error'
  | 'call_failed';

export type SoftphoneError = { code: SoftphoneErrorCode; message: string };

export type CallEndReason = 'local_hangup' | 'remote_hangup' | 'error';

export type SoftphoneState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'blocked'; reasons: string[]; dryRun: boolean; localTime: string | null; timezone: string | null }
  | { phase: 'connecting'; callId: string }
  | { phase: 'ringing'; callId: string }
  | { phase: 'in_call'; callId: string; muted: boolean; held: boolean }
  | {
      phase: 'wrap_up';
      callId: string;
      /** True when the other side answered; the outcome form can lead with the connected group. */
      answered: boolean;
      endedBy: CallEndReason;
      saving: boolean;
      saveError: string | null;
    }
  | { phase: 'saved'; callId: string; outcome: PhoneOutcomeId }
  | { phase: 'error'; error: SoftphoneError };

export type SoftphoneEvent =
  | { type: 'DIAL' }
  | { type: 'CHECK_ALLOWED'; callId: string }
  | { type: 'CHECK_BLOCKED'; reasons: string[]; dryRun?: boolean; localTime?: string | null; timezone?: string | null }
  | { type: 'CHECK_FAILED'; error: SoftphoneError }
  | { type: 'RTC_RINGING' }
  | { type: 'RTC_ANSWERED' }
  | { type: 'RTC_HELD'; held: boolean }
  | { type: 'MUTED'; muted: boolean }
  | { type: 'HANGUP' }
  | { type: 'REMOTE_ENDED' }
  | { type: 'RTC_ERROR'; error: SoftphoneError }
  | { type: 'SAVE_STARTED' }
  | { type: 'SAVE_SUCCEEDED'; outcome: PhoneOutcomeId }
  | { type: 'SAVE_FAILED'; message: string }
  | { type: 'RESET' };

export const INITIAL_SOFTPHONE_STATE: SoftphoneState = { phase: 'idle' };

/** The states with a call in progress or being set up: hangup is offered, closing is not. */
export function isLive(state: SoftphoneState): boolean {
  return state.phase === 'checking' || state.phase === 'connecting' || state.phase === 'ringing' || state.phase === 'in_call';
}

/** The dialog may be dismissed (Escape, close button, backdrop) only here: never mid-call, never before the outcome. */
export function canClose(state: SoftphoneState): boolean {
  return state.phase === 'idle' || state.phase === 'blocked' || state.phase === 'saved' || state.phase === 'error';
}

/** Whether a call exists at the provider that the browser must hang up when the dialog goes away. */
export function hasProviderCall(state: SoftphoneState): boolean {
  return state.phase === 'connecting' || state.phase === 'ringing' || state.phase === 'in_call';
}

export function softphoneReducer(state: SoftphoneState, event: SoftphoneEvent): SoftphoneState {
  switch (event.type) {
    case 'DIAL':
      return state.phase === 'idle' || state.phase === 'blocked' || state.phase === 'error' ? { phase: 'checking' } : state;

    case 'CHECK_ALLOWED':
      return state.phase === 'checking' ? { phase: 'connecting', callId: event.callId } : state;

    case 'CHECK_BLOCKED':
      return state.phase === 'checking'
        ? { phase: 'blocked', reasons: event.reasons, dryRun: event.dryRun ?? false, localTime: event.localTime ?? null, timezone: event.timezone ?? null }
        : state;

    case 'CHECK_FAILED':
      return state.phase === 'checking' ? { phase: 'error', error: event.error } : state;

    case 'RTC_RINGING':
      return state.phase === 'connecting' ? { phase: 'ringing', callId: state.callId } : state;

    case 'RTC_ANSWERED':
      // An answer can overtake the "ringing" event; both lead to in_call.
      return state.phase === 'connecting' || state.phase === 'ringing'
        ? { phase: 'in_call', callId: state.callId, muted: false, held: false }
        : state;

    case 'RTC_HELD':
      return state.phase === 'in_call' ? { ...state, held: event.held } : state;

    case 'MUTED':
      return state.phase === 'in_call' ? { ...state, muted: event.muted } : state;

    case 'HANGUP':
      return endCall(state, 'local_hangup');

    case 'REMOTE_ENDED':
      return endCall(state, 'remote_hangup');

    case 'RTC_ERROR':
      if (state.phase === 'checking' || state.phase === 'connecting') return { phase: 'error', error: event.error };
      // Once it rang there is a call to log; the failure is not a reason to lose the outcome.
      return state.phase === 'ringing' || state.phase === 'in_call' ? endCall(state, 'error') : state;

    case 'SAVE_STARTED':
      return state.phase === 'wrap_up' && !state.saving ? { ...state, saving: true, saveError: null } : state;

    case 'SAVE_SUCCEEDED':
      return state.phase === 'wrap_up' ? { phase: 'saved', callId: state.callId, outcome: event.outcome } : state;

    case 'SAVE_FAILED':
      return state.phase === 'wrap_up' ? { ...state, saving: false, saveError: event.message } : state;

    case 'RESET':
      return state.phase === 'blocked' || state.phase === 'error' || state.phase === 'saved' ? INITIAL_SOFTPHONE_STATE : state;
  }
}

function endCall(state: SoftphoneState, endedBy: CallEndReason): SoftphoneState {
  switch (state.phase) {
    case 'checking':
      // Nothing was dialled yet; the attempt's row stays `authorized`/`blocked` and the answer, if it
      // still arrives, is ignored in idle.
      return endedBy === 'local_hangup' ? INITIAL_SOFTPHONE_STATE : state;
    case 'connecting':
      // Never rang: nothing happened that needs an outcome.
      return endedBy === 'local_hangup'
        ? INITIAL_SOFTPHONE_STATE
        : { phase: 'error', error: { code: 'call_failed', message: 'The call could not be connected.' } };
    case 'ringing':
      return { phase: 'wrap_up', callId: state.callId, answered: false, endedBy, saving: false, saveError: null };
    case 'in_call':
      return { phase: 'wrap_up', callId: state.callId, answered: true, endedBy, saving: false, saveError: null };
    default:
      return state;
  }
}
