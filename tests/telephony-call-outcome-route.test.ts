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

import { TELEPHONY_ENV } from '@/lib/env-contract';
import { prisma } from '@/lib/prisma';
import { OUTCOME_WINDOW_MS } from '@/lib/telephony/callOutcome';
import { PHONE_OUTCOMES } from '@/lib/telephony/outcomes';
import { tenantStorage } from '@/lib/tenant-context';
import { PATCH } from '@/app/api/telephony/calls/[id]/outcome/route';
import { GET as GET_STATUS } from '@/app/api/telephony/status/route';
import { GET as GET_PENDING } from '@/app/api/telephony/calls/pending-outcome/route';
import { createTestTenant } from './helpers/testTenant';

/**
 * The softphone wrap-up: `PATCH /api/telephony/calls/[id]/outcome`. The browser may only label its
 * own call, once the call reached the provider, within 24 hours; it never sets the call's status.
 * A do-not-call outcome writes the lead flag, the contact flag and the phone suppression together.
 * Plus `GET /api/telephony/status`, the one boolean the lead drawer routes on.
 */

const ENV_KEYS = [...TELEPHONY_ENV, 'TELEPHONY_ENABLED'] as const;
let savedEnv: Record<string, string | undefined> = {};
let tenantId: string;
let otherTenantId: string;
const users = { rep: null as unknown as SessionUser, peer: null as unknown as SessionUser, other: null as unknown as SessionUser };
const ids = { lead: '', contact: '' };
const TO = '+14155552671';

const inTenant = <T>(fn: () => Promise<T>, t = tenantId) => tenantStorage.run({ tenantId: t, bypassRls: true }, fn);

async function makeUser(t: string): Promise<SessionUser> {
  const row = await inTenant(
    () => prisma.user.create({ data: { tenantId: t, email: `u.${randomUUID()}@t.test`, firstName: 'S', lastName: 'R', password: 'x', role: 'sdr' } }),
    t
  );
  return { id: row.id, email: row.email, firstName: 'S', lastName: 'R', role: 'sdr', tenantId: t };
}

async function makeLead(t: string, assignedToId: string) {
  return inTenant(async () => {
    const client = await prisma.client.create({ data: { tenantId: t, name: 'C', industry: 'SaaS', contactName: 'c', contactEmail: `c.${randomUUID()}@t.test` } });
    const campaign = await prisma.campaign.create({ data: { tenantId: t, clientId: client.id, name: 'Out', startDate: new Date() } });
    const contact = await prisma.contact.create({ data: { tenantId: t, firstName: 'Ann', lastName: 'L', company: 'Acme', email: `ann.${randomUUID()}@acme.test` } });
    const lead = await prisma.lead.create({
      data: { tenantId: t, firstName: 'Ann', lastName: 'L', email: contact.email, company: 'Acme', phone: TO, campaignId: campaign.id, assignedToId, contactId: contact.id },
    });
    return { lead: lead.id, contact: contact.id };
  }, t);
}

async function makeCall(t: string, userId: string, leadId: string | null, data: Record<string, unknown> = {}) {
  return inTenant(
    async () =>
      (await prisma.call.create({ data: { tenantId: t, direction: 'outbound', status: 'completed', userId, leadId, toE164: TO, ...data } })).id,
    t
  );
}

async function patch(user: SessionUser | null, callId: string, body: unknown) {
  authUser.current = user;
  const response = await PATCH(
    new NextRequest(`https://crm.telestar.cloud/api/telephony/calls/${callId}/outcome`, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ id: callId }) }
  );
  return { response, body: await response.json() };
}

const callRow = (id: string, t = tenantId) => inTenant(() => prisma.call.findUniqueOrThrow({ where: { id } }), t);
const leadRow = (t = tenantId) => inTenant(() => prisma.lead.findUniqueOrThrow({ where: { id: ids.lead } }), t);
const suppressions = (t = tenantId) => inTenant(() => prisma.phoneSuppression.findMany({ where: { tenantId: t } }), t);
const tasks = () => inTenant(() => prisma.task.findMany({ where: { leadId: ids.lead } }));

beforeEach(async () => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  tenantId = `t-calloutcome-${randomUUID()}`;
  otherTenantId = `t-calloutcome-other-${randomUUID()}`;
  await createTestTenant(tenantId, 'Call outcome');
  await createTestTenant(otherTenantId, 'Call outcome other');
  users.rep = await makeUser(tenantId);
  users.peer = await makeUser(tenantId);
  users.other = await makeUser(otherTenantId);
  const made = await makeLead(tenantId, users.rep.id);
  ids.lead = made.lead;
  ids.contact = made.contact;
});

