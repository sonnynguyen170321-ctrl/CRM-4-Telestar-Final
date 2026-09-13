import { prisma } from '@/lib/prisma';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const hasDb = Boolean(process.env.DATABASE_URL);

const tenantId = 'campaign-prospect-ref-tenant';
const userId = 'campaign-prospect-ref-user';
const clientId = 'campaign-prospect-ref-client';
const campaignA = 'campaign-prospect-ref-a';
const campaignB = 'campaign-prospect-ref-b';
const profileId = 'campaign-prospect-ref-profile';
const versionA = 'campaign-prospect-ref-version-a';
const versionB = 'campaign-prospect-ref-version-b';
const poolId = 'campaign-prospect-ref-pool';
const assessmentA = 'campaign-prospect-ref-assessment-a';
const assessmentB = 'campaign-prospect-ref-assessment-b';
const leadA = 'campaign-prospect-ref-lead-a';
const leadB = 'campaign-prospect-ref-lead-b';

async function cleanup() {
  await prisma.campaignProspect.deleteMany({ where: { tenantId } });
  await prisma.leadPoolAssessment.deleteMany({ where: { tenantId } });
  await prisma.lead.deleteMany({ where: { tenantId } });
  await prisma.leadPoolItem.deleteMany({ where: { tenantId } });
  await prisma.campaign.deleteMany({ where: { tenantId } });
  await prisma.icpVersion.deleteMany({ where: { tenantId } });
  await prisma.icpProfile.deleteMany({ where: { tenantId } });
  await prisma.client.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
}

