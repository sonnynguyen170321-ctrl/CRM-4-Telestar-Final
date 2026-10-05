import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import type { SessionUser } from '@/lib/auth';

/**
 * The sequence Performance and Activity tabs (owner request: a sequence dashboard with open, click,
 * bounce and reply rates, and a tab showing who edited the sequence and what the cadence did).
 *
 * Performance pins that every number comes from the row that records the fact: a queued message is
 * not a send, a rate the sequence does not track is `null` rather than 0%, and a step's reply rate
 * is the replies to that step. Activity pins who is named for an edit (the editor, not the
 * sequence's creator) and that a shared sequence does not show a viewer another team's prospects.
 */

const authUser = vi.hoisted(() => ({ current: null as SessionUser | null }));
vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  const { NextResponse } = await import('next/server');
  return {
    ...actual,
    requireAuth: async () => authUser.current ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
  };
});

import { clearVisibleUserCache } from '@/lib/auth';
import { prisma, tenantStorage } from '@/lib/prisma';
import { getSequencePerformance } from '@/lib/sequences/performance';
import { describeEdit, getSequenceActivity } from '@/lib/sequences/activity';
import { GET as getPerformanceRoute } from '@/app/api/sequences/[id]/performance/route';
import { GET as getActivityRoute } from '@/app/api/sequences/[id]/activity/route';
import { PUT as putSequence } from '@/app/api/sequences/[id]/route';
import { PUT as putSenders } from '@/app/api/sequences/[id]/senders/route';
import { createTestTenant } from './helpers/testTenant';

