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
const limiter = vi.hoisted(() => ({ allowed: true }));
vi.mock('@/lib/security/attemptLimit', () => ({
  consumeAttempt: async () => (limiter.allowed ? { allowed: true, remaining: 1, retryAfterSeconds: 0 } : { allowed: false, remaining: 0, retryAfterSeconds: 30 }),
}));

import { clearVisibleUserCache } from '@/lib/auth';
import { TELEPHONY_ENV } from '@/lib/env-contract';
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { GET as getTargets } from '@/app/api/telephony/targets/route';
import { GET as getCallerIds } from '@/app/api/telephony/caller-ids/route';
import { createTestTenant } from './helpers/testTenant';

/**
 * `GET /api/telephony/targets` and `/caller-ids` (floating dialer), against a real database. Targets
 * are leads the rep may work, found by name, company or phone; the number comes from the record; a
 * contact is only offered through a lead the rep can reach; another tenant is invisible.
 */

const ENV_KEYS = [...TELEPHONY_ENV, 'TELEPHONY_ENABLED', 'TELEPHONY_DRY_RUN'] as const;
let savedEnv: Record<string, string | undefined> = {};
let tenantId: string;
let otherTenantId: string;
let campaignId: string;
const users = { rep: null as unknown as SessionUser, peer: null as unknown as SessionUser, other: null as unknown as SessionUser };

const inTenant = <T>(fn: () => Promise<T>, t = tenantId) => tenantStorage.run({ tenantId: t, bypassRls: true }, fn);

async function makeUser(t: string): Promise<SessionUser> {
  const row = await inTenant(() => prisma.user.create({ data: { tenantId: t, email: `u.${randomUUID()}@t.test`, firstName: 'S', lastName: 'R', password: 'x', role: 'sdr' } }), t);
  return { id: row.id, email: row.email, firstName: 'S', lastName: 'R', role: 'sdr', tenantId: t };
}

async function makeCampaign(t: string) {
  return inTenant(async () => {
    const client = await prisma.client.create({ data: { tenantId: t, name: 'C', industry: 'SaaS', contactName: 'c', contactEmail: `c.${randomUUID()}@t.test` } });
    return (await prisma.campaign.create({ data: { tenantId: t, clientId: client.id, name: 'Out', startDate: new Date() } })).id;
  }, t);
}

const makeLead = (t: string, camp: string, assignedToId: string, data: Record<string, unknown> = {}) =>
  inTenant(
    async () =>
      (
        await prisma.lead.create({
          data: { tenantId: t, firstName: 'Ann', lastName: 'Lee', email: `a.${randomUUID()}@acme.test`, company: 'Acme', phone: '+66812345678', normalizedPhone: '+66812345678', campaignId: camp, assignedToId, ...data },
        })
      ).id,
    t
  );

async function search(user: SessionUser | null, q: string | null) {
  authUser.current = user;
  const response = await getTargets(new NextRequest(`https://crm.telestar.cloud/api/telephony/targets${q === null ? '' : `?q=${encodeURIComponent(q)}`}`));
  return { response, body: await response.json() };
}

beforeEach(async () => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of TELEPHONY_ENV) process.env[k] = `test-value-for-${k}-long-enough-to-satisfy-checks`;
  process.env.TELEPHONY_ENABLED = 'true';
  process.env.TELEPHONY_DRY_RUN = 'false';
  limiter.allowed = true;
  clearVisibleUserCache?.();
  tenantId = `t-teltarg-${randomUUID()}`;
  otherTenantId = `t-teltarg-o-${randomUUID()}`;
  await createTestTenant(tenantId, 'Targets');
  await createTestTenant(otherTenantId, 'Targets other');
  users.rep = await makeUser(tenantId);
  users.peer = await makeUser(tenantId);
  users.other = await makeUser(otherTenantId);
  campaignId = await makeCampaign(tenantId);
});

afterEach(() => {
  authUser.current = null;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k]!;
  }
});

