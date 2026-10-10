import { describe, expect, it, vi } from 'vitest';

import { BLOCK_LABELS, blockLabel } from '@/lib/telephony/blockLabels';
import { chooseCallSurface } from '@/lib/telephony/callSurface';
import { BLOCK_REASONS } from '@/lib/telephony/compliance';
import { phoneCallTarget } from '@/lib/telephony/logPhoneCall';
import { describeMicError, eventsForRtcState, requestCall, saveCallOutcome } from '@/lib/telephony/softphoneFlow';
import {
  canClose,
  hasProviderCall,
  INITIAL_SOFTPHONE_STATE,
  isLive,
  softphoneReducer,
  type SoftphoneEvent,
  type SoftphoneState,
} from '@/lib/telephony/softphoneMachine';

/** The softphone's pure parts: the state machine, the gate's words, routing, and the request edges. */

const run = (events: SoftphoneEvent[], from: SoftphoneState = INITIAL_SOFTPHONE_STATE) => events.reduce(softphoneReducer, from);
const TO_CALL: SoftphoneEvent[] = [{ type: 'DIAL' }, { type: 'CHECK_ALLOWED', callId: 'c1' }];
const IN_CALL: SoftphoneEvent[] = [...TO_CALL, { type: 'RTC_RINGING' }, { type: 'RTC_ANSWERED' }];
const wrapUp = () => run([...IN_CALL, { type: 'HANGUP' }]);

describe('softphone state machine: the happy path', () => {
  it('walks idle -> checking -> connecting -> ringing -> in_call -> wrap_up -> saved', () => {
    expect(run([{ type: 'DIAL' }])).toEqual({ phase: 'checking' });
    expect(run(TO_CALL)).toEqual({ phase: 'connecting', callId: 'c1' });
    expect(run([...TO_CALL, { type: 'RTC_RINGING' }])).toEqual({ phase: 'ringing', callId: 'c1' });
    expect(run(IN_CALL)).toEqual({ phase: 'in_call', callId: 'c1', muted: false, held: false });
    expect(wrapUp()).toEqual({ phase: 'wrap_up', callId: 'c1', answered: true, endedBy: 'local_hangup', saving: false, saveError: null });
    expect(run([...IN_CALL, { type: 'HANGUP' }, { type: 'SAVE_STARTED' }, { type: 'SAVE_SUCCEEDED', outcome: 'connected_interested' }])).toEqual({
      phase: 'saved',
      callId: 'c1',
      outcome: 'connected_interested',
    });
  });

  it('lets an answer overtake the ringing event', () => {
    expect(run([...TO_CALL, { type: 'RTC_ANSWERED' }])).toMatchObject({ phase: 'in_call', callId: 'c1' });
  });

  it('tracks mute and hold only inside a call', () => {
    const muted = run([...IN_CALL, { type: 'MUTED', muted: true }, { type: 'RTC_HELD', held: true }]);
    expect(muted).toMatchObject({ phase: 'in_call', muted: true, held: true });
    expect(run([...IN_CALL, { type: 'RTC_HELD', held: true }, { type: 'RTC_HELD', held: false }])).toMatchObject({ held: false });
    expect(run([{ type: 'MUTED', muted: true }])).toEqual(INITIAL_SOFTPHONE_STATE);
    expect(run([...TO_CALL, { type: 'RTC_HELD', held: true }])).toEqual({ phase: 'connecting', callId: 'c1' });
  });
});