afterEach(() => {
  authUser.current = null;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k]!;
  }
});

describe('PATCH /api/telephony/calls/[id]/outcome', () => {
  it('requires a session and refuses an API key', async () => {
    const callId = await makeCall(tenantId, users.rep.id, ids.lead);
    expect((await patch(null, callId, { outcome: 'no_answer' })).response.status).toBe(401);
    const keyed = { ...users.rep, apiKey: { id: 'k1', name: 'any', scopes: ['*'] } } as SessionUser;
    expect((await patch(keyed, callId, { outcome: 'no_answer' })).response.status).toBe(403);
    expect((await callRow(callId)).outcome).toBeNull();
  });

  it('labels the rep\'s own finished call, mapping the outcome id to the enum, and never touches the status', async () => {
    const callId = await makeCall(tenantId, users.rep.id, ids.lead);
    const { response, body } = await patch(users.rep, callId, { outcome: 'connected_meeting_booked', notes: ' Booked Tuesday ' });

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(body).toMatchObject({ callId, outcome: 'connected_meeting_booked', suppressed: false });
    expect(await callRow(callId)).toMatchObject({ outcome: 'meeting_booked', notes: 'Booked Tuesday', status: 'completed' });
    expect((await leadRow()).lastContactedAt).not.toBeNull();
  });

  it.each(PHONE_OUTCOMES.map((o) => [o.id, o.callOutcome] as const))('accepts %s and stores %s', async (outcome, stored) => {
    const callId = await makeCall(tenantId, users.rep.id, ids.lead);
    expect((await patch(users.rep, callId, { outcome })).response.status).toBe(200);
    expect((await callRow(callId)).outcome).toBe(stored);
  });

  it('accepts a call that is still being finalised (ringing), since the wrap-up can beat the final webhook', async () => {
    const callId = await makeCall(tenantId, users.rep.id, ids.lead, { status: 'ringing' });
    expect((await patch(users.rep, callId, { outcome: 'no_answer' })).response.status).toBe(200);
  });

  it('answers 404 for another rep\'s call in the same tenant, and changes nothing', async () => {
    const callId = await makeCall(tenantId, users.rep.id, ids.lead);
    const { response } = await patch(users.peer, callId, { outcome: 'do_not_call' });
    expect(response.status).toBe(404);
    expect((await callRow(callId)).outcome).toBeNull();
    expect((await leadRow()).doNotCall).toBe(false);
    expect(await suppressions()).toHaveLength(0);
  });

  it('answers 404 for another tenant\'s call', async () => {
    const callId = await makeCall(tenantId, users.rep.id, ids.lead);
    const { response } = await patch(users.other, callId, { outcome: 'no_answer' });
    expect(response.status).toBe(404);
    expect((await callRow(callId)).outcome).toBeNull();
  });

  it('answers 404 for a call that does not exist', async () => {
    expect((await patch(users.rep, 'no-such-call', { outcome: 'no_answer' })).response.status).toBe(404);
  });

  it('rejects an outcome that is not on the list, and a missing one, with 400', async () => {
    const callId = await makeCall(tenantId, users.rep.id, ids.lead);
    expect((await patch(users.rep, callId, { outcome: 'gatekeeper_rejection' })).response.status).toBe(400);
    expect((await patch(users.rep, callId, { outcome: 'gatekeeper' })).response.status).toBe(400);
    expect((await patch(users.rep, callId, { notes: 'x' })).response.status).toBe(400);
    expect((await callRow(callId)).outcome).toBeNull();
  });

  it('bounds the notes instead of storing an essay', async () => {
    const callId = await makeCall(tenantId, users.rep.id, ids.lead);
    expect((await patch(users.rep, callId, { outcome: 'no_answer', notes: 'x'.repeat(2500) })).response.status).toBe(200);
    expect((await callRow(callId)).notes).toHaveLength(2000);
    expect((await patch(users.rep, callId, { outcome: 'no_answer', notes: 'x'.repeat(5000) })).response.status).toBe(400);
  });

  it.each(['authorized', 'blocked'] as const)('answers 409 for a call that never reached the provider (%s)', async (status) => {
    const callId = await makeCall(tenantId, users.rep.id, ids.lead, { status });
    const { response, body } = await patch(users.rep, callId, { outcome: 'no_answer' });
    expect(response.status).toBe(409);
    expect(body.code).toBe('call_not_started');
    expect((await callRow(callId)).outcome).toBeNull();
  });

  it('answers 409 once the call is more than 24 hours old', async () => {
    const old = new Date(Date.now() - OUTCOME_WINDOW_MS - 60_000);
    const callId = await makeCall(tenantId, users.rep.id, ids.lead, { createdAt: old });
    const { response, body } = await patch(users.rep, callId, { outcome: 'do_not_call' });
    expect(response.status).toBe(409);
    expect(body.code).toBe('window_closed');
    expect((await leadRow()).doNotCall).toBe(false);
    expect(await suppressions()).toHaveLength(0);
  });

  it('does not take an inbound call for an outcome', async () => {
    const callId = await makeCall(tenantId, users.rep.id, ids.lead, { direction: 'inbound' });
    expect((await patch(users.rep, callId, { outcome: 'no_answer' })).response.status).toBe(404);
  });

  it('do_not_call flags the lead and contact and suppresses the dialled number, together', async () => {
    const callId = await makeCall(tenantId, users.rep.id, ids.lead);
    const { response, body } = await patch(users.rep, callId, { outcome: 'do_not_call', notes: 'asked to be removed' });

    expect(response.status).toBe(200);
    expect(body.suppressed).toBe(true);
    const lead = await leadRow();
    expect(lead).toMatchObject({ doNotCall: true, doNotCallReason: 'Logged on a call: asked to be removed' });
    expect(lead.tags).toContain('do_not_call');
    const contact = await inTenant(() => prisma.contact.findUniqueOrThrow({ where: { id: ids.contact } }));
    expect(contact.doNotCall).toBe(true);
    const [suppression] = await suppressions();
    expect(suppression).toMatchObject({ tenantId, e164: TO, source: 'call_outcome', createdById: users.rep.id });
    expect(suppression.reason).toContain(callId);
    expect(await suppressions(otherTenantId)).toHaveLength(0);
  });

  it('do_not_call twice keeps one suppression and the first reason', async () => {
    const callId = await makeCall(tenantId, users.rep.id, ids.lead);
    await patch(users.rep, callId, { outcome: 'do_not_call', notes: 'first' });
    expect((await patch(users.rep, callId, { outcome: 'do_not_call', notes: 'second' })).response.status).toBe(200);
    expect(await suppressions()).toHaveLength(1);
    expect((await leadRow()).doNotCallReason).toBe('Logged on a call: first');
    expect((await leadRow()).tags.filter((t) => t === 'do_not_call')).toHaveLength(1);
  });

  it('wrong_number tags the lead out of the queue without suppressing', async () => {
    const callId = await makeCall(tenantId, users.rep.id, ids.lead);
    await patch(users.rep, callId, { outcome: 'wrong_number' });
    expect((await leadRow()).tags).toContain('wrong_number');
    expect(await suppressions()).toHaveLength(0);
  });

  it('a callback request creates one task, even when the same outcome is saved twice', async () => {
    const callId = await makeCall(tenantId, users.rep.id, ids.lead);
    await patch(users.rep, callId, { outcome: 'callback_requested' });
    await patch(users.rep, callId, { outcome: 'callback_requested', notes: 'again' });
    const rows = await tasks();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'phone', userId: users.rep.id, priority: 'high' });
  });

  it('allows re-labelling, but makes one callback task per call and moves the last-contacted date once', async () => {
    const callId = await makeCall(tenantId, users.rep.id, ids.lead);
    await patch(users.rep, callId, { outcome: 'callback_requested' });
    const first = (await leadRow()).lastContactedAt!;
    await new Promise((r) => setTimeout(r, 20));
    expect((await patch(users.rep, callId, { outcome: 'no_answer' })).response.status).toBe(200);
    expect((await patch(users.rep, callId, { outcome: 'callback_requested' })).response.status).toBe(200);
    expect(await tasks()).toHaveLength(1);
    expect((await leadRow()).lastContactedAt!.getTime()).toBe(first.getTime());
    expect((await callRow(callId)).outcome).toBe('callback_requested');
    // A different call is a different callback.
    const second = await makeCall(tenantId, users.rep.id, ids.lead);
    await patch(users.rep, second, { outcome: 'callback_requested' });
    expect(await tasks()).toHaveLength(2);
  });

  it('saves the label but applies no lead effects once the rep can no longer work the lead', async () => {
    const callId = await makeCall(tenantId, users.rep.id, ids.lead);
    await inTenant(() => prisma.lead.update({ where: { id: ids.lead }, data: { assignedToId: users.peer.id } }));
    const { response } = await patch(users.rep, callId, { outcome: 'do_not_call' });
    expect(response.status).toBe(200);
    expect((await callRow(callId)).outcome).toBe('do_not_call');
    const lead = await leadRow();
    expect(lead.doNotCall).toBe(false);
    expect(lead.lastContactedAt).toBeNull();
    expect(lead.tags).toEqual([]);
    expect(await suppressions()).toHaveLength(0);
  });

  it('labels a call whose lead is gone without error', async () => {
    const callId = await makeCall(tenantId, users.rep.id, null);
    const { response, body } = await patch(users.rep, callId, { outcome: 'do_not_call' });
    expect(response.status).toBe(200);
    expect(body.suppressed).toBe(false);
    expect((await callRow(callId)).outcome).toBe('do_not_call');
  });
});

