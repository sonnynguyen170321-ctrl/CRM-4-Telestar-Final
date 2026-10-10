import { describe, expect, it, vi } from 'vitest';

import { FakeTelephonyProvider } from '@/lib/telephony/fake';
import { TelnyxProvider } from '@/lib/telephony/telnyx/client';
import { parseTelnyxEvent } from '@/lib/telephony/telnyx/events';

type Reply = { status: number; body?: unknown };

function telnyxWith(replies: Reply[]) {
  const urls: string[] = [];
  const impl = vi.fn(async (url: string | URL | Request) => {
    urls.push(String(url));
    const reply = replies.shift();
    if (!reply) throw new Error('unexpected request');
    return new Response(reply.body === undefined ? '' : JSON.stringify(reply.body), { status: reply.status });
  });
  const telnyx = new TelnyxProvider({ apiKey: 'k', credentialConnectionId: 'c', fetchImpl: impl as unknown as typeof fetch, sleep: async () => undefined });
  return { telnyx, urls };
}

describe('TelnyxProvider.getCallStatus', () => {
  it('reports a live leg as alive', async () => {
    const { telnyx, urls } = telnyxWith([{ status: 200, body: { data: { is_alive: true } } }]);
    await expect(telnyx.getCallStatus('ctl/1')).resolves.toEqual({ alive: true });
    expect(urls[0]).toBe('https://api.telnyx.com/v2/calls/ctl%2F1');
  });

  it('reports an ended leg as not alive: is_alive false, 404, or the 422 Telnyx uses for a finished call', async () => {
    const { telnyx } = telnyxWith([{ status: 200, body: { data: { is_alive: false } } }, { status: 404 }, { status: 422 }]);
    await expect(telnyx.getCallStatus('a')).resolves.toEqual({ alive: false });
    await expect(telnyx.getCallStatus('b')).resolves.toEqual({ alive: false });
    await expect(telnyx.getCallStatus('c')).resolves.toEqual({ alive: false });
  });

  it('does not mistake an outage for an ended call', async () => {
    const { telnyx } = telnyxWith([{ status: 400 }]);
    await expect(telnyx.getCallStatus('a')).rejects.toMatchObject({ status: 400 });
  });

  it('is answered by the fake from the set of live calls', async () => {
    const fake = new FakeTelephonyProvider();
    fake.liveCalls.add('up');
    await expect(fake.getCallStatus('up')).resolves.toEqual({ alive: true });
    await expect(fake.getCallStatus('down')).resolves.toEqual({ alive: false });
  });
});

describe('parseTelnyxEvent', () => {
  it('reads the fields the dialer uses', () => {
    const event = parseTelnyxEvent({
      data: {
        id: 'e1',
        event_type: 'call.hangup',
        occurred_at: '2026-10-05T03:00:00Z',
        payload: { call_session_id: 's', call_control_id: 'c', direction: 'outgoing', hangup_cause: 'user_busy', client_state: 'abc', from: '+1', to: '+2', end_time: '2026-10-05T03:00:09Z', recording_id: 'r' },
      },
    });
    expect(event).toMatchObject({ providerEventId: 'e1', type: 'call.hangup', sessionId: 's', controlId: 'c', direction: 'outgoing', hangupCause: 'user_busy', clientState: 'abc', recordingId: 'r' });
    expect(event?.endTime?.toISOString()).toBe('2026-10-05T03:00:09.000Z');
  });

  it('refuses bodies that are not call events and ignores junk fields', () => {
    expect(parseTelnyxEvent(null)).toBeNull();
    expect(parseTelnyxEvent([])).toBeNull();
    expect(parseTelnyxEvent({ data: { id: '', event_type: 'x' } })).toBeNull();
    expect(parseTelnyxEvent({ data: { id: 'e', event_type: 'call.answered', payload: { call_session_id: 5, direction: 'sideways', start_time: 'yesterday' } } })).toMatchObject({
      sessionId: null,
      direction: null,
      startTime: null,
    });
  });
});
