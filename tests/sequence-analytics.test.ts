import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import type { SessionUser } from '@/lib/auth';

/**
 * The sequence dashboards, against a real database (rebuilt 2026-10-04).
 *
 * The old version read sends from `email_sent` activities filtered on `metadata.sequenceId`,
 * which no writer sets — every sequence showed 0 sends, 0 replies and 0 bounces on production —
 * and its mock tests pinned the query shape, so they stayed green while the numbers were zero.
 * These seed the rows that record what happened and compare the numbers against them.
 */

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
import { tenantStorage } from '@/lib/tenant-context';
import { getScopedSequenceStats, getSequenceAnalytics } from '@/lib/sequences/analytics';
import { occupancyKeyFor } from '@/lib/sequences/occupancy';
import { GET as drillDown } from '@/app/api/sequences/[id]/analytics/route';
import { createTestTenant } from './helpers/testTenant';

// 20:00 UTC on 4 Oct = 03:00 on 5 Oct in Ho Chi Minh City (UTC+7).
const NOW = new Date('2026-10-04T20:00:00Z');
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

let tenantId: string;
const ids = { director: '', teamLead: '', report: '', outsider: '', account: '', campaign: '', seqA: '', seqB: '' };
const inTenant = <T>(fn: () => Promise<T>, t = tenantId) => tenantStorage.run({ tenantId: t, bypassRls: true }, fn);
const session = (id: string, role: SessionUser['role']) =>
  ({ id, email: `${id}@t.test`, firstName: 'A', lastName: 'B', role, tenantId }) as SessionUser;

async function user(role: SessionUser['role'], extra: Record<string, unknown> = {}) {
  const row = await prisma.user.create({
    data: { tenantId, email: `${role}.${randomUUID()}@t.test`, firstName: role, lastName: 'U', password: 'x', role, ...extra },
  });
  return row.id;
}

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
      ...extra,
    },
  });
  return row.id;
}

async function enroll(leadId: string, sequenceId: string, status: 'active' | 'paused' | 'completed' = 'active') {
  await prisma.sequenceEnrollment.create({
    data: {
      tenantId,
      leadId,
      sequenceId,
      status,
      currentStep: 1,
      occupancyKey: status === 'completed' ? null : occupancyKeyFor(tenantId, leadId, sequenceId),
    },
  });
}

async function message(input: {
  leadId: string;
  sequenceId: string | null;
  step?: number | null;
  sentAt: Date | null;
  repliedAt?: Date;
  bouncedAt?: Date;
  dryRun?: boolean;
}) {
  const id = randomUUID();
  await prisma.outboundMessage.create({
    data: {
      tenantId,
      leadId: input.leadId,
      accountId: ids.account,
      sequenceId: input.sequenceId,
      sequenceStepOrder: input.step === undefined ? 1 : input.step,
      to: 'p@acme.test',
      idempotencyKey: `an-${id}`,
      status: input.sentAt ? 'sent' : 'pending',
      sentAt: input.sentAt,
      providerMessageId: input.sentAt ? (input.dryRun ? `dry-run-${id}` : `<${id}@mail>`) : null,
      repliedAt: input.repliedAt ?? null,
      bouncedAt: input.bouncedAt ?? null,
    },
  });
}

beforeEach(async () => {
  authUser.current = null;
  clearVisibleUserCache();
  tenantId = `t-seqanalytics-${randomUUID()}`;
  await createTestTenant(tenantId, 'Sequence analytics');
  await inTenant(async () => {
    ids.director = await user('director', { timezone: 'Asia/Ho_Chi_Minh' });
    ids.teamLead = await user('team_lead', { timezone: 'Asia/Ho_Chi_Minh' });
    ids.report = await user('sdr', { managerId: ids.teamLead, timezone: 'Asia/Ho_Chi_Minh' });
    ids.outsider = await user('sdr', { timezone: 'Asia/Ho_Chi_Minh' });
    const client = await prisma.client.create({
      data: { tenantId, name: 'C', industry: 'SaaS', contactName: 'c', contactEmail: `c.${randomUUID()}@t.test` },
    });
    ids.campaign = (await prisma.campaign.create({ data: { tenantId, clientId: client.id, name: 'Out', startDate: new Date() } })).id;
    ids.account = (
      await prisma.emailAccount.create({
        data: { tenantId, userId: ids.director, email: `box.${randomUUID()}@t.test`, provider: 'imap_smtp', isActive: true },
      })
    ).id;
    for (const key of ['seqA', 'seqB'] as const) {
      const seq = await prisma.sequence.create({
        data: { tenantId, name: key, createdById: ids.director, steps: { create: [{ order: 1, channel: 'email', delayDays: 0 }] } },
      });
      ids[key] = seq.id;
    }
  });
});