describe('softphone state machine: the gate says no', () => {
  it('goes to blocked with every reason and the dry-run flag', () => {
    const state = run([{ type: 'DIAL' }, { type: 'CHECK_BLOCKED', reasons: ['suppressed', 'outside_hours'], localTime: '08:00', timezone: 'Asia/Singapore' }]);
    expect(state).toEqual({ phase: 'blocked', reasons: ['suppressed', 'outside_hours'], dryRun: false, localTime: '08:00', timezone: 'Asia/Singapore' });
    expect(run([{ type: 'DIAL' }, { type: 'CHECK_BLOCKED', reasons: ['dry_run'], dryRun: true }])).toMatchObject({ phase: 'blocked', dryRun: true });
  });

  it('can dial again after a block, and reset to idle', () => {
    const blocked = run([{ type: 'DIAL' }, { type: 'CHECK_BLOCKED', reasons: ['no_phone'] }]);
    expect(run([{ type: 'DIAL' }], blocked)).toEqual({ phase: 'checking' });
    expect(run([{ type: 'RESET' }], blocked)).toEqual(INITIAL_SOFTPHONE_STATE);
  });

  it('shows a failed check as an error, and lets the rep retry', () => {
    const error = { code: 'check_failed', message: 'down' } as const;
    const failed = run([{ type: 'DIAL' }, { type: 'CHECK_FAILED', error }]);
    expect(failed).toEqual({ phase: 'error', error });
    expect(run([{ type: 'DIAL' }], failed)).toEqual({ phase: 'checking' });
  });
});

describe('softphone state machine: hanging up from every live state', () => {
  it('during checking cancels the attempt, and a late answer is ignored', () => {
    const state = run([{ type: 'DIAL' }, { type: 'HANGUP' }]);
    expect(state).toEqual(INITIAL_SOFTPHONE_STATE);
    expect(run([{ type: 'CHECK_ALLOWED', callId: 'late' }], state)).toEqual(INITIAL_SOFTPHONE_STATE);
    expect(run([{ type: 'CHECK_BLOCKED', reasons: ['suppressed'] }], state)).toEqual(INITIAL_SOFTPHONE_STATE);
  });

  it('during connecting cancels without an outcome form (nothing rang)', () => {
    expect(run([...TO_CALL, { type: 'HANGUP' }])).toEqual(INITIAL_SOFTPHONE_STATE);
  });

  it('during ringing owes an outcome, and records that nobody answered', () => {
    expect(run([...TO_CALL, { type: 'RTC_RINGING' }, { type: 'HANGUP' }])).toMatchObject({ phase: 'wrap_up', answered: false, endedBy: 'local_hangup' });
  });

  it('during the call owes an outcome', () => {
    expect(wrapUp()).toMatchObject({ phase: 'wrap_up', answered: true });
  });

  it('a late SDK event cannot revive a hung-up call', () => {
    const ended = wrapUp();
    for (const event of [{ type: 'RTC_RINGING' }, { type: 'RTC_ANSWERED' }, { type: 'REMOTE_ENDED' }, { type: 'HANGUP' }] as SoftphoneEvent[]) {
      expect(run([event], ended)).toEqual(ended);
    }
  });
});

describe('softphone state machine: the other side and the provider', () => {
  it('a remote hangup in a call goes to wrap-up', () => {
    expect(run([...IN_CALL, { type: 'REMOTE_ENDED' }])).toMatchObject({ phase: 'wrap_up', answered: true, endedBy: 'remote_hangup' });
  });

  it('a remote hangup before ringing is a failed connection, not an outcome', () => {
    expect(run([...TO_CALL, { type: 'REMOTE_ENDED' }])).toMatchObject({ phase: 'error', error: { code: 'call_failed' } });
  });

  it('a provider error while connecting is an error; while on the call it still owes the outcome', () => {
    const error = { code: 'provider_error', message: 'boom' } as const;
    expect(run([...TO_CALL, { type: 'RTC_ERROR', error }])).toEqual({ phase: 'error', error });
    expect(run([{ type: 'DIAL' }, { type: 'RTC_ERROR', error }])).toEqual({ phase: 'error', error });
    expect(run([...IN_CALL, { type: 'RTC_ERROR', error }])).toMatchObject({ phase: 'wrap_up', endedBy: 'error', answered: true });
    expect(run([{ type: 'RTC_ERROR', error }])).toEqual(INITIAL_SOFTPHONE_STATE);
  });
});