const NOW = new Date('2026-10-04T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

let tenantId: string;
let otherTenantId: string;
const ids = {
  creator: '',
  editor: '',
  director: '',
  teamLead: '',
  report: '',
  outsider: '',
  sequence: '',
  account: '',
  campaign: '',
  reportLead: '',
  outsiderLead: '',
  foreignSequence: '',
};

const inTenant = <T>(fn: () => Promise<T>, t = tenantId) => tenantStorage.run({ tenantId: t, bypassRls: true }, fn);

async function user(role: SessionUser['role'], extra: Record<string, unknown> = {}) {
  const row = await prisma.user.create({
    data: { tenantId, email: `${role}.${randomUUID()}@t.test`, firstName: role, lastName: 'U', password: 'x', role, ...extra },
  });
  return row.id;
}

function session(id: string, role: SessionUser['role']): SessionUser {
  return { id, email: `${id}@t.test`, firstName: 'A', lastName: 'B', role, tenantId } as SessionUser;
}

async function lead(assignedToId: string, firstName: string) {
  const row = await prisma.lead.create({
    data: {
      tenantId,
      firstName,
      lastName: 'L',
      email: `${firstName}.${randomUUID()}@acme.test`,
      company: 'Acme',
      assignedToId,
      campaignId: ids.campaign,
    },
  });
  return row.id;
}

let messageSeq = 0;
async function message(input: {
  leadId: string;
  step: number;
  sentAt: Date | null;
  openedAt?: Date;
  clickedAt?: Date;
  repliedAt?: Date;
  bouncedAt?: Date;
}) {
  messageSeq += 1;
  await prisma.outboundMessage.create({
    data: {
      tenantId,
      leadId: input.leadId,
      accountId: ids.account,
      sequenceId: ids.sequence,
      sequenceStepOrder: input.step,
      to: 'p@acme.test',
      idempotencyKey: `perf-${randomUUID()}-${messageSeq}`,
      status: input.sentAt ? 'sent' : 'pending',
      sentAt: input.sentAt,
      openedAt: input.openedAt ?? null,
      clickedAt: input.clickedAt ?? null,
      repliedAt: input.repliedAt ?? null,
      bouncedAt: input.bouncedAt ?? null,
    },
  });
}

beforeEach(async () => {
  authUser.current = null;
  clearVisibleUserCache();
  tenantId = `t-seqperf-${randomUUID()}`;
  otherTenantId = `t-seqperf-other-${randomUUID()}`;
  await createTestTenant(tenantId, 'Sequence perf');
  await createTestTenant(otherTenantId, 'Sequence perf other');

  await inTenant(async () => {
    ids.creator = await user('sdr');
    ids.editor = await user('sdr');
    ids.director = await user('director');
    ids.teamLead = await user('team_lead');
    ids.report = await user('sdr', { managerId: ids.teamLead });
    ids.outsider = await user('sdr');

    const sequence = await prisma.sequence.create({
      data: {
        tenantId,
        name: 'Email - Judy',
        createdById: ids.creator,
        trackOpens: true,
        trackClicks: false,
        steps: {
          create: [
            { order: 1, channel: 'email', delayDays: 0, delayHours: 0, instructions: 'Intro' },
            { order: 2, channel: 'email', delayDays: 3, delayHours: 0, instructions: 'Bump' },
          ],
        },
      },
    });
    ids.sequence = sequence.id;

    const client = await prisma.client.create({
      data: { tenantId, name: 'C', industry: 'SaaS', contactName: 'c', contactEmail: `c.${randomUUID()}@t.test` },
    });
    ids.campaign = (await prisma.campaign.create({ data: { tenantId, clientId: client.id, name: 'Out', startDate: new Date() } })).id;
    ids.account = (
      await prisma.emailAccount.create({
        data: { tenantId, userId: ids.creator, email: `box.${randomUUID()}@t.test`, provider: 'imap_smtp', isActive: true },
      })
    ).id;
    ids.reportLead = await lead(ids.report, 'Reporty');
    ids.outsiderLead = await lead(ids.outsider, 'Outsidery');
  });

  await inTenant(async () => {
    const foreignUser = await prisma.user.create({
      data: { tenantId: otherTenantId, email: `f.${randomUUID()}@t.test`, firstName: 'F', lastName: 'U', password: 'x', role: 'director' },
    });
    ids.foreignSequence = (
      await prisma.sequence.create({ data: { tenantId: otherTenantId, name: 'Foreign', createdById: foreignUser.id } })
    ).id;
  }, otherTenantId);
});

describe('getSequencePerformance', () => {
  const read = (window: '7d' | '30d' | '90d' | 'all' = '30d') =>
    inTenant(() => getSequencePerformance({ tenantId, sequenceId: ids.sequence, window, now: NOW }));

  it('counts sends the provider accepted, not queued messages, and rates over those sends', async () => {
    await inTenant(async () => {
      await message({ leadId: ids.reportLead, step: 1, sentAt: daysAgo(2), openedAt: daysAgo(1), repliedAt: daysAgo(1) });
      await message({ leadId: ids.outsiderLead, step: 1, sentAt: daysAgo(2), bouncedAt: daysAgo(2) });
      await message({ leadId: ids.reportLead, step: 2, sentAt: daysAgo(1) });
      await message({ leadId: ids.outsiderLead, step: 2, sentAt: daysAgo(1), openedAt: daysAgo(1) });
      await message({ leadId: ids.reportLead, step: 2, sentAt: null }); // queued: not a send
    });

    const perf = await read();

    expect(perf?.totals).toMatchObject({ sent: 4, opened: 2, replied: 1, bounced: 1, openRate: 50, replyRate: 25, bounceRate: 25 });
    expect(perf?.steps.map((s) => [s.order, s.sent, s.replyRate])).toEqual([
      [1, 2, 50],
      [2, 2, 0],
    ]);
  });

  it('reports an untracked rate as null — "off", never 0%', async () => {
    await inTenant(() => message({ leadId: ids.reportLead, step: 1, sentAt: daysAgo(1), clickedAt: daysAgo(1) }));

    const perf = await read();

    expect(perf?.tracking).toEqual({ opens: true, clicks: false });
    expect(perf?.totals.clickRate).toBeNull();
    expect(perf?.totals.openRate).toBe(0);
  });

  it('leaves sends older than the window out of it, and keeps them in "all"', async () => {
    await inTenant(async () => {
      await message({ leadId: ids.reportLead, step: 1, sentAt: daysAgo(3) });
      await message({ leadId: ids.reportLead, step: 1, sentAt: daysAgo(45) });
      await message({ leadId: ids.reportLead, step: 1, sentAt: null }); // queued: in no window, not even "all"
    });

    expect((await read('7d'))?.totals.sent).toBe(1);
    expect((await read('30d'))?.totals.sent).toBe(1);
    expect((await read('all'))?.totals.sent).toBe(2);
  });

  it('reports sends from a removed step in their own row, so the steps add up to the total', async () => {
    await inTenant(async () => {
      await message({ leadId: ids.reportLead, step: 1, sentAt: daysAgo(1), repliedAt: daysAgo(1) });
      await message({ leadId: ids.reportLead, step: 3, sentAt: daysAgo(1), repliedAt: daysAgo(1) }); // step 3 was deleted
    });

    const perf = await read();

    expect(perf?.totals).toMatchObject({ sent: 2, replied: 2 });
    expect(perf?.steps.map((s) => [s.order, s.sent, s.replied])).toEqual([
      [1, 1, 1],
      [2, 0, 0],
      [null, 1, 1],
    ]);
    expect(perf?.steps.reduce((sum, s) => sum + s.sent, 0)).toBe(perf?.totals.sent);
  });

  it('counts enrollments by their own status, so a lead in several sequences counts in each', async () => {
    await inTenant(async () => {
      await prisma.sequenceEnrollment.createMany({
        data: [
          { tenantId, leadId: ids.reportLead, sequenceId: ids.sequence, status: 'active', currentStep: 1, occupancyKey: `${tenantId}:${ids.reportLead}:${ids.sequence}` },
          { tenantId, leadId: ids.outsiderLead, sequenceId: ids.sequence, status: 'completed', currentStep: 2 },
        ],
      });
    });

    expect((await read())?.enrollments).toEqual({ total: 2, active: 1, paused: 0, completed: 1, unenrolled: 0 });
  });

  it('does not read another tenant\'s sequence', async () => {
    authUser.current = session(ids.director, 'director');
    const res = await inTenant(() =>
      getPerformanceRoute(new NextRequest(`http://localhost/api/sequences/${ids.foreignSequence}/performance`), {
        params: Promise.resolve({ id: ids.foreignSequence }),
      })
    );
    expect(res.status).toBe(404);
  });
});

describe('getSequenceActivity', () => {
  async function cadenceEvents() {
    await inTenant(async () => {
      await prisma.activity.createMany({
        data: [
          { tenantId, userId: ids.report, leadId: ids.reportLead, sequenceId: ids.sequence, type: 'sequence_enrolled', description: 'Enrolled' },
          { tenantId, userId: ids.outsider, leadId: ids.outsiderLead, sequenceId: ids.sequence, type: 'sequence_enrolled', description: 'Enrolled' },
        ],
      });
    });
  }
  const leadsSeenBy = async (id: string, role: SessionUser['role']) => {
    const items = await inTenant(() => getSequenceActivity({ user: session(id, role), tenantId, sequenceId: ids.sequence }));
    return (items ?? []).filter((item) => item.kind === 'cadence').map((item) => item.lead?.id).sort();
  };

  it('shows a director every lead the cadence touched', async () => {
    await cadenceEvents();
    expect(await leadsSeenBy(ids.director, 'director')).toEqual([ids.outsiderLead, ids.reportLead].sort());
  });

  it('shows a team lead only their team\'s leads on a sequence shared across teams', async () => {
    await cadenceEvents();
    expect(await leadsSeenBy(ids.teamLead, 'team_lead')).toEqual([ids.reportLead]);
  });

  it('shows a rep only their own leads', async () => {
    await cadenceEvents();
    expect(await leadsSeenBy(ids.outsider, 'sdr')).toEqual([ids.outsiderLead]);
  });

  it('names the person who edited the sequence, not the person who created it', async () => {
    // The creator's own team lead: only the creator or a manager above them may edit a sequence
    // (lib/visibility.ts). A team lead of another pod cannot even see it.
    await inTenant(() => prisma.user.update({ where: { id: ids.creator }, data: { managerId: ids.editor } }));
    clearVisibleUserCache();
    authUser.current = session(ids.editor, 'team_lead');
    const res = await inTenant(() =>
      putSequence(
        new NextRequest(`http://localhost/api/sequences/${ids.sequence}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Email - Judy v2', trackClicks: true }),
        }),
        { params: Promise.resolve({ id: ids.sequence }) }
      )
    );
    expect(res.status).toBe(200);

    const items = await inTenant(() =>
      getSequenceActivity({ user: session(ids.director, 'director'), tenantId, sequenceId: ids.sequence })
    );
    const edits = (items ?? []).filter((item) => item.kind === 'edit');

    expect(edits[0]).toMatchObject({ actor: { id: ids.editor }, summary: 'Changed name, click tracking' });
    expect(edits.some((item) => item.summary === 'Created the sequence' && item.actor?.id === ids.creator)).toBe(true);
    // The extension's own update row would name the creator; it must not appear as an edit.
    expect(edits.filter((item) => item.actor?.id === ids.creator).map((item) => item.summary)).toEqual(['Created the sequence']);
  });

  it('records a sender change against the person who made it, with mailbox ids and no addresses', async () => {
    authUser.current = session(ids.creator, 'sdr');
    const res = await inTenant(() =>
      putSenders(
        new NextRequest(`http://localhost/api/sequences/${ids.sequence}/senders`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ emailAccountIds: [ids.account] }),
        }),
        { params: Promise.resolve({ id: ids.sequence }) }
      )
    );
    expect(res.status).toBe(200);

    const items = await inTenant(() =>
      getSequenceActivity({ user: session(ids.director, 'director'), tenantId, sequenceId: ids.sequence })
    );
    expect(items?.[0]).toMatchObject({ kind: 'edit', actor: { id: ids.creator }, summary: 'Changed the sending mailboxes' });
    const row = await inTenant(() =>
      prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'admin.sequence.senders', recordId: ids.sequence } })
    );
    expect(JSON.stringify(row.changedFields)).not.toContain('@');
  });

  it('answers 404 to a rep who cannot see the sequence at all', async () => {
    await cadenceEvents();
    authUser.current = session(ids.outsider, 'sdr');
    const res = await inTenant(() =>
      getActivityRoute(new Request(`http://localhost/api/sequences/${ids.sequence}/activity`), {
        params: Promise.resolve({ id: ids.sequence }),
      })
    );
    expect(res.status).toBe(404);
  });

  it('scopes the route by the caller, not just the library', async () => {
    await cadenceEvents();
    // Shared with the team, so the rep may open it — and then sees only their own lead on it.
    await inTenant(() => prisma.sequence.update({ where: { id: ids.sequence }, data: { isShared: true } }));
    authUser.current = session(ids.outsider, 'sdr');
    const res = await inTenant(() =>
      getActivityRoute(new Request(`http://localhost/api/sequences/${ids.sequence}/activity`), {
        params: Promise.resolve({ id: ids.sequence }),
      })
    );
    const body = (await res.json()) as { items: Array<{ kind: string; lead?: { id: string } | null }> };
    expect(body.items.filter((item) => item.kind === 'cadence').map((item) => item.lead?.id)).toEqual([ids.outsiderLead]);
  });

  it('returns 404 for another tenant\'s sequence', async () => {
    authUser.current = session(ids.director, 'director');
    const res = await inTenant(() =>
      getActivityRoute(new Request(`http://localhost/api/sequences/${ids.foreignSequence}/activity`), {
        params: Promise.resolve({ id: ids.foreignSequence }),
      })
    );
    expect(res.status).toBe(404);
  });
});

describe('describeEdit', () => {
  it('ignores the actor bookkeeping keys logAdminAudit adds', () => {
    expect(describeEdit('admin.sequence.update', { __actor: 'u1', steps: '3 steps' })).toBe('Changed steps');
    expect(describeEdit('admin.sequence.senders', { senders: [] })).toBe('Changed the sending mailboxes');
  });
});
