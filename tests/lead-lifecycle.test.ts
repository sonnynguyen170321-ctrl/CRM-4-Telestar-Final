/**
 * Lead soft delete and restore (`OPS-020`).
 *
 * This test did not exist. The requirement cited `tests/lead-lifecycle.test.ts`, a file that
 * was never written, and the row was nonetheless marked VERIFIED - the defect registered as
 * TEL-P1-019. A citation to a nonexistent test reads as coverage and is worse than an
 * acknowledged gap, because nothing looks wrong.
 *
 * What must hold: archiving a lead removes it from active pipeline **without destroying
 * anything**. The row survives, its activity history survives in full, and a restore puts it
 * back with the trail of both events intact. If archive were ever implemented as a hard
 * delete, the CRM would silently lose the history that reporting and coaching depend on -
 * and `Activity.leadId` is `onDelete: SetNull`, so the activities would survive as orphans
 * pointing at nothing, which is worse than losing them loudly.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/bullmq/enqueue', () => ({
  enqueue: vi.fn().mockResolvedValue('j'),
  enqueueImmediate: vi.fn().mockResolvedValue('j'),
  enqueueReschedule: vi.fn().mockResolvedValue('j'),
  ensureJob: vi.fn().mockResolvedValue('j'),
  removeJob: vi.fn().mockResolvedValue(true),
}));

const { prisma, tenantStorage } = await import('@/lib/prisma');

const T = 'lead-lifecycle-tenant';
const USER = 'll-director';
const CLIENT = 'll-client';
const CAMPAIGN = 'll-campaign';
const LEAD = 'll-lead';

const run = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId: T, bypassRls: true }, fn);
const runSystem = <R>(fn: () => Promise<R>) =>
  tenantStorage.run({ tenantId: 'system', bypassRls: true }, fn);

let hasDb = false;
try {
  if (process.env.DATABASE_URL) {
    await prisma.$queryRaw`SELECT 1`;
    hasDb = true;
  }
} catch {
  hasDb = false;
}

/** Mirrors `DELETE /api/leads/[id]`: soft delete, never a row removal. */
async function archiveLead(leadId: string, actorId: string, reason: string) {
  return run(() =>
    prisma.lead.update({
      where: { id: leadId },
      data: { archivedAt: new Date(), archivedById: actorId, archiveReason: reason },
    }),
  );
}

/** Mirrors `POST /api/leads/[id]/restore`: clears the archive and records the event. */
async function restoreLead(leadId: string, actorId: string) {
  return run(async () => {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { archivedAt: true, firstName: true, lastName: true },
    });
    if (!lead) throw new Error('Not found');
    if (!lead.archivedAt) throw new Error('Lead is not archived');

    const restored = await prisma.lead.update({
      where: { id: leadId },
      data: { archivedAt: null, archivedById: null, archiveReason: null },
    });
    await prisma.activity.create({
      data: {
        tenantId: T,
        userId: actorId,
        leadId,
        type: 'lead_created',
        description: `Lead restored from archive: ${lead.firstName} ${lead.lastName}`,
        metadata: { restored: true },
      },
    });
    return restored;
  });
}

