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

import { clearVisibleUserCache } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { PHONE_OUTCOMES } from '@/lib/telephony/outcomes';
import { tenantStorage } from '@/lib/tenant-context';
import { POST } from '@/app/api/telephony/phone-calls/route';
import { createTestTenant } from './helpers/testTenant';

/**
 * `POST /api/telephony/phone-calls`: a call the rep placed on their own phone, logged from the lead
 * drawer. One request writes the `call_logged` activity, the last-contacted date, the queue tag and,
 * for do-not-call, the lead flag plus the tenant's phone suppression, all together.
 */

let tenantId: string;
let otherTenantId: string;
const ids = { campaign: '', lead: '', otherLead: '' };
const users = { rep: null as unknown as SessionUser, peer: null as unknown as SessionUser, other: null as unknown as SessionUser };

const inTenant = <T>(fn: () => Promise<T>, t = tenantId) => tenantStorage.run({ tenantId: t, bypassRls: true }, fn);

async function makeUser(t: string, role: SessionUser['role'] = 'sdr'): Promise<SessionUser> {
  const row = await inTenant(
    () => prisma.user.create({ data: { tenantId: t, email: `u.${randomUUID()}@t.test`, firstName: 'S', lastName: 'R', password: 'x', role } }),
    t
  );
  return { id: row.id, email: row.email, firstName: 'S', lastName: 'R', role, tenantId: t };
}

async function makeCampaign(t: string) {
  return inTenant(async () => {
    const client = await prisma.client.create({ data: { tenantId: t, name: 'C', industry: 'SaaS', contactName: 'c', contactEmail: `c.${randomUUID()}@t.test` } });
    return (await prisma.campaign.create({ data: { tenantId: t, clientId: client.id, name: 'Out', startDate: new Date() } })).id;
  }, t);
}

async function makeLead(t: string, campaignId: string, assignedToId: string, data: Record<string, unknown> = {}) {
  return inTenant(
    async () =>
      (
        await prisma.lead.create({
          data: { tenantId: t, firstName: 'Ann', lastName: 'L', email: `ann.${randomUUID()}@acme.test`, company: 'Acme', phone: '0948200638', campaignId, assignedToId, ...data },
        })
      ).id,
    t
  );
}

