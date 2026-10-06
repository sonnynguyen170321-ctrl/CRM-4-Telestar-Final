import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Edit and archive a campaign — team lead and above (owner request, 2026-10-06), through the real
 * session path. A team lead manages their pod's campaigns only; one outside it answers like a
 * missing one. Archive marks the campaign completed (it stops sending) and never deletes it.
 */

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; tenantId: string; authVersion: number } } }));
vi.mock('@/auth', () => ({ auth: vi.fn(async () => session.current), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

import { clearVisibleUserCache } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { DELETE, GET, PUT } from '@/app/api/campaigns/[id]/route';
import { createTestTenant } from './helpers/testTenant';

let tenantId: string;
const ids = { lead: '', sdr: '', floor: '', mine: '', theirs: '' };
const inTenant = <T>(fn: () => Promise<T>) => tenantStorage.run({ tenantId, bypassRls: true }, fn);

async function user(role: 'sdr' | 'team_lead' | 'floor_manager') {
  return inTenant(async () => (await prisma.user.create({ data: { tenantId, email: `${role}.${randomUUID()}@t.test`, firstName: 'U', lastName: role, password: 'x', role } })).id);
}

async function campaign(name: string) {
  return inTenant(async () => {
    const client = await prisma.client.create({ data: { tenantId, name: `C ${randomUUID()}`, industry: 'SaaS', contactName: 'c', contactEmail: `c.${randomUUID()}@t.test` } });
    return (await prisma.campaign.create({ data: { tenantId, clientId: client.id, name, startDate: new Date(), targetVertical: 'SaaS', targetGeo: 'APAC' } })).id;
  });
}

const as = (userId: string) => {
  clearVisibleUserCache();
  session.current = { user: { id: userId, tenantId, authVersion: 1 } };
};
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const put = (id: string, body: unknown) =>
  PUT(new NextRequest(`http://localhost/api/campaigns/${id}`, { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }), ctx(id));
const archive = (id: string) => DELETE(new NextRequest(`http://localhost/api/campaigns/${id}`, { method: 'DELETE' }), ctx(id));
const row = (id: string) => inTenant(() => prisma.campaign.findUniqueOrThrow({ where: { id } }));

beforeEach(async () => {
  tenantId = `t-campedit-${randomUUID()}`;
  await createTestTenant(tenantId, 'Campaign edit');
  ids.lead = await user('team_lead');
  ids.sdr = await user('sdr');
  ids.floor = await user('floor_manager');
  ids.mine = await campaign('Pod campaign');
  ids.theirs = await campaign('Other pod campaign');
  await inTenant(() => prisma.campaignSdr.create({ data: { tenantId, campaignId: ids.mine, userId: ids.lead } }));
});

describe('campaign edit', () => {
  it('lets a team lead rename their pod’s campaign, leaving untouched fields alone', async () => {
    as(ids.lead);
    const res = await put(ids.mine, { name: 'Renamed' });
    expect(res.status).toBe(200);
    expect(await row(ids.mine)).toMatchObject({ name: 'Renamed', targetVertical: 'SaaS', targetGeo: 'APAC', status: 'active' });
  });

  it('answers a campaign outside the team lead’s pod like a missing one, and changes nothing', async () => {
    as(ids.lead);
    expect((await put(ids.theirs, { name: 'Hijacked' })).status).toBe(404);
    expect((await GET(new NextRequest(`http://localhost/api/campaigns/${ids.theirs}`), ctx(ids.theirs))).status).toBe(404);
    expect((await row(ids.theirs)).name).toBe('Other pod campaign');
  });

  it('refuses an SDR', async () => {
    as(ids.sdr);
    expect((await put(ids.mine, { name: 'Nope' })).status).toBe(403);
    expect((await archive(ids.mine)).status).toBe(403);
  });

  it('does not leak client contact details in the response', async () => {
    as(ids.lead);
    const body = await (await GET(new NextRequest(`http://localhost/api/campaigns/${ids.mine}`), ctx(ids.mine))).json();
    expect(body.client).toEqual({ id: expect.any(String), name: expect.any(String) });
  });
});

describe('campaign archive', () => {
  it('archives without deleting: completed, an end date, audited — and restore clears the end date', async () => {
    as(ids.lead);
    const res = await archive(ids.mine);
    expect(res.status).toBe(200);
    const archived = await row(ids.mine);
    expect(archived.status).toBe('completed');
    expect(archived.endDate).toBeInstanceOf(Date);
    const audit = await inTenant(() => prisma.auditLog.findFirst({ where: { tenantId, recordId: ids.mine, action: 'admin.campaign.archive' } }));
    expect(audit).not.toBeNull();

    expect((await put(ids.mine, { status: 'active' })).status).toBe(200);
    expect(await row(ids.mine)).toMatchObject({ status: 'active', endDate: null });
  });

  it('keeps the end date in step with the status set from the edit dialog', async () => {
    as(ids.lead);
    await put(ids.mine, { status: 'completed' });
    expect((await row(ids.mine)).endDate).toBeInstanceOf(Date);
    await put(ids.mine, { status: 'paused' });
    expect(await row(ids.mine)).toMatchObject({ status: 'paused', endDate: null });
  });

  it('refuses to archive a campaign outside the team lead’s pod', async () => {
    as(ids.lead);
    expect((await archive(ids.theirs)).status).toBe(404);
    expect((await row(ids.theirs)).status).toBe('active');
  });
});
