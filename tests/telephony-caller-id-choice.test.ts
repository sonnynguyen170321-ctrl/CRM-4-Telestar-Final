import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));
const enqueueMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/bullmq/enqueue', () => ({ enqueue: enqueueMock }));

import { clearVisibleUserCache } from '@/lib/auth';
import { TELEPHONY_ENV } from '@/lib/env-contract';
import { prisma } from '@/lib/prisma';
import { fromClientState, issueCallToken, verifyCallToken } from '@/lib/telephony/authToken';
import { FakeTelephonyProvider } from '@/lib/telephony/fake';
import { setTelephonyProviderForTests } from '@/lib/telephony/index';
import { POST } from '@/app/api/telephony/telnyx/webhook/route';
import { ensureFinalActivity } from '@/lib/telephony/applyEvent';
import { createTestTenant } from './helpers/testTenant';
import { activitiesFor, buildDialerWorld, clientStateFor, deleteEventsWithPrefix, eventBody, inTenant, makeCall, makeSigner, reload, type DialerWorld } from './helpers/telephonyFixture';

/**
 * The caller ID a rep chooses (floating dialer): the token carries it, the call row holds it, and the
 * webhook connects the parked call from exactly that number, or hangs up when the token and the row
 * disagree or the number has since been switched off.
 */

const VN_10AM = new Date('2026-10-05T03:00:00Z');
const ENV_KEYS = [...TELEPHONY_ENV, 'TELEPHONY_ENABLED', 'TELEPHONY_DRY_RUN'] as const;
const nowSeconds = () => Math.floor(Date.now() / 1000);
const signer = makeSigner();

let savedEnv: Record<string, string | undefined> = {};
let fake: FakeTelephonyProvider;
let world: DialerWorld;
let prefix: string;
let counter = 0;

const randomUs = () => `+1415${Math.floor(1000000 + Math.random() * 8999999)}`;
const makeNumber = (data: Record<string, unknown> = {}) =>
  inTenant(world.tenantId, () => prisma.telephonyNumber.create({ data: { tenantId: world.tenantId, e164: randomUs(), country: 'US', purpose: 'both', ...data } }));

async function post(call: { id: string; tenantId: string; userId: string | null; toE164: string }, clientState: string | null) {
  const raw = JSON.stringify(
    eventBody({
      id: `${prefix}${(counter += 1)}`,
      type: 'call.initiated',
      sessionId: `sess-${call.id}`,
      controlId: `ctl-${call.id}`,
      direction: 'incoming',
      clientState,
      from: `sip:${world.sipUsername}@sip.telnyx.com`,
      to: call.toE164,
    })
  );
  const response = await POST(new NextRequest('https://crm.telestar.cloud/api/telephony/telnyx/webhook', { method: 'POST', body: raw, headers: signer.headers(raw, nowSeconds()) }));
  await response.json();
  return response;
}
const transfers = () => fake.commands.filter((c) => c.command.action === 'transfer');
const hangups = () => fake.commands.filter((c) => c.command.action === 'hangup');

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
  prefix = `evt-cid-${randomUUID()}-`;
  counter = 0;
  world = await buildDialerWorld(await createTestTenant(`t-telcid-${randomUUID()}`, 'Caller ID'));
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

