import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));
const enqueueMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/bullmq/enqueue', () => ({ enqueue: enqueueMock }));

import { clearVisibleUserCache } from '@/lib/auth';
import { JobType } from '@/lib/bullmq/types';
import { TELEPHONY_ENV } from '@/lib/env-contract';
import { prisma } from '@/lib/prisma';
import { toClientState, issueCallToken } from '@/lib/telephony/authToken';
import { FakeTelephonyProvider } from '@/lib/telephony/fake';
import { setTelephonyProviderForTests } from '@/lib/telephony/index';
import { legClientState } from '@/lib/telephony/legMarker';
import { TelephonyProviderError } from '@/lib/telephony/provider';
import { POST } from '@/app/api/telephony/telnyx/webhook/route';
import { createTestTenant } from './helpers/testTenant';
import {
  asSystem,
  buildDialerWorld,
  clientStateFor,
  deleteEventsWithPrefix,
  eventBody,
  inTenant,
  makeCall,
  makeSigner,
  reload,
  type DialerWorld,
  type EventSpec,
} from './helpers/telephonyFixture';

/**
 * `POST /api/telephony/telnyx/webhook` (docs/dialer/TASKS.md D4.1), against a real database.
 *
 * Nothing is trusted until the raw body verifies under the Ed25519 key within five minutes. Every
 * verified event is stored once, whatever the delivery count. A parked call from a rep's browser is
 * connected only when its token, its row and the gate all agree, and in every other case — a
 * missing, expired, foreign or reused token, a closed gate, a dialer that is off, a provider that
 * errors — it is hung up on.
 */

/** Monday 2026-10-05 10:00 in Vietnam. */
const VN_10AM = new Date('2026-10-05T03:00:00Z');
const ENV_KEYS = [...TELEPHONY_ENV, 'TELEPHONY_ENABLED', 'TELEPHONY_DRY_RUN'] as const;
const nowSeconds = () => Math.floor(Date.now() / 1000);

let savedEnv: Record<string, string | undefined> = {};
const signer = makeSigner();
let fake: FakeTelephonyProvider;
let world: DialerWorld;
let other: DialerWorld;
let prefix: string;
let counter = 0;
const eventId = () => `${prefix}${(counter += 1)}`;

async function post(spec: EventSpec, options: { timestamp?: number; tamper?: boolean; headers?: 'none' | 'signature-only' } = {}) {
  const raw = JSON.stringify(eventBody(spec));
  const signed = signer.headers(raw, options.timestamp ?? nowSeconds());
  const headers: Record<string, string> =
    options.headers === 'none' ? { 'content-type': 'application/json' } : options.headers === 'signature-only' ? { 'telnyx-signature-ed25519': signed['telnyx-signature-ed25519'] } : signed;
  const body = options.tamper ? raw.replace('call.', 'call.x') : raw;
  const response = await POST(new NextRequest('https://crm.telestar.cloud/api/telephony/telnyx/webhook', { method: 'POST', body, headers }));
  return { response, body: await response.json() };
}

const storedEvents = () => asSystem(() => prisma.telephonyEvent.findMany({ where: { providerEventId: { startsWith: prefix } } }));
const transfers = () => fake.commands.filter((c) => c.command.action === 'transfer');
const hangups = () => fake.commands.filter((c) => c.command.action === 'hangup');

/** A parked call.initiated as the rep's browser produces it. */
function parked(call: { id: string; tenantId: string; userId: string | null; toE164: string }, overrides: Partial<EventSpec> = {}): EventSpec {
  return {
    id: eventId(),
    type: 'call.initiated',
    sessionId: `sess-${call.id}`,
    controlId: `ctl-${call.id}`,
    direction: 'incoming',
    clientState: clientStateFor(call),
    from: `sip:${world.sipUsername}@sip.telnyx.com`,
    to: call.toE164,
    ...overrides,
  };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(VN_10AM);
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of TELEPHONY_ENV) process.env[k] = `test-value-for-${k}-long-enough-to-satisfy-checks`;
  process.env.TELNYX_PUBLIC_KEY = signer.publicKey;
  process.env.TELEPHONY_ENABLED = 'true';
  process.env.TELEPHONY_DRY_RUN = 'false';
  clearVisibleUserCache?.();
  enqueueMock.mockReset().mockResolvedValue('job');
  fake = new FakeTelephonyProvider();
  setTelephonyProviderForTests(fake);

  prefix = `evt-wh-${randomUUID()}-`;
  counter = 0;
  const tenantId = await createTestTenant(`t-telwh-${randomUUID()}`, 'Webhook');
  const otherTenantId = await createTestTenant(`t-telwh-o-${randomUUID()}`, 'Webhook other');
  world = await buildDialerWorld(tenantId);
  other = await buildDialerWorld(otherTenantId);
});