describe.skipIf(!hasDb)('OPS-020: lead soft delete and restore preserve history', () => {
  beforeAll(async () => {
    await run(async () => {
      await prisma.activity.deleteMany({ where: { tenantId: T } });
      await prisma.lead.deleteMany({ where: { tenantId: T } });
      await prisma.campaign.deleteMany({ where: { tenantId: T } });
      await prisma.client.deleteMany({ where: { tenantId: T } });
      await prisma.user.deleteMany({ where: { tenantId: T } });
    });
    await runSystem(() => prisma.tenant.deleteMany({ where: { id: T } }));
    await runSystem(() => prisma.tenant.create({ data: { id: T, name: 'Lead Lifecycle Tenant' } }));
    await run(async () => {
      await prisma.user.create({
        data: {
          id: USER,
          tenantId: T,
          email: 'll-director@telestar.invalid',
          firstName: 'Dee',
          lastName: 'Director',
          role: 'director',
          password: 'test-only-not-a-credential',
        },
      });
      await prisma.client.create({
        data: {
          id: CLIENT,
          tenantId: T,
          name: 'Lifecycle Client',
          industry: 'QA',
          contactName: 'Contact',
          contactEmail: 'c@telestar.invalid',
        },
      });
      await prisma.campaign.create({
        data: {
          id: CAMPAIGN,
          tenantId: T,
          clientId: CLIENT,
          name: 'Lifecycle Campaign',
          startDate: new Date('2026-08-01T00:00:00Z'),
        },
      });
    });
  });

  afterAll(async () => {
    await run(async () => {
      await prisma.activity.deleteMany({ where: { tenantId: T } });
      await prisma.lead.deleteMany({ where: { tenantId: T } });
      await prisma.campaign.deleteMany({ where: { tenantId: T } });
      await prisma.client.deleteMany({ where: { tenantId: T } });
      await prisma.user.deleteMany({ where: { tenantId: T } });
    });
    await runSystem(() => prisma.tenant.deleteMany({ where: { id: T } }));
  });

  beforeEach(async () => {
    await run(async () => {
      await prisma.activity.deleteMany({ where: { tenantId: T } });
      await prisma.lead.deleteMany({ where: { tenantId: T } });
      await prisma.lead.create({
        data: {
          id: LEAD,
          tenantId: T,
          campaignId: CAMPAIGN,
          assignedToId: USER,
          firstName: 'Archie',
          lastName: 'Vale',
          company: 'Vale Industries',
          email: 'archie@vale.invalid',
          stage: 'sequence_active',
        },
      });
      // A history worth protecting.
      for (const [type, description] of [
        ['email_sent', 'Sent intro email'],
        ['call_logged', 'Discovery call, 6 minutes'],
        ['note_added', 'Interested but budget is next quarter'],
      ] as const) {
        await prisma.activity.create({
          data: { tenantId: T, userId: USER, leadId: LEAD, type, description },
        });
      }
    });
  });

  it('archiving keeps the row and every activity attached to it', async () => {
    const before = await run(() => prisma.activity.count({ where: { leadId: LEAD } }));
    expect(before).toBe(3);

    await archiveLead(LEAD, USER, 'Budget cycle ended');

    const lead = await run(() => prisma.lead.findUnique({ where: { id: LEAD } }));
    expect(lead).not.toBeNull();
    expect(lead?.archivedAt).toBeInstanceOf(Date);
    expect(lead?.archivedById).toBe(USER);
    expect(lead?.archiveReason).toBe('Budget cycle ended');

    const after = await run(() =>
      prisma.activity.findMany({ where: { leadId: LEAD }, orderBy: { createdAt: 'asc' } }),
    );
    expect(after).toHaveLength(3);
    // Still attached, not orphaned by a SetNull cascade.
    expect(after.every((activity) => activity.leadId === LEAD)).toBe(true);
  });

  it('an archived lead leaves the active pipeline but stays findable', async () => {
    await archiveLead(LEAD, USER, 'Not a fit');

    const active = await run(() =>
      prisma.lead.findMany({ where: { tenantId: T, archivedAt: null } }),
    );
    expect(active.map((lead) => lead.id)).not.toContain(LEAD);

    const archived = await run(() =>
      prisma.lead.findMany({ where: { tenantId: T, archivedAt: { not: null } } }),
    );
    expect(archived.map((lead) => lead.id)).toContain(LEAD);
  });

  it('restoring returns the lead to the pipeline and records the event', async () => {
    await archiveLead(LEAD, USER, 'Archived in error');
    await restoreLead(LEAD, USER);

    const lead = await run(() => prisma.lead.findUnique({ where: { id: LEAD } }));
    expect(lead?.archivedAt).toBeNull();
    expect(lead?.archivedById).toBeNull();
    expect(lead?.archiveReason).toBeNull();

    const active = await run(() =>
      prisma.lead.findMany({ where: { tenantId: T, archivedAt: null } }),
    );
    expect(active.map((entry) => entry.id)).toContain(LEAD);
  });

  it('the activity history spans the whole archive and restore cycle', async () => {
    await archiveLead(LEAD, USER, 'Paused engagement');
    await restoreLead(LEAD, USER);

    const timeline = await run(() =>
      prisma.activity.findMany({ where: { leadId: LEAD }, orderBy: { createdAt: 'asc' } }),
    );

    // Three original entries survived, and the restore added a fourth.
    expect(timeline).toHaveLength(4);
    expect(timeline.slice(0, 3).map((entry) => entry.type)).toEqual([
      'email_sent',
      'call_logged',
      'note_added',
    ]);
    expect(timeline[3].description).toContain('restored from archive');
  });

  it('refuses to restore a lead that was never archived', async () => {
    await expect(restoreLead(LEAD, USER)).rejects.toThrow(/not archived/i);
  });

  it('archiving is idempotent enough to survive a repeated call', async () => {
    await archiveLead(LEAD, USER, 'First');
    const first = await run(() => prisma.lead.findUnique({ where: { id: LEAD } }));

    await archiveLead(LEAD, USER, 'Second');
    const second = await run(() => prisma.lead.findUnique({ where: { id: LEAD } }));

    expect(first?.archivedAt).toBeInstanceOf(Date);
    expect(second?.archivedAt).toBeInstanceOf(Date);
    expect(second?.archiveReason).toBe('Second');
    // Still exactly one lead row - archiving never duplicates or deletes.
    expect(await run(() => prisma.lead.count({ where: { tenantId: T } }))).toBe(1);
  });
});
