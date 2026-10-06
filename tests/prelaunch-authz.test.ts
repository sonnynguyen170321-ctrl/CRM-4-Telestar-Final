import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Pre-launch audit, 2026-10-05: four ways a signed-in rep reached past their own work, each
 * driven through the real session path (cookie session → database user → role), not a mocked guard.
 *
 *   - `/api/v1/*` scoped by tenant only, so an SDR's browser session read every lead;
 *   - any SDR could mint, list and revoke API keys;
 *   - any SDR could edit or archive anyone's sequence (archiving unenrolls every lead in it);
 *   - AI routes loaded any lead in the tenant by id.
 */

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; tenantId: string; authVersion: number } } }));
vi.mock('@/auth', () => ({ auth: vi.fn(async () => session.current), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { GET as v1Leads } from '@/app/api/v1/leads/route';
import { GET as listKeys, POST as createKey } from '@/app/api/developer/keys/route';
import { DELETE as archiveSequence } from '@/app/api/sequences/[id]/route';
import { POST as createSequence } from '@/app/api/sequences/route';
import { POST as enroll } from '@/app/api/sequences/[id]/enroll/route';
import { GET as nextBestAction } from '@/app/api/ai/nba/route';
import { CRON_MANAGER_ROLES } from '@/lib/cron/auth';
import { createTestTenant } from './helpers/testTenant';

type Role = 'sdr' | 'team_lead' | 'floor_manager' | 'director';

let tenantId: string;
const users: Record<'rep' | 'peer' | 'lead' | 'floor', string> = { rep: '', peer: '', lead: '', floor: '' };
const inTenant = <T>(fn: () => Promise<T>) => tenantStorage.run({ tenantId, bypassRls: true }, fn);

async function makeUser(role: Role) {
  return inTenant(async () => (await prisma.user.create({ data: { tenantId, email: `${role}.${randomUUID()}@t.test`, firstName: 'U', lastName: role, password: 'x', role } })).id);
}

const as = (userId: string) => {
  session.current = { user: { id: userId, tenantId, authVersion: 1 } };
};

const req = (url: string, init?: RequestInit) => new NextRequest(new Request(`https://crm.telestar.cloud${url}`, init));

beforeEach(async () => {
  tenantId = `t-authz-${randomUUID()}`;
  await createTestTenant(tenantId, 'Prelaunch authz');
  users.rep = await makeUser('sdr');
  users.peer = await makeUser('sdr');
  users.lead = await makeUser('team_lead');
  users.floor = await makeUser('floor_manager');
});

describe('/api/v1 takes an API key, not a browser session', () => {
  it('refuses an SDR’s session', async () => {
    as(users.rep);
    const response = await v1Leads(req('/api/v1/leads?limit=200'));
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('api_key_required');
  });
});

describe('API keys are a manager’s to mint, list and revoke', () => {
  it('refuses an SDR and a team lead, allows a floor manager', async () => {
    const body = () => JSON.stringify({ name: 'clay', scopes: ['leads:read'] });
    for (const id of [users.rep, users.lead]) {
      as(id);
      expect((await createKey(req('/api/developer/keys', { method: 'POST', body: body(), headers: { 'content-type': 'application/json' } }))).status).toBe(403);
      expect((await listKeys()).status).toBe(403);
    }
    as(users.floor);
    const created = await createKey(req('/api/developer/keys', { method: 'POST', body: body(), headers: { 'content-type': 'application/json' } }));
    expect(created.status).toBeLessThan(300);
    expect((await listKeys()).status).toBe(200);
  });
});

describe('a sequence is changed only by its creator or a manager', () => {
  async function sequenceBy(createdById: string) {
    return inTenant(async () => (await prisma.sequence.create({ data: { tenantId, name: `S ${randomUUID()}`, createdById } })).id);
  }
  const archive = (id: string) => archiveSequence(req(`/api/sequences/${id}`, { method: 'DELETE' }), { params: Promise.resolve({ id }) });

  // Since 2026-10-05 a sequence is private to its creator and the managers above them unless a
  // manager shares it (lib/visibility.ts), so one a rep cannot see answers "not found" rather than
  // "forbidden" — it is not confirmed to exist.
  it('hides another SDR’s sequence, and leaves it untouched', async () => {
    const id = await sequenceBy(users.peer);
    as(users.rep);
    expect((await archive(id)).status).toBe(404);
    expect(await inTenant(() => prisma.sequence.findUniqueOrThrow({ where: { id } }))).toMatchObject({ isArchived: false });
  });

  it('refuses an SDR who can see a shared sequence but did not create it', async () => {
    const id = await sequenceBy(users.peer);
    await inTenant(() => prisma.sequence.update({ where: { id }, data: { isShared: true } }));
    as(users.rep);
    expect((await archive(id)).status).toBe(403);
    expect(await inTenant(() => prisma.sequence.findUniqueOrThrow({ where: { id } }))).toMatchObject({ isArchived: false });
  });

  it('allows its creator and the creator’s own team lead', async () => {
    as(users.peer);
    expect((await archive(await sequenceBy(users.peer))).status).toBe(200);

    await inTenant(() => prisma.user.update({ where: { id: users.peer }, data: { managerId: users.lead } }));
    as(users.lead);
    expect((await archive(await sequenceBy(users.peer))).status).toBe(200);
  });

  it('hides it from a team lead of another pod — being a manager is not enough', async () => {
    const id = await sequenceBy(users.peer);
    as(users.lead);
    expect((await archive(id)).status).toBe(404);
    expect(await inTenant(() => prisma.sequence.findUniqueOrThrow({ where: { id } }))).toMatchObject({ isArchived: false });
  });
});

describe('a private template or sequence cannot be reached by id', () => {
  // Since 2026-10-05 templates and sequences are private to their creator and the managers above
  // them unless a manager shares them (lib/visibility.ts). Knowing an id must not get round that.
  async function templateBy(createdById: string, isShared = false) {
    return inTenant(async () => (await prisma.template.create({
      data: { tenantId, name: `T ${randomUUID()}`, channel: 'email', subject: 'S', body: 'B', createdById, isShared },
    })).id);
  }
  const create = (templateId: string) =>
    createSequence(req('/api/sequences', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `S ${randomUUID()}`, steps: [{ channel: 'email', autoComplete: true, templateId }] }),
    }));

  it('refuses a step pointed at a colleague’s private template, and creates nothing', async () => {
    const templateId = await templateBy(users.peer);
    as(users.rep);
    expect((await create(templateId)).status).toBe(404);
    expect(await inTenant(() => prisma.sequence.count({ where: { createdById: users.rep } }))).toBe(0);
  });

  it('allows a shared template, and the caller’s own', async () => {
    as(users.rep);
    expect((await create(await templateBy(users.peer, true))).status).toBe(201);
    expect((await create(await templateBy(users.rep))).status).toBe(201);
  });

  it('will not enroll a lead in a sequence the caller cannot see', async () => {
    const sequenceId = await inTenant(async () => (await prisma.sequence.create({ data: { tenantId, name: `S ${randomUUID()}`, createdById: users.peer } })).id);
    const leadId = await inTenant(async () => {
      const client = await prisma.client.create({ data: { tenantId, name: 'C', industry: 'SaaS', contactName: 'c', contactEmail: `c.${randomUUID()}@t.test` } });
      const campaign = await prisma.campaign.create({ data: { tenantId, clientId: client.id, name: 'Out', startDate: new Date() } });
      return (await prisma.lead.create({ data: { tenantId, firstName: 'A', lastName: 'B', email: `a.${randomUUID()}@acme.test`, company: 'Acme', campaignId: campaign.id, assignedToId: users.rep } })).id;
    });
    as(users.rep);
    const res = await enroll(
      req(`/api/sequences/${sequenceId}/enroll`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ leadId }) }),
      { params: Promise.resolve({ id: sequenceId }) },
    );
    expect(res.status).toBe(404);
    expect(await inTenant(() => prisma.sequenceEnrollment.count({ where: { sequenceId } }))).toBe(0);
  });
});

describe('AI routes only read leads the caller may work', () => {
  it('answers another rep’s lead as not found', async () => {
    const leadId = await inTenant(async () => {
      const client = await prisma.client.create({ data: { tenantId, name: 'C', industry: 'SaaS', contactName: 'c', contactEmail: `c.${randomUUID()}@t.test` } });
      const campaign = await prisma.campaign.create({ data: { tenantId, clientId: client.id, name: 'Out', startDate: new Date() } });
      return (await prisma.lead.create({ data: { tenantId, firstName: 'A', lastName: 'B', email: `a.${randomUUID()}@acme.test`, company: 'Acme', campaignId: campaign.id, assignedToId: users.peer } })).id;
    });
    as(users.rep);
    expect((await nextBestAction(req(`/api/ai/nba?leadId=${leadId}`))).status).toBe(404);
  });
});

describe('tenant-wide cron runs', () => {
  it('are not a team lead’s to trigger', () => {
    expect(CRON_MANAGER_ROLES).toEqual(['director', 'floor_manager']);
  });
});