afterEach(async () => {
  vi.useRealTimers();
  setTelephonyProviderForTests(null);
  await deleteEventsWithPrefix(prefix);
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k]!;
  }
});

describe('webhook signature', () => {
  it('acts on a validly signed event', async () => {
    const call = await makeCall(world, { status: 'initiated', sessionId: 's-1', controlId: 'c-1' });
    const { response } = await post({ id: eventId(), type: 'call.answered', sessionId: 's-1', controlId: 'c-1' });
    expect(response.status).toBe(200);
    expect(await storedEvents()).toHaveLength(1);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(call.id).toBeTruthy();
  });

  it('refuses a request with no signature headers: 400, nothing stored, nothing done', async () => {
    const call = await makeCall(world);
    const { response } = await post(parked(call), { headers: 'none' });
    expect(response.status).toBe(400);
    expect(await storedEvents()).toHaveLength(0);
    expect(fake.commands).toHaveLength(0);
    expect(enqueueMock).not.toHaveBeenCalled();
    expect((await reload(world.tenantId, call.id)).status).toBe('authorized');
  });

  it('refuses a request with a signature but no timestamp', async () => {
    const call = await makeCall(world);
    expect((await post(parked(call), { headers: 'signature-only' })).response.status).toBe(400);
    expect(await storedEvents()).toHaveLength(0);
  });

  it('refuses a body changed after signing: 401, and a valid parked call is not connected', async () => {
    const call = await makeCall(world);
    const { response } = await post(parked(call), { tamper: true });
    expect(response.status).toBe(401);
    expect(await storedEvents()).toHaveLength(0);
    expect(fake.commands).toHaveLength(0);
    expect((await reload(world.tenantId, call.id)).status).toBe('authorized');
  });

  it('refuses a signature from another key', async () => {
    const call = await makeCall(world);
    const stranger = makeSigner();
    const raw = JSON.stringify(eventBody(parked(call)));
    const response = await POST(
      new NextRequest('https://crm.telestar.cloud/api/telephony/telnyx/webhook', { method: 'POST', body: raw, headers: stranger.headers(raw, nowSeconds()) })
    );
    expect(response.status).toBe(401);
    expect(fake.commands).toHaveLength(0);
  });

  it('accepts a timestamp 300 s old and refuses one 301 s old or 301 s ahead', async () => {
    const call = await makeCall(world, { status: 'initiated', sessionId: 's-skew', controlId: 'c-skew' });
    const at = (skew: number) => post({ id: eventId(), type: 'call.answered', sessionId: 's-skew', controlId: 'c-skew' }, { timestamp: nowSeconds() + skew });

    expect((await at(-300)).response.status).toBe(200);
    expect((await at(-301)).response.status).toBe(401);
    expect((await at(301)).response.status).toBe(401);
    expect(await storedEvents()).toHaveLength(1);
    expect(call.id).toBeTruthy();
  });

  it('answers 503 and does nothing while the verification key is not configured', async () => {
    delete process.env.TELNYX_PUBLIC_KEY;
    const call = await makeCall(world);
    expect((await post(parked(call))).response.status).toBe(503);
    expect(await storedEvents()).toHaveLength(0);
    expect(fake.commands).toHaveLength(0);
  });

  it('rejects a body that is not a call event', async () => {
    const raw = JSON.stringify({ hello: 'world' });
    const response = await POST(
      new NextRequest('https://crm.telestar.cloud/api/telephony/telnyx/webhook', { method: 'POST', body: raw, headers: signer.headers(raw, nowSeconds()) })
    );
    expect(response.status).toBe(400);
  });
});

