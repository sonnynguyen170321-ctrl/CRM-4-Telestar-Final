import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import type { SessionUser } from '@/lib/auth';

/**
 * Per-sequence rules (owner request: Apollo-style sequence settings) and the multi-sequence
 * stops they sit beside.
 *
 * Each rule is pinned where it is enforced, not where it is stored: a weekend rule that the
 * scheduler honours but the send-time check ignores would still hold every Saturday email until
 * Monday. The stop fixes pin the other half of "a lead may run several sequences": every way a
 * lead's outreach ends must end all of its cadences, not the one the lead's pointer names.
 */

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));

const { fakeQueue } = vi.hoisted(() => ({
  fakeQueue: {
    async add(_name: string, _data: unknown, opts: { jobId: string }) {
      return { id: opts.jobId };
    },
    async getJob() {
      return undefined;
    },
  },
}));
vi.mock('@/lib/bullmq/queues', () => ({
  sequenceQueue: () => fakeQueue,
  emailQueue: () => fakeQueue,
  importQueue: () => fakeQueue,
  syncQueue: () => fakeQueue,
  maintenanceQueue: () => fakeQueue,
  agentQueue: () => fakeQueue,
  researchQueue: () => fakeQueue,
}));

const authUser = vi.hoisted(() => ({ current: null as SessionUser | null }));
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  const { NextResponse } = await import('next/server');
  return {
    ...actual,
    requireAuth: async () => authUser.current ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
  };
});

import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { evaluateAutomationEligibility } from '@/lib/automation/eligibility';
import type { AutomationEvaluationContext } from '@/lib/automation/types';
import { computeStepDueDateForLead } from '@/lib/sequences/engine';
import { nextSendAttemptAt } from '@/lib/email/sendWindow';
import { enrollLeadInSequence, SequenceEnrollmentError } from '@/lib/sequences/enrollment';
import { pauseCompanyCadences } from '@/lib/sequences/companyStop';
import { applyReplyClassification } from '@/lib/replies/handling';
import type { ReplyClassification } from '@/lib/replies/types';
import { occupancyKeyFor } from '@/lib/sequences/occupancy';
import { handleExecuteTask } from '@/workers/sequence';
import { PUT as putLead } from '@/app/api/leads/[id]/route';
import { createTestTenant } from './helpers/testTenant';

const FRIDAY = new Date('2026-08-14T10:00:00Z');
const SATURDAY = new Date('2026-08-15T10:00:00Z');

let tenantId: string;
let user: SessionUser;
let campaignId: string;

const inTenant = <T>(fn: () => Promise<T>): Promise<T> => tenantStorage.run({ tenantId, bypassRls: true }, fn);

async function sequence(name: string, rules: Record<string, boolean> = {}) {
  const row = await prisma.sequence.create({ data: { tenantId, name, createdById: user.id, ...rules } });
  await prisma.sequenceStep.create({
    data: { tenantId, sequenceId: row.id, order: 1, channel: 'email', delayDays: 0, instructions: 'Open' },
  });
  await prisma.sequenceStep.create({
    data: { tenantId, sequenceId: row.id, order: 2, channel: 'email', delayDays: 1, instructions: 'Bump' },
  });
  return row.id;
}

async function lead(email: string, extra: Record<string, unknown> = {}) {
  const row = await prisma.lead.create({
    data: {
      tenantId,
      firstName: email.split('@')[0],
      lastName: 'L',
      email,
      company: 'Acme',
      assignedToId: user.id,
      campaignId,
      operatingState: 'ready_for_outreach',
      ...extra,
    },
  });
  return row.id;
}

async function enrollment(leadId: string, sequenceId: string, status: 'active' | 'paused' = 'active') {
  const row = await prisma.sequenceEnrollment.create({
    data: {
      tenantId,
      leadId,
      sequenceId,
      status,
      currentStep: 1,
      occupancyKey: occupancyKeyFor(tenantId, leadId, sequenceId),
    },
  });
  return row.id;
}