describe('GET /api/telephony/status', () => {
  const status = async (user: SessionUser | null) => {
    authUser.current = user;
    const response = await GET_STATUS();
    return { response, body: await response.json() };
  };
  const switchOn = () => {
    for (const k of TELEPHONY_ENV) process.env[k] = `test-value-for-${k}-long-enough-to-satisfy-checks`;
    process.env.TELEPHONY_ENABLED = 'true';
  };

  it('requires a session and refuses an API key', async () => {
    expect((await status(null)).response.status).toBe(401);
    const keyed = { ...users.rep, apiKey: { id: 'k1', name: 'any', scopes: ['*'] } } as SessionUser;
    expect((await status(keyed)).response.status).toBe(403);
  });

  it('says no when the deployment has the dialer off', async () => {
    delete process.env.TELEPHONY_ENABLED;
    await inTenant(() => prisma.telephonySettings.create({ data: { tenantId, enabled: true } }));
    expect((await status(users.rep)).body).toEqual({ enabled: false });
  });

  it('says no when the team has not enabled it, or the kill switch is on', async () => {
    switchOn();
    expect((await status(users.rep)).body).toEqual({ enabled: false });
    await inTenant(() => prisma.telephonySettings.create({ data: { tenantId, enabled: true, killedAt: new Date() } }));
    expect((await status(users.rep)).body).toEqual({ enabled: false });
  });

  it('says yes when the deployment and the team have it on, for this tenant only', async () => {
    switchOn();
    await inTenant(() => prisma.telephonySettings.create({ data: { tenantId, enabled: true } }));
    const mine = await status(users.rep);
    expect(mine.body).toEqual({ enabled: true });
    expect(mine.response.headers.get('Cache-Control')).toBe('no-store');
    expect((await status(users.other)).body).toEqual({ enabled: false });
  });
});

