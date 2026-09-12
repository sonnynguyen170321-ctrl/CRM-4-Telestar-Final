import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = {
  campaign: { findFirst: vi.fn() },
  leadPoolItem: { findFirst: vi.fn() },
  campaignProspect: {
    findUnique: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  leadPoolAssessment: { findFirst: vi.fn() },
};

vi.mock('@/lib/prisma', () => ({ prisma: db }));
vi.mock('@/lib/leadgen/assignableReps', () => ({
  canAssignToRep: vi.fn().mockResolvedValue(true),
}));

const {
  CampaignProspectRemovedError,
  deriveCampaignProspectReadiness,
  ensureCampaignProspect,
} = await import('@/lib/leadgen/campaignProspects');

const actor = {
  id: 'manager-a',
  tenantId: 'tenant-a',
  email: 'manager@example.test',
  firstName: 'Morgan',
  lastName: 'Manager',
  role: 'leadgen_manager',
} as const;

const existing = {
  id: 'membership-a',
  tenantId: 'tenant-a',
  campaignId: 'campaign-a',
  poolItemId: 'pool-a',
  assignedSdrId: 'sdr-a',
  leadId: null,
  createdById: 'manager-a',
  assessedIcpVersionId: 'icp-v1',
  latestAssessmentId: 'assessment-v1',
  status: 'ready',
  addedAt: new Date(),
  activatedAt: null,
  completedAt: null,
  removedAt: null,
  removalReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('CampaignProspect runtime service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.campaign.findFirst.mockResolvedValue({ id: 'campaign-a', icpVersionId: 'icp-v1' });
    db.leadPoolItem.findFirst.mockResolvedValue({
      id: 'pool-a',
      email: 'person@example.test',
      emailValidation: 'deliverable',
    });
    db.campaignProspect.findUnique.mockResolvedValue(null);
    db.leadPoolAssessment.findFirst.mockResolvedValue({
      id: 'assessment-v1',
      icpVersionId: 'icp-v1',
    });
    db.campaignProspect.create.mockImplementation(async ({ data }) => ({
      ...existing,
      ...data,
      id: 'membership-a',
    }));
    db.campaignProspect.update.mockImplementation(async ({ data }) => ({
      ...existing,
      ...data,
    }));
  });

  it.each([
    [{ email: null, emailValidation: null }, 'needs_contact'],
    [{ email: 'bad-address', emailValidation: null }, 'needs_contact'],
    [{ email: 'person@example.test', emailValidation: 'undeliverable' }, 'needs_contact'],
    [{ email: 'person@example.test', emailValidation: null }, 'ready'],
    [{ email: 'person@example.test', emailValidation: 'deliverable' }, 'ready'],
  ] as const)('derives simple contact readiness for %o', (input, expected) => {
    expect(deriveCampaignProspectReadiness(input)).toBe(expected);
  });

  it('creates one membership with the assessment for the campaign ICP', async () => {
    const row = await ensureCampaignProspect({
      tenantId: 'tenant-a',
      campaignId: 'campaign-a',
      poolItemId: 'pool-a',
      assignedSdrId: 'sdr-a',
      actor,
    });

    expect(row.status).toBe('ready');
    expect(db.campaignProspect.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-a',
        campaignId: 'campaign-a',
        poolItemId: 'pool-a',
        assessedIcpVersionId: 'icp-v1',
        latestAssessmentId: 'assessment-v1',
      }),
    });
  });

  it('is a no-write retry when membership state is unchanged', async () => {
    db.campaignProspect.findUnique.mockResolvedValue(existing);

    const row = await ensureCampaignProspect({
      tenantId: 'tenant-a',
      campaignId: 'campaign-a',
      poolItemId: 'pool-a',
      assignedSdrId: 'sdr-a',
      actor,
    });

    expect(row).toBe(existing);
    expect(db.campaignProspect.update).not.toHaveBeenCalled();
    expect(db.campaignProspect.create).not.toHaveBeenCalled();
  });

  it('preserves the prior assessment as stale when the campaign changes ICP', async () => {
    db.campaign.findFirst.mockResolvedValue({ id: 'campaign-a', icpVersionId: 'icp-v2' });
    db.campaignProspect.findUnique.mockResolvedValue(existing);
    db.leadPoolAssessment.findFirst.mockResolvedValue(null);

    const row = await ensureCampaignProspect({
      tenantId: 'tenant-a',
      campaignId: 'campaign-a',
      poolItemId: 'pool-a',
      actor,
    });

    expect(row.assessedIcpVersionId).toBe('icp-v1');
    expect(row.latestAssessmentId).toBe('assessment-v1');
    expect(db.campaignProspect.update).not.toHaveBeenCalled();
  });

  it('converges a create race onto the requested assignment', async () => {
    db.campaignProspect.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...existing, assignedSdrId: null })
      .mockResolvedValueOnce({ ...existing, assignedSdrId: null });
    db.campaignProspect.create.mockRejectedValueOnce({ code: 'P2002' });

    const row = await ensureCampaignProspect({
      tenantId: 'tenant-a',
      campaignId: 'campaign-a',
      poolItemId: 'pool-a',
      assignedSdrId: 'sdr-a',
      actor,
    });

    expect(row.assignedSdrId).toBe('sdr-a');
    expect(db.campaignProspect.update).toHaveBeenCalledTimes(1);
  });

  it('never implicitly reopens a removed membership', async () => {
    db.campaignProspect.findUnique.mockResolvedValue({ ...existing, status: 'removed' });

    await expect(
      ensureCampaignProspect({
        tenantId: 'tenant-a',
        campaignId: 'campaign-a',
        poolItemId: 'pool-a',
        actor,
      })
    ).rejects.toBeInstanceOf(CampaignProspectRemovedError);
  });

  it('rejects an actor from another tenant before any read', async () => {
    await expect(
      ensureCampaignProspect({
        tenantId: 'tenant-a',
        campaignId: 'campaign-a',
        poolItemId: 'pool-a',
        actor: { ...actor, tenantId: 'tenant-b' },
      })
    ).rejects.toThrow('campaign_prospect_actor_tenant_mismatch');

    expect(db.campaign.findFirst).not.toHaveBeenCalled();
  });
});
