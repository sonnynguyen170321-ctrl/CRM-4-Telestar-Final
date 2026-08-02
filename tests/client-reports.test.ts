import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  canCreateClientReport,
  canApproveClientReport,
  canShareClientReport,
  canViewClientReport,
  canEditClientReport,
} from '@/lib/client-reports/access';
import {
  sanitizeClientNotes,
  anonymizeSdrName,
  sanitizeInsightArray,
} from '@/lib/client-reports/sanitization';
import {
  hashToken,
  hashPassword,
  verifyPassword,
} from '@/lib/client-reports/shareLinks';
import {
  exportReportToCSV,
  exportReportToHTML,
} from '@/lib/client-reports/exporters';
import {
  createClientReportSchema,
  updateClientReportSchema,
  createShareLinkSchema,
} from '@/lib/validation/schemas';
import { ClientReportSnapshot } from '@/lib/client-reports/types';
import { buildReportMetrics } from '@/lib/client-reports/metrics';

const mockPrismaClient = {
  client: { findUnique: vi.fn() },
  campaign: { findUnique: vi.fn() },
  lead: { count: vi.fn(), groupBy: vi.fn() },
  activity: { findMany: vi.fn() },
  meeting: { findMany: vi.fn() },
  opportunity: { findMany: vi.fn() },
  outboundMessage: { findMany: vi.fn() },
};

vi.mock('@/lib/prisma', () => ({
  prisma: {
    client: { findUnique: (...args: unknown[]) => mockPrismaClient.client.findUnique(...args) },
    campaign: { findUnique: (...args: unknown[]) => mockPrismaClient.campaign.findUnique(...args) },
    lead: {
      count: (...args: unknown[]) => mockPrismaClient.lead.count(...args),
      groupBy: (...args: unknown[]) => mockPrismaClient.lead.groupBy(...args),
    },
    activity: { findMany: (...args: unknown[]) => mockPrismaClient.activity.findMany(...args) },
    meeting: { findMany: (...args: unknown[]) => mockPrismaClient.meeting.findMany(...args) },
    opportunity: { findMany: (...args: unknown[]) => mockPrismaClient.opportunity.findMany(...args) },
    outboundMessage: { findMany: (...args: unknown[]) => mockPrismaClient.outboundMessage.findMany(...args) },
  },
}));