describe('GET /api/telephony/calls/pending-outcome', () => {
  const pending = async (user: SessionUser | null, query = '') => {
    authUser.current = user;
    const response = await GET_PENDING(new NextRequest(`https://crm.telestar.cloud/api/telephony/calls/pending-outcome${query}`));
    return { response, body: await response.json() };
  };

  it('requires a session and refuses an API key', async () => {
    expect((await pending(null)).response.status).toBe(401);
    const keyed = { ...users.rep, apiKey: { id: 'k1', name: 'any', scopes: ['*'] } } as SessionUser;
    expect((await pending(keyed)).response.status).toBe(403);
  });

  it('lists only the rep own finished outbound calls with no outcome, under 24 hours old', async () => {
    const mine = await makeCall(tenantId, users.rep.id, ids.lead);
    await makeCall(tenantId, users.rep.id, ids.lead, { outcome: 'no_answer' });
    await makeCall(tenantId, users.rep.id, ids.lead, { status: 'ringing' });
    await makeCall(tenantId, users.rep.id, ids.lead, { status: 'blocked' });
    await makeCall(tenantId, users.rep.id, ids.lead, { createdAt: new Date(Date.now() - OUTCOME_WINDOW_MS - 60_000) });
    await makeCall(tenantId, users.peer.id, ids.lead);

    const { response, body } = await pending(users.rep);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(body.calls).toHaveLength(1);
    expect(body.calls[0]).toMatchObject({ id: mine, leadId: ids.lead, leadName: 'Ann L', toE164: TO });
    expect((await pending(users.other)).body.calls).toEqual([]);
  });

  it('narrows to one lead, and drops a call once its outcome is saved', async () => {
    const callId = await makeCall(tenantId, users.rep.id, ids.lead);
    expect((await pending(users.rep, '?leadId=another-lead')).body.calls).toEqual([]);
    expect((await pending(users.rep, `?leadId=${ids.lead}`)).body.calls).toHaveLength(1);
    await patch(users.rep, callId, { outcome: 'no_answer' });
    expect((await pending(users.rep)).body.calls).toEqual([]);
  });
});
