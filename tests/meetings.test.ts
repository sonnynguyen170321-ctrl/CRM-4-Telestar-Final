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
  };
});

import { resolveBookingLink } from '@/lib/meetings/bookingLinks';
import { canAccessMeeting } from '@/lib/meetings/meetingAccess';
import { bookMeeting, logMeetingOutcome } from '@/lib/meetings/meetingLifecycle';
import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/auth';

// Mock prisma
vi.mock('@/lib/prisma', () => {
  return {
    prisma: {
      bookingLink: {
        findFirst: vi.fn(),
      },
      lead: {
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        update: vi.fn(),
      },
      meeting: {
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      activity: {
        create: vi.fn(),
      },
      task: {
        create: vi.fn(),
      },
      sequenceEnrollment: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    },
  };
});

// Mock pauseSequence
vi.mock('@/lib/sequences/engine', () => ({
  pauseSequence: vi.fn().mockResolvedValue({ success: true }),
}));

describe('Booking Link Resolver (Waterfall Logic)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves by specific bookingLinkId when provided', async () => {
    const mockLink = { id: 'link-1', name: 'Specific Link', url: 'https://cal.com/link1', isActive: true };
    (prisma.bookingLink.findFirst as any).mockResolvedValueOnce(mockLink);

    const result = await resolveBookingLink({
      tenantId: 'tenant-1',
      clientId: 'client-1',
      campaignId: 'camp-1',
      bookingLinkId: 'link-1',
    });

    expect(prisma.bookingLink.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'link-1',
        tenantId: 'tenant-1',
        clientId: 'client-1',
        isActive: true,
        OR: [{ campaignId: 'camp-1' }, { campaignId: null }],
      },
    });
    expect(result).toEqual(mockLink);
  });

  it('falls back through waterfall when bookingLinkId is not passed', async () => {
    const clientDefault = { id: 'link-default', name: 'Client Default', url: 'https://cal.com/default', isDefault: true };
    (prisma.bookingLink.findFirst as any)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(clientDefault);

    const result = await resolveBookingLink({
      tenantId: 'tenant-1',
      clientId: 'client-1',
      campaignId: 'camp-1',
    });

    expect(prisma.bookingLink.findFirst).toHaveBeenCalledTimes(2);
    expect(result).toEqual(clientDefault);
  });
});

describe('Meeting Access Control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const director: SessionUser = {
    id: 'dir-1',
    email: 'director@example.com',
    firstName: 'Boss',
    lastName: 'Man',
    role: 'director',
  };

  const sdr1: SessionUser = {
    id: 'sdr-1',
    email: 'sdr1@example.com',
    firstName: 'John',
    lastName: 'Doe',
    role: 'sdr',
  };

  const sdr2: SessionUser = {
    id: 'sdr-2',
    email: 'sdr2@example.com',
    firstName: 'Jane',
    lastName: 'Smith',
    role: 'sdr',
  };

  it('allows Director to access any meeting in tenant', async () => {
    (prisma.meeting.findUnique as any).mockResolvedValueOnce({
      id: 'm-1',
      sdrId: 'sdr-99',
      lead: { id: 'lead-1', assignedToId: 'sdr-99', campaignId: 'c-1' },
    });

    const access = await canAccessMeeting(director, 'm-1');
    expect(access.allowed).toBe(true);
  });

  it('allows SDR to access meeting for their assigned lead', async () => {
    (prisma.meeting.findUnique as any).mockResolvedValueOnce({
      id: 'm-2',
      sdrId: sdr1.id,
      lead: { id: 'lead-1', assignedToId: sdr1.id, campaignId: 'c-1' },
    });

    const access = await canAccessMeeting(sdr1, 'm-2');
    expect(access.allowed).toBe(true);
  });

  it('denies SDR access to another SDR lead meeting', async () => {
    (prisma.meeting.findUnique as any).mockResolvedValueOnce({
      id: 'm-3',
      sdrId: sdr2.id,
      lead: { id: 'lead-2', assignedToId: sdr2.id, campaignId: 'c-1' },
    });

    const access = await canAccessMeeting(sdr1, 'm-3');
    expect(access.allowed).toBe(false);
  });

  it('returns 404 when meeting does not exist', async () => {
    (prisma.meeting.findUnique as any).mockResolvedValueOnce(null);

    const access = await canAccessMeeting(sdr1, 'm-nonexistent');
    expect(access.allowed).toBe(false);
  });
});