describe('softphone state machine: the outcome is required', () => {
  it('cannot be closed or reset out of wrap-up', () => {
    const state = wrapUp();
    expect(canClose(state)).toBe(false);
    expect(run([{ type: 'RESET' }, { type: 'DIAL' }], state)).toEqual(state);
  });

  it('keeps the form open and reports the error when saving fails, then allows a retry', () => {
    const failed = run([{ type: 'SAVE_STARTED' }, { type: 'SAVE_FAILED', message: 'nope' }], wrapUp());
    expect(failed).toMatchObject({ phase: 'wrap_up', saving: false, saveError: 'nope' });
    expect(canClose(failed)).toBe(false);
    expect(run([{ type: 'SAVE_STARTED' }], failed)).toMatchObject({ saving: true, saveError: null });
  });

  it('ignores a second save while one is running', () => {
    const saving = run([{ type: 'SAVE_STARTED' }], wrapUp());
    expect(run([{ type: 'SAVE_STARTED' }], saving)).toBe(saving);
  });

  it('ignores save events outside wrap-up', () => {
    expect(run([{ type: 'SAVE_SUCCEEDED', outcome: 'no_answer' }])).toEqual(INITIAL_SOFTPHONE_STATE);
    expect(run([{ type: 'SAVE_FAILED', message: 'x' }, { type: 'SAVE_STARTED' }])).toEqual(INITIAL_SOFTPHONE_STATE);
  });

  it('allows closing only when nothing is live and nothing is owed', () => {
    const closable = (s: SoftphoneState) => canClose(s);
    expect(closable(INITIAL_SOFTPHONE_STATE)).toBe(true);
    expect(closable(run([{ type: 'DIAL' }, { type: 'CHECK_BLOCKED', reasons: [] }]))).toBe(true);
    expect(closable(run([{ type: 'DIAL' }]))).toBe(false);
    expect(closable(run(TO_CALL))).toBe(false);
    expect(closable(run(IN_CALL))).toBe(false);
    expect(closable(run([...IN_CALL, { type: 'HANGUP' }, { type: 'SAVE_SUCCEEDED', outcome: 'no_answer' }]))).toBe(true);
  });

  it('knows which states are live and which hold a provider call', () => {
    expect(isLive(run([{ type: 'DIAL' }]))).toBe(true);
    expect(hasProviderCall(run([{ type: 'DIAL' }]))).toBe(false);
    expect(hasProviderCall(run(TO_CALL))).toBe(true);
    expect(isLive(wrapUp())).toBe(false);
    expect(hasProviderCall(wrapUp())).toBe(false);
  });

  it('refuses to start a second call while one is live', () => {
    const live = run(IN_CALL);
    expect(run([{ type: 'DIAL' }], live)).toBe(live);
    expect(run([{ type: 'DIAL' }], wrapUp())).toMatchObject({ phase: 'wrap_up' });
  });
});

describe('softphone state machine: reopening a lost wrap-up', () => {
  it('goes straight to wrap-up for an earlier call, only from idle', () => {
    const resumed = run([{ type: 'RESUME_WRAP_UP', callId: 'old' }]);
    expect(resumed).toMatchObject({ phase: 'wrap_up', callId: 'old', saving: false });
    expect(canClose(resumed)).toBe(false);
    expect(run([{ type: 'SAVE_STARTED' }, { type: 'SAVE_SUCCEEDED', outcome: 'no_answer' }], resumed)).toMatchObject({ phase: 'saved', callId: 'old' });
    const live = run(IN_CALL);
    expect(run([{ type: 'RESUME_WRAP_UP', callId: 'old' }], live)).toBe(live);
  });
});

describe('the gate\'s words', () => {
  it('has a label for every block reason, and for the dry-run marker', () => {
    for (const reason of [...BLOCK_REASONS, 'dry_run']) {
      expect(BLOCK_LABELS[reason as keyof typeof BLOCK_LABELS]?.label, reason).toBeTruthy();
    }
    expect(Object.keys(BLOCK_LABELS).sort()).toEqual([...BLOCK_REASONS, 'dry_run'].sort());
  });

  it('gives the rep a fix where the rep can fix it, and none where only a manager can', () => {
    expect(blockLabel('no_phone').fix).toMatch(/Add a number/);
    expect(blockLabel('tz_unknown').fix).toMatch(/timezone/);
    expect(blockLabel('lead_do_not_call').fix).toBeNull();
    expect(blockLabel('suppressed').fix).toBeNull();
  });

  it('never shows a machine reason code to the rep, even an unknown one', () => {
    expect(blockLabel('brand_new_reason').label).toBe('The call is not allowed.');
    for (const reason of BLOCK_REASONS) expect(blockLabel(reason).label).not.toContain('_');
  });
});

