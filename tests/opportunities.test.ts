import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock @/auth so next-auth is not pulled into Vitest
vi.mock('@/auth', () => ({
  auth: vi.fn(),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

// Mock @/lib/auth
vi.mock('@/lib/auth', async () => {
  return {
    canAccessLead: vi.fn((user: any, lead: any) => {
      if (user.role === 'director' || user.role === 'floor_manager' || user.role === 'team_lead') {
        return Promise.resolve(true);
      }
      return Promise.resolve(lead?.assignedToId === user.id);
    }),
    getVisibleCampaignIds: vi.fn(async (user: any) => {
      if (user.role === 'director' || user.role === 'floor_manager' || user.role === 'team_lead') {
        return null;
      }
      return ['camp-1'];
    }),
  };
});

// Mock prisma
vi.mock('@/lib/prisma', () => {
  return {
    prisma: {
      opportunity: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      opportunityActivity: {
        create: vi.fn(),
      },
      activity: {
        create: vi.fn(),
      },
      lead: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      task: {
        create: vi.fn(),
      },
    },
  };
});

import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/auth';
import { createOpportunityFromQualifiedMeeting, createManualOpportunity } from '@/lib/opportunities/service';
import { moveStage, decideHandoff } from '@/lib/opportunities/lifecycle';
import { buildSummary, acceptanceRate } from '@/lib/opportunities/metrics';
import { canAccessOpportunity, canApproveClientHandoff } from '@/lib/opportunities/access';
import { handoffDecisionSchema, updateOpportunityStageSchema, logMeetingOutcomeSchema } from '@/lib/validation/schemas';

const manager: SessionUser = {
  id: 'user-manager',
  role: 'floor_manager',
  tenantId: 'tenant-1',
  email: 'manager@telestar.com',
  firstName: 'Manager',
  lastName: 'One',
} as SessionUser;

const sdr: SessionUser = {
  id: 'user-sdr',
  role: 'sdr',
  tenantId: 'tenant-1',
  email: 'sdr@telestar.com',
  firstName: 'SDR',
  lastName: 'One',
} as SessionUser;

const leadSeed = {
  id: 'lead-1',
  tenantId: 'tenant-1',
  campaignId: 'camp-1',
  accountId: 'acct-1',
  contactId: 'contact-1',
  assignedToId: 'user-sdr',
  firstName: 'Jane',
  lastName: 'Doe',
  company: 'Acme Corp',
  email: 'jane@acme.com',
  phone: '+15551234567',
  title: 'VP Ops',
  stage: 'meeting',
  campaign: { clientId: 'client-1', client: { id: 'client-1', name: 'Telestar Client' } },
  account: { id: 'acct-1', name: 'Acme Corp' },
  contact: { id: 'contact-1', firstName: 'Jane', lastName: 'Doe' },
  assignedTo: { id: 'user-sdr', firstName: 'SDR', lastName: 'One' },
};

const createdOpp = {
  id: 'opp-1',
  tenantId: 'tenant-1',
  clientId: 'client-1',
  campaignId: 'camp-1',
  leadId: 'lead-1',
  ownerId: 'user-sdr',
  createdById: 'user-sdr',
  title: 'Acme Corp - Jane Doe',
  company: 'Acme Corp',
  stage: 'pending_client_review',
  status: 'open',
  handoffStatus: 'pending',
  probability: 10,
  currency: 'USD',
  client: { id: 'client-1', name: 'Telestar Client' },
  campaign: { id: 'camp-1', name: 'Summer 2026' },
  owner: { id: 'user-sdr', firstName: 'SDR', lastName: 'One' },
  meeting: { id: 'meet-1', title: 'Intro call' },
};

describe('opportunities/service — createOpportunityFromQualifiedMeeting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an opportunity once and is idempotent on re-submit', async () => {
    (prisma.lead.findUnique as any).mockResolvedValue(leadSeed);
    (prisma.opportunity.findFirst as any).mockResolvedValueOnce(null);
    (prisma.opportunity.create as any).mockResolvedValue(createdOpp);

    await createOpportunityFromQualifiedMeeting({
      user: sdr,
      leadId: 'lead-1',
      meetingId: 'meet-1',
      qualificationSummary: 'Strong fit, budget confirmed',
      value: 50000,
      nextStep: 'Send proposal',
      nextStepAt: new Date('2026-09-01'),
    });

    // Idempotency: the second submit finds the existing open opportunity.
    (prisma.opportunity.findFirst as any).mockResolvedValueOnce(createdOpp);
    const again = await createOpportunityFromQualifiedMeeting({
      user: sdr,
      leadId: 'lead-1',
      meetingId: 'meet-1',
    });

    expect(again).toEqual(createdOpp);
    expect(prisma.opportunity.create).toHaveBeenCalledTimes(1);

    const createArg = (prisma.opportunity.create as any).mock.calls[0][0].data;
    expect(createArg.tenantId).toBe('tenant-1');
    expect(createArg.clientId).toBe('client-1');
    expect(createArg.campaignId).toBe('camp-1');
    expect(createArg.leadId).toBe('lead-1');
    expect(createArg.meetingId).toBe('meet-1');
    expect(createArg.ownerId).toBe('user-sdr');
    expect(createArg.stage).toBe('pending_client_review');
    expect(createArg.handoffStatus).toBe('pending');
    expect(createArg.status).toBe('open');
    expect(createArg.source).toBe('meeting_outcome');
    expect(createArg.probability).toBe(10);
    expect(createArg.currency).toBe('USD');
    expect(createArg.title).toBe('Acme Corp - Jane Doe');
    expect(createArg.value).toBe(50000);
    expect(createArg.qualificationSummary).toBe('Strong fit, budget confirmed');

    // Both activity logs written (opportunity + lead feed)
    expect(prisma.opportunityActivity.create).toHaveBeenCalledTimes(1);
    expect(prisma.activity.create).toHaveBeenCalledTimes(1);
  });
});

describe('opportunities/service — createManualOpportunity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a manual opportunity with defaults and logs activity', async () => {
    (prisma.opportunity.create as any).mockResolvedValue(createdOpp);

    const result = await createManualOpportunity({
      user: manager,
      tenantId: 'tenant-1',
      data: {
        clientId: 'client-1',
        campaignId: 'camp-1',
        title: 'Manual deal',
        company: 'Acme Corp',
      },
    });

    expect(result).toEqual(createdOpp);
    const createArg = (prisma.opportunity.create as any).mock.calls[0][0].data;
    expect(createArg.source).toBe('manual');
    expect(createArg.stage).toBe('pending_client_review');
    expect(createArg.handoffStatus).toBe('pending');
    expect(createArg.probability).toBe(10);
    expect(createArg.currency).toBe('USD');
    expect(prisma.opportunityActivity.create).toHaveBeenCalledTimes(1);
  });
});