beforeEach(async () => {
  authUser.current = null;
  tenantId = `t-seqrules-${randomUUID()}`;
  await createTestTenant(tenantId, 'Sequence rules');
  await inTenant(async () => {
    const row = await prisma.user.create({
      data: {
        tenantId,
        email: `sdr.${randomUUID()}@t.test`,
        firstName: 'Judy',
        lastName: 'N',
        password: '$2a$10$abcdefghijklmnopqrstuu',
        role: 'sdr',
      },
    });
    user = { id: row.id, email: row.email, firstName: 'Judy', lastName: 'N', role: 'sdr', tenantId } as SessionUser;
    const client = await prisma.client.create({
      data: { tenantId, name: 'C', industry: 'SaaS', contactName: 'c', contactEmail: `c.${randomUUID()}@t.test` },
    });
    campaignId = (
      await prisma.campaign.create({ data: { tenantId, clientId: client.id, name: 'Out', startDate: new Date(), status: 'active' } })
    ).id;
  });
});

describe('send step 1 immediately', () => {
  // Monday 2026-10-05 20:00 UTC: after a 09:00–17:00 window in the lead's (UTC) timezone.
  const EVENING = new Date('2026-10-05T20:00:00Z');
  const step1 = { id: 'step-1', order: 1, channel: 'email', autoComplete: true, delayDays: 0, delayHours: 0, sendWindowStartMinutes: 540, sendWindowEndMinutes: 1020 };

  it('schedules step 1 at enrollment when the sequence asks for it, and at the next window otherwise', async () => {
    await inTenant(async () => {
      const leadId = await lead(`ann.${randomUUID()}@acme.test`, { timezone: 'UTC' });
      const windowed = await sequence('Windowed');
      const immediate = await sequence('Immediate', { sendFirstStepImmediately: true });

      const enrolling = { onEnrollment: true };
      expect((await computeStepDueDateForLead(leadId, immediate, step1 as any, EVENING, enrolling)).toISOString()).toBe(EVENING.toISOString());
      const next = await computeStepDueDateForLead(leadId, windowed, step1 as any, EVENING, enrolling);
      expect(next.toISOString() >= '2026-10-06T09:00:00.000Z').toBe(true);
      // A resume or a repair is not an enrollment: the window applies.
      const resumed = await computeStepDueDateForLead(leadId, immediate, step1 as any, EVENING);
      expect(resumed.toISOString() >= '2026-10-06T09:00:00.000Z').toBe(true);
    });
  });

  it('makes a real enrollment due at once outside the window, and only with the switch on', async () => {
    const { enrollLeadInSequence } = await import('@/lib/sequences/enrollment');
    // A one-hour window that does not contain the current UTC time.
    const nowMinutes = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
    const [start, end] = nowMinutes < 720 ? [1200, 1260] : [300, 360];

    const dueFor = async (sendFirstStepImmediately: boolean) =>
      inTenant(async () => {
        const seq = await prisma.sequence.create({ data: { tenantId, name: `W ${randomUUID()}`, createdById: user.id, sendFirstStepImmediately } });
        await prisma.sequenceStep.create({
          data: { tenantId, sequenceId: seq.id, order: 1, channel: 'email', delayDays: 0, delayHours: 0, autoComplete: true, sendWindowStartMinutes: start, sendWindowEndMinutes: end },
        });
        const leadId = await lead(`e.${randomUUID()}@acme.test`, { timezone: 'UTC' });
        await enrollLeadInSequence(user, { leadId, sequenceId: seq.id });
        const task = await prisma.task.findFirstOrThrow({ where: { leadId, sequenceId: seq.id } });
        return task.dueDate.getTime() - task.createdAt.getTime();
      });

    expect(Math.abs(await dueFor(true))).toBeLessThan(60_000);
    expect(await dueFor(false)).toBeGreaterThan(60 * 60_000);
  });

  it('is saved by the sequence update and read back', async () => {
    const { PUT: putSequence } = await import('@/app/api/sequences/[id]/route');
    const id = await inTenant(() => sequence('Toggle'));
    authUser.current = user;
    const res = await putSequence(
      new NextRequest(`http://localhost/api/sequences/${id}`, { method: 'PUT', body: JSON.stringify({ sendFirstStepImmediately: true }), headers: { 'content-type': 'application/json' } }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(200);
    expect((await inTenant(() => prisma.sequence.findUniqueOrThrow({ where: { id } }))).sendFirstStepImmediately).toBe(true);
  });
});

describe('send on weekends', () => {
  const step = { id: 'step-2', order: 2, delayDays: 1, delayHours: 0, sendWindowStartMinutes: null, sendWindowEndMinutes: null };

  it('schedules a one-day step from Friday on Monday by default, and on Saturday when the sequence allows weekends', async () => {
    await inTenant(async () => {
      const leadId = await lead(`ann.${randomUUID()}@acme.test`, { timezone: 'UTC' });
      const weekdays = await sequence('Weekdays');
      const everyDay = await sequence('Every day', { sendOnWeekends: true });

      const due = (sequenceId: string) => computeStepDueDateForLead(leadId, sequenceId, step as any, FRIDAY);

      expect((await due(weekdays)).getUTCDay()).toBe(1);
      expect((await due(everyDay)).getUTCDay()).toBe(6);
    });
  });

  it('keeps a full mailbox\'s retry on Saturday for a sequence that sends on weekends', () => {
    const retry = (businessDayPolicy?: 'skip_weekends' | 'none') =>
      nextSendAttemptAt({ now: SATURDAY, minHours: 1, timezone: 'UTC', seed: 'msg-1', businessDayPolicy });

    expect(retry().getUTCDay()).toBe(1);
    expect(retry('none').getUTCDay()).toBe(6);
  });

  it('lets a due step send on Saturday at send time only when its sequence allows weekends', () => {
    const ctx = (sendOnWeekends: boolean): AutomationEvaluationContext => ({
      tenantId: 't',
      now: SATURDAY,
      enrollment: { id: 'e', status: 'active', currentStep: 1 },
      lead: {
        id: 'l',
        email: 'p@acme.com',
        emailInvalid: false,
        stage: 'sequence_active',
        sequenceId: 's',
        sequenceStep: 1,
        sequenceStatus: 'active',
        assignedToId: 'u',
        campaignId: 'c',
        archivedAt: null,
        timezone: 'UTC',
      },
      user: { id: 'u', isActive: true, timezone: 'UTC' },
      campaign: { id: 'c', status: 'active' },
      sequence: { id: 's', isActive: true, isArchived: false, sendOnWeekends },
      step: {
        id: 'st',
        order: 1,
        channel: 'email',
        autoComplete: true,
        templateId: 'tp',
        sendWindowStartMinutes: null,
        sendWindowEndMinutes: null,
        delayDays: 0,
        delayHours: 0,
      },
      template: { id: 'tp', subject: 'Hi', body: 'Hi' },
      account: {
        id: 'a',
        isActive: true,
        sendPausedAt: null,
        sendPauseReason: null,
        healthLevel: 'good',
        dailyCap: 100,
        dailySendCount: 0,
      },
      isSuppressed: false,
    } as AutomationEvaluationContext);

    expect(evaluateAutomationEligibility(ctx(false)).decision).toBe('DEFER');
    expect(evaluateAutomationEligibility(ctx(true)).decision).toBe('ALLOW');
  });
});

describe('only leads not in another sequence', () => {
  it('refuses to add a lead running another sequence, names that sequence, and leaves it running', async () => {
    await inTenant(async () => {
      const leadId = await lead(`ann.${randomUUID()}@acme.test`);
      const open = await sequence('Email - Judy');
      const exclusive = await sequence('Founders only', { excludeLeadsInOtherSequences: true });
      await enrollLeadInSequence(user, { leadId, sequenceId: open });

      const attempt = enrollLeadInSequence(user, { leadId, sequenceId: exclusive, mode: 'add' });

      await expect(attempt).rejects.toBeInstanceOf(SequenceEnrollmentError);
      await expect(attempt).rejects.toMatchObject({ code: 'lead_in_other_sequence' });
      await expect(attempt).rejects.toThrow(/Email - Judy/);
      const running = await prisma.sequenceEnrollment.findMany({ where: { tenantId, leadId, status: 'active' } });
      expect(running.map((row) => row.sequenceId)).toEqual([open]);
    });
  }, 60_000);

  it('still lets a person switch the lead into it, which leaves the lead in that sequence alone', async () => {
    await inTenant(async () => {
      const leadId = await lead(`ann.${randomUUID()}@acme.test`);
      const open = await sequence('Email - Judy');
      const exclusive = await sequence('Founders only', { excludeLeadsInOtherSequences: true });
      await enrollLeadInSequence(user, { leadId, sequenceId: open });

      await enrollLeadInSequence(user, { leadId, sequenceId: exclusive });

      const running = await prisma.sequenceEnrollment.findMany({ where: { tenantId, leadId, status: { in: ['active', 'paused'] } } });
      expect(running.map((row) => row.sequenceId)).toEqual([exclusive]);
    });
  }, 60_000);

  it('belongs to the sequence that set it — another sequence may still be added beside it', async () => {
    await inTenant(async () => {
      const leadId = await lead(`ann.${randomUUID()}@acme.test`);
      const open = await sequence('Email - Judy');
      const exclusive = await sequence('Founders only', { excludeLeadsInOtherSequences: true });
      await enrollLeadInSequence(user, { leadId, sequenceId: exclusive });

      await enrollLeadInSequence(user, { leadId, sequenceId: open, mode: 'add' });

      const running = await prisma.sequenceEnrollment.count({ where: { tenantId, leadId, status: 'active' } });
      expect(running).toBe(2);
    });
  }, 60_000);
});

describe('stop when someone at the company replies', () => {
  it('pauses colleagues on the same account or company domain, only in sequences with the rule', async () => {
    await inTenant(async () => {
      const account = await prisma.account.create({ data: { tenantId, name: 'Acme' } });
      const ruled = await sequence('Acme ABM', { stopOnCompanyReply: true });
      const plain = await sequence('Generic');

      const replier = await lead(`ann.${randomUUID()}@acme.test`, { accountId: account.id });
      const sameAccount = await lead(`bob.${randomUUID()}@acme-group.test`, { accountId: account.id });
      const sameDomain = await lead(`cat.${randomUUID()}@acme.test`);
      const otherCompany = await lead(`dan.${randomUUID()}@globex.test`);
      for (const id of [replier, sameAccount, sameDomain, otherCompany]) await enrollment(id, ruled);
      // The replier runs the plain sequence too: its rule is off, so the colleague there keeps going.
      await enrollment(replier, plain);
      const plainColleague = await enrollment(sameAccount, plain);

      const result = await pauseCompanyCadences({ tenantId, leadId: replier, actorUserId: user.id });

      expect(result.leadIds.sort()).toEqual([sameAccount, sameDomain].sort());
      const rows = await prisma.sequenceEnrollment.findMany({ where: { tenantId, sequenceId: ruled } });
      const statusOf = (leadId: string) => rows.find((row) => row.leadId === leadId)?.status;
      expect(statusOf(sameAccount)).toBe('paused');
      expect(statusOf(sameDomain)).toBe('paused');
      expect(statusOf(otherCompany)).toBe('active');
      expect(rows.find((row) => row.leadId === sameAccount)?.pausedReason).toBe('company_reply');
      // The replier's own cadence is handled by reply handling, not by this rule.
      expect(statusOf(replier)).toBe('active');
      const plainRow = await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: plainColleague } });
      expect(plainRow.status).toBe('active');
    });
  });

  it('runs on a real reply but not on an out-of-office', async () => {
    await inTenant(async () => {
      const ruled = await sequence('Acme ABM', { stopOnCompanyReply: true });
      const replier = await lead(`ann.${randomUUID()}@acme.test`);
      const colleague = await lead(`bob.${randomUUID()}@acme.test`);
      const replierEnrollment = await enrollment(replier, ruled);
      const colleagueEnrollment = await enrollment(colleague, ruled);
      const reply = (classification: ReplyClassification) =>
        applyReplyClassification({
          leadId: replier,
          tenantId,
          enrollment: { id: replierEnrollment, sequenceId: ruled },
          eventId: `evt-${randomUUID()}`,
          actorUserId: user.id,
          classification,
          leadName: 'Ann L',
        });
      const colleagueStatus = async () =>
        (await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: colleagueEnrollment } })).status;

      await reply({ replyClass: 'B', kind: 'out_of_office', confidence: 1, source: 'deterministic', rationale: 'Away' });
      expect(await colleagueStatus()).toBe('active');

      const outcome = await reply({ replyClass: 'C', kind: 'interest', confidence: 0.9, source: 'ai', rationale: 'Interested' });
      expect(outcome.companyPaused).toBe(1);
      expect(await colleagueStatus()).toBe('paused');
    });
  }, 60_000);

  it('pauses colleagues even when the replier was never in the ruled sequence — the company answered', async () => {
    await inTenant(async () => {
      const ruled = await sequence('Acme ABM', { stopOnCompanyReply: true });
      const replier = await lead(`ann.${randomUUID()}@acme.test`); // replied to a one-off email
      const colleague = await lead(`bob.${randomUUID()}@acme.test`);
      const colleagueEnrollment = await enrollment(colleague, ruled);

      await pauseCompanyCadences({ tenantId, leadId: replier, actorUserId: user.id });

      expect((await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: colleagueEnrollment } })).status).toBe('paused');
    });
  });

  it('never reaches a lead in another tenant with the same company domain', async () => {
    const otherTenant = `t-seqrules-other-${randomUUID()}`;
    await createTestTenant(otherTenant, 'Other');
    const foreign = await tenantStorage.run({ tenantId: otherTenant, bypassRls: true }, async () => {
      const owner = await prisma.user.create({
        data: { tenantId: otherTenant, email: `o.${randomUUID()}@t.test`, firstName: 'O', lastName: 'U', password: 'x', role: 'sdr' },
      });
      const client = await prisma.client.create({
        data: { tenantId: otherTenant, name: 'C', industry: 'SaaS', contactName: 'c', contactEmail: `c.${randomUUID()}@t.test` },
      });
      const camp = await prisma.campaign.create({ data: { tenantId: otherTenant, clientId: client.id, name: 'Out', startDate: new Date() } });
      const seq = await prisma.sequence.create({ data: { tenantId: otherTenant, name: 'Their ABM', createdById: owner.id, stopOnCompanyReply: true } });
      const foreignLead = await prisma.lead.create({
        data: { tenantId: otherTenant, firstName: 'F', lastName: 'L', email: `fay.${randomUUID()}@acme.test`, company: 'Acme', assignedToId: owner.id, campaignId: camp.id },
      });
      return prisma.sequenceEnrollment.create({
        data: { tenantId: otherTenant, leadId: foreignLead.id, sequenceId: seq.id, status: 'active', currentStep: 1, occupancyKey: occupancyKeyFor(otherTenant, foreignLead.id, seq.id) },
      });
    });

    await inTenant(async () => {
      const replier = await lead(`ann.${randomUUID()}@acme.test`);
      await pauseCompanyCadences({ tenantId, leadId: replier, actorUserId: user.id });
    });

    const after = await tenantStorage.run({ tenantId: otherTenant, bypassRls: true }, () =>
      prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: foreign.id } })
    );
    expect(after.status).toBe('active');
  });

  it('a failure in the company stop does not fail the reply it follows', async () => {
    await inTenant(async () => {
      const ruled = await sequence('Acme ABM', { stopOnCompanyReply: true });
      const replier = await lead(`ann.${randomUUID()}@acme.test`);
      const replierEnrollment = await enrollment(replier, ruled);
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      // Fail only the company stop's query; the reply's own stop runs normally.
      const findMany = prisma.sequenceEnrollment.findMany.bind(prisma.sequenceEnrollment);
      const broken = vi
        .spyOn(prisma.sequenceEnrollment, 'findMany')
        .mockImplementation(((args: any) =>
          args?.where?.sequence?.stopOnCompanyReply ? Promise.reject(new Error('db blip')) : findMany(args)) as any);
      try {
        const outcome = await applyReplyClassification({
          leadId: replier,
          tenantId,
          enrollment: { id: replierEnrollment, sequenceId: ruled },
          eventId: `evt-${randomUUID()}`,
          actorUserId: user.id,
          classification: { replyClass: 'A', kind: 'rejection', confidence: 1, source: 'deterministic', rationale: 'No' },
          leadName: 'Ann L',
        });
        expect(outcome.cadence).toBe('stopped');
        expect(outcome.companyPaused).toBe(0);
        expect(errors).toHaveBeenCalledWith('[companyStop] could not pause colleagues after a reply', expect.anything());
      } finally {
        broken.mockRestore();
        errors.mockRestore();
      }
    });
  }, 60_000);

  it('never treats a public mailbox host as a company', async () => {
    await inTenant(async () => {
      const ruled = await sequence('Acme ABM', { stopOnCompanyReply: true });
      const replier = await lead(`ann.${randomUUID()}@gmail.com`);
      const stranger = await lead(`zed.${randomUUID()}@gmail.com`);
      await enrollment(replier, ruled);
      const strangerEnrollment = await enrollment(stranger, ruled);

      const result = await pauseCompanyCadences({ tenantId, leadId: replier, actorUserId: user.id });

      expect(result.paused).toBe(0);
      expect((await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: strangerEnrollment } })).status).toBe('active');
    });
  });
});