describe('which screen the Call button opens', () => {
  const surface = (phone: string, country: string | null, dialerEnabled: boolean) =>
    chooseCallSurface({ target: phoneCallTarget(phone, country), dialerEnabled });

  it('sends a Vietnamese number to the phone panel, even with the dialer enabled', () => {
    expect(surface('0948 200 638', 'Vietnam', true)).toBe('phone_panel');
    expect(surface('0948200638', 'Singapore', true)).toBe('phone_panel');
  });

  it('sends a foreign number to the softphone when the dialer is enabled', () => {
    expect(surface('+1 415 555 2671', 'United States', true)).toBe('softphone');
  });

  it('keeps the phone panel for everything when the dialer is not enabled for this rep', () => {
    expect(surface('+1 415 555 2671', 'United States', false)).toBe('phone_panel');
    expect(surface('0948200638', 'Vietnam', false)).toBe('phone_panel');
  });

  it('sends an unreadable number to the panel, which says so', () => {
    expect(surface('not a number', null, true)).toBe('phone_panel');
  });
});

const respond = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('asking for a call', () => {
  it('returns the token (clientState) to dial with when allowed', async () => {
    const fetchImpl = vi.fn(respond(201, { callId: 'c1', allowed: true, toE164: '+14155552671', clientState: 'dG9rZW4=', expiresAt: 'x' }));
    const result = await requestCall({ leadId: 'l1', fetchImpl });
    expect(result).toEqual({ kind: 'allowed', callId: 'c1', toE164: '+14155552671', clientState: 'dG9rZW4=' });
    expect(fetchImpl).toHaveBeenCalledWith('/api/telephony/calls', expect.objectContaining({ method: 'POST', body: JSON.stringify({ leadId: 'l1' }) }));
  });

  it('returns every reason when blocked, and says test mode for a dry run', async () => {
    expect(await requestCall({ leadId: 'l1', fetchImpl: respond(200, { callId: 'c', allowed: false, dryRun: false, reasons: ['suppressed', 'outside_hours'], localTime: '08:00', timezone: 'Asia/Ho_Chi_Minh' }) })).toEqual({
      kind: 'blocked',
      reasons: ['suppressed', 'outside_hours'],
      dryRun: false,
      localTime: '08:00',
      timezone: 'Asia/Ho_Chi_Minh',
    });
    expect(await requestCall({ leadId: 'l1', fetchImpl: respond(200, { callId: 'c', allowed: false, dryRun: true, wouldBeAllowed: true, reasons: [] }) })).toMatchObject({
      kind: 'blocked',
      dryRun: true,
      reasons: ['dry_run'],
    });
  });

  it('treats a lead with no dialable number as blocked with the gate\'s reasons', async () => {
    expect(await requestCall({ leadId: 'l1', fetchImpl: respond(422, { code: 'no_dialable_number', reasons: ['no_phone'] }) })).toMatchObject({ kind: 'blocked', reasons: ['no_phone'] });
    expect(await requestCall({ leadId: 'l1', fetchImpl: respond(422, { code: 'no_dialable_number' }) })).toMatchObject({ kind: 'blocked', reasons: ['no_phone'] });
  });

  it('maps a disabled dialer, a too-quick second attempt, a missing lead, a server error and a network failure to clear errors', async () => {
    expect(await requestCall({ leadId: 'l', fetchImpl: respond(403, { code: 'dialer_disabled' }) })).toMatchObject({ kind: 'error', error: { code: 'dialer_disabled' } });
    expect(await requestCall({ leadId: 'l', fetchImpl: respond(429, { code: 'rate_limited' }) })).toMatchObject({ kind: 'error', error: { code: 'rate_limited' } });
    expect(await requestCall({ leadId: 'l', fetchImpl: respond(404, { code: 'not_found' }) })).toMatchObject({ kind: 'error', error: { code: 'check_failed' } });
    expect(await requestCall({ leadId: 'l', fetchImpl: respond(500, {}) })).toMatchObject({ kind: 'error', error: { code: 'check_failed' } });
    const down = await requestCall({
      leadId: 'l',
      fetchImpl: async () => {
        throw new Error('offline');
      },
    });
    expect(down).toMatchObject({ kind: 'error', error: { code: 'check_failed' } });
  });

  it('never treats an answer without a token as allowed', async () => {
    expect(await requestCall({ leadId: 'l', fetchImpl: respond(201, { callId: 'c', allowed: true, toE164: '+1' }) })).toMatchObject({ kind: 'blocked' });
  });
});