describe('opportunities/lifecycle — moveStage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks won: status, closedAt, activity type, lead stage sync', async () => {
    (prisma.opportunity.findUnique as any).mockResolvedValue({
      id: 'opp-1',
      stage: 'negotiation',
      status: 'open',
      tenantId: 'tenant-1',
      lead: { id: 'lead-1' },
    });
    (prisma.opportunity.update as any).mockResolvedValue(createdOpp);

    await moveStage({
      opportunityId: 'opp-1',
      user: manager,
      tenantId: 'tenant-1',
      stage: 'won',
    });

    const updateArg = (prisma.opportunity.update as any).mock.calls[0][0].data;
    expect(updateArg.stage).toBe('won');
    expect(updateArg.status).toBe('won');
    expect(updateArg.closedAt).toBeInstanceOf(Date);

    const activityArg = (prisma.opportunityActivity.create as any).mock.calls[0][0].data;
    expect(activityArg.type).toBe('closed_won');

    expect(prisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: { stage: 'won' },
    });
  });

  it('throws when moving to lost without a lost reason', async () => {
    (prisma.opportunity.findUnique as any).mockResolvedValue({
      id: 'opp-1',
      stage: 'discovery',
      status: 'open',
      lead: null,
    });

    await expect(
      moveStage({
        opportunityId: 'opp-1',
        user: manager,
        tenantId: 'tenant-1',
        stage: 'lost',
      }),
    ).rejects.toThrow('Lost reason is required');
  });
});