describe('webhook body', () => {
  const url = 'https://crm.telestar.cloud/api/telephony/telnyx/webhook';

  it('refuses a body over 256 KB however it is delivered, without trusting Content-Length', async () => {
    const chunk = new TextEncoder().encode('x'.repeat(64 * 1024));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 6) return controller.close();
        sent += 1;
        controller.enqueue(chunk);
      },
    });
    const response = await POST(new NextRequest(url, { method: 'POST', body: stream, duplex: 'half', headers: { 'content-length': '10' } } as unknown as ConstructorParameters<typeof NextRequest>[1]));
    expect(response.status).toBe(413);
    expect(sent).toBeLessThan(6); // stopped reading once past the cap
    expect(await storedEvents()).toHaveLength(0);
  });

  it('accepts a body of exactly 256 KB up to the signature check', async () => {
    const body = 'x'.repeat(256 * 1024);
    const response = await POST(new NextRequest(url, { method: 'POST', body, headers: signer.headers(body, nowSeconds()) }));
    expect(response.status).toBe(400); // signed and in bounds, but not a call event
  });

  it('refuses a body that is not valid UTF-8', async () => {
    const response = await POST(new NextRequest(url, { method: 'POST', body: new Uint8Array([0x7b, 0xff, 0x7d]), headers: { 'telnyx-signature-ed25519': 'AA==', 'telnyx-timestamp': String(nowSeconds()) } }));
    expect(response.status).toBe(400);
  });

  it('logs the kind of failure, never its message', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const spy = vi.spyOn(prisma.telephonyEvent, 'createMany').mockRejectedValueOnce(Object.assign(new Error('Invalid create args {to: +84948200638, token: SECRET-TOKEN}'), { code: 'P2002' }));
    await post({ id: eventId(), type: 'call.answered', sessionId: 'x', controlId: 'x' });
    spy.mockRestore();
    const output = JSON.stringify(logged.mock.calls);
    logged.mockRestore();
    expect(output).toContain('P2002');
    expect(output).not.toContain('SECRET-TOKEN');
    expect(output).not.toContain('84948200638');
  });
});

