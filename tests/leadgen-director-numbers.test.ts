import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import type { SessionUser } from '@/lib/auth';

/**
 * Leadgen and Director numbers against the rows they describe (Phase 6 dashboard audit).
 *
 * Before: every Leadgen headline was counted in the browser from the first 200 leads;
 * "Imported This Week" matched a source value the import rarely writes; "Meetings Booked" read
 * the meeting_booked stage, which drops meetings whose deal has closed; the Director's meetings
 * board kept archived leads and counted a no-show as still pending.
 */

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));
const authUser = vi.hoisted(() => ({ current: null as SessionUser | null }));
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  const { NextResponse } = await import('next/server');
  const deny = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return {
    ...actual,
    requireAuth: async () => authUser.current ?? deny(),
    requireManager: async () => authUser.current ?? deny(),
  };
});

import { clearVisibleUserCache } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { getLeadgenSummary } from '@/lib/leadgen/summary';
import { GET as teamMeetings } from '@/app/api/team/meetings/route';
import { createTestTenant } from './helpers/testTenant';

const NOW = new Date('2026-10-04T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

let tenantId: string;
const ids = { director: '', rep: '', peer: '', retired: '', client: '', campaign: '' };
const inTenant = <T>(fn: () => Promise<T>) => tenantStorage.run({ tenantId, bypassRls: true }, fn);
const session = (id: string, role: SessionUser['role']) =>
  ({ id, email: `${id}@t.test`, firstName: 'A', lastName: 'B', role, tenantId }) as SessionUser;

async function lead(assignedToId: string, extra: Record<string, unknown> = {}) {
  const row = await prisma.lead.create({
    data: {
      tenantId,
      firstName: 'L',
      lastName: randomUUID().slice(0, 6),
      email: `l.${randomUUID()}@acme.test`,
      company: 'Acme',
      assignedToId,
      campaignId: ids.campaign,
      createdAt: daysAgo(30),
      ...extra,
    },
  });
  return row.id;
}

async function meeting(leadId: string, status: 'scheduled' | 'cancelled' | 'no_show' | 'completed') {
  await prisma.meeting.create({
    data: { tenantId, leadId, clientId: ids.client, campaignId: ids.campaign, sdrId: ids.rep, status, title: 'Intro' },
  });
}

beforeEach(async () => {
  authUser.current = null;
  clearVisibleUserCache();
  tenantId = `t-lgdir-${randomUUID()}`;
  await createTestTenant(tenantId, 'Leadgen director');
  await inTenant(async () => {
    const mk = async (role: SessionUser['role'], extra: Record<string, unknown> = {}) =>
      (await prisma.user.create({ data: { tenantId, email: `${role}.${randomUUID()}@t.test`, firstName: role, lastName: 'U', password: 'x', role, ...extra } })).id;
    ids.director = await mk('director');
    ids.rep = await mk('sdr');
    ids.peer = await mk('sdr');
    ids.retired = await mk('sdr', { isActive: false });
    ids.client = (await prisma.client.create({ data: { tenantId, name: 'C', industry: 'SaaS', contactName: 'c', contactEmail: `c.${randomUUID()}@t.test` } })).id;
    ids.campaign = (await prisma.campaign.create({ data: { tenantId, clientId: ids.client, name: 'Out', startDate: new Date() } })).id;
  });
});

describe('the Leadgen headline numbers', () => {
  it('count the whole scope, not the first page of the list', async () => {
    const summary = await inTenant(async () => {
      await prisma.lead.createMany({
        data: Array.from({ length: 205 }, (_, index) => ({
          tenantId,
          firstName: 'Bulk',
          lastName: String(index),
          email: `bulk.${index}.${randomUUID()}@acme.test`,
          company: 'Acme',
          assignedToId: ids.rep,
          campaignId: ids.campaign,
          createdAt: daysAgo(30),
        })),
      });
      return getLeadgenSummary(session(ids.director, 'director'), NOW);
    });
    expect(summary.totalLeads).toBe(205);
  });

  it('count what each label says', async () => {
    const summary = await inTenant(async () => {
      await lead(ids.rep, { createdAt: daysAgo(2), icpQualification: 'qualified' }); // new, imported under a file name
      await lead(ids.rep, { createdAt: daysAgo(2), icpQualification: 'needs_review' });
      await lead(ids.peer, { stage: 'replied' });
      await lead(ids.retired); // a rep who has left owns nothing that counts as "working"
      await lead(ids.rep, { archivedAt: new Date(), createdAt: daysAgo(1) }); // archived: out of every number

      const wonAfterMeeting = await lead(ids.rep, { stage: 'won' });
      await meeting(wonAfterMeeting, 'completed');
      const loggedOnly = await lead(ids.peer, { stage: 'meeting_booked' });
      await prisma.activity.create({ data: { tenantId, userId: ids.peer, leadId: loggedOnly, type: 'meeting_booked' } });
      const cancelled = await lead(ids.rep);
      await meeting(cancelled, 'cancelled');

      return getLeadgenSummary(session(ids.director, 'director'), NOW);
    });
    expect(summary).toMatchObject({
      totalLeads: 7,
      addedThisWeek: 2,
      icpQualified: 1,
      repsWorking: 2,
      meetingsBooked: 2,
    });
    expect(summary.stages).toMatchObject({ replied: 1, won: 1, meeting_booked: 1 });
  });

  it('count only a rep\'s own leads for that rep', async () => {
    const summary = await inTenant(async () => {
      await lead(ids.rep);
      await lead(ids.peer);
      return getLeadgenSummary(session(ids.rep, 'sdr'), NOW);
    });
    expect(summary.totalLeads).toBe(1);
  });
});

describe('the Director meetings board', () => {
  it('lists leads with a live meeting or a logged booking, not archived leads or cancelled-only meetings', async () => {
    authUser.current = session(ids.director, 'director');
    const { body, expected } = await inTenant(async () => {
      const booked = await lead(ids.rep, { stage: 'meeting_booked' });
      await meeting(booked, 'scheduled');
      const noShow = await lead(ids.rep, { stage: 'meeting_booked' });
      await meeting(noShow, 'no_show');
      const logged = await lead(ids.peer, { stage: 'meeting_booked' });
      await prisma.activity.create({ data: { tenantId, userId: ids.peer, leadId: logged, type: 'meeting_booked' } });
      const cancelledOnly = await lead(ids.rep);
      await meeting(cancelledOnly, 'cancelled');
      const archived = await lead(ids.rep, { stage: 'meeting_booked', archivedAt: new Date() });
      await meeting(archived, 'scheduled');

      const res = await teamMeetings(new NextRequest('http://localhost/api/team/meetings'));
      return {
        body: (await res.json()) as Array<{ id: string; meetings?: Array<{ status: string }> }>,
        expected: { booked, noShow, logged },
      };
    });
    expect(body.map((row) => row.id).sort()).toEqual([expected.booked, expected.noShow, expected.logged].sort());
    expect(body.find((row) => row.id === expected.noShow)?.meetings?.[0]?.status).toBe('no_show');
  });
});

describe('wiring', () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

  it('asks for the Director\'s own open tasks instead of filtering a capped org list', () => {
    expect(read('app/director/page.tsx')).toMatch(/\/api\/tasks\?tab=pending&userId=\$\{encodeURIComponent\(currentUserId\)\}/);
  });

  it('takes the Leadgen headline numbers from the server summary', () => {
    const source = read('app/leadgen/page.tsx');
    expect(source).toMatch(/fetch\('\/api\/leadgen\/summary'\)/);
    expect(source).not.toMatch(/value: leads\.length/);
  });

  it('counts a no-show with the lost meetings and rates wins over decided ones', () => {
    const source = read('components/team/MeetingsBoard.tsx');
    expect(source).toMatch(/isNoShow\(m\) && m\.stage !== 'won'/);
    expect(source).toMatch(/const winRate = decided > 0/);
  });
});
