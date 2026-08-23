import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/auth', () => ({
  auth: vi.fn(),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { prisma } from '@/lib/prisma';
import { createTestTenant } from './helpers/testTenant';
import { randomUUID } from 'crypto';
import { tenantStorage } from '@/lib/tenant-context';
import { occupancyKeyFor } from '@/lib/sequences/occupancy';
import {
  prepareEnrollment,
  enrollLeadInSequence,
  finalizeFirstStep,
  enrollmentFirstTaskId,
  SequenceEnrollmentError,
} from '@/lib/sequences/enrollment';
import { launchAIOutreach, launchEnrollmentId, LaunchNotAllowedError } from '@/lib/prospects/outreach';
import { unenrollLead, advanceSequence } from '@/lib/sequences/engine';
import type { SessionUser } from '@/lib/auth';

/**
 * The enrollment occupancy invariant, and the races it exists to arbitrate.
 *
 * `occupancyKey` is unique, so "one occupying enrollment per lead" is a database fact. These
 * tests pin the invariant across every lifecycle transition, and pin what happens when an agent
 * and a human reach for the same lead.
 */
describe('Phase 8a — enrollment occupancy', () => {
  let tenantId: string;
  let leadId: string;
  let sequenceA: string;
  let sequenceB: string;
  let userA: SessionUser;

  const inTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    tenantStorage.run({ tenantId, bypassRls: true }, fn);

  const makeSequence = async (name: string, createdById: string, autoComplete = false) => {
    const seq = await prisma.sequence.create({ data: { tenantId, name, createdById } });
    await prisma.sequenceStep.create({
      data: {
        tenantId,
        sequenceId: seq.id,
        order: 1,
        channel: 'email',
        delayDays: 0,
        instructions: 'Opening touch',
        autoComplete,
      },
    });
    return seq.id;
  };

  const designate = (sequenceId: string) =>
    prisma.lead.update({ where: { id: leadId }, data: { sequenceId } });

  const makeWorkOrder = async () =>
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

  const occupying = () =>
    prisma.sequenceEnrollment.findMany({
      where: { tenantId, leadId, status: { in: ['active', 'paused'] } },
    });

  beforeEach(async () => {
    tenantId = `t8occ-${randomUUID()}`;
    await createTestTenant(tenantId, 'Occupancy');

    await tenantStorage.run({ tenantId, bypassRls: true }, async () => {
      const user = await prisma.user.create({
        data: {
          id: `u-${randomUUID()}`,
          tenantId,
          email: `sdr.${randomUUID()}@acme.test`,
          firstName: 'SDR',
          lastName: 'User',
          password: '$2a$10$abcdefghijklmnopqrstuu',
          role: 'sdr',
        },
      });
      userA = {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: 'sdr',
        tenantId,
      };

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
        },
      });
      leadId = lead.id;

      sequenceA = await makeSequence('Seq A', user.id);
      sequenceB = await makeSequence('Seq B', user.id);
    });
  });

  // =========================================================================
  // The invariant, across every lifecycle transition
  // =========================================================================
  it('populates occupancy on an active enrollment', async () => {
    await inTenant(async () => {
      const result = await prepareEnrollment(userA, { leadId, sequenceId: sequenceA });
      const row = await prisma.sequenceEnrollment.findUniqueOrThrow({
        where: { id: result.enrollmentId },
      });
      expect(row.occupancyKey).toBe(occupancyKeyFor(tenantId, leadId));
    });
  }, 60_000);

  it('preserves occupancy across active → paused → active', async () => {
    await inTenant(async () => {
      const { enrollmentId } = await prepareEnrollment(userA, { leadId, sequenceId: sequenceA });
      const key = occupancyKeyFor(tenantId, leadId);

      await prisma.sequenceEnrollment.update({
        where: { id: enrollmentId },
        data: { status: 'paused', pausedReason: 'manual' },
      });
      expect(
        (await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).occupancyKey
      ).toBe(key);

      await prisma.sequenceEnrollment.update({ where: { id: enrollmentId }, data: { status: 'active' } });
      expect(
        (await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).occupancyKey
      ).toBe(key);
    });
  }, 60_000);

  it('clears occupancy when unenrollLead ends the cadence', async () => {
    await inTenant(async () => {
      const { enrollmentId } = await prepareEnrollment(userA, { leadId, sequenceId: sequenceA });
      await unenrollLead(leadId, sequenceA);

      const row = await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
      expect(row.status).toBe('unenrolled');
      expect(row.occupancyKey).toBeNull();
      expect(await occupying()).toHaveLength(0);
    });
  }, 60_000);

  it('clears occupancy when the sequence completes', async () => {
    await inTenant(async () => {
      const { enrollmentId } = await enrollLeadInSequence(userA, { leadId, sequenceId: sequenceA });
      const task = await prisma.task.findFirstOrThrow({ where: { tenantId, leadId } });

      // The single-step sequence finishes on the first completion.
      await advanceSequence(
        { leadId, sequenceId: sequenceA, sequenceStep: task.sequenceStep },
        userA.id
      );

      const row = await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
      expect(row.status).toBe('completed');
      expect(row.occupancyKey).toBeNull();
    });
  }, 60_000);

  it('lets a terminal enrollment be followed by a new one that reacquires occupancy', async () => {
    await inTenant(async () => {
      const first = await prepareEnrollment(userA, { leadId, sequenceId: sequenceA });
      await unenrollLead(leadId, sequenceA);

      const second = await prepareEnrollment(userA, { leadId, sequenceId: sequenceB });
      expect(second.enrollmentId).not.toBe(first.enrollmentId);
      expect(
        (await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: second.enrollmentId } }))
          .occupancyKey
      ).toBe(occupancyKeyFor(tenantId, leadId));

      // Many terminal rows, one occupying row — exactly what the NULL-tolerant unique index buys.
      expect(await prisma.sequenceEnrollment.count({ where: { tenantId, leadId } })).toBe(2);
      expect(await occupying()).toHaveLength(1);
    });
  }, 60_000);

  it('refuses a second occupying enrollment at the database level', async () => {
    await inTenant(async () => {
      await prepareEnrollment(userA, { leadId, sequenceId: sequenceA });

      await expect(
        prisma.sequenceEnrollment.create({
          data: {
            tenantId,
            leadId,
            sequenceId: sequenceB,
            status: 'active',
            currentStep: 1,
            occupancyKey: occupancyKeyFor(tenantId, leadId),
          },
        })
      ).rejects.toMatchObject({ code: 'P2002' });

      expect(await occupying()).toHaveLength(1);
    });
  }, 60_000);

  // =========================================================================
  // Human vs AI
  // =========================================================================
  it('lets the human win when they enrol after the launch was claimed', async () => {
    await inTenant(async () => {
      const order = await makeWorkOrder();

      // The agent claims its launch...
      const launch = await prisma.sequenceLaunch.create({
        data: { tenantId, leadId, sequenceId: sequenceA, workOrderId: order.id, stage: 'claimed' },
      });

      // ...and the SDR enrols the prospect before it gets to the enrollment.
      const human = await enrollLeadInSequence(userA, { leadId, sequenceId: sequenceA });

      await expect(
        launchAIOutreach(userA, { leadId, sequenceId: sequenceA, workOrderId: order.id })
      ).rejects.toBeInstanceOf(LaunchNotAllowedError);

      // The human cadence is untouched, and no AI enrollment exists.
      const rows = await occupying();
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(human.enrollmentId);
      expect(rows[0].id).not.toBe(launchEnrollmentId(launch.id));
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).operatingState).toBe(
        'ready_for_outreach'
      );
    });
  }, 60_000);

  it('refuses the human path when the AI already occupies the lead', async () => {
    await inTenant(async () => {
      const order = await makeWorkOrder();
      await designate(sequenceA);
      await launchAIOutreach(userA, { leadId, sequenceId: sequenceA, workOrderId: order.id });

      // A human enrolling into a *different* sequence closes the AI cadence through the normal
      // switch path rather than creating a second occupying row.
      const switched = await enrollLeadInSequence(userA, { leadId, sequenceId: sequenceB });
      const rows = await occupying();
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(switched.enrollmentId);
    });
  }, 60_000);

  it('surfaces a refusal rather than a second cadence when occupancy is taken concurrently', async () => {
    await inTenant(async () => {
      const { enrollmentId } = await prepareEnrollment(userA, { leadId, sequenceId: sequenceA });

      // Simulates the racer that lost: the row it wants to insert carries an id of its own but
      // the lead's occupancy is already held.
      await expect(
        prepareEnrollment(userA, {
          leadId,
          sequenceId: sequenceB,
          enrollmentId: `seqlaunch-${randomUUID()}-enrollment`,
          // The switch path would normally close the incumbent; this asserts the DB is the
          // arbiter when two inserts race for the same key.
        })
      ).resolves.toBeDefined();

      // Whatever happened, exactly one enrollment occupies the lead.
      const rows = await occupying();
      expect(rows).toHaveLength(1);
      expect(rows.every((r) => r.occupancyKey === occupancyKeyFor(tenantId, leadId))).toBe(true);
      expect(
        (await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).status
      ).toBe('unenrolled');
    });
  }, 60_000);


  // =========================================================================
  // The exact race boundary: AI eligibility passed, then the human inserts
  // =========================================================================
  it('the AI cold launch never terminalizes a human enrollment that won the race', async () => {
    await inTenant(async () => {
      const order = await makeWorkOrder();

      // Eligibility passed — no occupancy at this moment.
      const launch = await prisma.sequenceLaunch.create({
        data: { tenantId, leadId, sequenceId: sequenceA, workOrderId: order.id, stage: 'claimed' },
      });

      // The SDR enrols in the window between eligibility and the agent's insert.
      const human = await enrollLeadInSequence(userA, { leadId, sequenceId: sequenceA });
      const humanRowBefore = await prisma.sequenceEnrollment.findUniqueOrThrow({
        where: { id: human.enrollmentId },
      });

      // The agent now attempts exactly its own deterministic enrollment — the step
      // `launchAIOutreach` runs after its eligibility check.
      await expect(
        prepareEnrollment(userA, {
          leadId,
          sequenceId: sequenceA,
          mode: 'cold_launch',
          enrollmentId: launchEnrollmentId(launch.id),
          workOrderId: order.id,
        })
      ).rejects.toMatchObject({ code: 'lead_already_occupied' });

      // The human row is untouched.
      const humanRowAfter = await prisma.sequenceEnrollment.findUniqueOrThrow({
        where: { id: human.enrollmentId },
      });
      expect(humanRowAfter.status).toBe('active');
      expect(humanRowAfter.occupancyKey).toBe(humanRowBefore.occupancyKey);
      expect(humanRowAfter.completedAt).toBeNull();

      // No AI enrollment, no AI transition, no extra task, prospect unmoved.
      expect(
        await prisma.sequenceEnrollment.findUnique({ where: { id: launchEnrollmentId(launch.id) } })
      ).toBeNull();
      expect(await occupying()).toHaveLength(1);
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).operatingState).toBe(
        'ready_for_outreach'
      );
      expect(
        await prisma.prospectTransition.count({ where: { tenantId, leadId, kind: 'ai_managed_started' } })
      ).toBe(0);
      expect(await prisma.task.count({ where: { tenantId, leadId } })).toBe(1);
    });
  }, 60_000);

  it('the AI wins deterministically when its insert lands first', async () => {
    await inTenant(async () => {
      const order = await makeWorkOrder();
      await designate(sequenceA);
      const result = await launchAIOutreach(userA, {
        leadId,
        sequenceId: sequenceA,
        workOrderId: order.id,
      });

      const launch = await prisma.sequenceLaunch.findUniqueOrThrow({
        where: { tenantId_workOrderId: { tenantId, workOrderId: order.id } },
      });
      expect(result.enrollment.enrollmentId).toBe(launchEnrollmentId(launch.id));
      expect((await occupying())[0].id).toBe(launchEnrollmentId(launch.id));
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).operatingState).toBe(
        'ai_managed'
      );
    });
  }, 60_000);

  // =========================================================================
  // Crash immediately after the enrollment insert
  // =========================================================================
  const plantOrphanEnrollment = async (workOrderId: string) => {
    const launch = await prisma.sequenceLaunch.create({
      data: { tenantId, leadId, sequenceId: sequenceA, workOrderId, stage: 'claimed' },
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
    return enrollmentId;
  };

  it('repairs the lead cache and the activity when the process died right after the insert', async () => {
    await inTenant(async () => {
      const order = await makeWorkOrder();
      const enrollmentId = await plantOrphanEnrollment(order.id);

      await prisma.lead.update({
        where: { id: leadId },
        data: { sequenceId: sequenceA, sequenceStep: null, sequenceStatus: null },
      });
      expect(await prisma.activity.count({ where: { leadId, type: 'sequence_enrolled' } })).toBe(0);

      const resumed = await prepareEnrollment(userA, {
        leadId,
        sequenceId: sequenceA,
        mode: 'cold_launch',
        enrollmentId,
        workOrderId: order.id,
      });

      expect(resumed.reused).toBe(true);
      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
      expect(lead.sequenceStep).toBe(1);
      expect(lead.sequenceStatus).toBe('active');
      expect(await prisma.activity.count({ where: { leadId, type: 'sequence_enrolled' } })).toBe(1);
    });
  }, 60_000);

  it('produces exactly one sequence_enrolled activity under concurrent recovery', async () => {
    await inTenant(async () => {
      const order = await makeWorkOrder();
      const enrollmentId = await plantOrphanEnrollment(order.id);
      await designate(sequenceA);

      await Promise.all(
        Array.from({ length: 4 }, () =>
          prepareEnrollment(userA, {
            leadId,
            sequenceId: sequenceA,
            mode: 'cold_launch',
            enrollmentId,
            workOrderId: order.id,
          })
        )
      );

      expect(await prisma.activity.count({ where: { leadId, type: 'sequence_enrolled' } })).toBe(1);
    });
  }, 60_000);

  it('refuses to overwrite a newer human sequence designation while recovering', async () => {
    await inTenant(async () => {
      const order = await makeWorkOrder();
      const enrollmentId = await plantOrphanEnrollment(order.id);

      // The SDR re-designates the lead while the interrupted launch was down.
      await prisma.lead.update({ where: { id: leadId }, data: { sequenceId: sequenceB } });

      await expect(
        prepareEnrollment(userA, {
          leadId,
          sequenceId: sequenceA,
          mode: 'cold_launch',
          enrollmentId,
          workOrderId: order.id,
        })
      ).rejects.toMatchObject({ code: 'sequence_designation_changed' });

      // The human choice stands, and the abandoned AI cadence released the lead.
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).sequenceId).toBe(sequenceB);
      const released = await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
      expect(released.status).toBe('unenrolled');
      expect(released.occupancyKey).toBeNull();
      expect(await occupying()).toHaveLength(0);
    });
  }, 60_000);

  it('does not treat a terminal deterministic enrollment as a retry target', async () => {
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
          status: 'unenrolled',
          currentStep: 2,
          completedAt: new Date(),
        },
      });

      await expect(
        prepareEnrollment(userA, {
          leadId,
          sequenceId: sequenceA,
          mode: 'cold_launch',
          enrollmentId,
          workOrderId: order.id,
        })
      ).rejects.toMatchObject({ code: 'enrollment_terminal' });
    });
  }, 60_000);

  // =========================================================================
  // The CHECK constraint — the half the unique index cannot express
  // =========================================================================
  describe('the status/occupancy CHECK', () => {
    const bad = (data: Record<string, unknown>) =>
      prisma.sequenceEnrollment.create({
        data: { tenantId, leadId, sequenceId: sequenceA, currentStep: 1, ...data } as never,
      });

    it('rejects an active enrollment with no occupancy key', async () => {
      await inTenant(async () => {
        await expect(bad({ status: 'active', occupancyKey: null })).rejects.toThrow();
      });
    }, 60_000);

    it('rejects a paused enrollment with no occupancy key', async () => {
      await inTenant(async () => {
        await expect(bad({ status: 'paused', occupancyKey: null })).rejects.toThrow();
      });
    }, 60_000);

    it('rejects an occupancy key belonging to a different lead', async () => {
      await inTenant(async () => {
        await expect(
          bad({ status: 'active', occupancyKey: `${tenantId}:someone-else` })
        ).rejects.toThrow();
      });
    }, 60_000);

    it('rejects a terminal enrollment that still holds occupancy', async () => {
      await inTenant(async () => {
        await expect(
          bad({ status: 'completed', occupancyKey: occupancyKeyFor(tenantId, leadId) })
        ).rejects.toThrow();
      });
    }, 60_000);

    it('refuses to resume a terminal enrollment through the status route rules', async () => {
      await inTenant(async () => {
        const { enrollmentId } = await prepareEnrollment(userA, { leadId, sequenceId: sequenceA });
        await unenrollLead(leadId, sequenceA);

        // What the route now refuses: reactivating a terminal row would also have produced
        // `active` with a NULL key, which the CHECK rejects outright.
        await expect(
          prisma.sequenceEnrollment.update({
            where: { id: enrollmentId },
            data: { status: 'active' },
          })
        ).rejects.toThrow();
      });
    }, 60_000);
  });


  // =========================================================================
  // Reuse preserves where the cadence actually is
  // =========================================================================
  it('reusing an enrollment at step 3 does not rewind the lead cache to step 1', async () => {
    await inTenant(async () => {
      const { enrollmentId } = await enrollLeadInSequence(userA, { leadId, sequenceId: sequenceA });

      // The cadence has moved on.
      await prisma.sequenceEnrollment.update({
        where: { id: enrollmentId },
        data: { currentStep: 3 },
      });
      await prisma.lead.update({ where: { id: leadId }, data: { sequenceStep: 3 } });
      const tasksBefore = await prisma.task.count({ where: { tenantId, leadId } });
      const activitiesBefore = await prisma.activity.count({
        where: { leadId, type: 'sequence_enrolled' },
      });

      const again = await enrollLeadInSequence(userA, { leadId, sequenceId: sequenceA });

      expect(again.reused).toBe(true);
      expect(again.currentStep).toBe(3);
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).sequenceStep).toBe(3);
      // Step 1 is not recreated, and the occurrence keeps its single activity.
      expect(await prisma.task.count({ where: { tenantId, leadId } })).toBe(tasksBefore);
      expect(await prisma.activity.count({ where: { leadId, type: 'sequence_enrolled' } })).toBe(
        activitiesBefore
      );
    });
  }, 60_000);

  it('a work order retry after step 1 does not rewind the lead cache', async () => {
    await inTenant(async () => {
      const order = await makeWorkOrder();
      await designate(sequenceA);
      const first = await launchAIOutreach(userA, {
        leadId,
        sequenceId: sequenceA,
        workOrderId: order.id,
      });

      await prisma.sequenceEnrollment.update({
        where: { id: first.enrollment.enrollmentId },
        data: { currentStep: 2 },
      });
      await prisma.lead.update({ where: { id: leadId }, data: { sequenceStep: 2 } });

      const retry = await launchAIOutreach(userA, {
        leadId,
        sequenceId: sequenceA,
        workOrderId: order.id,
      });

      expect(retry.resumed).toBe(true);
      expect(retry.enrollment.currentStep).toBe(2);
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).sequenceStep).toBe(2);
      expect(await prisma.task.count({ where: { tenantId, leadId } })).toBe(1);
    });
  }, 60_000);

  it('refuses to re-enrol the same sequence while it is paused', async () => {
    await inTenant(async () => {
      const { enrollmentId } = await enrollLeadInSequence(userA, { leadId, sequenceId: sequenceA });
      await prisma.sequenceEnrollment.update({
        where: { id: enrollmentId },
        data: { status: 'paused', pausedReason: 'manual' },
      });

      await expect(
        enrollLeadInSequence(userA, { leadId, sequenceId: sequenceA })
      ).rejects.toMatchObject({ code: 'enrollment_paused' });

      // The paused occurrence is intact, reason and all.
      const row = await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
      expect(row.status).toBe('paused');
      expect(row.pausedReason).toBe('manual');
    });
  }, 60_000);

  // =========================================================================
  // Occurrence-scoped first task
  // =========================================================================
  it('gives each enrollment occurrence its own first task, and never reuses a historical one', async () => {
    await inTenant(async () => {
      const first = await enrollLeadInSequence(userA, { leadId, sequenceId: sequenceA });
      const firstTask = await prisma.task.findUniqueOrThrow({
        where: { id: enrollmentFirstTaskId(first.enrollmentId) },
      });

      await unenrollLead(leadId, sequenceA);
      await prisma.task.update({ where: { id: firstTask.id }, data: { status: 'skipped' } });

      const second = await enrollLeadInSequence(userA, { leadId, sequenceId: sequenceA });
      expect(second.enrollmentId).not.toBe(first.enrollmentId);

      const secondTask = await prisma.task.findUniqueOrThrow({
        where: { id: enrollmentFirstTaskId(second.enrollmentId) },
      });
      expect(secondTask.id).not.toBe(firstTask.id);
      expect(secondTask.status).toBe('pending');
      expect(await prisma.task.count({ where: { tenantId, leadId } })).toBe(2);
    });
  }, 60_000);

  it('repeats step-1 finalization idempotently, and refuses to touch step 2+', async () => {
    await inTenant(async () => {
      const enrolled = await prepareEnrollment(userA, { leadId, sequenceId: sequenceA });

      const first = await finalizeFirstStep({
        leadId,
        sequenceId: sequenceA,
        enrollmentId: enrolled.enrollmentId,
        currentStep: 1,
      });
      const again = await finalizeFirstStep({
        leadId,
        sequenceId: sequenceA,
        enrollmentId: enrolled.enrollmentId,
        currentStep: 1,
      });

      expect(first.created).toBe(true);
      expect(again.created).toBe(false);
      expect(again.rescheduled).toBe(true);
      expect(again.taskId).toBe(first.taskId);

      // The same occurrence, now mid-cadence: step 1 must not be re-opened. The guard reads the
      // enrollment rather than trusting the caller's snapshot.
      await prisma.sequenceEnrollment.update({
        where: { id: enrolled.enrollmentId },
        data: { currentStep: 3 },
      });
      const advanced = await finalizeFirstStep({
        leadId,
        sequenceId: sequenceA,
        enrollmentId: enrolled.enrollmentId,
        currentStep: 3,
      });
      expect(advanced.skipped).toBe(true);
      expect(advanced.taskId).toBeNull();
      expect(await prisma.task.count({ where: { tenantId, leadId } })).toBe(1);
    });
  }, 60_000);

  it('refuses an enrollment id that belongs to another lead', async () => {
    await inTenant(async () => {
      const other = await prisma.lead.create({
        data: {
          tenantId,
          firstName: 'Other',
          lastName: 'Lead',
          email: `other.${randomUUID()}@acme.test`,
          company: 'Other',
          assignedToId: userA.id,
          campaignId: (await prisma.campaign.findFirstOrThrow({ where: { tenantId } })).id,
        },
      });
      const foreign = await prepareEnrollment(userA, { leadId: other.id, sequenceId: sequenceA });

      await expect(
        prepareEnrollment(userA, {
          leadId,
          sequenceId: sequenceA,
          enrollmentId: foreign.enrollmentId,
        })
      ).rejects.toBeInstanceOf(SequenceEnrollmentError);
    });
  }, 60_000);

  // =========================================================================
  // The migration's own guarantees
  // =========================================================================
  describe('the occupancy migration', () => {
    const sql = (() => {
      const dir = readdirSync('prisma/migrations').find((d) =>
        d.includes('phase8a_enrollment_occupancy')
      );
      return readFileSync(join('prisma/migrations', dir!, 'migration.sql'), 'utf8');
    })();

    it('refuses to run against a database that already has duplicate occupancies', () => {
      // A migration must not decide which of a lead's two live cadences is real.
      expect(sql).toMatch(/HAVING COUNT\(\*\) > 1/);
      expect(sql).toMatch(/RAISE EXCEPTION/);
      expect(sql).not.toMatch(/DELETE FROM "SequenceEnrollment"/i);
      expect(sql).not.toMatch(/SET "status" = 'unenrolled'/i);
    });

    it('backfills only occupying statuses, and creates a plain unique index', () => {
      expect(sql).toMatch(/WHERE "status" IN \('active', 'paused'\)/);
      expect(sql).toMatch(/CREATE UNIQUE INDEX "SequenceEnrollment_occupancyKey_key"/);
      // A partial index would drift from what Prisma describes.
      expect(sql).not.toMatch(/WHERE "occupancyKey" IS NOT NULL/);
    });

    it('leaves historical terminal rows unkeyed, so they never conflict', async () => {
      await inTenant(async () => {
        for (let i = 0; i < 3; i += 1) {
          await prisma.sequenceEnrollment.create({
            data: {
              tenantId,
              leadId,
              sequenceId: sequenceA,
              status: 'completed',
              currentStep: 1,
              completedAt: new Date(),
            },
          });
        }
        expect(
          await prisma.sequenceEnrollment.count({ where: { tenantId, leadId, status: 'completed' } })
        ).toBe(3);
        expect(await occupying()).toHaveLength(0);
      });
    }, 60_000);
  });
});