describe('webhook inbox and queueing', () => {
  it('stores a redelivered event once and queues it once', async () => {
    await makeCall(world, { status: 'initiated', sessionId: 's-dup', controlId: 'c-dup' });
    const spec: EventSpec = { id: eventId(), type: 'call.answered', sessionId: 's-dup', controlId: 'c-dup' };

    const first = await post(spec);
    const second = await post(spec);

    expect(first.body).toEqual({ received: true });
    expect(second.response.status).toBe(200);
    expect(second.body).toEqual({ received: true, duplicate: true });
    expect(await storedEvents()).toHaveLength(1);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledWith(
      JobType.TELEPHONY_EVENT,
      { providerEventId: spec.id },
      expect.objectContaining({ tenantId: world.tenantId, dedupeKey: `telephony:event:${spec.id}` })
    );
  });

  it('queues the event under the tenant of the call it belongs to, whatever else the payload says', async () => {
    await makeCall(other, { status: 'initiated', sessionId: 's-other', controlId: 'c-other' });
    await post({ id: eventId(), type: 'call.answered', sessionId: 's-other', controlId: 'c-other' });
    expect(enqueueMock.mock.calls[0][2]).toMatchObject({ tenantId: other.tenantId });
  });

  it('delays a hangup so the answered event can land first', async () => {
    await makeCall(world, { status: 'answered', sessionId: 's-hang', controlId: 'c-hang' });
    await post({ id: eventId(), type: 'call.hangup', sessionId: 's-hang', controlId: 'c-hang', hangupCause: 'normal_clearing' });
    expect(enqueueMock.mock.calls[0][2]).toMatchObject({ delay: 5000 });
  });

  it('stores an event for an unknown call and queues nothing for it', async () => {
    const { response } = await post({ id: eventId(), type: 'call.answered', sessionId: 'nobody', controlId: 'nobody' });
    expect(response.status).toBe(200);
    expect(await storedEvents()).toHaveLength(1);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('still answers 200 when the queue is down: the event is stored for the reconcile cron', async () => {
    await makeCall(world, { status: 'initiated', sessionId: 's-q', controlId: 'c-q' });
    enqueueMock.mockRejectedValueOnce(new Error('redis down'));
    const { response } = await post({ id: eventId(), type: 'call.answered', sessionId: 's-q', controlId: 'c-q' });
    expect(response.status).toBe(200);
    const [stored] = await storedEvents();
    expect(stored.processedAt).toBeNull();
  });

  it('answers 5xx only when the event cannot be stored', async () => {
    const spy = vi.spyOn(prisma.telephonyEvent, 'createMany').mockRejectedValueOnce(new Error('db down'));
    const { response } = await post({ id: eventId(), type: 'call.answered', sessionId: 'x', controlId: 'x' });
    spy.mockRestore();
    expect(response.status).toBe(500);
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});

describe('a parked call from the rep’s browser', () => {
  it('is connected when token, row and gate agree: claimed once, transferred to the lead with the leg mark', async () => {
    const call = await makeCall(world);
    await inTenant(world.tenantId, () => prisma.telephonyNumber.create({ data: { tenantId: world.tenantId, e164: `+1415${Math.floor(1000000 + Math.random() * 8999999)}`, country: 'US', purpose: 'both' } }));
    const spec = parked(call);

    const { response } = await post(spec);

    expect(response.status).toBe(200);
    expect(transfers()).toHaveLength(1);
    expect(transfers()[0]).toMatchObject({
      callControlId: spec.controlId,
      commandId: `transfer:${call.id}`,
      command: { action: 'transfer', to: '+84948200638', timeoutSecs: 30, clientState: legClientState(call.id) },
    });
    expect(hangups()).toHaveLength(0);
    const row = await reload(world.tenantId, call.id);
    expect(row).toMatchObject({ status: 'initiated', providerSessionId: spec.sessionId, providerControlId: spec.controlId });
    expect(row.initiatedAt?.toISOString()).toBe(VN_10AM.toISOString());
    expect(row.fromE164).toMatch(/^\+1415/);
    const [stored] = await storedEvents();
    expect(stored.processedAt).not.toBeNull();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('is hung up when it carries no token', async () => {
    const call = await makeCall(world);
    const { response } = await post(parked(call, { clientState: null }));
    expect(response.status).toBe(200);
    expect(transfers()).toHaveLength(0);
    expect(hangups()).toHaveLength(1);
    expect((await reload(world.tenantId, call.id)).status).toBe('authorized');
  });

  it('is hung up when the client state is not a token', async () => {
    const call = await makeCall(world);
    await post(parked(call, { clientState: toClientState('not-a-token') }));
    expect(transfers()).toHaveLength(0);
    expect(hangups()).toHaveLength(1);
  });

  it('is hung up when the token has expired', async () => {
    const call = await makeCall(world);
    await post(parked(call, { clientState: clientStateFor(call, nowSeconds() - 121) }));
    expect(transfers()).toHaveLength(0);
    expect(hangups()).toHaveLength(1);
    expect((await reload(world.tenantId, call.id)).status).toBe('authorized');
  });

  it('hangs up, but leaves the rep’s row alone, when the token was issued to another user', async () => {
    const call = await makeCall(world);
    const colleague = await inTenant(world.tenantId, () =>
      prisma.user.create({ data: { tenantId: world.tenantId, email: `c.${randomUUID()}@t.test`, firstName: 'C', lastName: 'W', password: 'x', role: 'sdr' } })
    );
    const clientState = toClientState(issueCallToken({ callId: call.id, tenantId: world.tenantId, userId: colleague.id, toE164: call.toE164 }, nowSeconds()));
    await post(parked(call, { clientState }));
    expect(transfers()).toHaveLength(0);
    expect(hangups()).toHaveLength(1);
    expect((await reload(world.tenantId, call.id)).status).toBe('authorized');
  });

  it('is hung up when the browser dials a different number than the token names', async () => {
    const call = await makeCall(world);
    await post(parked(call, { to: '+84900000001' }));
    expect(transfers()).toHaveLength(0);
    expect(hangups()).toHaveLength(1);
    expect(await reload(world.tenantId, call.id)).toMatchObject({ status: 'blocked', blockedReasons: ['destination_mismatch'] });
  });

  it('hangs up, but leaves the row alone, when it comes from another rep’s login (a copied token)', async () => {
    const call = await makeCall(world);
    await post(parked(call, { from: 'sip:gencredSomeoneElse@sip.telnyx.com' }));
    expect(transfers()).toHaveLength(0);
    expect(hangups()).toHaveLength(1);
    expect((await reload(world.tenantId, call.id)).status).toBe('authorized');
  });

  it('refuses a call with no caller identity, and one whose login only contains the rep’s as a substring', async () => {
    const call = await makeCall(world);
    await post(parked(call, { from: undefined }));
    await post(parked(call, { from: `sip:x${world.sipUsername}y@sip.telnyx.com` }));
    await post(parked(call, { from: `sip:${world.sipUsername}@sip.telnyx.com`.padEnd(300, 'a') }));
    expect(transfers()).toHaveLength(0);
    expect(hangups()).toHaveLength(3);
    expect((await reload(world.tenantId, call.id)).status).toBe('authorized');
  });

  it('accepts the rep’s login in the common SIP address shapes', async () => {
    for (const shape of [
      (u: string) => u,
      (u: string) => `${u}@sip.telnyx.com`,
      (u: string) => `<sip:${u.toUpperCase()}@sip.telnyx.com>;tag=abc`,
      (u: string) => `"Rep" <sip:${u}@sip.telnyx.com>`,
    ]) {
      const call = await makeCall(world);
      fake.commands.length = 0;
      await post(parked(call, { from: shape(world.sipUsername) }));
      expect(transfers(), shape(world.sipUsername)).toHaveLength(shape(world.sipUsername).includes('@') ? 1 : 0);
      vi.setSystemTime(new Date(Date.now() + 4000));
    }
  });

  it('never reaches another tenant’s call: a token naming a call outside its tenant finds nothing', async () => {
    const mine = await makeCall(world);
    const theirs = await makeCall(other);
    // A token signed for tenant A's id but naming tenant B's call.
    const clientState = toClientState(issueCallToken({ callId: theirs.id, tenantId: world.tenantId, userId: world.repId, toE164: theirs.toE164 }, nowSeconds()));
    await post(parked(theirs, { clientState }));
    expect(transfers()).toHaveLength(0);
    expect(hangups()).toHaveLength(1);
    expect((await reload(other.tenantId, theirs.id)).status).toBe('authorized');
    expect((await reload(world.tenantId, mine.id)).status).toBe('authorized');
  });

  it('is hung up when the second use of the same token arrives: one transfer only', async () => {
    const call = await makeCall(world);
    const clientState = clientStateFor(call);
    await post(parked(call, { clientState }));
    await post(parked(call, { clientState }));
    expect(transfers()).toHaveLength(1);
    expect(hangups()).toHaveLength(1);
    expect((await reload(world.tenantId, call.id)).status).toBe('initiated');
  });

  it('re-runs the gate: a call authorized at 16:59:59 is refused at 17:00', async () => {
    // The default is any time (owner, 2026-10-08); a manager who sets 08:00-17:00 gets it enforced.
    await inTenant(world.tenantId, () =>
      prisma.telephonySettings.update({ where: { tenantId: world.tenantId }, data: { callingHoursStart: 480, callingHoursEnd: 1020 } })
    );
    const call = await makeCall(world);
    vi.setSystemTime(new Date('2026-10-05T10:00:00Z')); // 17:00 in Vietnam
    await post(parked(call, { clientState: clientStateFor(call, nowSeconds()) }));
    expect(transfers()).toHaveLength(0);
    expect(hangups()).toHaveLength(1);
    expect(await reload(world.tenantId, call.id)).toMatchObject({ status: 'blocked', blockedReasons: ['outside_hours'] });
  });

  it('re-runs the gate: a number suppressed after authorization is not dialled', async () => {
    const call = await makeCall(world);
    await inTenant(world.tenantId, () => prisma.phoneSuppression.create({ data: { tenantId: world.tenantId, e164: call.toE164, source: 'manual' } }));
    await post(parked(call));
    expect(transfers()).toHaveLength(0);
    expect(hangups()).toHaveLength(1);
    expect(await reload(world.tenantId, call.id)).toMatchObject({ status: 'blocked', blockedReasons: ['suppressed'] });
  });

  it('with the dialer switched off: verified and stored, never bridged', async () => {
    process.env.TELEPHONY_ENABLED = 'false';
    const call = await makeCall(world);
    const { response } = await post(parked(call));
    expect(response.status).toBe(200);
    expect(await storedEvents()).toHaveLength(1);
    expect(transfers()).toHaveLength(0);
    expect(hangups()).toHaveLength(1);
    expect((await reload(world.tenantId, call.id)).blockedReasons).toContain('dialer_disabled');
  });

  it('with the team’s kill switch thrown: never bridged', async () => {
    await inTenant(world.tenantId, () => prisma.telephonySettings.update({ where: { tenantId: world.tenantId }, data: { killedAt: new Date() } }));
    const call = await makeCall(world);
    await post(parked(call));
    expect(transfers()).toHaveLength(0);
    expect((await reload(world.tenantId, call.id)).blockedReasons).toContain('kill_switch');
  });

  it('in dry-run: never bridged', async () => {
    delete process.env.TELEPHONY_DRY_RUN;
    const call = await makeCall(world);
    await post(parked(call));
    expect(transfers()).toHaveLength(0);
    expect(hangups()).toHaveLength(1);
    expect((await reload(world.tenantId, call.id)).blockedReasons).toContain('dry_run');
  });

  it('fails closed when the provider refuses to connect it: hung up, ended as failed, not counted as an attempt', async () => {
    const call = await makeCall(world);
    fake.failNext.command = new TelephonyProviderError('refused', 400, false);
    const { response } = await post(parked(call));
    expect(response.status).toBe(200);
    expect(hangups()).toHaveLength(1);
    expect(await reload(world.tenantId, call.id)).toMatchObject({ status: 'failed', hangupCause: 'connect_failed', initiatedAt: null });
  });

  it('leaves a call initiated, and does not hang it up, when the connect result is unknown (timeout)', async () => {
    const call = await makeCall(world);
    fake.failNext.command = new TelephonyProviderError('timeout', null, true);
    const { response } = await post(parked(call));
    expect(response.status).toBe(200);
    expect(hangups()).toHaveLength(0);
    const row = await reload(world.tenantId, call.id);
    expect(row.status).toBe('initiated');
    expect(row.initiatedAt).not.toBeNull();
  });

  it('fails closed on an unexpected error: hung up, answered 200', async () => {
    const call = await makeCall(world);
    const spy = vi.spyOn(prisma.telephonyCredential, 'findFirst').mockRejectedValueOnce(new Error('db hiccup'));
    const { response } = await post(parked(call));
    spy.mockRestore();
    expect(response.status).toBe(200);
    expect(transfers()).toHaveLength(0);
    expect(hangups()).toHaveLength(1);
  });

  it('is not claimed twice when two webhooks race for the same token', async () => {
    const call = await makeCall(world);
    const clientState = clientStateFor(call);
    await Promise.all([post(parked(call, { clientState })), post(parked(call, { clientState }))]);
    expect(transfers()).toHaveLength(1);
    expect(hangups()).toHaveLength(1);
  });
});

describe('the leg we create ourselves', () => {
  it('is not treated as a parked call: queued for the worker, never hung up', async () => {
    const call = await makeCall(world, { status: 'initiated', sessionId: 'sess-leg', controlId: 'ctl-a' });
    await post({ id: eventId(), type: 'call.initiated', sessionId: 'sess-leg', controlId: 'ctl-b', direction: 'outgoing', clientState: legClientState(call.id) });
    expect(hangups()).toHaveLength(0);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an incoming leg', { direction: 'incoming' as const }],
    ['the parked leg itself', { controlId: 'ctl-a' }],
  ])('is not believed for %s carrying the mark: treated as parked and hung up', async (_name, override) => {
    const call = await makeCall(world, { status: 'initiated', sessionId: 'sess-m', controlId: 'ctl-a' });
    await post({ id: eventId(), type: 'call.initiated', sessionId: 'sess-m', controlId: 'ctl-b', direction: 'outgoing', clientState: legClientState(call.id), to: '+84900000002', ...override });
    expect(hangups()).toHaveLength(1);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it.each(['answered', 'completed'] as const)('is not believed once the call is %s', async (status) => {
    const call = await makeCall(world, { status, sessionId: 'sess-s', controlId: 'ctl-a' });
    await post({ id: eventId(), type: 'call.initiated', sessionId: 'sess-s', controlId: 'ctl-b', direction: 'outgoing', clientState: legClientState(call.id), to: '+84900000002' });
    expect(hangups()).toHaveLength(1);
  });

  it('is believed only when the named call holds that provider session: a forged mark is hung up', async () => {
    const call = await makeCall(world, { status: 'initiated', sessionId: 'sess-real', controlId: 'ctl-a' });
    await post({ id: eventId(), type: 'call.initiated', sessionId: 'sess-forged', controlId: 'ctl-evil', direction: 'incoming', clientState: legClientState(call.id), to: '+84900000002' });
    expect(hangups()).toHaveLength(1);
    expect(hangups()[0].callControlId).toBe('ctl-evil');
    expect(transfers()).toHaveLength(0);
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});
