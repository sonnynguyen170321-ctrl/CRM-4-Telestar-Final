import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import type { SessionUser } from '@/lib/auth';

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));
const authUser = vi.hoisted(() => ({ current: null as SessionUser | null }));
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  const { NextResponse } = await import('next/server');
  return {
    ...actual,
    requireAuth: async () => authUser.current ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
  };
});

import { canAccessLeadId, clearVisibleUserCache } from '@/lib/auth';
import { prisma, tenantStorage } from '@/lib/prisma';
import { FakeTelephonyProvider } from '@/lib/telephony/fake';
import { listenableCallIds } from '@/lib/telephony/recordingAccess';
import { setTelephonyProviderForTests } from '@/lib/telephony/index';
import { GET } from '@/app/api/telephony/calls/[id]/recording/route';
import { GET as listActivities } from '@/app/api/activities/route';
import { createTestTenant } from './helpers/testTenant';
import { buildDialerWorld, inTenant, makeCall, type DialerWorld } from './helpers/telephonyFixture';

/**
 * `GET /api/telephony/calls/[id]/recording` (docs/dialer/TASKS.md D7.2), against a real database,
 * the fake provider and a stubbed audio download.
 */

const UPSTREAM = 'https://recordings.example/rec-1.mp3';
const AUDIO = Buffer.from('ID3-fake-audio-bytes');
const realFetch = globalThis.fetch;

let fake: FakeTelephonyProvider;
let world: DialerWorld;
let other: DialerWorld;
let callId: string;
let users: { rep: SessionUser; peer: SessionUser; lead: SessionUser; director: SessionUser; foreignDirector: SessionUser };
let upstreamCalls: Array<{ url: string; range: string | null }>;

async function makeUser(tenantId: string, role: SessionUser['role'], extra: { managerId?: string } = {}): Promise<SessionUser> {
  const row = await inTenant(tenantId, () =>
    prisma.user.create({ data: { tenantId, email: `u.${randomUUID()}@t.test`, firstName: 'U', lastName: role, password: 'x', role, ...extra } })
  );
  return { id: row.id, email: row.email, firstName: 'U', lastName: role, role, tenantId };
}

const call = (id: string, init: { range?: string } = {}) =>
  GET(new NextRequest(`http://localhost/api/telephony/calls/${id}/recording`, { headers: init.range ? { range: init.range } : {} }), {
    params: Promise.resolve({ id }),
  });

const auditRows = (actorId: string) =>
  inTenant(world.tenantId, () => prisma.auditLog.findMany({ where: { userId: actorId, action: 'admin.call.recording_play' } }));

beforeEach(async () => {
  fake = new FakeTelephonyProvider();
  setTelephonyProviderForTests(fake);
  upstreamCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith('https://recordings.example/')) return realFetch(input, init);
    upstreamCalls.push({ url, range: new Headers(init?.headers).get('range') });
    const range = new Headers(init?.headers).get('range');
    return range
      ? new Response(AUDIO.subarray(3), { status: 206, headers: { 'content-type': 'audio/mpeg', 'content-range': `bytes 3-${AUDIO.length - 1}/${AUDIO.length}`, 'content-length': String(AUDIO.length - 3) } })
      : new Response(AUDIO, { status: 200, headers: { 'content-type': 'audio/mpeg', 'content-length': String(AUDIO.length), 'accept-ranges': 'bytes', 'x-signed': UPSTREAM } });
  }) as typeof fetch;

  world = await buildDialerWorld(await createTestTenant(`t-telrr-${randomUUID()}`, 'Rec route'));
  other = await buildDialerWorld(await createTestTenant(`t-telrr-o-${randomUUID()}`, 'Rec route other'));
  const director = await makeUser(world.tenantId, 'director');
  const rep = await inTenant(world.tenantId, () => prisma.user.findFirstOrThrow({ where: { id: world.repId } }));
  users = {
    rep: { id: rep.id, email: rep.email, firstName: rep.firstName, lastName: rep.lastName, role: 'sdr', tenantId: world.tenantId },
    peer: await makeUser(world.tenantId, 'sdr'),
    lead: await makeUser(world.tenantId, 'team_lead'),
    director,
    foreignDirector: await makeUser(other.tenantId, 'director'),
  };
  // The team lead manages the rep, so the lead is inside their pod.
  await inTenant(world.tenantId, () => prisma.user.update({ where: { id: world.repId }, data: { managerId: users.lead.id } }));
  clearVisibleUserCache();

  const row = await makeCall(world, { status: 'completed', sessionId: `s-${randomUUID()}`, controlId: `c-${randomUUID()}` });
  await inTenant(world.tenantId, () => prisma.call.update({ where: { id: row.id }, data: { recordingProviderId: 'rec-1' } }));
  callId = row.id;
  authUser.current = users.rep;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setTelephonyProviderForTests(null);
  authUser.current = null;
});