describe('opportunities/lifecycle — decideHandoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const oppWithLead = {
    id: 'opp-1',
    tenantId: 'tenant-1',
    title: 'Acme Corp - Jane Doe',
    lead: { id: 'lead-1' },
    owner: { id: 'user-sdr', firstName: 'SDR', lastName: 'One' },
  };

  it('accepted → active pipeline stage', async () => {
    (prisma.opportunity.findUnique as any).mockResolvedValue(oppWithLead);
    (prisma.opportunity.update as any).mockResolvedValue(createdOpp);

    await decideHandoff({
      opportunityId: 'opp-1',
      user: manager,
      tenantId: 'tenant-1',
      decision: 'accepted',
      clientFeedback: 'Sounds good, send proposal',
    });

    const updateArg = (prisma.opportunity.update as any).mock.calls[0][0].data;
    expect(updateArg.handoffStatus).toBe('accepted');
    expect(updateArg.stage).toBe('accepted_by_client');
    expect(updateArg.status).toBe('open');

    expect((prisma.opportunityActivity.create as any).mock.calls[0][0].data.type).toBe('client_accepted');
    // No lead stage sync for accepted
    expect(prisma.lead.update).not.toHaveBeenCalled();
  });

  it('rejected defaults lost reason to client_rejected and syncs lead to lost', async () => {
    (prisma.opportunity.findUnique as any).mockResolvedValue(oppWithLead);
    (prisma.opportunity.update as any).mockResolvedValue(createdOpp);

    await decideHandoff({
      opportunityId: 'opp-1',
      user: manager,
      tenantId: 'tenant-1',
      decision: 'rejected',
    });

    const updateArg = (prisma.opportunity.update as any).mock.calls[0][0].data;
    expect(updateArg.handoffStatus).toBe('rejected');
    expect(updateArg.stage).toBe('lost');
    expect(updateArg.status).toBe('rejected');
    expect(updateArg.lostReason).toBe('client_rejected');

    expect(prisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: { stage: 'lost' },
    });
  });

  it('needs_more_info creates a follow-up task only when a lead exists', async () => {
    (prisma.opportunity.findUnique as any).mockResolvedValue(oppWithLead);
    (prisma.opportunity.update as any).mockResolvedValue(createdOpp);

    await decideHandoff({
      opportunityId: 'opp-1',
      user: manager,
      tenantId: 'tenant-1',
      decision: 'needs_more_info',
    });

    expect(prisma.task.create).toHaveBeenCalledTimes(1);
    expect((prisma.task.create as any).mock.calls[0][0].data.leadId).toBe('lead-1');
    expect((prisma.task.create as any).mock.calls[0][0].data.userId).toBe('user-sdr');

    // Without a lead, no task is created
    (prisma.opportunity.findUnique as any).mockResolvedValue({ ...oppWithLead, lead: null });
    (prisma.opportunity.update as any).mockResolvedValue(createdOpp);
    (prisma.task.create as any).mockClear();

    await decideHandoff({
      opportunityId: 'opp-1',
      user: manager,
      tenantId: 'tenant-1',
      decision: 'needs_more_info',
    });

    expect(prisma.task.create).not.toHaveBeenCalled();
  });
});

describe('opportunities/metrics', () => {
  it('builds pipeline + weighted value only for open opportunities', () => {
    const summary = buildSummary([
      { stage: 'discovery', status: 'open', value: 1000, probability: 50 },
      { stage: 'won', status: 'won', value: 2000, probability: 100 },
      { stage: 'lost', status: 'lost', value: 3000, probability: 20 },
      { stage: 'pending_client_review', status: 'open', value: null, probability: 10 },
    ]);

    expect(summary.totalOpen).toBe(2);
    expect(summary.pendingClientReview).toBe(1);
    expect(summary.won).toBe(1);
    expect(summary.lost).toBe(1);
    expect(summary.totalPipelineValue).toBe(1000);
    expect(summary.weightedPipelineValue).toBe(500);
  });

  it('computes acceptance rate as a percentage', () => {
    expect(acceptanceRate(3, 4)).toBe(75);
    expect(acceptanceRate(0, 0)).toBe(0);
  });
});

describe('opportunities/access', () => {
  it('director bypasses all checks; sdr only own rows', async () => {
    const opp = { ownerId: 'user-sdr', createdById: 'user-sdr', campaignId: 'camp-1', lead: null };
    expect(await canAccessOpportunity(manager, opp)).toBe(true);
    expect(await canAccessOpportunity(sdr, opp)).toBe(true);

    const other = { ownerId: 'user-other', createdById: 'user-other', campaignId: 'camp-other', lead: null };
    expect(await canAccessOpportunity(sdr, other)).toBe(false);
  });

  it('only manager roles may approve client handoffs', () => {
    expect(canApproveClientHandoff(manager)).toBe(true);
    expect(canApproveClientHandoff(sdr)).toBe(false);
  });
});

describe('opportunities/validation', () => {
  it('handoff rejection requires a lost reason', () => {
    const bad = handoffDecisionSchema.safeParse({ decision: 'rejected' });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues.some(i => i.path.includes('lostReason'))).toBe(true);
    }

    const ok = handoffDecisionSchema.safeParse({ decision: 'rejected', lostReason: 'no_budget' });
    expect(ok.success).toBe(true);

    const accepted = handoffDecisionSchema.safeParse({ decision: 'accepted' });
    expect(accepted.success).toBe(true);
  });

  it('stage schema bounds probability', () => {
    expect(updateOpportunityStageSchema.safeParse({ stage: 'won', probability: 101 }).success).toBe(false);
    expect(updateOpportunityStageSchema.safeParse({ stage: 'won', probability: -1 }).success).toBe(false);
    expect(updateOpportunityStageSchema.safeParse({ stage: 'won', probability: 80 }).success).toBe(true);
    expect(updateOpportunityStageSchema.safeParse({ stage: 'lost' }).success).toBe(false);
  });

  it('meeting outcome schema accepts opportunity fields', () => {
    const parsed = logMeetingOutcomeSchema.safeParse({
      status: 'completed',
      outcome: 'qualified_opportunity',
      createOpportunity: true,
      opportunityValue: '25000',
      opportunityCurrency: 'USD',
      opportunityClientOwnerName: 'Sarah',
      opportunityClientOwnerEmail: 'sarah@client.com',
      qualificationSummary: 'Budget + authority confirmed',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.opportunityValue).toBe(25000);
    }
  });
});