describe('GET /api/telephony/targets', () => {
  it('requires a session and refuses an API key', async () => {
    expect((await search(null, 'ann')).response.status).toBe(401);
    const keyed = { ...users.rep, apiKey: { id: 'k', name: 'ro', scopes: ['*'] } } as SessionUser;
    expect((await search(keyed, 'ann')).response.status).toBe(403);
  });

  it('is refused while the deployment switch is off', async () => {
    process.env.TELEPHONY_ENABLED = 'false';
    const { response, body } = await search(users.rep, 'ann');
    expect(response.status).toBe(403);
    expect(body.code).toBe('dialer_disabled');
  });

  it('answers an empty list for a missing or too-short query, without searching', async () => {
    expect((await search(users.rep, null)).body.targets).toEqual([]);
    expect((await search(users.rep, 'a')).body.targets).toEqual([]);
    expect((await search(users.rep, '   ')).body.targets).toEqual([]);
  });

  it('finds a lead by name and company, with the number from the record', async () => {
    const id = await makeLead(tenantId, campaignId, users.rep.id, { firstName: 'Nguyễn', lastName: 'Hải', company: 'Sao Mai' });
    const byName = await search(users.rep, 'nguyen hai');
    expect(byName.body.targets).toEqual([
      expect.objectContaining({ leadId: id, contactId: null, name: 'Nguyễn Hải', company: 'Sao Mai', phone: '+66812345678', doNotCall: false, suppressed: false, kind: 'lead' }),
    ]);
    expect((await search(users.rep, 'sao mai')).body.targets).toHaveLength(1);
  });

  it('finds a lead by phone however it is typed: local zero, spaces, country code', async () => {
    const id = await makeLead(tenantId, campaignId, users.rep.id, { phone: '+84 948 200 638', normalizedPhone: '+84948200638' });
    for (const q of ['0948200638', '+84 948 200 638', '948 200', '(0948) 200']) {
      const { body } = await search(users.rep, q);
      expect(body.targets.map((t: { leadId: string }) => t.leadId), q).toContain(id);
    }
    expect((await search(users.rep, '0999111222')).body.targets).toEqual([]);
  });

  it('does not return leads the rep may not work, a peer’s lead included', async () => {
    await makeLead(tenantId, campaignId, users.peer.id, { firstName: 'Peerlead' });
    const mine = await makeLead(tenantId, campaignId, users.rep.id, { firstName: 'Peerlead', lastName: 'Mine' });
    const { body } = await search(users.rep, 'peerlead');
    expect(body.targets.map((t: { leadId: string }) => t.leadId)).toEqual([mine]);
  });

  it('never crosses tenants: another company’s lead is not found by name or phone', async () => {
    const otherCampaign = await makeCampaign(otherTenantId);
    await makeLead(otherTenantId, otherCampaign, users.other.id, { firstName: 'Zebulon', phone: '+84911222333', normalizedPhone: '+84911222333' });
    expect((await search(users.rep, 'zebulon')).body.targets).toEqual([]);
    expect((await search(users.rep, '0911222333')).body.targets).toEqual([]);
  });

  it('does not return archived leads', async () => {
    await makeLead(tenantId, campaignId, users.rep.id, { firstName: 'Archie', archivedAt: new Date() });
    expect((await search(users.rep, 'archie')).body.targets).toEqual([]);
  });

  it('offers the lead’s own contact as a second target, and only that contact', async () => {
    const contact = await inTenant(() => prisma.contact.create({ data: { tenantId, firstName: 'Cee', lastName: 'Kay', fullName: 'Cee Kay', company: 'Acme', email: `c.${randomUUID()}@acme.test`, phone: '+65 6123 4567', country: 'Singapore', doNotCall: true } }));
    const stray = await inTenant(() => prisma.contact.create({ data: { tenantId, firstName: 'Stray', lastName: 'One', fullName: 'Stray One', company: 'Acme', email: `s.${randomUUID()}@acme.test`, phone: '+65 6999 0000', country: 'Singapore' } }));
    const id = await makeLead(tenantId, campaignId, users.rep.id, { firstName: 'Linked', contactId: contact.id });
    const { body } = await search(users.rep, 'linked');
    expect(body.targets).toHaveLength(2);
    expect(body.targets[1]).toMatchObject({ leadId: id, contactId: contact.id, name: 'Cee Kay', phone: '+6561234567', doNotCall: true, kind: 'contact' });
    expect((await search(users.rep, '69990000')).body.targets).toEqual([]);
    void stray;
  });

  it('flags a number on the suppression list', async () => {
    await makeLead(tenantId, campaignId, users.rep.id, { firstName: 'Suppressed' });
    await inTenant(() => prisma.phoneSuppression.create({ data: { tenantId, e164: '+66812345678', source: 'manual', reason: 'dnc' } }));
    expect((await search(users.rep, 'suppressed')).body.targets[0]).toMatchObject({ suppressed: true });
  });

  it('shows a lead with no dialable number as not callable', async () => {
    await makeLead(tenantId, campaignId, users.rep.id, { firstName: 'Nophone', phone: null, normalizedPhone: null });
    expect((await search(users.rep, 'nophone')).body.targets[0]).toMatchObject({ phone: null });
  });

  it('is rate limited per rep', async () => {
    limiter.allowed = false;
    const { response, body } = await search(users.rep, 'ann');
    expect(response.status).toBe(429);
    expect(body.code).toBe('rate_limited');
    expect(response.headers.get('Retry-After')).toBe('30');
  });

  it('returns at most eight leads', async () => {
    for (let i = 0; i < 10; i += 1) await makeLead(tenantId, campaignId, users.rep.id, { firstName: 'Many' });
    expect((await search(users.rep, 'many')).body.targets.length).toBeLessThanOrEqual(8);
  });
});

describe('GET /api/telephony/caller-ids', () => {
  const list = async (user: SessionUser | null) => {
    authUser.current = user;
    const response = await getCallerIds();
    return { response, body: await response.json() };
  };
  const number = (t: string, data: Record<string, unknown> = {}) =>
    inTenant(() => prisma.telephonyNumber.create({ data: { tenantId: t, e164: `+1415${Math.floor(1000000 + Math.random() * 8999999)}`, country: 'US', purpose: 'both', ...data } }), t);

  it('lists this company’s active outbound numbers only', async () => {
    const both = await number(tenantId);
    const outbound = await number(tenantId, { purpose: 'outbound', label: 'Sales' });
    await number(tenantId, { purpose: 'inbound' });
    await number(tenantId, { isActive: false });
    await number(otherTenantId);
    const { response, body } = await list(users.rep);
    expect(response.status).toBe(200);
    expect(body.numbers.map((n: { id: string }) => n.id).sort()).toEqual([both.id, outbound.id].sort());
    expect(body.numbers[0]).not.toHaveProperty('providerNumberId');
  });

  it('requires a session', async () => {
    expect((await list(null)).response.status).toBe(401);
  });
});