async function log(user: SessionUser | null, body: unknown) {
  authUser.current = user;
  const response = await POST(
    new NextRequest('https://crm.telestar.cloud/api/telephony/phone-calls', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
  );
  return { response, body: await response.json() };
}

const leadRow = (id = ids.lead, t = tenantId) => inTenant(() => prisma.lead.findUniqueOrThrow({ where: { id } }), t);
const activities = (leadId = ids.lead, t = tenantId) => inTenant(() => prisma.activity.findMany({ where: { leadId }, orderBy: { createdAt: 'asc' } }), t);
const suppressions = (t = tenantId) => inTenant(() => prisma.phoneSuppression.findMany({ where: { tenantId: t } }), t);

beforeEach(async () => {
  clearVisibleUserCache?.();
  tenantId = `t-phonecalls-${randomUUID()}`;
  otherTenantId = `t-phonecalls-other-${randomUUID()}`;
  await createTestTenant(tenantId, 'Phone calls');
  await createTestTenant(otherTenantId, 'Phone calls other');
  users.rep = await makeUser(tenantId);
  users.peer = await makeUser(tenantId);
  users.other = await makeUser(otherTenantId);
  ids.campaign = await makeCampaign(tenantId);
  ids.lead = await makeLead(tenantId, ids.campaign, users.rep.id, { tags: ['vip'] });
  ids.otherLead = await makeLead(otherTenantId, await makeCampaign(otherTenantId), users.other.id);
});

afterEach(() => {
  authUser.current = null;
});

describe('POST /api/telephony/phone-calls', () => {
  it('requires a session', async () => {
    expect((await log(null, { leadId: ids.lead, outcome: 'no_answer' })).response.status).toBe(401);
  });

  it('rejects an outcome that is not one of the nine, and writes nothing', async () => {
    const { response } = await log(users.rep, { leadId: ids.lead, outcome: 'gatekeeper_rejection' });
    expect(response.status).toBe(400);
    expect(await activities()).toHaveLength(0);
  });

  it('rejects a body without a lead', async () => {
    expect((await log(users.rep, { outcome: 'no_answer' })).response.status).toBe(400);
  });

  it('logs a call_logged activity in the task path shape and stamps the last-contacted date', async () => {
    const { response, body } = await log(users.rep, { leadId: ids.lead, outcome: 'connected_interested', notes: ' Wants pricing ' });

    expect(response.status).toBe(201);
    expect(body.activity).toMatchObject({ type: 'call_logged', channel: 'phone', userId: users.rep.id, leadId: ids.lead });
    const [row] = await activities();
    expect(row.description).toBe('Call logged. Outcome: Interested: Wants pricing');
    expect(row.metadata).toEqual({
      action: 'connected_interested',
      outcome: 'connected_interested',
      label: 'Interested',
      notes: 'Wants pricing',
      via: 'phone',
    });
    const lead = await leadRow();
    expect(lead.lastContactedAt).not.toBeNull();
    expect(lead.tags).toEqual(['vip']);
    expect(lead.doNotCall).toBe(false);
    expect(await suppressions()).toHaveLength(0);
  });

  it('keeps the description under the activity limit and the full notes in metadata', async () => {
    const notes = 'x'.repeat(900);
    await log(users.rep, { leadId: ids.lead, outcome: 'no_answer', notes });
    const [row] = await activities();
    expect(row.description!.length).toBeLessThanOrEqual(500);
    expect((row.metadata as { notes: string }).notes).toBe(notes);
  });

  it('accepts each of the nine outcomes', async () => {
    for (const outcome of PHONE_OUTCOMES) {
      const lead = await makeLead(tenantId, ids.campaign, users.rep.id);
      const { response } = await log(users.rep, { leadId: lead, outcome: outcome.id });
      expect(response.status, outcome.id).toBe(201);
    }
  });

  it('creates the callback task for a callback request, once', async () => {
    await log(users.rep, { leadId: ids.lead, outcome: 'callback_requested' });
    const tasks = await inTenant(() => prisma.task.findMany({ where: { leadId: ids.lead } }));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ type: 'phone', title: 'Callback: Ann L', priority: 'high', userId: users.rep.id });
  });

  it('creates no task for other outcomes', async () => {
    await log(users.rep, { leadId: ids.lead, outcome: 'voicemail_not_left' });
    expect(await inTenant(() => prisma.task.count({ where: { leadId: ids.lead } }))).toBe(0);
  });

  it('adds the wrong_number tag without dropping existing tags, and only once', async () => {
    await log(users.rep, { leadId: ids.lead, outcome: 'wrong_number' });
    await log(users.rep, { leadId: ids.lead, outcome: 'wrong_number' });
    const lead = await leadRow();
    expect(lead.tags).toEqual(['vip', 'wrong_number']);
    expect(lead.doNotCall).toBe(false);
    expect(await suppressions()).toHaveLength(0);
  });

  it('keeps every tag when two outcomes are logged at once', async () => {
    await Promise.all([
      log(users.rep, { leadId: ids.lead, outcome: 'wrong_number' }),
      log(users.rep, { leadId: ids.lead, outcome: 'do_not_call' }),
    ]);
    const lead = await leadRow();
    expect([...lead.tags].sort()).toEqual(['do_not_call', 'vip', 'wrong_number']);
  });

  it('do_not_call flags the lead, tags it and suppresses the normalized number', async () => {
    const { response, body } = await log(users.rep, { leadId: ids.lead, outcome: 'do_not_call', notes: 'asked us to stop' });

    expect(response.status).toBe(201);
    expect(body.suppressed).toBe(true);
    const lead = await leadRow();
    expect(lead.doNotCall).toBe(true);
    expect(lead.doNotCallAt).not.toBeNull();
    expect(lead.doNotCallReason).toContain('asked us to stop');
    expect(lead.tags).toEqual(['vip', 'do_not_call']);
    expect(await suppressions()).toEqual([
      expect.objectContaining({ e164: '+84948200638', source: 'call_outcome', createdById: users.rep.id, tenantId }),
    ]);
  });

  it('do_not_call twice leaves one suppression row and one tag', async () => {
    await log(users.rep, { leadId: ids.lead, outcome: 'do_not_call' });
    const second = await log(users.rep, { leadId: ids.lead, outcome: 'do_not_call' });
    expect(second.response.status).toBe(201);
    expect(await suppressions()).toHaveLength(1);
    expect((await leadRow()).tags).toEqual(['vip', 'do_not_call']);
  });

  it('do_not_call on a lead with no usable number still flags the lead and reports no suppression', async () => {
    const lead = await makeLead(tenantId, ids.campaign, users.rep.id, { phone: 'call reception' });
    const { response, body } = await log(users.rep, { leadId: lead, outcome: 'do_not_call' });
    expect(response.status).toBe(201);
    expect(body.suppressed).toBe(false);
    expect((await leadRow(lead)).doNotCall).toBe(true);
    expect(await suppressions()).toHaveLength(0);
  });

  it('reads a national number with the lead company country first', async () => {
    const lead = await makeLead(tenantId, ids.campaign, users.rep.id, { phone: '+1 415 555 2671' });
    await log(users.rep, { leadId: lead, outcome: 'do_not_call' });
    expect((await suppressions()).map((s) => s.e164)).toEqual(['+14155552671']);
  });

  it('refuses a rep who cannot work the lead, and writes nothing', async () => {
    const { response } = await log(users.peer, { leadId: ids.lead, outcome: 'do_not_call' });
    expect([403, 404]).toContain(response.status);
    expect(await activities()).toHaveLength(0);
    expect((await leadRow()).doNotCall).toBe(false);
    expect(await suppressions()).toHaveLength(0);
  });

  it('answers 404 for a lead in another tenant, and leaves it untouched', async () => {
    const { response } = await log(users.rep, { leadId: ids.otherLead, outcome: 'do_not_call' });
    expect(response.status).toBe(404);
    expect(await activities(ids.otherLead, otherTenantId)).toHaveLength(0);
    expect((await leadRow(ids.otherLead, otherTenantId)).doNotCall).toBe(false);
    expect(await suppressions(otherTenantId)).toHaveLength(0);
  });

  it('answers 404 for a lead that does not exist', async () => {
    expect((await log(users.rep, { leadId: 'nope', outcome: 'no_answer' })).response.status).toBe(404);
  });
});
