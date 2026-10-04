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
import { TELEPHONY_ENV } from '@/lib/env-contract';
import { prisma } from '@/lib/prisma';
import { fromClientState, verifyCallToken } from '@/lib/telephony/authToken';
import { tenantStorage } from '@/lib/tenant-context';
import { POST } from '@/app/api/telephony/calls/route';
import { createTestTenant } from './helpers/testTenant';

/**
 * `POST /api/telephony/calls` (docs/dialer/TASKS.md D3.3), against a real database.
 *
 * Every attempt to call a callable record leaves a `Call` row — authorized with a token bound to it,
 * or blocked with its reasons — so a manager can see what was tried and why it was stopped. The
 * number always comes from the record, a rep can only call leads they may work, and a lead in
 * another tenant does not exist as far as this route is concerned.
 */

/** Monday 2026-10-05 10:00 in Vietnam. */
const VN_10AM = new Date('2026-10-05T03:00:00Z');
const ENV_KEYS = [...TELEPHONY_ENV, 'TELEPHONY_ENABLED', 'TELEPHONY_DRY_RUN'] as const;

let savedEnv: Record<string, string | undefined> = {};
let tenantId: string;
let otherTenantId: string;
const ids = { campaign: '', lead: '', contact: '', otherLead: '' };
const users = { rep: null as unknown as SessionUser, peer: null as unknown as SessionUser, other: null as unknown as SessionUser };

const inTenant = <T>(fn: () => Promise<T>, t = tenantId) => tenantStorage.run({ tenantId: t, bypassRls: true }, fn);

async function makeUser(t: string, role: SessionUser['role'] = 'sdr'): Promise<SessionUser> {
  const row = await inTenant(
    () => prisma.user.create({ data: { tenantId: t, email: `u.${randomUUID()}@t.test`, firstName: 'S', lastName: 'R', password: 'x', role } }),
    t
  );
  return { id: row.id, email: row.email, firstName: 'S', lastName: 'R', role, tenantId: t };
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

async function makeCampaign(t: string) {
  return inTenant(async () => {
    const client = await prisma.client.create({ data: { tenantId: t, name: 'C', industry: 'SaaS', contactName: 'c', contactEmail: `c.${randomUUID()}@t.test` } });
    return (await prisma.campaign.create({ data: { tenantId: t, clientId: client.id, name: 'Out', startDate: new Date() } })).id;
  }, t);
}

async function enableDialer(t: string, user: SessionUser) {
  await inTenant(async () => {
    await prisma.telephonySettings.create({ data: { tenantId: t, enabled: true, dryRun: false, allowedCountries: ['VN', 'SG'] } });
    await prisma.telephonyCredential.create({
      data: { tenantId: t, userId: user.id, provider: 'fake', providerCredentialId: `cred-${randomUUID()}`, sipUsername: 'gencred' },
    });
  }, t);
}

async function call(user: SessionUser | null, body: unknown) {
  authUser.current = user;
  const response = await POST(
    new NextRequest('https://crm.telestar.cloud/api/telephony/calls', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
  );
  return { response, body: await response.json() };
}

const callRows = (t = tenantId) => inTenant(() => prisma.call.findMany({ where: { tenantId: t }, orderBy: { createdAt: 'asc' } }), t);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(VN_10AM);
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of TELEPHONY_ENV) process.env[k] = `test-value-for-${k}-long-enough-to-satisfy-checks`;
  process.env.TELEPHONY_ENABLED = 'true';
  process.env.TELEPHONY_DRY_RUN = 'false';
  clearVisibleUserCache?.();

  tenantId = `t-telcalls-${randomUUID()}`;
  otherTenantId = `t-telcalls-other-${randomUUID()}`;
  await createTestTenant(tenantId, 'Telephony calls');
  await createTestTenant(otherTenantId, 'Telephony calls other');
  users.rep = await makeUser(tenantId);
  users.peer = await makeUser(tenantId);
  users.other = await makeUser(otherTenantId);
  ids.campaign = await makeCampaign(tenantId);
  ids.contact = await inTenant(
    async () => (await prisma.contact.create({ data: { tenantId, firstName: 'Cee', lastName: 'K', company: 'Acme', email: `cee.${randomUUID()}@acme.test`, phone: '+65 6123 4567', country: 'Singapore' } })).id
  );
  ids.lead = await makeLead(tenantId, ids.campaign, users.rep.id, { contactId: ids.contact });
  ids.otherLead = await makeLead(otherTenantId, await makeCampaign(otherTenantId), users.other.id);
  await enableDialer(tenantId, users.rep);
});

