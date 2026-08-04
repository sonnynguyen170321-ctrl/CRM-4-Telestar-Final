import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportReportToHTML } from '@/lib/client-reports/exporters';
import type { ClientReportSnapshot } from '@/lib/client-reports/types';

const mockPrisma = {
  opportunity: { findUnique: vi.fn(), update: vi.fn() },
  opportunityActivity: { create: vi.fn() },
  activity: { create: vi.fn() },
  // moveStage syncs the lead lifecycle on won/lost.
  lead: { update: vi.fn() },
};

vi.mock('@/lib/prisma', () => ({
  prisma: {
    opportunity: {
      findUnique: (...a: unknown[]) => mockPrisma.opportunity.findUnique(...a),
      update: (...a: unknown[]) => mockPrisma.opportunity.update(...a),
    },
    opportunityActivity: { create: (...a: unknown[]) => mockPrisma.opportunityActivity.create(...a) },
    activity: { create: (...a: unknown[]) => mockPrisma.activity.create(...a) },
    lead: { update: (...a: unknown[]) => mockPrisma.lead.update(...a) },
  },
}));

const user = { id: 'u1', role: 'director' as const, email: 'd@t.vn', firstName: 'D', lastName: '', tenantId: 't1' };

async function move(stage: string, opp: Record<string, unknown>) {
  const { moveStage } = await import('@/lib/opportunities/lifecycle');
  mockPrisma.opportunity.findUnique.mockResolvedValue({
    id: 'o1', stage: 'pending_client_review', status: 'open', handoffStatus: 'pending',
    lead: { id: 'l1' }, ...opp,
  });
  mockPrisma.opportunity.update.mockResolvedValue({
    id: 'o1', client: { id: 'c1', name: 'Acme' }, campaign: null, owner: null,
  });
  await moveStage({ opportunityId: 'o1', user, tenantId: 't1', stage, lostReason: stage === 'lost' ? 'budget' : undefined });
  return mockPrisma.opportunity.update.mock.calls[0][0].data as Record<string, unknown>;
}

beforeEach(() => vi.clearAllMocks());

/**
 * CRM-E-009. Only decideHandoff ever wrote handoffStatus, so walking the stage
 * dropdown — the obvious control — left every accepted deal at 'pending'. Client
 * acceptance rate, the core BPO quality metric, was structurally pinned at 0%
 * beside a six-figure won value.
 */
describe('moveStage records the client handoff decision', () => {
  it('marks accepted_by_client as accepted', async () => {
    expect(await move('accepted_by_client', {})).toMatchObject({ handoffStatus: 'accepted' });
  });

  it('marks a walk straight to won as accepted', async () => {
    expect(await move('won', {})).toMatchObject({ handoffStatus: 'accepted' });
  });

  it('marks a loss out of pending_client_review as rejected', async () => {
    expect(await move('lost', { stage: 'pending_client_review' })).toMatchObject({ handoffStatus: 'rejected' });
  });

  it('does NOT rewrite acceptance when a deal is lost after being accepted', async () => {
    const data = await move('lost', { stage: 'negotiation', handoffStatus: 'accepted' });
    expect(data.handoffStatus).toBeUndefined();
  });

  it('leaves nurture alone', async () => {
    const data = await move('nurture', {});
    expect(data.handoffStatus).toBeUndefined();
  });
});

/** CRM-E-006 — a draft must never export claiming approval. */
describe('report export approval honesty', () => {
  const snapshot = {
    meta: { clientName: 'Acme', campaignName: 'Q3', periodStart: '2026-07-01', periodEnd: '2026-07-07', version: 'v1' },
    kpis: {
      totalLeadsAssigned: 10, newLeadsAdded: 2, leadsTouched: 5, touchpointsCompleted: 12,
      replies: 3, replyRate: 0.6, meetingsBooked: 2, meetingsHeld: 1, meetingsCompleted: 1,
      noShows: 0, noShowRate: 0, qualifiedMeetings: 1, opportunitiesSubmitted: 1,
      clientAcceptedOpportunities: 1, clientRejectedOpportunities: 0, clientAcceptanceRate: 1,
      activePipelineValue: 1000, wonValue: 0, opportunityWinRate: 0,
    },
    funnel: [], channels: [], leadQuality: { imported: 10, validated: 9 },
    meetings: [], opportunities: [], reps: [],
    insights: { summary: '', keyWins: [], blockers: [], recommendations: [], clientActions: [] },
  } as unknown as ClientReportSnapshot;

  it('does not stamp a draft as Approved', () => {
    const html = exportReportToHTML(snapshot, { status: 'draft' });
    expect(html).not.toContain('Status: Approved');
    expect(html).toContain('DRAFT');
  });

  it('marks an approved report as approved, naming the approver', () => {
    const html = exportReportToHTML(snapshot, { status: 'approved', approvedByName: 'Dean' });
    expect(html).toContain('Status: Approved');
    expect(html).toContain('Dean');
    expect(html).not.toContain('DRAFT &mdash;');
  });

  it('treats a shared report as approved', () => {
    expect(exportReportToHTML(snapshot, { status: 'shared' })).toContain('Status: Approved');
  });

  it('defaults to draft when approval state is unknown, never to approved', () => {
    expect(exportReportToHTML(snapshot)).not.toContain('Status: Approved');
  });
});