describe('call token caller ID', () => {
  const base = { callId: 'c1', tenantId: 't1', userId: 'u1', toE164: '+66812345678' };

  it('round-trips the chosen number and omits it when none is chosen', () => {
    const withFrom = verifyCallToken(issueCallToken({ ...base, fromE164: '+14155550101' }));
    expect(withFrom).toEqual({ ok: true, claims: expect.objectContaining({ fromE164: '+14155550101' }) });
    const without = verifyCallToken(issueCallToken(base));
    expect(without.ok && 'fromE164' in without.claims).toBe(false);
  });

  it('cannot have the number swapped after signing', () => {
    const token = issueCallToken({ ...base, fromE164: '+14155550101' });
    const [payload, signature] = token.split('.');
    const wire = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const forged = Buffer.from(JSON.stringify({ ...wire, f: '+14155550199' })).toString('base64url');
    expect(verifyCallToken(`${forged}.${signature}`)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(fromClientState(null)).toBeNull();
  });
});

describe('a parked call with a chosen caller ID', () => {
  it('is transferred from exactly the chosen number, not the country default', async () => {
    const chosen = await makeNumber({ country: 'SG' });
    await makeNumber({ country: 'TH', isDefault: true }); // the country rule would pick this for a Thai number
    const call = await makeCall(world, { fromE164: chosen.e164 });

    const response = await post(call, clientStateFor(call));

    expect(response.status).toBe(200);
    expect(transfers()).toHaveLength(1);
    expect(transfers()[0].command).toMatchObject({ action: 'transfer', from: chosen.e164, to: '+66812345678' });
    expect(hangups()).toHaveLength(0);
    expect((await reload(world.tenantId, call.id)).fromE164).toBe(chosen.e164);
  });

  it('is hung up when the token names a different number than the call row', async () => {
    const chosen = await makeNumber();
    const other = await makeNumber();
    const call = await makeCall(world, { fromE164: chosen.e164 });

    await post(call, clientStateFor({ ...call, fromE164: other.e164 }));

    expect(transfers()).toHaveLength(0);
    expect(hangups()).toHaveLength(1);
    expect((await reload(world.tenantId, call.id)).status).toBe('authorized');
  });

  it('is hung up when the row holds a chosen number but the token names none', async () => {
    const chosen = await makeNumber();
    const call = await makeCall(world, { fromE164: chosen.e164 });
    await post(call, clientStateFor({ ...call, fromE164: null }));
    expect(transfers()).toHaveLength(0);
    expect(hangups()).toHaveLength(1);
  });

  it('is hung up when the token names a number the row does not hold', async () => {
    const other = await makeNumber();
    const call = await makeCall(world);
    await post(call, clientStateFor({ ...call, fromE164: other.e164 }));
    expect(transfers()).toHaveLength(0);
    expect(hangups()).toHaveLength(1);
  });

  it('is refused and marked blocked when the chosen number was switched off after authorization', async () => {
    const chosen = await makeNumber();
    const call = await makeCall(world, { fromE164: chosen.e164 });
    await inTenant(world.tenantId, () => prisma.telephonyNumber.update({ where: { id: chosen.id }, data: { isActive: false } }));

    await post(call, clientStateFor(call));

    expect(transfers()).toHaveLength(0);
    expect(hangups()).toHaveLength(1);
    expect(await reload(world.tenantId, call.id)).toMatchObject({ status: 'blocked', blockedReasons: ['caller_id_unavailable'] });
  });

  it('still uses the country rule when no number was chosen', async () => {
    const th = await makeNumber({ country: 'TH', isDefault: true });
    const call = await makeCall(world);
    await post(call, clientStateFor(call));
    expect(transfers()[0].command).toMatchObject({ from: th.e164 });
  });
});

describe('the call timeline shows the caller ID used', () => {
  it('writes fromE164 into the call activity and its description', async () => {
    const chosen = await makeNumber();
    const call = await makeCall(world, { status: 'completed', fromE164: chosen.e164 });
    await inTenant(world.tenantId, () => prisma.call.update({ where: { id: call.id }, data: { endedAt: new Date(), billedDurationSec: 62 } }));

    expect(await inTenant(world.tenantId, () => ensureFinalActivity(call.id, world.tenantId))).toBe('written');

    const [activity] = await activitiesFor(world.tenantId, call.id);
    expect(activity.description).toBe(`Call completed (1m 02s) from ${chosen.e164}`);
    expect(activity.metadata).toMatchObject({ fromE164: chosen.e164, toE164: '+66812345678' });
  });
});