describe('every way a lead stops ends all of its cadences', () => {
  const putStage = (leadId: string, stage: string) =>
    putLead(
      new NextRequest(`http://localhost/api/leads/${leadId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stage }),
      }),
      { params: Promise.resolve({ id: leadId }) }
    );

  it('marking a lead won ends its cadences even when its sequence pointer is empty', async () => {
    authUser.current = user;
    await inTenant(async () => {
      const leadId = await lead(`ann.${randomUUID()}@acme.test`);
      const a = await sequence('Email');
      await enrollment(leadId, a);
      await prisma.lead.update({ where: { id: leadId }, data: { sequenceId: null, sequenceStatus: null } });

      const res = await putStage(leadId, 'won');

      expect(res.status).toBe(200);
      expect(await prisma.sequenceEnrollment.count({ where: { tenantId, leadId, status: { in: ['active', 'paused'] } } })).toBe(0);
    });
  }, 60_000);

  it('marking a lead replied by hand pauses its colleagues in a sequence with the company rule', async () => {
    authUser.current = user;
    await inTenant(async () => {
      const ruled = await sequence('Acme ABM', { stopOnCompanyReply: true });
      const replier = await lead(`ann.${randomUUID()}@acme.test`);
      const colleague = await lead(`bob.${randomUUID()}@acme.test`);
      const colleagueEnrollment = await enrollment(colleague, ruled);

      const res = await putStage(replier, 'replied');

      expect(res.status).toBe(200);
      expect((await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: colleagueEnrollment } })).status).toBe('paused');
    });
  }, 60_000);

  it('marking a lead won ends every running cadence, not only the one its pointer names', async () => {
    authUser.current = user;
    await inTenant(async () => {
      const leadId = await lead(`ann.${randomUUID()}@acme.test`);
      const a = await sequence('Email');
      const b = await sequence('LinkedIn');
      await enrollLeadInSequence(user, { leadId, sequenceId: a });
      await enrollLeadInSequence(user, { leadId, sequenceId: b, mode: 'add' });

      const res = await putStage(leadId, 'won');

      expect(res.status).toBe(200);
      const open = await prisma.sequenceEnrollment.count({ where: { tenantId, leadId, status: { in: ['active', 'paused'] } } });
      expect(open).toBe(0);
    });
  }, 60_000);

  it('marking a lead replied pauses its other cadences even when the pointer cadence is already paused', async () => {
    authUser.current = user;
    await inTenant(async () => {
      const leadId = await lead(`ann.${randomUUID()}@acme.test`);
      const a = await sequence('Email');
      const b = await sequence('LinkedIn');
      await enrollLeadInSequence(user, { leadId, sequenceId: a });
      await enrollLeadInSequence(user, { leadId, sequenceId: b, mode: 'add' });
      // The pointer (b, most recent) was paused by hand; a is still running.
      await prisma.sequenceEnrollment.updateMany({ where: { tenantId, leadId, sequenceId: b }, data: { status: 'paused', pausedReason: 'manual' } });
      await prisma.lead.update({ where: { id: leadId }, data: { sequenceId: b, sequenceStatus: 'paused' } });

      const res = await putStage(leadId, 'replied');

      expect(res.status).toBe(200);
      const running = await prisma.sequenceEnrollment.count({ where: { tenantId, leadId, status: 'active' } });
      expect(running).toBe(0);
    });
  }, 60_000);
});

describe('the send-time check reads the task\'s own sequence', () => {
  it('holds a step from an inactive sequence even when the lead\'s pointer names an active one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-12T10:00:00Z')); // a Wednesday
    try {
      await inTenant(async () => {
        const leadId = await lead(`ann.${randomUUID()}@acme.test`, { timezone: 'UTC' });
        const stopped = await sequence('Stopped');
        const running = await sequence('Running');
        await prisma.sequence.update({ where: { id: stopped }, data: { isActive: false } });
        const stoppedEnrollment = await enrollment(leadId, stopped);
        await enrollment(leadId, running);
        await prisma.lead.update({ where: { id: leadId }, data: { sequenceId: running, sequenceStep: 1, sequenceStatus: 'active', stage: 'sequence_active' } });
        const task = await prisma.task.create({
          data: {
            tenantId,
            leadId,
            userId: user.id,
            type: 'email',
            title: 'Email 1',
            status: 'pending',
            dueDate: new Date(),
            sequenceId: stopped,
            sequenceStep: 1,
          },
        });

        const result = await handleExecuteTask({ taskId: task.id, expectedEnrollmentId: stoppedEnrollment });

        expect(result).toMatchObject({ status: 'skipped', reason: 'sequence_inactive' });
      });
    } finally {
      vi.useRealTimers();
    }
  }, 60_000);
});
