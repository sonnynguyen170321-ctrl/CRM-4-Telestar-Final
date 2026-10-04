import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));

import { clearVisibleUserCache, type SessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { buildAiConsole } from '@/lib/console/aiConsole';
import { getMyDay } from '@/lib/dashboard/myDay';
import { getTasks } from '@/lib/tasks/service';
import { occupancyKeyFor } from '@/lib/sequences/occupancy';
import { createTestTenant } from './helpers/testTenant';

/**
 * Home's numbers against the rows they describe (Phase 6 dashboard audit).
 *
 * Before: "Replies today" was the count of reply events inside the newest 40 tenant-wide activity
 * rows; every strip count was the length of a list capped at 300; "My Performance" tallied the
 * newest 20 activities of any date; tasks on archived leads stayed in Today and Overdue.
 */

// 20:00 UTC on 4 Oct = 03:00 on 5 Oct in Ho Chi Minh City (UTC+7).
const NOW = new Date('2026-10-04T20:00:00Z');
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

let tenantId: string;
const ids = { director: '', rep: '', peer: '', account: '', campaign: '' };
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
      operatingState: 'ai_managed',
      ...extra,
    },
  });
  return row.id;
}

async function reply(leadId: string, replyClass: string, date: Date) {
  await prisma.inboundMessage.create({
    data: {
      tenantId,
      accountId: ids.account,
      fromEmail: 'p@acme.test',
      to: 'box@t.test',
      providerMessageId: `<${randomUUID()}@in>`,
      date,
      isReply: true,
      leadId,
      replyClass,
    },
  });
}

beforeEach(async () => {
  clearVisibleUserCache();
  tenantId = `t-home-${randomUUID()}`;
  await createTestTenant(tenantId, 'Home numbers');
  await inTenant(async () => {
    const mk = async (role: SessionUser['role']) =>
      (
        await prisma.user.create({
          data: { tenantId, email: `${role}.${randomUUID()}@t.test`, firstName: role, lastName: 'U', password: 'x', role, timezone: 'Asia/Ho_Chi_Minh' },
        })
      ).id;
    ids.director = await mk('director');
    ids.rep = await mk('sdr');
    ids.peer = await mk('sdr');
    const client = await prisma.client.create({
      data: { tenantId, name: 'C', industry: 'SaaS', contactName: 'c', contactEmail: `c.${randomUUID()}@t.test` },
    });
    ids.campaign = (await prisma.campaign.create({ data: { tenantId, clientId: client.id, name: 'Out', startDate: new Date() } })).id;
    ids.account = (
      await prisma.emailAccount.create({
        data: { tenantId, userId: ids.rep, email: `box.${randomUUID()}@t.test`, provider: 'imap_smtp', isActive: true },
      })
    ).id;
  });
});

