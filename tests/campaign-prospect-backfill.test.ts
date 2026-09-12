import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({
  auth: vi.fn(() => Promise.resolve(null)),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

import { backfillCampaignProspectsForTenant } from '@/lib/leadgen/campaignProspectBackfill';
import { prisma, tenantStorage } from '@/lib/prisma';

const hasDb = Boolean(process.env.DATABASE_URL);
const tenantId = 'campaign-prospect-backfill-tenant';
let userId = '';
let campaignA = '';
let campaignB = '';
let normalPoolId = '';
let conflictPoolId = '';

const run = <T>(fn: () => Promise<T>) =>
  tenantStorage.run({ tenantId, bypassRls: true }, fn);

async function cleanup() {
  await run(async () => {
    await prisma.campaignProspect.deleteMany({ where: { tenantId } });
    await prisma.leadPoolAssessment.deleteMany({ where: { tenantId } });
    await prisma.leadPoolItem.deleteMany({ where: { tenantId } });
    await prisma.lead.deleteMany({ where: { tenantId } });
    await prisma.campaign.deleteMany({ where: { tenantId } });
    await prisma.icpVersion.deleteMany({ where: { tenantId } });
    await prisma.icpProfile.deleteMany({ where: { tenantId } });
    await prisma.client.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
  });
}

describe.skipIf(!hasDb)('CampaignProspect legacy backfill', () => {
  beforeAll(async () => {
    await cleanup();
    await run(async () => {
      await prisma.tenant.create({ data: { id: tenantId, name: 'Backfill Tenant' } });
      const user = await prisma.user.create({
        data: {
          tenantId,
          email: 'campaign-prospect-backfill@example.test',
          password: 'x',
          firstName: 'Bailey',
          lastName: 'Rep',
        },
      });
      userId = user.id;
      const client = await prisma.client.create({
        data: {
          tenantId,
          name: 'Backfill Client',
          industry: 'Software',
          contactName: 'Owner',
          contactEmail: 'owner@backfill.test',
        },
      });
      const profile = await prisma.icpProfile.create({
        data: { tenantId, name: 'Backfill ICP' },
      });
      const version = await prisma.icpVersion.create({
        data: {
          tenantId,
          icpProfileId: profile.id,
          versionNumber: 1,
          status: 'published',
        },
      });
      const campaigns = await Promise.all([
        prisma.campaign.create({
          data: {
            tenantId,
            clientId: client.id,
            name: 'Backfill A',
            startDate: new Date(),
            icpVersionId: version.id,
          },
        }),
        prisma.campaign.create({
          data: {
            tenantId,
            clientId: client.id,
            name: 'Backfill B',
            startDate: new Date(),
          },
        }),
      ]);
      campaignA = campaigns[0].id;
      campaignB = campaigns[1].id;

      const normal = await prisma.leadPoolItem.create({
        data: {
          tenantId,
          company: 'Normal Co',
          email: 'normal@backfill.test',
          tags: [],
          assignedCampaignId: campaignA,
          assignedSdrId: userId,
          assignedById: userId,
          assignedAt: new Date(),
        },
      });
      normalPoolId = normal.id;
      const normalLead = await prisma.lead.create({
        data: {
          tenantId,
          campaignId: campaignA,
          assignedToId: userId,
          firstName: 'Normal',
          lastName: 'Lead',
          company: 'Normal Co',
          email: 'normal@backfill.test',
          normalizedEmail: 'normal@backfill.test',
          tags: [],
        },
      });
      await prisma.leadPoolItem.update({
        where: { id: normal.id },
        data: { convertedLeadId: normalLead.id },
      });
      await prisma.leadPoolAssessment.create({
        data: {
          tenantId,
          poolItemId: normal.id,
          icpVersionId: version.id,
          fitScore: 80,
          confidenceScore: 90,
          dataQualityScore: 80,
          qualification: 'qualified',
          inputSnapshot: {},
          rulesSnapshot: {},
          fingerprint: 'campaign-prospect-backfill-assessment',
        },
      });

      const conflict = await prisma.leadPoolItem.create({
        data: {
          tenantId,
          company: 'Conflict Co',
          email: 'conflict@backfill.test',
          tags: [],
          assignedCampaignId: campaignA,
          assignedSdrId: userId,
        },
      });
      conflictPoolId = conflict.id;
      const conflictLead = await prisma.lead.create({
        data: {
          tenantId,
          campaignId: campaignB,
          assignedToId: userId,
          firstName: 'Conflict',
          lastName: 'Lead',
          company: 'Conflict Co',
          email: 'conflict@backfill.test',
          normalizedEmail: 'conflict@backfill.test',
          tags: [],
        },
      });
      await prisma.leadPoolItem.update({
        where: { id: conflict.id },
        data: { convertedLeadId: conflictLead.id },
      });
    });
  });

  afterAll(async () => {
    if (hasDb) await cleanup();
    await prisma.$disconnect();
  });

  it('dry-run plans without writing and reports legacy conflicts', async () => {
    const report = await run(() =>
      backfillCampaignProspectsForTenant({ tenantId, dryRun: true, batchSize: 1 })
    );

    expect(report.scanned).toBe(2);
    expect(report.planned).toBe(1);
    expect(report.inserted).toBe(0);
    expect(report.conflicts).toEqual([
      expect.objectContaining({
        poolItemId: conflictPoolId,
        reason: 'campaign_mismatch',
      }),
    ]);
    expect(await run(() => prisma.campaignProspect.count({ where: { tenantId } }))).toBe(0);
  });

  it('apply refuses the whole tenant on conflict, then reruns idempotently after repair', async () => {
    const refused = await run(() =>
      backfillCampaignProspectsForTenant({ tenantId, dryRun: false, batchSize: 1 })
    );
    expect(refused.inserted).toBe(0);
    expect(refused.conflicts).toHaveLength(1);
    expect(await run(() => prisma.campaignProspect.count({ where: { tenantId } }))).toBe(0);

    await run(async () => {
      await prisma.leadPoolItem.delete({ where: { id: conflictPoolId } });
    });

    const first = await run(() =>
      backfillCampaignProspectsForTenant({ tenantId, dryRun: false, batchSize: 1 })
    );
    expect(first.inserted).toBe(1);

    const membership = await run(() =>
      prisma.campaignProspect.findUniqueOrThrow({
        where: {
          tenantId_campaignId_poolItemId: {
            tenantId,
            campaignId: campaignA,
            poolItemId: normalPoolId,
          },
        },
      })
    );
    expect(membership.status).toBe('active');
    expect(membership.assessedIcpVersionId).not.toBeNull();
    expect(membership.latestAssessmentId).not.toBeNull();

    const second = await run(() =>
      backfillCampaignProspectsForTenant({ tenantId, dryRun: false, batchSize: 1 })
    );
    expect(second.inserted).toBe(0);
    expect(second.alreadyPresent).toBe(1);
    expect(await run(() => prisma.campaignProspect.count({ where: { tenantId } }))).toBe(1);
  });
});
