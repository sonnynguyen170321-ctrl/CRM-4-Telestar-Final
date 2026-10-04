import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));

import type { SessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { bookMeeting } from '@/lib/meetings/meetingLifecycle';
import { occupancyKeyFor } from '@/lib/sequences/occupancy';
import { createTestTenant } from './helpers/testTenant';

/**
 * Booking a meeting stops the outreach — every cadence on the lead, through the real pause path.
 *
 * It used to pause only when the lead's `sequenceStatus` pointer said "active", with a raw status
 * write. A lead runs several sequences, and its pointer can be empty or "paused" while others
 * send, so a prospect who had just booked could keep getting the cold sequence. The raw write also
 * left the cadence's pending tasks live and recorded no reason.
 */

let tenantId: string;
let user: SessionUser;
let leadId: string;
const sequences: string[] = [];

const inTenant = <T>(fn: () => Promise<T>) => tenantStorage.run({ tenantId, bypassRls: true }, fn);

beforeEach(async () => {
  sequences.length = 0;
  tenantId = `t-meetpause-${randomUUID()}`;
  await createTestTenant(tenantId, 'Meeting pause');
  await inTenant(async () => {
    const row = await prisma.user.create({
      data: { tenantId, email: `sdr.${randomUUID()}@t.test`, firstName: 'Judy', lastName: 'N', password: 'x', role: 'sdr' },
    });
    user = { id: row.id, email: row.email, firstName: 'Judy', lastName: 'N', role: 'sdr', tenantId } as SessionUser;
    const client = await prisma.client.create({
      data: { tenantId, name: 'Client', industry: 'SaaS', contactName: 'c', contactEmail: `c.${randomUUID()}@t.test` },
    });
    const campaign = await prisma.campaign.create({ data: { tenantId, clientId: client.id, name: 'Out', startDate: new Date() } });
    const lead = await prisma.lead.create({
      data: {
        tenantId,
        firstName: 'Ann',
        lastName: 'L',
        email: `ann.${randomUUID()}@acme.test`,
        company: 'Acme',
        assignedToId: row.id,
        campaignId: campaign.id,
        stage: 'sequence_active',
        // The pointer says nothing, while two cadences run — the case the old guard skipped.
        sequenceId: null,
        sequenceStatus: null,
      },
    });
    leadId = lead.id;
    for (const name of ['Email', 'LinkedIn']) {
      const seq = await prisma.sequence.create({ data: { tenantId, name, createdById: row.id } });
      sequences.push(seq.id);
      await prisma.sequenceEnrollment.create({
        data: { tenantId, leadId, sequenceId: seq.id, status: 'active', currentStep: 1, occupancyKey: occupancyKeyFor(tenantId, leadId, seq.id) },
      });
      await prisma.task.create({
        data: { tenantId, leadId, userId: row.id, type: 'email', title: `${name} step`, status: 'pending', dueDate: new Date(), sequenceId: seq.id, sequenceStep: 1 },
      });
    }
  });
});

describe('booking a meeting', () => {
  it('pauses every running cadence with the reason, and skips their pending steps', async () => {
    await inTenant(() => bookMeeting({ leadId, user, tenantId, status: 'scheduled', scheduledAt: new Date(Date.now() + 86_400_000) }));

    const enrollments = await inTenant(() => prisma.sequenceEnrollment.findMany({ where: { tenantId, leadId } }));
    expect(enrollments.map((row) => row.status)).toEqual(['paused', 'paused']);
    expect(enrollments.every((row) => row.pausedReason === 'meeting_booked')).toBe(true);

    const pending = await inTenant(() => prisma.task.count({ where: { tenantId, leadId, sequenceId: { in: sequences }, status: 'pending' } }));
    expect(pending).toBe(0);
  }, 60_000);
});