describe('who may listen', () => {
  it('plays the recording to the rep who made the call', async () => {
    const res = await call(callId);

    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(AUDIO);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('plays it to a team lead who manages the rep and to a director', async () => {
    authUser.current = users.lead;
    expect((await call(callId)).status).toBe(200);
    authUser.current = users.director;
    expect((await call(callId)).status).toBe(200);
  });

  it('answers 404, not 403, to another rep', async () => {
    authUser.current = users.peer;
    expect((await call(callId)).status).toBe(404);
  });

  it('answers 404 to a non-manager role that can otherwise work the lead', async () => {
    const leadgenManager = await makeUser(world.tenantId, 'leadgen_manager');
    clearVisibleUserCache();
    expect(await canAccessLeadId(leadgenManager, world.leadId)).toBe(true); // the role gate is what refuses it
    authUser.current = leadgenManager;
    expect((await call(callId)).status).toBe(404);
  });

  it('answers 404 to a manager of another tenant', async () => {
    authUser.current = users.foreignDirector;
    const res = await call(callId);
    expect(res.status).toBe(404);
    expect(fake.recordingUrlRequests).toEqual([]);
  });

  it('refuses an API key', async () => {
    authUser.current = { ...users.director, apiKey: { id: 'k', scopes: [] } } as unknown as SessionUser;
    expect((await call(callId)).status).toBe(403);
  });

  it('answers 401 without a session', async () => {
    authUser.current = null;
    expect((await call(callId)).status).toBe(401);
  });

  it('answers 404 for a call with no recording, an unknown call, and a purged recording', async () => {
    const bare = await makeCall(world, { status: 'completed', sessionId: `s-${randomUUID()}`, controlId: `c-${randomUUID()}` });
    expect((await call(bare.id)).status).toBe(404);
    expect((await call('does-not-exist')).status).toBe(404);

    await inTenant(world.tenantId, () => prisma.call.update({ where: { id: callId }, data: { recordingProviderId: null } }));
    expect((await call(callId)).status).toBe(404);
  });

  it('answers 404 when the provider no longer has the file', async () => {
    fake.deletedRecordings.push('rec-1');
    expect((await call(callId)).status).toBe(404);
  });

  it('answers 502 without leaking the provider error when the provider is down', async () => {
    fake.failNext.getRecordingUrl = new (await import('@/lib/telephony/provider')).TelephonyProviderError('secret-detail', 503, true);
    const res = await call(callId);
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('secret-detail');
  });
});

describe('streaming', () => {
  it('never exposes the provider URL and asks for a fresh one every time', async () => {
    const res = await call(callId);
    await call(callId);

    const exposed = JSON.stringify([...res.headers.entries()]);
    expect(exposed).not.toContain('recordings.example');
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-signed')).toBeNull();
    expect(fake.recordingUrlRequests).toEqual(['rec-1', 'rec-1']);
    expect(upstreamCalls.map((c) => c.url)).toEqual([UPSTREAM, UPSTREAM]);
  });

  it('passes a byte range through', async () => {
    const res = await call(callId, { range: 'bytes=3-' });

    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 3-${AUDIO.length - 1}/${AUDIO.length}`);
    expect(upstreamCalls[0].range).toBe('bytes=3-');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(AUDIO.subarray(3));
  });

  it('rejects a range it cannot pass through', async () => {
    expect((await call(callId, { range: 'bytes=0-1,5-9' })).status).toBe(416);
    expect(upstreamCalls).toEqual([]);
  });
});

describe('audit', () => {
  it('writes one row per listen, for the actor, naming the call', async () => {
    authUser.current = users.director;

    await call(callId);
    await call(callId, { range: 'bytes=3-' }); // seeking within the same listen

    const rows = await auditRows(users.director.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].recordId).toBe(callId);
    expect(rows[0].tableName).toBe('Call');
    expect(JSON.stringify(rows[0].changedFields)).not.toContain('recordings.example');
  });

  it('writes nothing for a refused request', async () => {
    authUser.current = users.peer;
    await call(callId);
    expect(await auditRows(users.peer.id)).toHaveLength(0);
  });
});

describe('the activity feed hint', () => {
  async function activityFor(viewer: SessionUser) {
    const activity = await inTenant(world.tenantId, () =>
      prisma.activity.create({
        data: { tenantId: world.tenantId, userId: world.repId, leadId: world.leadId, type: 'call_made', channel: 'phone', description: 'Call completed', metadata: { callId } },
      })
    );
    authUser.current = viewer;
    const res = await tenantStorage.run({ tenantId: world.tenantId }, () =>
      listActivities(new NextRequest(`http://localhost/api/activities?leadId=${world.leadId}`))
    );
    const body = (await res.json()) as Array<{ id: string; recordingCallId?: string }>;
    return body.find((a) => a.id === activity.id);
  }

  it('flags the call for a viewer who may play it', async () => {
    expect((await activityFor(users.rep))?.recordingCallId).toBe(callId);
  });

  it('does not flag it for a viewer who may not', async () => {
    const tenantId = world.tenantId;
    expect([...(await listenableCallIds({ ...users.peer, tenantId }, [callId]))]).toEqual([]);
    expect([...(await listenableCallIds({ ...users.foreignDirector, tenantId: other.tenantId }, [callId]))]).toEqual([]);
    expect([...(await listenableCallIds({ ...users.rep, tenantId }, [callId]))]).toEqual([callId]);
  });
});