describe('Client Reports Module - Unit Tests', () => {
  describe('1. Access Control (RBAC)', () => {
    const director = { id: 'u1', email: 'dir@telestar.test', firstName: 'Diana', lastName: 'Director', role: 'director' as const, tenantId: 'tenant-1' };
    const floorManager = { id: 'u2', email: 'fm@telestar.test', firstName: 'Frank', lastName: 'Manager', role: 'floor_manager' as const, tenantId: 'tenant-1' };
    const teamLead = { id: 'u3', email: 'tl@telestar.test', firstName: 'Tom', lastName: 'Lead', role: 'team_lead' as const, tenantId: 'tenant-1' };
    const sdr = { id: 'u4', email: 'sdr@telestar.test', firstName: 'Sam', lastName: 'Rep', role: 'sdr' as const, tenantId: 'tenant-1' };
    const leadgen = { id: 'u5', email: 'lg@telestar.test', firstName: 'Leo', lastName: 'Gen', role: 'leadgen' as const, tenantId: 'tenant-1' };

    it('allows director, floor_manager, team_lead, sdr to create reports', () => {
      expect(canCreateClientReport(director)).toBe(true);
      expect(canCreateClientReport(floorManager)).toBe(true);
      expect(canCreateClientReport(teamLead)).toBe(true);
      expect(canCreateClientReport(sdr)).toBe(true);
      expect(canCreateClientReport(leadgen)).toBe(false);
    });

    it('only allows director and floor_manager to approve reports', () => {
      expect(canApproveClientReport(director)).toBe(true);
      expect(canApproveClientReport(floorManager)).toBe(true);
      expect(canApproveClientReport(teamLead)).toBe(false);
      expect(canApproveClientReport(sdr)).toBe(false);
    });

    it('only allows director, floor_manager, team_lead to generate share links', () => {
      expect(canShareClientReport(director)).toBe(true);
      expect(canShareClientReport(floorManager)).toBe(true);
      expect(canShareClientReport(teamLead)).toBe(true);
      expect(canShareClientReport(sdr)).toBe(false);
    });

    it('prevents cross-tenant viewing', () => {
      const report = {
        id: 'rep-1',
        tenantId: 'tenant-1',
        status: 'approved',
        audience: 'client',
        generatedById: 'u4',
      };
      expect(canViewClientReport(director, report)).toBe(true);

      const otherTenantUser = { ...director, tenantId: 'tenant-2' };
      expect(canViewClientReport(otherTenantUser, report)).toBe(false);
    });

    it('prevents editing approved/archived reports', () => {
      const draftReport = { id: 'rep-1', tenantId: 'tenant-1', status: 'draft', generatedById: 'u4' };
      const approvedReport = { id: 'rep-2', tenantId: 'tenant-1', status: 'approved', generatedById: 'u4' };

      expect(canEditClientReport(floorManager, draftReport)).toBe(true);
      expect(canEditClientReport(sdr, draftReport)).toBe(true);
      expect(canEditClientReport(floorManager, approvedReport)).toBe(false);
    });
  });

  describe('2. Sanitization and SDR Anonymization', () => {
    it('removes internal tags and sensitive annotations from notes', () => {
      const rawNotes = 'Prospect confirmed interest. [INTERNAL: SDR quota 50% met, commission: $200]. Needs follow-up via phone.';
      const clean = sanitizeClientNotes(rawNotes);
      expect(clean).not.toContain('INTERNAL');
      expect(clean).not.toContain('commission: $200');
      expect(clean).toContain('Prospect confirmed interest.');
      expect(clean).toContain('Needs follow-up via phone.');
    });

    it('strips vendor tags and confidential markings', () => {
      const raw = 'Qualified lead. [[CONFIDENTIAL: Vendor lead list pricing $15]] Meeting set for Friday.';
      const clean = sanitizeClientNotes(raw);
      expect(clean).not.toContain('CONFIDENTIAL');
      expect(clean).not.toContain('Vendor lead list pricing');
      expect(clean).toContain('Qualified lead.');
      expect(clean).toContain('Meeting set for Friday.');
    });

    it('anonymizes SDR names according to display mode', () => {
      expect(anonymizeSdrName('Sarah Connor', 'full_name')).toBe('Sarah Connor');
      expect(anonymizeSdrName('Sarah Connor', 'first_only')).toBe('Sarah');
      expect(anonymizeSdrName('Sarah Connor', 'first_last_initial')).toBe('Sarah C.');
      expect(anonymizeSdrName('Sarah Connor', 'anonymized')).toBe('Outreach Representative');
      expect(anonymizeSdrName(null, 'first_last_initial')).toBe('Outreach Representative');
    });

    it('sanitizes arrays of strategic insights', () => {
      const raw = [
        'Outreach to fintech VPs converted at 4.2%',
        'Internal: Vendor list quality was poor, quota missed',
        'Target enterprise companies with >500 headcount',
      ];
      const cleaned = sanitizeInsightArray(raw);
      expect(cleaned.length).toBe(3);
      expect(cleaned[1]).not.toContain('Internal:');
    });
  });

  describe('3. Token Hashing & Share Links', () => {
    it('hashes tokens deterministically with SHA-256', () => {
      const rawToken = 'abc123token456sample789xyz00000000000000000000';
      const hash1 = hashToken(rawToken);
      const hash2 = hashToken(rawToken);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
      expect(hash1).not.toBe(rawToken);
    });

    it('hashes and validates passwords with salt correctly', () => {
      const password = 'ClientSecret2026!';
      const hash = hashPassword(password);

      expect(hash).toContain('crm_salt_');
      expect(verifyPassword(password, hash)).toBe(true);
      expect(verifyPassword('WrongPassword', hash)).toBe(false);
    });
  });

  describe('4. Exporters (CSV & HTML Print)', () => {
    const mockSnapshot: ClientReportSnapshot = {
      meta: {
        version: 'v1',
        clientId: 'client-1',
        clientName: 'Acme Enterprises',
        campaignId: 'camp-1',
        campaignName: 'Q1 Enterprise Outreach',
        periodType: 'weekly',
        periodStart: '2026-07-01T00:00:00.000Z',
        periodEnd: '2026-07-07T23:59:59.000Z',
        audience: 'client',
        sdrDisplayMode: 'first_last_initial',
        generatedAt: '2026-07-08T10:00:00.000Z',
        generatedById: 'u1',
        generatedByName: 'Diana Director',
      },
      kpis: {
        totalLeadsAssigned: 500,
        newLeadsAdded: 50,
        leadsTouched: 450,
        touchpointsCompleted: 1200,
        replies: 45,
        positiveReplies: 20,
        replyRate: 0.1,
        positiveReplyRate: 0.044,
        meetingsBooked: 18,
        meetingsCompleted: 15,
        noShows: 3,
        noShowRate: 0.166,
        qualifiedMeetings: 12,
        opportunitiesSubmitted: 12,
        clientAcceptedOpportunities: 10,
        clientRejectedOpportunities: 2,
        clientAcceptanceRate: 0.833,
        activePipelineValue: 150000,
        wonValue: 45000,
        opportunityWinRate: 0.3,
      },
      funnel: [
        { stage: 'assigned', label: 'Leads Assigned', count: 500, conversionRate: 1 },
        { stage: 'contacted', label: 'Prospects Contacted', count: 450, conversionRate: 0.9 },
        { stage: 'replied', label: 'Replies', count: 45, conversionRate: 0.1 },
        { stage: 'meeting_booked', label: 'Meetings Booked', count: 18, conversionRate: 0.4 },
        { stage: 'meeting_held', label: 'Meetings Held', count: 15, conversionRate: 0.833 },
        { stage: 'opportunity_accepted', label: 'Opportunities Accepted', count: 10, conversionRate: 0.667 },
      ],
      channels: [
        { channel: 'email', label: 'Email', touchpoints: 800, replies: 30, meetingsBooked: 12, conversionRate: 0.0375 },
        { channel: 'call', label: 'Cold Calls', touchpoints: 300, replies: 10, meetingsBooked: 5, conversionRate: 0.0333 },
        { channel: 'linkedin', label: 'LinkedIn', touchpoints: 100, replies: 5, meetingsBooked: 1, conversionRate: 0.05 },
      ],
      leadQuality: {
        imported: 500,
        validated: 480,
        qualified: 300,
        rejected: 20,
        duplicateRate: 0.02,
        averageEmailScore: 88,
        topSources: [{ source: 'Apollo', qualified: 200, meetings: 12 }],
      },
      meetings: [
        {
          id: 'mtg-1',
          company: 'Globex Corp',
          contactName: 'Hank Scorpio',
          contactTitle: 'CEO',
          scheduledAt: '2026-07-03T14:00:00.000Z',
          status: 'completed',
          outcome: 'qualified_demo_scheduled',
          sdrDisplayName: 'Sam R.',
          summaryNotes: 'Strong interest in enterprise tier.',
          nextStep: 'Send proposal',
        },
      ],
      opportunities: [
        {
          id: 'opp-1',
          company: 'Globex Corp',
          title: 'Globex Enterprise Deployment',
          stage: 'proposal',
          handoffStatus: 'accepted',
          value: 50000,
          probability: 80,
          nextStep: 'Legal review',
        },
      ],
      reps: [
        {
          repId: 'u4',
          displayName: 'Sam R.',
          leadsTouched: 450,
          touchpoints: 1200,
          replies: 45,
          meetingsBooked: 18,
          qualifiedMeetings: 12,
          acceptedOpportunities: 10,
        },
      ],
      insights: {
        summary: 'Strong outbound performance across enterprise segment.',
        keyWins: ['Exceeded weekly meeting target by 20%'],
        blockers: [],
        recommendations: ['Expand outreach to mid-market accounts'],
        clientActions: ['Review proposals for Globex Corp'],
      },
    };

    it('exports clean formatted CSV string', () => {
      const csv = exportReportToCSV(mockSnapshot);
      expect(csv).toContain('Acme Enterprises');
      expect(csv).toContain('Q1 Enterprise Outreach');
      expect(csv).toContain('KPI,Value');
      expect(csv).toContain('Prospects Contacted,450');
      expect(csv).toContain('Meetings Booked,18');
      expect(csv).toContain('Globex Corp');
      expect(csv).toContain('Hank Scorpio');
    });

    it('exports self-contained printable HTML document', () => {
      const html = exportReportToHTML(mockSnapshot);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Acme Enterprises');
      expect(html).toContain('Globex Enterprise Deployment');
      expect(html).toContain('window.print()');
      expect(html).toContain('450');
      expect(html).toContain('$150,000');
    });
  });

  describe('5. Zod Schemas Validation', () => {
    it('validates valid report creation payload', () => {
      const payload = {
        clientId: 'cli-1234',
        campaignId: 'camp-5678',
        title: 'Weekly Client Update',
        periodType: 'weekly',
        periodStart: '2026-07-01T00:00:00.000Z',
        periodEnd: '2026-07-07T23:59:59.000Z',
        audience: 'client',
      };
      const res = createClientReportSchema.safeParse(payload);
      expect(res.success).toBe(true);
    });

    it('rejects invalid periodType or audience', () => {
      const payload = {
        clientId: 'cli-1234',
        periodStart: '2026-07-01T00:00:00.000Z',
        periodEnd: '2026-07-07T23:59:59.000Z',
        periodType: 'invalid_cadence',
      };
      const res = createClientReportSchema.safeParse(payload);
      expect(res.success).toBe(false);
    });

    it('validates share link creation schema', () => {
      const validLink = {
        expiresAt: '2026-08-01T00:00:00.000Z',
        password: 'PassWord123',
      };
      expect(createShareLinkSchema.safeParse(validLink).success).toBe(true);

      const emptyLink = {};
      expect(createShareLinkSchema.safeParse(emptyLink).success).toBe(true);
    });
  });

  describe('6. buildReportMetrics query scoping', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockPrismaClient.client.findUnique.mockResolvedValue({ id: 'cli-1', name: 'Acme Corp' });
      mockPrismaClient.campaign.findUnique.mockResolvedValue({ id: 'camp-1', name: 'Outreach Q1' });
      mockPrismaClient.lead.count.mockResolvedValue(10);
      mockPrismaClient.lead.groupBy.mockResolvedValue([]);
      mockPrismaClient.activity.findMany.mockResolvedValue([]);
      mockPrismaClient.meeting.findMany.mockResolvedValue([]);
      mockPrismaClient.opportunity.findMany.mockResolvedValue([]);
      mockPrismaClient.outboundMessage.findMany.mockResolvedValue([]);
    });

    it('scopes lead queries through campaign relation instead of direct lead.clientId', async () => {
      const snapshot = await buildReportMetrics({
        clientId: 'cli-1',
        campaignId: 'camp-1',
        periodStart: new Date('2026-07-01'),
        periodEnd: new Date('2026-07-07'),
        generatedById: 'u1',
        generatedByName: 'Dean Director',
      });

      expect(snapshot.meta.clientName).toBe('Acme Corp');
      expect(mockPrismaClient.lead.count).toHaveBeenCalledWith({
        where: {
          campaign: {
            clientId: 'cli-1',
            id: 'camp-1',
          },
          archivedAt: null,
        },
      });

      expect(mockPrismaClient.meeting.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            clientId: 'cli-1',
            campaignId: 'camp-1',
            scheduledAt: expect.any(Object),
          },
        })
      );
    });
  });
});

