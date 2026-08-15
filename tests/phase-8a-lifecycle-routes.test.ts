import { vi, describe, it, expect, beforeEach } from 'vitest';

const sessionUser = { current: null as unknown };

vi.mock('@/auth', () => ({
  auth: vi.fn(),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return {
    ...actual,
    requireAuth: async () => sessionUser.current,
    requireRole: async () => sessionUser.current,
    getSessionUser: async () => sessionUser.current,
  };
});

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';
import { tenantStorage } from '@/lib/tenant-context';
import { occupancyKeyFor } from '@/lib/sequences/occupancy';
import { prepareEnrollment, finalizeFirstStep } from '@/lib/sequences/enrollment';
import { launchAIOutreach, launchEnrollmentId } from '@/lib/prospects/outreach';
import { markProspectAIManaged } from '@/lib/prospects/prospecting';
import { PATCH as patchEnrollmentStatus } from '@/app/api/sequences/[id]/enrollments/[enrollmentId]/status/route';
import { POST as bulkAction } from '@/app/api/sequences/[id]/enrollments/bulk-action/route';
import type { SessionUser } from '@/lib/auth';

/**
 * Sequence lifecycle through the actual routes, plus the ownership boundaries a human
 * replacement can open mid-launch.
 */
/** `nextActionAt` is what an agent scheduling against the wrong occurrence would have written. */
const humanRowNextAction = (row: { nextActionAt: Date | null }) => row.nextActionAt;

describe('Phase 8a — sequence lifecycle routes and occurrence ownership', () => {
  let tenantId: string;
  let leadId: string;
  let sequenceA: string;
  let sequenceB: string;
  let userA: SessionUser;

  const inTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    tenantStorage.run({ tenantId, bypassRls: true }, fn);

  const patch = (sequenceId: string, enrollmentId: string, status: string) =>
    patchEnrollmentStatus(
      new NextRequest('http://localhost/api', { method: 'PATCH', body: JSON.stringify({ status }) }),
      { params: Promise.resolve({ id: sequenceId, enrollmentId }) }
    );

  const bulk = (sequenceId: string, action: string, enrollmentIds: string[]) =>
    bulkAction(
      new NextRequest('http://localhost/api', {
        method: 'POST',
        body: JSON.stringify({ action, enrollmentIds }),
      }),
      { params: Promise.resolve({ id: sequenceId }) }
    );

  const makeSequence = async (name: string) => {
    const seq = await prisma.sequence.create({ data: { tenantId, name, createdById: userA.id } });
    await prisma.sequenceStep.create({
      data: {
        tenantId,
        sequenceId: seq.id,
        order: 1,
        channel: 'email',
        delayDays: 0,
        instructions: 'Opening touch',
      },
    });
    return seq.id;
  };

  const makeWorkOrder = () =>
    prisma.workOrder.create({
      data: {
        tenantId,
        type: 'outreach_launch',
        status: 'active',
        requestKey: `req-${randomUUID()}`,
        leadId,
        createdById: userA.id,
        researchBudget: 10,
        tokenBudget: 1000,
        maxToolCalls: 5,
        maxExecutionDuration: 300,
        activatedAt: new Date(),
      },
    });

  beforeEach(async () => {
    tenantId = `t8lc-${randomUUID()}`;
    await prisma.tenant.create({ data: { id: tenantId, name: 'Lifecycle' } });

    await tenantStorage.run({ tenantId, bypassRls: true }, async () => {
      const user = await prisma.user.create({
        data: {
          id: `u-${randomUUID()}`,
          tenantId,
          email: `sdr.${randomUUID()}@acme.test`,
          firstName: 'SDR',
          lastName: 'User',
          password: '$2a$10$abcdefghijklmnopqrstuu',
          role: 'director',
        },
      });
      userA = {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: 'director',
        tenantId,
      };
      sessionUser.current = userA;

      const client = await prisma.client.create({
        data: {
          id: `c-${randomUUID()}`,
          tenantId,
          name: 'Client',
          industry: 'SaaS',
          contactName: 'Buyer',
          contactEmail: `buyer.${randomUUID()}@acme.test`,
        },
      });
      const campaign = await prisma.campaign.create({
        data: {
          id: `camp-${randomUUID()}`,
          tenantId,
          clientId: client.id,
          name: 'Outbound',
          startDate: new Date(),
        },
      });

      sequenceA = await makeSequence('Seq A');
      sequenceB = await makeSequence('Seq B');

      const lead = await prisma.lead.create({
        data: {
          tenantId,
          firstName: 'Alice',
          lastName: 'Smith',
          email: `alice.${randomUUID()}@acme.test`,
          company: 'Acme',
          assignedToId: user.id,
          campaignId: campaign.id,
          operatingState: 'ready_for_outreach',
          sequenceId: sequenceA,
        },
      });
      leadId = lead.id;
    });
  });

  const terminalEnrollment = async (status: 'completed' | 'unenrolled') =>
    prisma.sequenceEnrollment.create({
      data: {
        tenantId,
        leadId,
        sequenceId: sequenceA,
        status,
        currentStep: 2,
        completedAt: new Date(),
      },
    });

  // =========================================================================
  // Single enrollment status route
  // =========================================================================
  for (const status of ['completed', 'unenrolled'] as const) {
    it(`refuses to pause a ${status} enrollment, leaving the live cadence alone`, async () => {
      await inTenant(async () => {
        const live = await prepareEnrollment(userA, { leadId, sequenceId: sequenceA });
        const historical = await terminalEnrollment(status);

        const res = await patch(sequenceA, historical.id, 'paused');
        expect(res.status).toBe(409);

        // The live cadence was never touched — the old route would have paused it through
        // `pauseSequence` before failing on the historical row.
        const current = await prisma.sequenceEnrollment.findUniqueOrThrow({
          where: { id: live.enrollmentId },
        });
        expect(current.status).toBe('active');
        expect(current.occupancyKey).toBe(occupancyKeyFor(tenantId, leadId));
      });
    }, 60_000);

    it(`refuses to resume a ${status} enrollment`, async () => {
      await inTenant(async () => {
        const historical = await terminalEnrollment(status);
        const res = await patch(sequenceA, historical.id, 'active');
        expect(res.status).toBe(409);
        expect(
          (await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: historical.id } })).status
        ).toBe(status);
      });
    }, 60_000);
  }

  it('pauses an active enrollment and resumes it, preserving the exact occupancy key', async () => {
    await inTenant(async () => {
      const { enrollmentId } = await prepareEnrollment(userA, { leadId, sequenceId: sequenceA });
      const key = occupancyKeyFor(tenantId, leadId);

      expect((await patch(sequenceA, enrollmentId, 'paused')).status).toBe(200);
      const paused = await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
      expect(paused.status).toBe('paused');
      expect(paused.occupancyKey).toBe(key);

      expect((await patch(sequenceA, enrollmentId, 'active')).status).toBe(200);
      const resumed = await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
      expect(resumed.status).toBe('active');
      expect(resumed.occupancyKey).toBe(key);
    });
  }, 60_000);

  it('refuses an enrollment that belongs to a different sequence', async () => {
    await inTenant(async () => {
      const { enrollmentId } = await prepareEnrollment(userA, { leadId, sequenceId: sequenceA });
      const res = await patch(sequenceB, enrollmentId, 'paused');
      expect(res.status).toBe(409);
      expect(
        (await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).status
      ).toBe('active');
    });
  }, 60_000);

  it('leaves the lead cache untouched when a resume finds the row no longer paused', async () => {
    await inTenant(async () => {
      const { enrollmentId } = await prepareEnrollment(userA, { leadId, sequenceId: sequenceA });
      await prisma.sequenceEnrollment.update({
        where: { id: enrollmentId },
        data: { status: 'paused', pausedReason: 'manual' },
      });

      // The row goes terminal between the route's read and its CAS — the window a
      // `update where id` would have written through.
      await prisma.sequenceEnrollment.updateMany({
        where: { id: enrollmentId },
        data: { status: 'unenrolled', completedAt: new Date(), occupancyKey: null },
      });

      const leadBefore = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
      const res = await patch(sequenceA, enrollmentId, 'active');
      expect(res.status).toBe(409);

      const leadAfter = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
      expect(leadAfter.sequenceStatus).toBe(leadBefore.sequenceStatus);
      expect(leadAfter.sequenceId).toBe(leadBefore.sequenceId);
      const row = await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
      expect(row.status).toBe('unenrolled');
      expect(row.occupancyKey).toBeNull();
    });
  }, 60_000);

  // =========================================================================
  // Bulk route
  // =========================================================================
  it('a stale bulk resume cannot resurrect a row that became terminal', async () => {
    await inTenant(async () => {
      const { enrollmentId } = await prepareEnrollment(userA, { leadId, sequenceId: sequenceA });
      await prisma.sequenceEnrollment.update({
        where: { id: enrollmentId },
        data: { status: 'paused', pausedReason: 'manual' },
      });

      // The list is loaded, then the row goes terminal before the action is applied. The route
      // re-claims on `status: 'paused'`, so the update finds nothing.
      await prisma.sequenceEnrollment.update({
        where: { id: enrollmentId },
        data: { status: 'unenrolled', completedAt: new Date(), occupancyKey: null },
      });

      await bulk(sequenceA, 'resume', [enrollmentId]);

      const after = await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
      expect(after.status).toBe('unenrolled');
      expect(after.occupancyKey).toBeNull();
    });
  }, 60_000);

  it('a stale bulk pause cannot pause a replacement cadence', async () => {
    await inTenant(async () => {
      const first = await prepareEnrollment(userA, { leadId, sequenceId: sequenceA });
      // The cadence is replaced after the list was loaded.
      await prisma.sequenceEnrollment.updateMany({
        where: { id: first.enrollmentId },
        data: { status: 'unenrolled', completedAt: new Date(), occupancyKey: null },
      });
      const replacement = await prepareEnrollment(userA, { leadId, sequenceId: sequenceB });

      await bulk(sequenceA, 'pause', [first.enrollmentId]);

      expect(
        (await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: replacement.enrollmentId } }))
          .status
      ).toBe('active');
    });
  }, 60_000);


  it('records the pause reason and transition time on the exact occurrence', async () => {
    await inTenant(async () => {
      const { enrollmentId } = await prepareEnrollment(userA, { leadId, sequenceId: sequenceA });

      expect((await patch(sequenceA, enrollmentId, 'paused')).status).toBe(200);

      const row = await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
      expect(row.status).toBe('paused');
      // The reason used to be lost: the route flipped the row first, then `pauseSequence` looked
      // for active rows to stamp and found none.
      expect(row.pausedReason).toBe('manual');
      expect(row.lastTransitionAt).not.toBeNull();
      expect(row.occupancyKey).toBe(occupancyKeyFor(tenantId, leadId));
    });
  }, 60_000);

  it('records the pause reason through the bulk route too', async () => {
    await inTenant(async () => {
      const { enrollmentId } = await prepareEnrollment(userA, { leadId, sequenceId: sequenceA });

      await bulk(sequenceA, 'pause', [enrollmentId]);

      const row = await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
      expect(row.status).toBe('paused');
      expect(row.pausedReason).toBe('manual');
      expect(row.lastTransitionAt).not.toBeNull();
    });
  }, 60_000);

  it('a stale pause request cannot pause the cadence that replaced it', async () => {
    await inTenant(async () => {
      const first = await prepareEnrollment(userA, { leadId, sequenceId: sequenceA });

      // The prospect is switched to B after the request was formed.
      await prisma.sequenceEnrollment.updateMany({
        where: { id: first.enrollmentId },
        data: { status: 'unenrolled', completedAt: new Date(), occupancyKey: null },
      });
      const replacement = await prepareEnrollment(userA, { leadId, sequenceId: sequenceB });
      await prisma.lead.update({ where: { id: leadId }, data: { sequenceId: sequenceB } });

      const res = await patch(sequenceA, first.enrollmentId, 'paused');
      expect(res.status).toBe(409);

      // B is untouched — the old lead-scoped pause would have paused it.
      const live = await prisma.sequenceEnrollment.findUniqueOrThrow({
        where: { id: replacement.enrollmentId },
      });
      expect(live.status).toBe('active');
      expect(live.pausedReason).toBeNull();
    });
  }, 60_000);

  it('repeated pause/resume reuses the current step task instead of duplicating it', async () => {
    await inTenant(async () => {
      const { enrollmentId } = await prepareEnrollment(userA, { leadId, sequenceId: sequenceA });
      await finalizeFirstStep({ leadId, sequenceId: sequenceA, enrollmentId, currentStep: 1 });

      for (let i = 0; i < 2; i += 1) {
        expect((await patch(sequenceA, enrollmentId, 'paused')).status).toBe(200);
        expect((await patch(sequenceA, enrollmentId, 'active')).status).toBe(200);
      }

      expect(await prisma.task.count({ where: { tenantId, leadId } })).toBe(1);
      const row = await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
      expect(row.status).toBe('active');
      expect(row.pausedReason).toBeNull();
      expect(row.occupancyKey).toBe(occupancyKeyFor(tenantId, leadId));
    });
  }, 60_000);

  it('the state write itself refuses when the designation changed after prepare', async () => {
    await inTenant(async () => {
      const order = await makeWorkOrder();
      const launch = await prisma.sequenceLaunch.create({
        data: { tenantId, leadId, sequenceId: sequenceA, workOrderId: order.id, stage: 'claimed' },
      });
      const enrollmentId = launchEnrollmentId(launch.id);
      await prisma.sequenceEnrollment.create({
        data: {
          id: enrollmentId,
          tenantId,
          leadId,
          sequenceId: sequenceA,
          status: 'active',
          currentStep: 1,
          occupancyKey: occupancyKeyFor(tenantId, leadId),
        },
      });

      // Prepare has happened. The SDR re-designates before the state write.
      await prisma.lead.update({ where: { id: leadId }, data: { sequenceId: sequenceB } });

      // The write is conditional on the designation, so this is the write boundary refusing —
      // not a preceding read.
      await expect(
        markProspectAIManaged({
          leadId,
          tenantId,
          workOrderId: order.id,
          actorUserId: userA.id,
          stateGuard: { sequenceId: sequenceA },
        })
      ).rejects.toThrow();

      expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).operatingState).toBe(
        'ready_for_outreach'
      );
      expect(await prisma.task.count({ where: { tenantId, leadId } })).toBe(0);
      expect(await prisma.jobRun.count({ where: { tenantId } })).toBe(0);
    });
  }, 60_000);

  it('strict scheduling that loses ownership leaves nextTaskDue untouched', async () => {
    await inTenant(async () => {
      const { enrollmentId } = await prepareEnrollment(userA, { leadId, sequenceId: sequenceA });
      await finalizeFirstStep({ leadId, sequenceId: sequenceA, enrollmentId, currentStep: 1 });

      const before = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
      await prisma.sequenceEnrollment.updateMany({
        where: { id: enrollmentId },
        data: { status: 'unenrolled', completedAt: new Date(), occupancyKey: null },
      });

      await expect(
        finalizeFirstStep({
          leadId,
          sequenceId: sequenceA,
          enrollmentId,
          currentStep: 1,
          strictScheduling: true,
        })
      ).rejects.toMatchObject({ code: 'enrollment_not_owner' });

      const after = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
      expect(after.nextTaskDue?.getTime()).toBe(before.nextTaskDue?.getTime());
      expect(await prisma.jobRun.count({ where: { tenantId } })).toBe(0);
    });
  }, 60_000);

  // =========================================================================
  // Occurrence ownership through the launch stages
  // =========================================================================
  const plantLaunch = async () => {
    const order = await makeWorkOrder();
    const launch = await prisma.sequenceLaunch.create({
      data: { tenantId, leadId, sequenceId: sequenceA, workOrderId: order.id, stage: 'claimed' },
    });
    return { order, launch, enrollmentId: launchEnrollmentId(launch.id) };
  };

  const replaceWithHumanCadence = async (aiEnrollmentId: string, sequenceId: string) => {
    await prisma.sequenceEnrollment.updateMany({
      where: { id: aiEnrollmentId },
      data: { status: 'unenrolled', completedAt: new Date(), occupancyKey: null },
    });
    const human = await prepareEnrollment(userA, { leadId, sequenceId });
    await prisma.lead.update({ where: { id: leadId }, data: { sequenceId } });
    return human;
  };

  it('refuses to mark the prospect AI-managed after a human replaced the cadence', async () => {
    await inTenant(async () => {
      const { order, enrollmentId } = await plantLaunch();
      await prisma.sequenceEnrollment.create({
        data: {
          id: enrollmentId,
          tenantId,
          leadId,
          sequenceId: sequenceA,
          status: 'active',
          currentStep: 1,
          occupancyKey: occupancyKeyFor(tenantId, leadId),
        },
      });

      const human = await replaceWithHumanCadence(enrollmentId, sequenceB);

      await expect(
        launchAIOutreach(userA, { leadId, sequenceId: sequenceA, workOrderId: order.id })
      ).rejects.toThrow();

      expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).operatingState).toBe(
        'ready_for_outreach'
      );
      expect(
        await prisma.prospectTransition.count({ where: { tenantId, leadId, kind: 'ai_managed_started' } })
      ).toBe(0);
      const humanRow = await prisma.sequenceEnrollment.findUniqueOrThrow({
        where: { id: human.enrollmentId },
      });
      expect(humanRow.status).toBe('active');
      expect(humanRow.nextActionAt).toBeNull();
    });
  }, 60_000);

  it('refuses to create or schedule the first task once ownership is lost', async () => {
    await inTenant(async () => {
      const { enrollmentId } = await plantLaunch();
      await prisma.sequenceEnrollment.create({
        data: {
          id: enrollmentId,
          tenantId,
          leadId,
          sequenceId: sequenceA,
          status: 'active',
          currentStep: 1,
          occupancyKey: occupancyKeyFor(tenantId, leadId),
        },
      });
      // The AI even got as far as the transition.
      await markProspectAIManaged({
        leadId,
        tenantId,
        workOrderId: (await makeWorkOrder()).id,
        actorUserId: userA.id,
      });

      const human = await replaceWithHumanCadence(enrollmentId, sequenceA);

      await expect(
        finalizeFirstStep({
          leadId,
          sequenceId: sequenceA,
          enrollmentId,
          currentStep: 1,
          strictScheduling: true,
        })
      ).rejects.toMatchObject({ code: 'enrollment_not_owner' });

      // No task at all — the agent refused before creating one — and the human's
      // identically-sequenced cadence was not scheduled by the agent either.
      expect(await prisma.task.count({ where: { tenantId, leadId } })).toBe(0);
      expect(humanRowNextAction(await prisma.sequenceEnrollment.findUniqueOrThrow({
        where: { id: human.enrollmentId },
      }))).toBeNull();
      const humanRow = await prisma.sequenceEnrollment.findUniqueOrThrow({
        where: { id: human.enrollmentId },
      });
      expect(humanRow.status).toBe('active');
    });
  }, 60_000);

  it('refuses to schedule when the enrollment stops being active between the task and the update', async () => {
    await inTenant(async () => {
      const { enrollmentId } = await plantLaunch();
      await prisma.sequenceEnrollment.create({
        data: {
          id: enrollmentId,
          tenantId,
          leadId,
          sequenceId: sequenceA,
          status: 'active',
          currentStep: 1,
          occupancyKey: occupancyKeyFor(tenantId, leadId),
        },
      });

      // Task row exists from an interrupted attempt; ownership is lost before the resume.
      await finalizeFirstStep({ leadId, sequenceId: sequenceA, enrollmentId, currentStep: 1 });
      await prisma.sequenceEnrollment.updateMany({
        where: { id: enrollmentId },
        data: { status: 'unenrolled', completedAt: new Date(), occupancyKey: null },
      });

      await expect(
        finalizeFirstStep({
          leadId,
          sequenceId: sequenceA,
          enrollmentId,
          currentStep: 1,
          strictScheduling: true,
        })
      ).rejects.toMatchObject({ code: 'enrollment_not_owner' });
    });
  }, 60_000);
});
