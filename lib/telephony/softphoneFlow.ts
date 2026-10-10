import { NOTES_MAX, type PhoneOutcomeId } from './outcomes';
import type { SoftphoneError, SoftphoneEvent } from './softphoneMachine';

/**
 * The softphone's edges, as plain functions: what the browser asks the server, what an SDK call state
 * means for the machine, and which words a rep sees when the microphone fails. Kept out of the
 * component so the branching is unit-tested without a DOM. Client-safe.
 */

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type CallRequestResult =
  | { kind: 'allowed'; callId: string; toE164: string; clientState: string }
  | { kind: 'blocked'; reasons: string[]; dryRun: boolean; localTime: string | null; timezone: string | null }
  | { kind: 'error'; error: SoftphoneError };

const checkFailed = (message: string, code: SoftphoneError['code'] = 'check_failed'): CallRequestResult => ({ kind: 'error', error: { code, message } });

/** `POST /api/telephony/calls`: runs the gate and, when allowed, returns the token to dial with. */
export async function requestCall(input: { leadId: string; contactId?: string; fetchImpl?: Fetch }): Promise<CallRequestResult> {
  const call: Fetch = input.fetchImpl ?? ((url, init) => fetch(url, init));
  let response: Response;
  try {
    response = await call('/api/telephony/calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId: input.leadId, ...(input.contactId ? { contactId: input.contactId } : {}) }),
    });
  } catch {
    return checkFailed('Could not reach the server. Check your connection and try again.');
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (response.status === 403 && body?.code === 'dialer_disabled') return checkFailed('The dialer is not enabled.', 'dialer_disabled');
  if (response.status === 429) return checkFailed('A call was just started. Wait a few seconds and try again.', 'rate_limited');
  if (response.status === 404) return checkFailed('This lead could not be found.');
  if (response.status === 422) {
    // No number that can be dialled: the gate's reasons say why (no phone, invalid number...).
    const reasons = Array.isArray(body?.reasons) && body.reasons.length > 0 ? (body.reasons as string[]) : ['no_phone'];
    return { kind: 'blocked', reasons, dryRun: false, localTime: null, timezone: null };
  }
  if (!response.ok || !body) return checkFailed('The calling check failed. Try again in a moment.');

  if (body.allowed === true && typeof body.callId === 'string' && typeof body.clientState === 'string' && typeof body.toE164 === 'string') {
    return { kind: 'allowed', callId: body.callId, toE164: body.toE164, clientState: body.clientState };
  }
  const reasons = Array.isArray(body.reasons) ? (body.reasons as string[]) : [];
  const dryRun = body.dryRun === true;
  return {
    kind: 'blocked',
    // A dry run that would have been allowed has no reasons of its own; say it is test mode.
    reasons: dryRun && reasons.length === 0 ? ['dry_run'] : reasons,
    dryRun,
    localTime: typeof body.localTime === 'string' ? body.localTime : null,
    timezone: typeof body.timezone === 'string' ? body.timezone : null,
  };
}

export type SaveOutcomeResult = { ok: true; suppressed: boolean } | { ok: false; error: string };

/** `PATCH /api/telephony/calls/[id]/outcome`: the required wrap-up. */
export async function saveCallOutcome(input: { callId: string; outcome: PhoneOutcomeId; notes: string; fetchImpl?: Fetch }): Promise<SaveOutcomeResult> {
  const call: Fetch = input.fetchImpl ?? ((url, init) => fetch(url, init));
  try {
    const response = await call(`/api/telephony/calls/${encodeURIComponent(input.callId)}/outcome`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome: input.outcome, notes: input.notes.trim().slice(0, NOTES_MAX) }),
    });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) return { ok: false, error: (typeof body?.error === 'string' && body.error) || 'The outcome could not be saved' };
    return { ok: true, suppressed: body?.suppressed === true };
  } catch {
    return { ok: false, error: 'Network error saving the outcome. Try again.' };
  }
}

/**
 * An SDK call state to machine events. States are the SDK's lower-case names (`Call.state`). `active`
 * after a hold means "resumed", so it also clears the held flag.
 */
export function eventsForRtcState(state: string): SoftphoneEvent[] {
  switch (state) {
    case 'ringing':
    case 'early':
      return [{ type: 'RTC_RINGING' }];
    case 'active':
      return [{ type: 'RTC_ANSWERED' }, { type: 'RTC_HELD', held: false }];
    case 'held':
      return [{ type: 'RTC_HELD', held: true }];
    case 'hangup':
    case 'destroy':
    case 'purge':
      return [{ type: 'REMOTE_ENDED' }];
    default:
      return [];
  }
}

export function describeMicError(error: unknown): SoftphoneError {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return {
      code: 'mic_denied',
      message: 'Microphone access is blocked. Click the lock icon in the address bar, allow the microphone for this site, then try again.',
    };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return { code: 'mic_unavailable', message: 'No microphone was found. Plug in a headset or enable your microphone, then try again.' };
  }
  return { code: 'mic_unavailable', message: 'The microphone could not be used. Close other apps that use it and try again.' };
}


export function rtcErrorToSoftphoneError(message: string | undefined): SoftphoneError {
  return { code: 'provider_error', message: message?.trim() || 'The phone provider reported a problem with the call.' };
}