afterEach(() => {
  vi.useRealTimers();
  authUser.current = null;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k]!;
  }
});

describe('POST /api/telephony/calls', () => {
  it('requires a session', async () => {
    expect((await call(null, { leadId: ids.lead })).response.status).toBe(401);
  });

  it('is refused with no row while the deployment switch is off', async () => {
    process.env.TELEPHONY_ENABLED = 'false';
    const { response, body } = await call(users.rep, { leadId: ids.lead });
    expect(response.status).toBe(403);
    expect(body.code).toBe('dialer_disabled');
    expect(await callRows()).toHaveLength(0);
  });

  it('rejects a body without a lead', async () => {
    expect((await call(users.rep, { phone: '+84948200638' })).response.status).toBe(400);
    expect(await callRows()).toHaveLength(0);
  });

  it('authorizes a permitted call: one row, and a token bound to that row, rep and number', async () => {
    const { response, body } = await call(users.rep, { leadId: ids.lead });

    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const [row] = await callRows();
    expect(row).toMatchObject({ status: 'authorized', direction: 'outbound', userId: users.rep.id, leadId: ids.lead, contactId: null, toE164: '+84948200638', blockedReasons: [] });
    expect(row.authorizedAt?.toISOString()).toBe(VN_10AM.toISOString());
    expect(row.compliance).toMatchObject({ allowed: true, localTime: '10:00', timezone: { timezone: 'Asia/Ho_Chi_Minh' } });

    expect(body).toMatchObject({ callId: row.id, allowed: true, toE164: '+84948200638' });
    const check = verifyCallToken(fromClientState(body.clientState), Math.floor(VN_10AM.getTime() / 1000));
    expect(check).toEqual({ ok: true, claims: expect.objectContaining({ callId: row.id, tenantId, userId: users.rep.id, toE164: '+84948200638' }) });
  });

  it('records a blocked attempt with its reasons and issues no token', async () => {
    vi.setSystemTime(new Date('2026-10-05T10:00:00Z')); // 17:00 in Vietnam
    const { response, body } = await call(users.rep, { leadId: ids.lead });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ allowed: false, dryRun: false, wouldBeAllowed: false, reasons: ['outside_hours'], localTime: '17:00' });
    expect(body).not.toHaveProperty('clientState');
    const [row] = await callRows();
    expect(row).toMatchObject({ status: 'blocked', blockedReasons: ['outside_hours'], authorizedAt: null });
  });

  it('in dry-run records what would have happened and places nothing', async () => {
    delete process.env.TELEPHONY_DRY_RUN;
    const { body } = await call(users.rep, { leadId: ids.lead });

    expect(body).toMatchObject({ allowed: false, dryRun: true, wouldBeAllowed: true, reasons: [] });
    expect(body).not.toHaveProperty('clientState');
    expect((await callRows())[0]).toMatchObject({ status: 'blocked', blockedReasons: ['dry_run'] });
  });

  it('blocks a number on this tenant’s do-not-call list, and only this tenant’s', async () => {
    await inTenant(() => prisma.phoneSuppression.create({ data: { tenantId: otherTenantId, e164: '+84948200638', source: 'manual' } }), otherTenantId);
    expect((await call(users.rep, { leadId: ids.lead })).response.status).toBe(201);

    vi.setSystemTime(new Date(VN_10AM.getTime() + 10_000));
    await inTenant(() => prisma.phoneSuppression.create({ data: { tenantId, e164: '+84948200638', source: 'manual' } }));
    expect((await call(users.rep, { leadId: ids.lead })).body.reasons).toEqual(['suppressed']);
  });

  it('records a blocked attempt when the lead’s clock cannot be known', async () => {
    await inTenant(() => prisma.telephonySettings.update({ where: { tenantId }, data: { allowedCountries: ['VN', 'US'] } }));
    await inTenant(() => prisma.lead.update({ where: { id: ids.lead }, data: { phone: '+1 415 555 2671', contactId: null } }));
    const { body } = await call(users.rep, { leadId: ids.lead });
    expect(body).toMatchObject({ allowed: false, reasons: ['tz_unknown'], timezone: null, localTime: null });
    expect((await callRows())[0]).toMatchObject({ status: 'blocked', toE164: '+14155552671', blockedReasons: ['tz_unknown'] });
  });

  it('blocks a lead flagged do-not-call', async () => {
    await inTenant(() => prisma.lead.update({ where: { id: ids.lead }, data: { doNotCall: true } }));
    expect((await call(users.rep, { leadId: ids.lead })).body.reasons).toEqual(['lead_do_not_call']);
  });

  it('dials the lead’s own contact’s number when asked, and refuses anyone else’s contact', async () => {
    const { response, body } = await call(users.rep, { leadId: ids.lead, contactId: ids.contact });
    expect(response.status).toBe(201);
    expect(body.toE164).toBe('+6561234567');
    expect((await callRows())[0]).toMatchObject({ contactId: ids.contact, toE164: '+6561234567' });

    const stranger = await inTenant(async () => (await prisma.contact.create({ data: { tenantId, firstName: 'X', lastName: 'Y', company: 'Other', email: `x.${randomUUID()}@o.test`, phone: '+6560000000' } })).id);
    vi.setSystemTime(new Date(VN_10AM.getTime() + 10_000));
    expect((await call(users.rep, { leadId: ids.lead, contactId: stranger })).response.status).toBe(404);
  });

  it('answers another rep’s lead exactly like a missing one, and stores nothing about it', async () => {
    const peersLead = await makeLead(tenantId, ids.campaign, users.peer.id, { phone: null, doNotCall: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { response, body } = await call(users.rep, { leadId: peersLead });
    warn.mockRestore();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Lead not found', code: 'not_found' });
    expect(await callRows()).toHaveLength(0);
  });

  it('starts one call when the same rep sends two requests at once', async () => {
    const results = await Promise.all([call(users.rep, { leadId: ids.lead }), call(users.rep, { leadId: ids.lead })]);
    expect(results.map((r) => r.response.status).sort()).toEqual([201, 429]);
    expect(await callRows()).toHaveLength(1);
  });

  it('treats a lead in another tenant, or an archived lead, as not found, and writes nothing', async () => {
    expect((await call(users.rep, { leadId: ids.otherLead })).response.status).toBe(404);
    await inTenant(() => prisma.lead.update({ where: { id: ids.lead }, data: { archivedAt: new Date() } }));
    expect((await call(users.rep, { leadId: ids.lead })).response.status).toBe(404);
    expect(await callRows()).toHaveLength(0);
    expect(await callRows(otherTenantId)).toHaveLength(0);
  });

  it('refuses a record with no callable number, with no row', async () => {
    await inTenant(() => prisma.lead.update({ where: { id: ids.lead }, data: { phone: null } }));
    const { response, body } = await call(users.rep, { leadId: ids.lead });
    expect(response.status).toBe(422);
    expect(body.code).toBe('no_dialable_number');
    expect(await callRows()).toHaveLength(0);
  });

  it('allows calling the same number again, but not twice inside three seconds', async () => {
    expect((await call(users.rep, { leadId: ids.lead })).response.status).toBe(201);

    vi.setSystemTime(new Date(VN_10AM.getTime() + 2_999));
    const tooSoon = await call(users.rep, { leadId: ids.lead });
    expect(tooSoon.response.status).toBe(429);
    expect(tooSoon.response.headers.get('Retry-After')).toBe('3');

    vi.setSystemTime(new Date(VN_10AM.getTime() + 3_001));
    expect((await call(users.rep, { leadId: ids.lead })).response.status).toBe(201);
    vi.setSystemTime(new Date(VN_10AM.getTime() + 60 * 60_000));
    expect((await call(users.rep, { leadId: ids.lead })).response.status).toBe(201);
    expect((await callRows()).map((r) => r.status)).toEqual(['authorized', 'authorized', 'authorized']);
  });

  it('does not let one rep’s recent attempt hold up another rep', async () => {
    await enableDialer(otherTenantId, users.other);
    await inTenant(() => prisma.telephonyCredential.create({
      data: { tenantId, userId: users.peer.id, provider: 'fake', providerCredentialId: `cred-${randomUUID()}`, sipUsername: 'g2' },
    }));
    const peersLead = await makeLead(tenantId, ids.campaign, users.peer.id);
    expect((await call(users.rep, { leadId: ids.lead })).response.status).toBe(201);
    expect((await call(users.peer, { leadId: peersLead })).response.status).toBe(201);
  });
});
