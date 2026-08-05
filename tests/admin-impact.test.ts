import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, tenantStorage } from '@/lib/prisma';
import { computeUserImpact } from '@/lib/admin/impact';
import { removeCampaignMember } from '@/lib/admin/campaignMembers';
import { transferWork } from '@/lib/admin/transferWork';
import type { SessionUser } from '@/lib/auth';

// Handlers/services must not pull next-auth setup into Vitest.
vi.mock('@/auth', () => ({
  auth: vi.fn(),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

const tenantId = 'admin-impact-tenant';

const director: SessionUser = {
  id: 'imp-director',
  email: 'imp-director@telestar.vn',
  firstName: 'Dean',
  lastName: 'Director',
  role: 'director',
  tenantId,
};
const sdrA: SessionUser = {
  id: 'imp-sdr-a',
  email: 'imp-sdr-a@telestar.vn',
  firstName: 'Lan',
  lastName: 'Pham',
  role: 'sdr',
  tenantId,
};
const sdrB: SessionUser = {
  id: 'imp-sdr-b',
  email: 'imp-sdr-b@telestar.vn',
  firstName: 'Minh',
  lastName: 'Tran',
  role: 'sdr',
  tenantId,
};
const leadgen: SessionUser = {
  id: 'imp-leadgen',
  email: 'imp-leadgen@telestar.vn',
  firstName: 'Alex',
  lastName: 'Gen',
  role: 'leadgen',
  tenantId,
};

let campaignId = '';
let otherCampaignId = '';
let lockedTaskId = '';

const run = <T>(fn: () => Promise<T>) =>
  tenantStorage.run({ tenantId, bypassRls: true }, fn);

const hasDb = Boolean(process.env.DATABASE_URL);

/**
 * Fixture (all inside `campaignId` unless noted):
 *   sdrA — 3 open leads + 2 closed (won/lost)
 *        — 4 pending tasks (1 of them cron-locked) + 2 completed
 *        — 1 future meeting + 1 past meeting
 *        — 1 open opportunity + 1 won
 *   sdrB — clean, and a valid transfer target
 */
beforeAll(async () => {
  if (!hasDb) return;

  await tenantStorage.run({ tenantId: 'system', bypassRls: true }, async () => {
    await prisma.opportunityActivity.deleteMany({ where: { tenantId } });
    await prisma.opportunity.deleteMany({ where: { tenantId } });
    await prisma.meeting.deleteMany({ where: { tenantId } });
    await prisma.task.deleteMany({ where: { tenantId } });
    await prisma.activity.deleteMany({ where: { tenantId } });
    await prisma.notification.deleteMany({ where: { tenantId } });
    await prisma.auditLog.deleteMany({ where: { tenantId } });
    await prisma.lead.deleteMany({ where: { tenantId } });
    await prisma.campaignSdr.deleteMany({ where: { tenantId } });
    await prisma.campaign.deleteMany({ where: { tenantId } });
    await prisma.client.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({
      where: { id: { in: [director.id, sdrA.id, sdrB.id, leadgen.id] } },
    });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });

    await prisma.tenant.create({ data: { id: tenantId, name: 'Admin Impact Tenant' } });

    for (const u of [director, sdrA, sdrB, leadgen]) {
      await prisma.user.create({
        data: {
          id: u.id,
          email: u.email,
          password: 'hashed-pwd',
          firstName: u.firstName,
          lastName: u.lastName,
          role: u.role,
          isActive: true,
          tenantId,
        },
      });
    }

    const client = await prisma.client.create({
      data: {
        name: 'Impact Co',
        industry: 'SaaS',
        contactName: 'Pat Buyer',
        contactEmail: 'pat@impact.co',
        tenantId,
      },
    });
    const campaign = await prisma.campaign.create({
      data: { name: 'Impact Campaign', clientId: client.id, startDate: new Date(), tenantId },
    });
    campaignId = campaign.id;

    const other = await prisma.campaign.create({
      data: { name: 'Other Campaign', clientId: client.id, startDate: new Date(), tenantId },
    });
    otherCampaignId = other.id;

    await prisma.campaignSdr.createMany({
      data: [
        { campaignId, userId: sdrA.id, tenantId },
        { campaignId, userId: sdrB.id, tenantId },
      ],
    });

    // 3 open + 2 closed leads for sdrA
    const stages = ['new', 'replied', 'meeting_booked', 'won', 'lost'] as const;
    const leadIds: string[] = [];
    for (const [i, stage] of stages.entries()) {
      const lead = await prisma.lead.create({
        data: {
          firstName: `Lead${i}`,
          lastName: 'Target',
          company: 'Prospect Inc',
          email: `lead${i}@prospect.test`,
          stage,
          assignedToId: sdrA.id,
          campaignId,
          tenantId,
        },
      });
      leadIds.push(lead.id);
    }

    // One lead in the OTHER campaign, to prove campaign scoping bites.
    await prisma.lead.create({
      data: {
        firstName: 'Elsewhere',
        lastName: 'Lead',
        company: 'Other Inc',
        email: 'elsewhere@prospect.test',
        stage: 'new',
        assignedToId: sdrA.id,
        campaignId: otherCampaignId,
        tenantId,
      },
    });

    // 4 pending (one locked) + 2 completed tasks
    for (let i = 0; i < 4; i++) {
      const task = await prisma.task.create({
        data: {
          leadId: leadIds[i % 3],
          userId: sdrA.id,
          type: 'email',
          title: `Pending task ${i}`,
          dueDate: new Date(),
          status: 'pending',
          ...(i === 0 ? { lockedAt: new Date() } : {}),
          tenantId,
        },
      });
      if (i === 0) lockedTaskId = task.id;
    }
    for (let i = 0; i < 2; i++) {
      await prisma.task.create({
        data: {
          leadId: leadIds[0],
          userId: sdrA.id,
          type: 'phone',
          title: `Done task ${i}`,
          dueDate: new Date(),
          status: 'completed',
          tenantId,
        },
      });
    }

    // 1 future + 1 past meeting
    await prisma.meeting.create({
      data: {
        leadId: leadIds[0],
        campaignId,
        clientId: client.id,
        sdrId: sdrA.id,
        title: 'Future discovery call',
        scheduledAt: new Date(Date.now() + 86_400_000),
        status: 'scheduled',
        tenantId,
      },
    });
    await prisma.meeting.create({
      data: {
        leadId: leadIds[1],
        campaignId,
        clientId: client.id,
        sdrId: sdrA.id,
        title: 'Past discovery call',
        scheduledAt: new Date(Date.now() - 86_400_000),
        status: 'scheduled',
        tenantId,
      },
    });

    // 1 open + 1 won opportunity
    await prisma.opportunity.create({
      data: {
        leadId: leadIds[0],
        campaignId,
        clientId: client.id,
        ownerId: sdrA.id,
        createdById: director.id,
        title: 'Open deal',
        company: 'Prospect Inc',
        status: 'open',
        tenantId,
      },
    });
    await prisma.opportunity.create({
      data: {
        leadId: leadIds[1],
        campaignId,
        clientId: client.id,
        ownerId: sdrA.id,
        createdById: director.id,
        title: 'Won deal',
        company: 'Prospect Inc',
        status: 'won',
        tenantId,
      },
    });
  });
}, 60_000);

afterAll(async () => {
  if (!hasDb) return;
  await tenantStorage.run({ tenantId: 'system', bypassRls: true }, async () => {
    await prisma.opportunity.deleteMany({ where: { tenantId } });
    await prisma.meeting.deleteMany({ where: { tenantId } });
    await prisma.task.deleteMany({ where: { tenantId } });
    await prisma.activity.deleteMany({ where: { tenantId } });
    await prisma.notification.deleteMany({ where: { tenantId } });
    await prisma.auditLog.deleteMany({ where: { tenantId } });
    await prisma.lead.deleteMany({ where: { tenantId } });
    await prisma.campaignSdr.deleteMany({ where: { tenantId } });
    await prisma.campaign.deleteMany({ where: { tenantId } });
    await prisma.client.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({
      where: { id: { in: [director.id, sdrA.id, sdrB.id, leadgen.id] } },
    });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
  });
}, 60_000);

describe.skipIf(!hasDb)('computeUserImpact', () => {
  it('counts only open work, campaign-scoped', async () => {
    const impact = await run(() =>
      computeUserImpact({ userId: sdrA.id, campaignId }, director)
    );

    expect(impact.openLeads).toBe(3); // won + lost excluded
    expect(impact.openTasks).toBe(4); // completed excluded, locked still counted
    expect(impact.lockedTasks).toBe(1);
    expect(impact.scheduledMeetings).toBe(1); // the past one is not "upcoming"
    expect(impact.openOpportunities).toBe(1); // won excluded
    expect(impact.totalOpen).toBe(9);
    expect(impact.canRemoveSafely).toBe(false);
  });

  it('widens to the whole book when no campaign is given', async () => {
    const scoped = await run(() => computeUserImpact({ userId: sdrA.id, campaignId }));
    const all = await run(() => computeUserImpact({ userId: sdrA.id }));
    // The extra lead lives in otherCampaignId.
    expect(all.openLeads).toBe(scoped.openLeads + 1);
  });

  it('reports a clean user as safe to remove', async () => {
    const impact = await run(() => computeUserImpact({ userId: sdrB.id, campaignId }, director));
    expect(impact.totalOpen).toBe(0);
    expect(impact.canRemoveSafely).toBe(true);
    expect(impact.recommendedAction).toBe('safe_remove');
  });

  it('recommends a transfer when an eligible target exists', async () => {
    const impact = await run(() =>
      computeUserImpact({ userId: sdrA.id, campaignId }, director)
    );
    expect(impact.recommendedAction).toBe('transfer_work');
    expect(impact.suggestedTargets.map((t) => t.id)).toContain(sdrB.id);
  });

  it('never suggests a leadgen user as a transfer target', async () => {
    const impact = await run(() =>
      computeUserImpact({ userId: sdrA.id, campaignId }, director)
    );
    expect(impact.suggestedTargets.map((t) => t.id)).not.toContain(leadgen.id);
  });
});

describe.skipIf(!hasDb)('removeCampaignMember — the no-silent-removal rule', () => {
  it('refuses with 409 and returns the impact when work is open and no mode is given', async () => {
    const result = await run(() =>
      removeCampaignMember(director, { userId: sdrA.id, campaignId })
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.status).toBe(409);
    expect(result.impact?.openLeads).toBe(3);

    // And critically: the membership row must still be there.
    const still = await run(() =>
      prisma.campaignSdr.findUnique({
        where: { campaignId_userId: { campaignId, userId: sdrA.id } },
      })
    );
    expect(still).not.toBeNull();
  });

  it('requires a reason once work is open, even for keep_existing_work', async () => {
    const result = await run(() =>
      removeCampaignMember(director, {
        userId: sdrA.id,
        campaignId,
        mode: 'keep_existing_work',
      })
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.status).toBe(400);
  });

  it('allows a mode-less removal when nothing is open', async () => {
    const result = await run(() =>
      removeCampaignMember(director, { userId: sdrB.id, campaignId })
    );
    expect(result.ok).toBe(true);

    const gone = await run(() =>
      prisma.campaignSdr.findUnique({
        where: { campaignId_userId: { campaignId, userId: sdrB.id } },
      })
    );
    expect(gone).toBeNull();

    // Restore for the transfer tests below.
    await run(() =>
      prisma.campaignSdr.create({ data: { campaignId, userId: sdrB.id, tenantId } })
    );
  });
});

describe.skipIf(!hasDb)('transferWork', () => {
  it('rejects a leadgen destination with an explanatory error', async () => {
    const result = await run(() =>
      transferWork(director, {
        fromUserId: sdrA.id,
        toUserId: leadgen.id,
        campaignId,
        include: { leads: true, openTasks: true, scheduledMeetings: true, openOpportunities: true },
        requestId: 'req-leadgen-reject',
        reason: 'should not happen',
      })
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.status).toBe(400);
    expect(result.error).toContain('leadgen');
  });

  it('rejects transferring to oneself', async () => {
    const result = await run(() =>
      transferWork(director, {
        fromUserId: sdrA.id,
        toUserId: sdrA.id,
        include: { leads: true, openTasks: true, scheduledMeetings: true, openOpportunities: true },
        requestId: 'req-self',
        reason: 'nope',
      })
    );
    expect(result.ok).toBe(false);
  });

  it('moves open work but leaves the cron-locked task with its owner', async () => {
    const result = await run(() =>
      transferWork(director, {
        fromUserId: sdrA.id,
        toUserId: sdrB.id,
        campaignId,
        include: { leads: true, openTasks: true, scheduledMeetings: true, openOpportunities: true },
        requestId: 'req-happy-path',
        reason: 'Lan left the company',
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.counts.leads).toBe(3);
    expect(result.counts.tasks).toBe(3); // 4 pending minus the locked one
    expect(result.skippedLockedTasks).toBe(1);
    expect(result.counts.meetings).toBe(1);
    expect(result.counts.opportunities).toBe(1);

    const locked = await run(() =>
      prisma.task.findUnique({ where: { id: lockedTaskId }, select: { userId: true } })
    );
    expect(locked?.userId).toBe(sdrA.id);
  });

  it('is idempotent — replaying a requestId returns the stored result and moves nothing', async () => {
    const before = await run(() =>
      prisma.lead.count({ where: { assignedToId: sdrB.id, campaignId } })
    );

    const replay = await run(() =>
      transferWork(director, {
        fromUserId: sdrA.id,
        toUserId: sdrB.id,
        campaignId,
        include: { leads: true, openTasks: true, scheduledMeetings: true, openOpportunities: true },
        requestId: 'req-happy-path',
        reason: 'Lan left the company',
      })
    );

    expect(replay.ok).toBe(true);
    if (!replay.ok) throw new Error('unreachable');
    expect(replay.replayed).toBe(true);
    expect(replay.counts.leads).toBe(3);

    const after = await run(() =>
      prisma.lead.count({ where: { assignedToId: sdrB.id, campaignId } })
    );
    expect(after).toBe(before);
  });

  it('writes an actor-stamped audit trail with intent and completion rows', async () => {
    const rows = await run(() =>
      prisma.auditLog.findMany({
        where: { tableName: 'WorkTransfer', recordId: 'req-happy-path' },
        select: { action: true, userId: true },
      })
    );

    const actions = rows.map((r) => r.action).sort();
    expect(actions).toEqual(['admin.work.transfer', 'admin.work.transfer.start']);
    // Attributed to the director who acted, not to the SDR who was acted on.
    expect(rows.every((r) => r.userId === director.id)).toBe(true);
  });

  it('records one bulk activity, not one per lead', async () => {
    const activities = await run(() =>
      prisma.activity.findMany({
        where: { userId: director.id, type: 'lead_reassigned' },
        select: { metadata: true },
      })
    );
    const bulk = activities.filter(
      (a) => (a.metadata as Record<string, unknown> | null)?.kind === 'bulk_transfer'
    );
    expect(bulk.length).toBe(1);
  });
});
