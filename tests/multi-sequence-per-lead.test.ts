import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/auth', () => ({
  auth: vi.fn(),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { createTestTenant } from './helpers/testTenant';
import { enrollLeadInSequence, SequenceEnrollmentError } from '@/lib/sequences/enrollment';
import { pauseSequence, unenrollLead } from '@/lib/sequences/engine';
import { pauseAllLeadCadences, unenrollAllLeadCadences } from '@/lib/sequences/leadStop';
import { launchAIOutreach } from '@/lib/prospects/outreach';
import type { SessionUser } from '@/lib/auth';

/**
 * A lead running several sequences at once (owner decision, 2026-10-02: "không giới hạn").
 *
 * What changes: an SDR can **add** a sequence beside the ones already running. What must not:
 *   - the same sequence never runs twice on one lead (every step would send twice);
 *   - a reply, a bounce, an unsubscribe or a booked meeting stops **every** cadence on the lead —
 *     the property that used to come free with one-per-lead and now has to be built;
 *   - the AI agent still never starts outreach beside a human's running cadence.
 */
describe('multiple sequences per lead', () => {
  let tenantId: string;
  let leadId: string;
  let sequenceA: string;
  let sequenceB: string;
  let user: SessionUser;

  const inTenant = <T>(fn: () => Promise<T>): Promise<T> => tenantStorage.run({ tenantId, bypassRls: true }, fn);

  const makeSequence = async (name: string, createdById: string) => {
    const seq = await prisma.sequence.create({ data: { tenantId, name, createdById } });
    await prisma.sequenceStep.create({
      data: { tenantId, sequenceId: seq.id, order: 1, channel: 'email', delayDays: 0, instructions: 'Open', autoComplete: false },
    });
    await prisma.sequenceStep.create({
      data: { tenantId, sequenceId: seq.id, order: 2, channel: 'linkedin', delayDays: 2, instructions: 'Follow', autoComplete: false },
    });
    return seq.id;
  };

  const occupying = () =>
    prisma.sequenceEnrollment.findMany({
      where: { tenantId, leadId, status: { in: ['active', 'paused'] } },
      orderBy: { startedAt: 'asc' },
    });

  beforeEach(async () => {
    tenantId = `t-multiseq-${randomUUID()}`;
    await createTestTenant(tenantId, 'Multi sequence');
    await inTenant(async () => {
      const row = await prisma.user.create({
        data: {
          id: `u-${randomUUID()}`,
          tenantId,
          email: `sdr.${randomUUID()}@acme.test`,
          firstName: 'Judy',
          lastName: 'N',
          password: '$2a$10$abcdefghijklmnopqrstuu',
          role: 'sdr',
        },
      });
      user = { id: row.id, email: row.email, firstName: 'Judy', lastName: 'N', role: 'sdr', tenantId };
      const client = await prisma.client.create({
        data: { tenantId, name: 'Client', industry: 'SaaS', contactName: 'B', contactEmail: `b.${randomUUID()}@acme.test` },
      });
      const campaign = await prisma.campaign.create({ data: { tenantId, clientId: client.id, name: 'Outbound', startDate: new Date() } });
      const lead = await prisma.lead.create({
        data: {
          tenantId,
          firstName: 'Alice',
          lastName: 'Smith',
          email: `alice.${randomUUID()}@acme.test`,
          company: 'Acme',
          assignedToId: row.id,
          campaignId: campaign.id,
          operatingState: 'ready_for_outreach',
        },
      });
      leadId = lead.id;
      sequenceA = await makeSequence('Email - Judy', row.id);
      sequenceB = await makeSequence('LinkedIn - Judy', row.id);
    });
  });

  it('adds a second sequence beside the first instead of switching away from it', async () => {
    await inTenant(async () => {
      const first = await enrollLeadInSequence(user, { leadId, sequenceId: sequenceA });
      const second = await enrollLeadInSequence(user, { leadId, sequenceId: sequenceB, mode: 'add' });

      const rows = await occupying();
      expect(rows.map((r) => r.id).sort()).toEqual([first.enrollmentId, second.enrollmentId].sort());
      expect(rows.every((r) => r.status === 'active')).toBe(true);
      expect(second.unenrolledFromSequenceId).toBeNull();
    });
  }, 60_000);

  it('still switches when asked to — a plain enrol closes the running cadence', async () => {
    await inTenant(async () => {
      await enrollLeadInSequence(user, { leadId, sequenceId: sequenceA });
      const switched = await enrollLeadInSequence(user, { leadId, sequenceId: sequenceB });

      const rows = await occupying();
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(switched.enrollmentId);
    });
  }, 60_000);

  it('never runs the same sequence twice on one lead', async () => {
    await inTenant(async () => {
      await enrollLeadInSequence(user, { leadId, sequenceId: sequenceA });
      await enrollLeadInSequence(user, { leadId, sequenceId: sequenceB, mode: 'add' });
      // Adding A again reuses the running occurrence rather than starting a second copy.
      await enrollLeadInSequence(user, { leadId, sequenceId: sequenceA, mode: 'add' });

      const rows = await occupying();
      expect(rows.filter((r) => r.sequenceId === sequenceA)).toHaveLength(1);
      expect(rows).toHaveLength(2);
    });
  }, 60_000);

  it('a reply on the lead page pauses every cadence, not only the one Lead.sequenceId points at', async () => {
    await inTenant(async () => {
      await enrollLeadInSequence(user, { leadId, sequenceId: sequenceA });
      await enrollLeadInSequence(user, { leadId, sequenceId: sequenceB, mode: 'add' });

      const outcome = await pauseSequence(leadId, 'reply', user.id);

      expect(outcome).toBe('paused');
      const rows = await occupying();
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.status === 'paused' && r.pausedReason === 'reply')).toBe(true);
      // And no step from either is left waiting to go out.
      expect(await prisma.task.count({ where: { tenantId, leadId, status: 'pending' } })).toBe(0);
    });
  }, 60_000);

  it('a bounce pauses every running cadence, through the shared lead stop', async () => {
    await inTenant(async () => {
      const first = await enrollLeadInSequence(user, { leadId, sequenceId: sequenceA });
      await enrollLeadInSequence(user, { leadId, sequenceId: sequenceB, mode: 'add' });

      const result = await pauseAllLeadCadences({ leadId, reason: 'hard_bounce', actorUserId: user.id });

      expect(result.paused).toBe(2);
      const rows = await occupying();
      expect(rows.every((r) => r.status === 'paused' && r.pausedReason === 'hard_bounce')).toBe(true);
      expect(rows.map((r) => r.id)).toContain(first.enrollmentId);
    });
  }, 60_000);

  it('an unsubscribe ends every cadence and releases every occupancy', async () => {
    await inTenant(async () => {
      await enrollLeadInSequence(user, { leadId, sequenceId: sequenceA });
      await enrollLeadInSequence(user, { leadId, sequenceId: sequenceB, mode: 'add' });

      await unenrollAllLeadCadences(leadId);

      expect(await occupying()).toHaveLength(0);
      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
      expect(lead.sequenceId).toBeNull();
    });
  }, 60_000);

  it('removing one cadence moves the lead pointer to the one still running, rather than blanking it', async () => {
    await inTenant(async () => {
      await enrollLeadInSequence(user, { leadId, sequenceId: sequenceA });
      await enrollLeadInSequence(user, { leadId, sequenceId: sequenceB, mode: 'add' });
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).sequenceId).toBe(sequenceB);

      await unenrollLead(leadId, sequenceB);

      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
      expect(lead.sequenceId).toBe(sequenceA);
      expect(lead.sequenceStatus).toBe('active');
    });
  }, 60_000);

  it('the AI agent never starts outreach beside a human cadence on another sequence', async () => {
    await inTenant(async () => {
      await enrollLeadInSequence(user, { leadId, sequenceId: sequenceA });
      const order = await prisma.workOrder.create({
        data: {
          tenantId,
          type: 'outreach_launch',
          status: 'active',
          requestKey: `req-${randomUUID()}`,
          leadId,
          createdById: user.id,
          researchBudget: 10,
          tokenBudget: 1000,
          maxToolCalls: 5,
          maxExecutionDuration: 300,
          activatedAt: new Date(),
        },
      });

      await expect(launchAIOutreach(user, { leadId, sequenceId: sequenceB, workOrderId: order.id })).rejects.toBeTruthy();

      const rows = await occupying();
      expect(rows).toHaveLength(1);
      expect(rows[0].sequenceId).toBe(sequenceA);
    });
  }, 60_000);

  it('the cold-launch path refuses directly too, with the occupancy code', async () => {
    await inTenant(async () => {
      await enrollLeadInSequence(user, { leadId, sequenceId: sequenceA });
      await prisma.lead.update({ where: { id: leadId }, data: { sequenceId: sequenceB } });

      const attempt = enrollLeadInSequence(user, { leadId, sequenceId: sequenceB, mode: 'cold_launch' });
      await expect(attempt).rejects.toBeInstanceOf(SequenceEnrollmentError);
      await expect(attempt).rejects.toMatchObject({ code: 'lead_already_occupied' });
      expect(await occupying()).toHaveLength(1);
    });
  }, 60_000);
});

describe('the occupancy migration', () => {
  const dir = join(process.cwd(), 'prisma', 'migrations');
  const name = readdirSync(dir).find((entry) => entry.endsWith('_occupancy_per_sequence'));
  const sql = name ? readFileSync(join(dir, name, 'migration.sql'), 'utf8') : '';

  it('re-keys occupying rows and swaps the CHECK in the same migration', () => {
    expect(name).toBeTruthy();
    expect(sql).toMatch(/DROP CONSTRAINT "SequenceEnrollment_occupancy_status_check"/);
    expect(sql).toMatch(/"tenantId" \|\| ':' \|\| "leadId" \|\| ':' \|\| "sequenceId"/);
    expect(sql).toMatch(/ADD CONSTRAINT "SequenceEnrollment_occupancy_status_check"/);
    // Only occupying rows are re-keyed; terminal rows keep NULL.
    expect(sql).toMatch(/WHERE "occupancyKey" IS NOT NULL/);
  });
});