describe('the per-sequence drill-down', () => {
  it('counts real sends, replies and bounces from the messages, not from activity metadata', async () => {
    const result = await inTenant(async () => {
      const a = await lead(ids.report);
      const b = await lead(ids.report);
      await enroll(a, ids.seqA);
      await enroll(b, ids.seqA, 'completed');
      await message({ leadId: a, sequenceId: ids.seqA, sentAt: hoursAgo(30), repliedAt: hoursAgo(10) });
      await message({ leadId: b, sequenceId: ids.seqA, sentAt: hoursAgo(30), bouncedAt: hoursAgo(29) });
      await message({ leadId: a, sequenceId: ids.seqA, sentAt: hoursAgo(2), dryRun: true }); // never left the building
      await message({ leadId: a, sequenceId: ids.seqA, sentAt: null }); // queued
      await message({ leadId: b, sequenceId: ids.seqA, step: 4, sentAt: hoursAgo(5) }); // step since removed
      return getSequenceAnalytics(ids.seqA, tenantId);
    });

    expect(result).toMatchObject({
      totalEnrolled: 2,
      activeEnrolled: 1,
      completedCount: 1,
      totalSends: 3,
      uniqueReplies: 1,
      bounceCount: 1,
    });
    expect(result?.stepBreakdown).toEqual([
      { step: 1, channel: 'email', sent: 2, replies: 1 },
      { step: null, channel: 'email', sent: 1, replies: 0 },
    ]);
    expect(result?.sendsByDay).toHaveLength(30);
    expect(result?.sendsByDay.reduce((sum, day) => sum + day.count, 0)).toBe(3);
  });

  it('reports a rate of nothing as null, not 0%', async () => {
    const result = await inTenant(() => getSequenceAnalytics(ids.seqB, tenantId));
    expect(result).toMatchObject({ totalSends: 0, replyRate: null, bounceRate: null });
  });

  it('does not open another tenant\'s sequence', async () => {
    const other = `t-seqanalytics-other-${randomUUID()}`;
    await createTestTenant(other, 'Other');
    authUser.current = { ...session(ids.director, 'director'), tenantId: other } as SessionUser;
    const res = await inTenant(
      () => drillDown(new NextRequest(`http://localhost/api/sequences/${ids.seqA}/analytics`), { params: Promise.resolve({ id: ids.seqA }) }),
      other
    );
    expect(res.status).toBe(404);
  });
});

describe('the overview and team numbers', () => {
  async function seedTwoTeams() {
    await inTenant(async () => {
      const mine = await lead(ids.report);
      const theirs = await lead(ids.outsider);
      const archived = await lead(ids.report, { archivedAt: new Date() });
      // One lead in two sequences: two running cadences.
      await enroll(mine, ids.seqA);
      await enroll(mine, ids.seqB);
      await enroll(theirs, ids.seqB);
      await enroll(archived, ids.seqA);
      // 18:00 UTC = 01:00 on 5 Oct local: today. 16:00 UTC = 23:00 on 4 Oct local: not today.
      await message({ leadId: mine, sequenceId: ids.seqA, sentAt: hoursAgo(2), repliedAt: hoursAgo(1) });
      await message({ leadId: mine, sequenceId: ids.seqB, sentAt: hoursAgo(4) });
      await message({ leadId: theirs, sequenceId: ids.seqB, sentAt: hoursAgo(2), bouncedAt: hoursAgo(2) });
      await message({ leadId: archived, sequenceId: ids.seqA, sentAt: hoursAgo(2) });
      await message({ leadId: mine, sequenceId: null, sentAt: hoursAgo(2) }); // a one-off, not a sequence send
      await message({ leadId: theirs, sequenceId: ids.seqB, sentAt: hoursAgo(2), dryRun: true }); // demo send
    });
  }

  it('gives a director every non-archived lead, counting each running cadence', async () => {
    await seedTwoTeams();
    const stats = await inTenant(() => getScopedSequenceStats(session(ids.director, 'director'), NOW));
    expect(stats).toMatchObject({
      totalLeads: 2,
      activeEnrollments: 3,
      todaySends: 2,
      weekSends: 3,
      todayReplies: 1,
      totalBounces: 1,
    });
    expect(stats.sequences.map((s) => [s.name, s.activeLeads])).toEqual([
      ['seqB', 2],
      ['seqA', 1],
    ]);
  });

  it('gives a team lead their pod only — sends, replies and enrollments on the same axis', async () => {
    await seedTwoTeams();
    const stats = await inTenant(() => getScopedSequenceStats(session(ids.teamLead, 'team_lead'), NOW));
    expect(stats).toMatchObject({ totalLeads: 1, activeEnrollments: 2, todaySends: 1, weekSends: 2, todayReplies: 1, totalBounces: 0 });
  });

  it('gives a rep only their own leads', async () => {
    await seedTwoTeams();
    const stats = await inTenant(() => getScopedSequenceStats(session(ids.outsider, 'sdr'), NOW));
    expect(stats).toMatchObject({ totalLeads: 1, activeEnrollments: 1, todaySends: 1, todayReplies: 0, totalBounces: 1 });
    expect(stats.sequences.map((s) => s.name)).toEqual(['seqB']);
  });
});