describe('Meeting Lifecycle Operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const testUser: SessionUser = {
    id: 'sdr-1',
    email: 'sdr@example.com',
    firstName: 'SDR',
    lastName: 'One',
    role: 'sdr',
  };

  it('bookMeeting with status link_sent creates meeting and activity without moving lead to meeting_booked', async () => {
    const mockLead = {
      id: 'lead-1',
      campaignId: 'camp-1',
      assignedToId: 'sdr-1',
      sequenceStatus: 'active',
      campaign: { id: 'camp-1', clientId: 'client-1', client: { id: 'client-1', name: 'Acme' } },
      firstName: 'Alice',
      lastName: 'Smith',
      email: 'alice@example.com',
      company: 'Acme Corp',
    };
    (prisma.lead.findUniqueOrThrow as any).mockResolvedValueOnce(mockLead);
    (prisma.bookingLink.findFirst as any).mockResolvedValueOnce({
      id: 'link-1',
      name: 'Discovery Call',
      url: 'https://cal.com/meet',
      ownerName: 'Sales Rep',
      ownerEmail: 'sales@example.com',
    });
    (prisma.meeting.create as any).mockResolvedValueOnce({
      id: 'meeting-1',
      status: 'link_sent',
    });

    const result = await bookMeeting({
      leadId: 'lead-1',
      user: testUser,
      tenantId: 'tenant-1',
      status: 'link_sent',
      sourceChannel: 'email',
    });

    expect(prisma.meeting.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leadId: 'lead-1',
          clientId: 'client-1',
          campaignId: 'camp-1',
          sdrId: 'sdr-1',
          status: 'link_sent',
          bookingLinkUrlSnapshot: 'https://cal.com/meet',
          bookingLinkNameSnapshot: 'Discovery Call',
        }),
      })
    );
    expect(prisma.activity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'booking_link_sent',
      }),
    });
    // Lead stage should NOT be changed for link_sent
    expect(prisma.lead.update).not.toHaveBeenCalled();
    expect(result.id).toBe('meeting-1');
  });

  it('bookMeeting with status scheduled updates lead stage to meeting_booked, pauses sequence and creates follow-up task', async () => {
    const mockLead = {
      id: 'lead-2',
      campaignId: 'camp-1',
      assignedToId: 'sdr-1',
      sequenceStatus: 'active',
      campaign: { id: 'camp-1', clientId: 'client-1', client: { id: 'client-1', name: 'Acme' } },
      firstName: 'Bob',
      lastName: 'Jones',
      email: 'bob@example.com',
      company: 'Globex Corp',
    };
    (prisma.lead.findUniqueOrThrow as any).mockResolvedValueOnce(mockLead);
    (prisma.bookingLink.findFirst as any).mockResolvedValueOnce(null);

    const scheduledDate = new Date(Date.now() + 86400000);
    (prisma.meeting.create as any).mockResolvedValueOnce({
      id: 'meeting-2',
      status: 'scheduled',
      scheduledAt: scheduledDate,
    });

    const result = await bookMeeting({
      leadId: 'lead-2',
      user: testUser,
      tenantId: 'tenant-1',
      status: 'scheduled',
      title: 'Demo Call with Bob',
      scheduledAt: scheduledDate,
      durationMins: 30,
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
    });

    expect(prisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-2' },
      data: expect.objectContaining({ stage: 'meeting_booked' }),
    });
    expect(prisma.activity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'meeting_booked',
      }),
    });
    expect(prisma.task.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leadId: 'lead-2',
        title: 'Log meeting outcome: Bob Jones',
      }),
    });
    expect(result.id).toBe('meeting-2');
  });

  it('logMeetingOutcome records outcome and logs activity', async () => {
    (prisma.meeting.update as any).mockResolvedValueOnce({
      id: 'meeting-2',
      status: 'completed',
      outcome: 'qualified_opportunity',
      leadId: 'lead-2',
      lead: { id: 'lead-2', firstName: 'Bob', lastName: 'Jones', assignedToId: 'sdr-1' },
    });

    await logMeetingOutcome({
      meetingId: 'meeting-2',
      user: testUser,
      tenantId: 'tenant-1',
      status: 'completed',
      outcome: 'qualified_opportunity',
      outcomeNotes: 'Client loved the demo, requested proposal',
      painPoints: 'Current CRM is slow',
      nextStep: 'Send proposal and schedule closing call',
    });

    expect(prisma.meeting.update).toHaveBeenCalledWith({
      where: { id: 'meeting-2' },
      data: expect.objectContaining({
        status: 'completed',
        outcome: 'qualified_opportunity',
        outcomeNotes: 'Client loved the demo, requested proposal',
        outcomeLoggedById: 'sdr-1',
      }),
      include: expect.anything(),
    });
    expect(prisma.activity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'meeting_outcome_logged',
      }),
    });
  });
});