describe('saving the outcome', () => {
  it('sends the outcome and trimmed, bounded notes to the call\'s own route', async () => {
    const fetchImpl = vi.fn(respond(200, { callId: 'c1', outcome: 'do_not_call', suppressed: true }));
    const result = await saveCallOutcome({ callId: 'c/1', outcome: 'do_not_call', notes: `  ${'x'.repeat(3000)}  `, fetchImpl });
    expect(result).toEqual({ ok: true, suppressed: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/telephony/calls/c%2F1/outcome');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ outcome: 'do_not_call', notes: 'x'.repeat(2000) });
  });

  it('reports the server\'s reason, and a network failure, instead of pretending it saved', async () => {
    expect(await saveCallOutcome({ callId: 'c', outcome: 'no_answer', notes: '', fetchImpl: respond(409, { error: 'older than 24 hours' }) })).toEqual({ ok: false, error: 'older than 24 hours' });
    expect(await saveCallOutcome({ callId: 'c', outcome: 'no_answer', notes: '', fetchImpl: respond(500, null) })).toEqual({ ok: false, error: 'The outcome could not be saved' });
    const offline = await saveCallOutcome({
      callId: 'c',
      outcome: 'no_answer',
      notes: '',
      fetchImpl: async () => {
        throw new Error('offline');
      },
    });
    expect(offline.ok).toBe(false);
  });
});

describe('SDK call states and microphone errors', () => {
  it('maps SDK states to machine events', () => {
    expect(eventsForRtcState('early')).toEqual([{ type: 'RTC_RINGING' }]);
    expect(eventsForRtcState('ringing')).toEqual([{ type: 'RTC_RINGING' }]);
    expect(eventsForRtcState('active')).toEqual([{ type: 'RTC_ANSWERED' }, { type: 'RTC_HELD', held: false }]);
    expect(eventsForRtcState('held')).toEqual([{ type: 'RTC_HELD', held: true }]);
    for (const state of ['hangup', 'destroy', 'purge']) expect(eventsForRtcState(state)).toEqual([{ type: 'REMOTE_ENDED' }]);
    for (const state of ['new', 'requesting', 'trying', 'answering']) expect(eventsForRtcState(state)).toEqual([]);
  });

  it('walks a call through the SDK states end to end', () => {
    const states = ['requesting', 'trying', 'early', 'active', 'held', 'active', 'hangup', 'destroy'];
    const events = states.flatMap(eventsForRtcState);
    const afterCall = run([{ type: 'DIAL' }, { type: 'CHECK_ALLOWED', callId: 'c1' }, ...events]);
    expect(afterCall).toMatchObject({ phase: 'wrap_up', answered: true, endedBy: 'remote_hangup' });
  });

  it('explains a denied microphone and a missing one in words a rep can act on', () => {
    expect(describeMicError({ name: 'NotAllowedError' })).toMatchObject({ code: 'mic_denied' });
    expect(describeMicError({ name: 'NotAllowedError' }).message).toMatch(/allow the microphone/);
    expect(describeMicError({ name: 'NotFoundError' })).toMatchObject({ code: 'mic_unavailable' });
    expect(describeMicError(new Error('weird'))).toMatchObject({ code: 'mic_unavailable' });
    expect(describeMicError(null)).toMatchObject({ code: 'mic_unavailable' });
  });
});