describe('the command strip', () => {
  it('counts replies from people on the viewer\'s own leads since local midnight', async () => {
    const result = await inTenant(async () => {
      const mine = await lead(ids.rep);
      const theirs = await lead(ids.peer);
      await reply(mine, 'C', hoursAgo(2)); // 01:00 local today
      await reply(mine, 'A', hoursAgo(1)); // an unsubscribe is still a person answering
      await reply(mine, 'B', hoursAgo(1)); // out-of-office: not a reply from a person
      await reply(mine, 'C', hoursAgo(4)); // 23:00 local yesterday
      await reply(theirs, 'C', hoursAgo(1)); // a colleague's prospect
      // A busy morning of other events, which used to push replies out of the 40-row timeline.
      await prisma.activity.createMany({
        data: Array.from({ length: 45 }, () => ({ tenantId, userId: ids.rep, leadId: mine, type: 'email_sent' as const })),
      });
      return buildAiConsole(session(ids.rep, 'sdr'), { now: NOW });
    });
    expect(result.repliesToday).toBe(2);
  });

  it('counts every prospect in a bucket, not the length of the capped list', async () => {
    const result = await inTenant(async () => {
      await prisma.lead.createMany({
        data: Array.from({ length: 305 }, (_, index) => ({
          tenantId,
          firstName: 'Bulk',
          lastName: String(index),
          email: `bulk.${index}.${randomUUID()}@acme.test`,
          company: 'Acme',
          assignedToId: ids.rep,
          campaignId: ids.campaign,
          operatingState: 'ai_managed' as const,
        })),
      });
      return buildAiConsole(session(ids.director, 'director'), { now: NOW });
    });
    const aiManaged = result.buckets.find((bucket) => bucket.key === 'ai_managed');
    expect(aiManaged?.count).toBe(305);
    expect(aiManaged?.prospects.length).toBe(300);
    expect(result.totals.aiManaged).toBe(305);
  });

  it('shows a rep only their own prospects and events, and lets a manager narrow to one rep', async () => {
    const { repView, focused } = await inTenant(async () => {
      const mine = await lead(ids.rep, { operatingState: 'human_attention' });
      const theirs = await lead(ids.peer, { operatingState: 'human_attention' });
      await prisma.activity.create({ data: { tenantId, userId: ids.peer, leadId: theirs, type: 'email_replied', description: 'peer' } });
      await prisma.activity.create({ data: { tenantId, userId: ids.rep, leadId: mine, type: 'email_replied', description: 'mine' } });
      return {
        repView: await buildAiConsole(session(ids.rep, 'sdr'), { now: NOW, focusUserId: ids.peer }),
        focused: await buildAiConsole(session(ids.director, 'director'), { now: NOW, focusUserId: ids.peer }),
      };
    });
    expect(repView.totals.needsAttention).toBe(1);
    expect(repView.timeline.map((event) => event.description)).toEqual(['mine']);
    expect(focused.totals.needsAttention).toBe(1);
    expect(focused.timeline.map((event) => event.description)).toEqual(['peer']);
  });

  it('lists every prospect it counts as having a draft, whatever their latest reply was', async () => {
    const result = await inTenant(async () => {
      const keen = await lead(ids.rep, { operatingState: 'human_managed' });
      await reply(keen, 'C', hoursAgo(30));
      await reply(keen, 'B', hoursAgo(2)); // an out-of-office after the interest
      return buildAiConsole(session(ids.rep, 'sdr'), { now: NOW });
    });
    const drafts = result.buckets.find((bucket) => bucket.key === 'draft_available');
    expect(drafts?.count).toBe(1);
    expect(drafts?.prospects.length).toBe(1);
  });

  it('counts approvals on the viewer\'s leads only', async () => {
    const { repView, directorView } = await inTenant(async () => {
      const mine = await lead(ids.rep);
      const theirs = await lead(ids.peer);
      for (const leadId of [mine, theirs]) {
        await prisma.agentApprovalRequest.create({
          data: {
            tenantId,
            actionKey: `k-${randomUUID()}`,
            capability: 'send_email',
            toolName: 'send',
            args: {},
            requiredLevel: 'manager',
            requestedById: ids.rep,
            expiresAt: new Date(Date.now() + 86_400_000),
            leadId,
          },
        });
      }
      return {
        repView: await buildAiConsole(session(ids.rep, 'sdr'), { now: NOW }),
        directorView: await buildAiConsole(session(ids.director, 'director'), { now: NOW }),
      };
    });
    const pending = (view: typeof repView) => view.buckets.find((bucket) => bucket.key === 'approval_pending')?.count;
    expect(pending(repView)).toBe(1);
    expect(pending(directorView)).toBe(2);
  });

  it('leaves archived prospects out of every count', async () => {
    const result = await inTenant(async () => {
      await lead(ids.rep);
      await lead(ids.rep, { archivedAt: new Date() });
      return buildAiConsole(session(ids.rep, 'sdr'), { now: NOW });
    });
    expect(result.totals.aiManaged).toBe(1);
  });
});

describe('My Performance', () => {
  it('counts today\'s work on every channel the work is logged under, without dry runs', async () => {
    const day = await inTenant(async () => {
      const mine = await lead(ids.rep);
      const today = hoursAgo(2);
      const yesterday = hoursAgo(4);
      const act = (type: string, createdAt: Date, metadata?: object) =>
        prisma.activity.create({ data: { tenantId, userId: ids.rep, leadId: mine, type: type as never, createdAt, ...(metadata ? { metadata } : {}) } });
      await act('call_logged', today);
      await act('call_made', today);
      await act('call_logged', yesterday);
      await act('email_sent', today, { subject: 'Hi' });
      await act('email_sent', today); // logged by hand, no metadata
      await act('email_task_completed', today);
      await act('email_sent', today, { dryRun: true });
      await act('linkedin_sent', today);
      await act('linkedin_touch', today);
      await act('note_added', today);
      return getMyDay(session(ids.rep, 'sdr'), NOW);
    });
    expect(day).toMatchObject({ calls: 2, emails: 3, linkedin: 2 });
  });

  it('counts a lead as in a sequence only while a cadence is running, whatever its stage says', async () => {
    const day = await inTenant(async () => {
      const running = await lead(ids.rep, { stage: 'sequence_active' });
      const finished = await lead(ids.rep, { stage: 'sequence_active' });
      const seq = await prisma.sequence.create({ data: { tenantId, name: 'S', createdById: ids.rep } });
      await prisma.sequenceEnrollment.create({
        data: { tenantId, leadId: running, sequenceId: seq.id, status: 'active', currentStep: 1, occupancyKey: occupancyKeyFor(tenantId, running, seq.id) },
      });
      await prisma.sequenceEnrollment.create({ data: { tenantId, leadId: finished, sequenceId: seq.id, status: 'completed', currentStep: 2 } });
      return getMyDay(session(ids.rep, 'sdr'), NOW);
    });
    expect(day.inSequence).toBe(1);
  });
});

describe('tasks', () => {
  it('leaves tasks on archived leads out of the lists', async () => {
    const titles = await inTenant(async () => {
      const live = await lead(ids.rep);
      const archived = await lead(ids.rep, { archivedAt: new Date() });
      for (const [leadId, title] of [[live, 'live'], [archived, 'archived']] as const) {
        await prisma.task.create({
          data: { tenantId, leadId, userId: ids.rep, type: 'phone', title, status: 'pending', dueDate: new Date(Date.now() - 3 * 86_400_000) },
        });
      }
      const overdue = await getTasks(session(ids.rep, 'sdr'), { tab: 'overdue' });
      return overdue.map((task) => task.title);
    });
    expect(titles).toEqual(['live']);
  });
});