describe.skipIf(!hasDb)('CampaignProspect reference integrity', () => {
  beforeAll(async () => {
    await cleanup();
    await prisma.tenant.create({ data: { id: tenantId, name: 'Campaign Prospect Ref' } });
    await prisma.user.create({
      data: {
        id: userId,
        tenantId,
        email: 'campaign-prospect-ref@example.test',
        password: 'x',
        firstName: 'Casey',
        lastName: 'Rep',
      },
    });
    await prisma.client.create({
      data: {
        id: clientId,
        tenantId,
        name: 'Reference Client',
        industry: 'Software',
        contactName: 'Owner',
        contactEmail: 'owner@example.test',
      },
    });
    await prisma.icpProfile.create({
      data: { id: profileId, tenantId, name: 'Reference ICP' },
    });
    await prisma.icpVersion.createMany({
      data: [
        { id: versionA, tenantId, icpProfileId: profileId, versionNumber: 1, status: 'published' },
        { id: versionB, tenantId, icpProfileId: profileId, versionNumber: 2, status: 'published' },
      ],
    });
    await prisma.campaign.createMany({
      data: [
        {
          id: campaignA,
          tenantId,
          clientId,
          name: 'Campaign A',
          startDate: new Date('2026-09-01T00:00:00Z'),
          icpVersionId: versionA,
        },
        {
          id: campaignB,
          tenantId,
          clientId,
          name: 'Campaign B',
          startDate: new Date('2026-09-01T00:00:00Z'),
          icpVersionId: versionB,
        },
      ],
    });
    await prisma.leadPoolItem.create({
      data: { id: poolId, tenantId, company: 'Reusable Co', tags: [] },
    });
    await prisma.leadPoolAssessment.createMany({
      data: [
        {
          id: assessmentA,
          tenantId,
          poolItemId: poolId,
          icpVersionId: versionA,
          fitScore: 90,
          confidenceScore: 90,
          dataQualityScore: 80,
          qualification: 'qualified',
          inputSnapshot: {},
          rulesSnapshot: {},
          fingerprint: 'campaign-prospect-ref-fp-a',
        },
        {
          id: assessmentB,
          tenantId,
          poolItemId: poolId,
          icpVersionId: versionB,
          fitScore: 10,
          confidenceScore: 90,
          dataQualityScore: 80,
          qualification: 'unqualified',
          inputSnapshot: {},
          rulesSnapshot: {},
          fingerprint: 'campaign-prospect-ref-fp-b',
        },
      ],
    });
    await prisma.lead.createMany({
      data: [
        {
          id: leadA,
          tenantId,
          campaignId: campaignA,
          assignedToId: userId,
          firstName: 'Alex',
          lastName: 'A',
          company: 'Reusable Co',
          email: 'alex-a@example.test',
          tags: [],
        },
        {
          id: leadB,
          tenantId,
          campaignId: campaignB,
          assignedToId: userId,
          firstName: 'Alex',
          lastName: 'B',
          company: 'Reusable Co',
          email: 'alex-b@example.test',
          tags: [],
        },
      ],
    });
    await prisma.campaignProspect.createMany({
      data: [
        {
          id: 'campaign-prospect-ref-member-a',
          tenantId,
          campaignId: campaignA,
          poolItemId: poolId,
          assignedSdrId: userId,
          createdById: userId,
          leadId: leadA,
          assessedIcpVersionId: versionA,
          latestAssessmentId: assessmentA,
        },
        {
          id: 'campaign-prospect-ref-member-b',
          tenantId,
          campaignId: campaignB,
          poolItemId: poolId,
          assignedSdrId: userId,
          createdById: userId,
          leadId: leadB,
          assessedIcpVersionId: versionB,
          latestAssessmentId: assessmentB,
        },
      ],
    });
  });

  afterAll(async () => {
    if (hasDb) await cleanup();
  });

  it('keeps opposite ICP outcomes for the same reusable prospect', async () => {
    const rows = await prisma.campaignProspect.findMany({
      where: { tenantId, poolItemId: poolId },
      orderBy: { campaignId: 'asc' },
      include: { latestAssessment: { select: { qualification: true } } },
    });

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.latestAssessment?.qualification)).toEqual([
      'qualified',
      'unqualified',
    ]);
  });

  it('makes a changed campaign ICP visibly stale until rescore', async () => {
    await prisma.campaign.update({ where: { id: campaignA }, data: { icpVersionId: versionB } });
    try {
      const row = await prisma.campaignProspect.findUniqueOrThrow({
        where: {
          tenantId_campaignId_poolItemId: { tenantId, campaignId: campaignA, poolItemId: poolId },
        },
        include: { campaign: { select: { icpVersionId: true } } },
      });
      expect(row.assessedIcpVersionId).toBe(versionA);
      expect(row.assessedIcpVersionId).not.toBe(row.campaign.icpVersionId);
    } finally {
      await prisma.campaign.update({ where: { id: campaignA }, data: { icpVersionId: versionA } });
    }
  });

  it('rejects a duplicate campaign membership', async () => {
    await expect(
      prisma.campaignProspect.create({
        data: { tenantId, campaignId: campaignA, poolItemId: poolId },
      })
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects a lead from a different campaign', async () => {
    await prisma.campaignProspect.update({
      where: {
        tenantId_campaignId_poolItemId: { tenantId, campaignId: campaignA, poolItemId: poolId },
      },
      data: { leadId: null },
    });

    await expect(
      prisma.campaignProspect.update({
        where: {
          tenantId_campaignId_poolItemId: { tenantId, campaignId: campaignA, poolItemId: poolId },
        },
        data: { leadId: leadB },
      })
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('rejects an assessment for a different ICP version', async () => {
    await expect(
      prisma.campaignProspect.update({
        where: {
          tenantId_campaignId_poolItemId: { tenantId, campaignId: campaignA, poolItemId: poolId },
        },
        data: { latestAssessmentId: assessmentB },
      })
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('nulls optional references when the referenced rows are deleted', async () => {
    await prisma.lead.delete({ where: { id: leadB } });
    const afterLeadDelete = await prisma.campaignProspect.findUniqueOrThrow({
      where: {
        tenantId_campaignId_poolItemId: { tenantId, campaignId: campaignB, poolItemId: poolId },
      },
    });
    expect(afterLeadDelete.leadId).toBeNull();

    await prisma.lead.deleteMany({ where: { tenantId } });
    await prisma.user.delete({ where: { id: userId } });
    const rows = await prisma.campaignProspect.findMany({ where: { tenantId } });
    expect(rows.every((row) => row.assignedSdrId === null && row.createdById === null)).toBe(true);
  });
});
