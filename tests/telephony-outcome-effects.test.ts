import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import type { SessionUser } from '@/lib/auth';

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));
const state = vi.hoisted(() => ({ user: null as SessionUser | null, failTag: false }));
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  const { NextResponse } = await import('next/server');
  return { ...actual, requireAuth: async () => state.user ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
});
vi.mock('@/lib/telephony/outcomeEffects', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/telephony/outcomeEffects')>();
  return {
    ...actual,
    appendOutcomeTag: async (...args: Parameters<typeof actual.appendOutcomeTag>) => {
      if (state.failTag) throw new Error('tag write failed');
      return actual.appendOutcomeTag(...args);
    },
  };
});

import { prisma } from '@/lib/prisma';
import { appendOutcomeTag } from '@/lib/telephony/outcomeEffects';
import { tenantStorage } from '@/lib/tenant-context';
import { POST } from '@/app/api/telephony/phone-calls/route';
import { createTestTenant } from './helpers/testTenant';

/**
 * The queue tag, proven against Postgres (raw SQL, so its parameter typing and NULL handling are only
 * real here), and the logged-call door staying 201 when the tag cannot be written.
 */

let tenantId: string;
let rep: SessionUser;
const inTenant = <T>(fn: () => Promise<T>) => tenantStorage.run({ tenantId, bypassRls: true }, fn);

const makeLead = (data: Record<string, unknown> = {}) =>
  inTenant(async () => {
    const client = await prisma.client.create({ data: { tenantId, name: 'C', industry: 'SaaS', contactName: 'c', contactEmail: `c.${randomUUID()}@t.test` } });
    const campaign = await prisma.campaign.create({ data: { tenantId, clientId: client.id, name: 'Out', startDate: new Date() } });
    return (
      await prisma.lead.create({
        data: { tenantId, firstName: 'Ann', lastName: 'L', company: 'Acme', email: `a.${randomUUID()}@acme.test`, phone: '0948200638', campaignId: campaign.id, assignedToId: rep.id, ...data },
      })
    ).id;
  });
const tagsOf = (id: string) => inTenant(async () => (await prisma.lead.findUniqueOrThrow({ where: { id } })).tags);
const rawTagsIsNull = (id: string) =>
  inTenant(async () => (await prisma.$queryRaw<Array<{ isnull: boolean }>>`SELECT "tags" IS NULL AS isnull FROM "Lead" WHERE "id" = ${id}`)[0].isnull);

beforeEach(async () => {
  tenantId = `t-outcomefx-${randomUUID()}`;
  await createTestTenant(tenantId, 'Outcome effects');
  const row = await inTenant(() => prisma.user.create({ data: { tenantId, email: `u.${randomUUID()}@t.test`, firstName: 'S', lastName: 'R', password: 'x', role: 'sdr' } }));
  rep = { id: row.id, email: row.email, firstName: 'S', lastName: 'R', role: 'sdr', tenantId };
});

afterEach(() => {
  state.user = null;
  state.failTag = false;
});

describe('appendOutcomeTag', () => {
  it('writes the tag to a lead whose tags column is NULL', async () => {
    const id = await makeLead();
    expect(await rawTagsIsNull(id)).toBe(true);
    await appendOutcomeTag(tenantId, id, 'do_not_call');
    expect(await tagsOf(id)).toEqual(['do_not_call']);
  });

  it('appends to existing tags without losing them, and is idempotent', async () => {
    const id = await makeLead({ tags: ['vip'] });
    await appendOutcomeTag(tenantId, id, 'wrong_number');
    await appendOutcomeTag(tenantId, id, 'wrong_number');
    expect(await tagsOf(id)).toEqual(['vip', 'wrong_number']);
  });

  it('does nothing for an outcome with no tag', async () => {
    const id = await makeLead({ tags: ['vip'] });
    await appendOutcomeTag(tenantId, id, 'no_answer');
    expect(await tagsOf(id)).toEqual(['vip']);
  });

  it('never touches a lead through another tenant id', async () => {
    const id = await makeLead({ tags: ['vip'] });
    await appendOutcomeTag(`${tenantId}-other`, id, 'do_not_call');
    expect(await tagsOf(id)).toEqual(['vip']);
  });
});

describe('POST /api/telephony/phone-calls when the tag cannot be written', () => {
  it('still answers 201 with a warning flag, and writes one activity', async () => {
    const id = await makeLead();
    state.user = rep;
    state.failTag = true;
    const response = await POST(
      new NextRequest('https://crm.telestar.cloud/api/telephony/phone-calls', {
        method: 'POST',
        body: JSON.stringify({ leadId: id, outcome: 'do_not_call' }),
        headers: { 'content-type': 'application/json' },
      })
    );
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.tagFailed).toBe(true);
    const lead = await inTenant(() => prisma.lead.findUniqueOrThrow({ where: { id } }));
    expect(lead.doNotCall).toBe(true);
    expect(await inTenant(() => prisma.activity.count({ where: { leadId: id } }))).toBe(1);
  });
});
