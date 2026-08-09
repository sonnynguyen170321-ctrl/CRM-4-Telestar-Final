import { describe, it, expect, vi } from 'vitest';
import { evaluateAutomationEligibility } from '@/lib/automation/eligibility';
import { pauseSequence } from '@/lib/sequences/engine';

const mockLeadFindUnique = vi.fn();
const mockLeadUpdate = vi.fn();
const mockSequenceFindUnique = vi.fn();
const mockEnrollmentUpdateMany = vi.fn();
const mockTaskUpdateMany = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    lead: {
      findUnique: (...args: unknown[]) => mockLeadFindUnique(...args),
      update: (...args: unknown[]) => mockLeadUpdate(...args),
    },
    sequence: {
      findUnique: (...args: unknown[]) => mockSequenceFindUnique(...args),
    },
    sequenceEnrollment: {
      updateMany: (...args: unknown[]) => mockEnrollmentUpdateMany(...args),
    },
    task: {
      updateMany: (...args: unknown[]) => mockTaskUpdateMany(...args),
    },
    activity: {
      create: vi.fn().mockResolvedValue({}),
    },
    activityLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

describe('Lifecycle Integration Tests (Phase 13 / Spec §35–39)', () => {
  it('1. Reply pauses active sequence run with pausedReason = reply', async () => {
    mockLeadFindUnique.mockResolvedValue({
      id: 'lead-1',
      sequenceId: 'seq-1',
      firstName: 'Alice',
      lastName: 'Smith',
    });
    mockSequenceFindUnique.mockResolvedValue({ name: 'Outreach Cadence' });
    mockLeadUpdate.mockResolvedValue({});
    mockEnrollmentUpdateMany.mockResolvedValue({ count: 1 });
    mockTaskUpdateMany.mockResolvedValue({ count: 1 });

    await pauseSequence('lead-1', 'reply', 'user-1');

    expect(mockLeadUpdate).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: { sequenceStatus: 'paused' },
    });
    expect(mockEnrollmentUpdateMany).toHaveBeenCalledWith({
      where: { leadId: 'lead-1', sequenceId: 'seq-1', status: 'active' },
      data: expect.objectContaining({
        status: 'paused',
        pausedReason: 'reply',
      }),
    });
  });

  it('1b. Legacy reason from an in-flight job is normalized, not stored raw', async () => {
    mockLeadFindUnique.mockResolvedValue({
      id: 'lead-1b',
      sequenceId: 'seq-1',
      firstName: 'Alice',
      lastName: 'Smith',
    });
    mockSequenceFindUnique.mockResolvedValue({ name: 'Outreach Cadence' });
    mockLeadUpdate.mockResolvedValue({});
    mockEnrollmentUpdateMany.mockResolvedValue({ count: 1 });
    mockTaskUpdateMany.mockResolvedValue({ count: 1 });

    // A SEQUENCE_PAUSE job queued before the vocabularies were collapsed still carries
    // 'replied'. Storing it raw is what made the lead panel print the token instead of a
    // label, so the write site has to translate rather than trust the caller.
    await pauseSequence('lead-1b', 'replied', 'user-1');

    expect(mockEnrollmentUpdateMany).toHaveBeenCalledWith({
      where: { leadId: 'lead-1b', sequenceId: 'seq-1', status: 'active' },
      data: expect.objectContaining({ pausedReason: 'reply' }),
    });
  });

  it('2. Hard bounce pauses active sequence run with pausedReason = hard_bounce', async () => {
    mockLeadFindUnique.mockResolvedValue({
      id: 'lead-2',
      sequenceId: 'seq-1',
      firstName: 'Bob',
      lastName: 'Jones',
    });
    mockSequenceFindUnique.mockResolvedValue({ name: 'Outreach Cadence' });
    mockLeadUpdate.mockResolvedValue({});
    mockEnrollmentUpdateMany.mockResolvedValue({ count: 1 });
    mockTaskUpdateMany.mockResolvedValue({ count: 1 });

    await pauseSequence('lead-2', 'hard_bounce', 'system');

    expect(mockEnrollmentUpdateMany).toHaveBeenCalledWith({
      where: { leadId: 'lead-2', sequenceId: 'seq-1', status: 'active' },
      data: expect.objectContaining({
        status: 'paused',
        pausedReason: 'hard_bounce',
      }),
    });
  });

  it('2b. Soft bounce is stored distinctly from a hard bounce', async () => {
    mockLeadFindUnique.mockResolvedValue({
      id: 'lead-2b',
      sequenceId: 'seq-1',
      firstName: 'Bob',
      lastName: 'Jones',
    });
    mockSequenceFindUnique.mockResolvedValue({ name: 'Outreach Cadence' });
    mockLeadUpdate.mockResolvedValue({});
    mockEnrollmentUpdateMany.mockResolvedValue({ count: 1 });
    mockTaskUpdateMany.mockResolvedValue({ count: 1 });

    await pauseSequence('lead-2b', 'soft_bounce', 'system');

    expect(mockEnrollmentUpdateMany).toHaveBeenCalledWith({
      where: { leadId: 'lead-2b', sequenceId: 'seq-1', status: 'active' },
      data: expect.objectContaining({ pausedReason: 'soft_bounce' }),
    });
  });

  it('3. Meeting booked pauses active sequence run with pausedReason = meeting_booked', async () => {
    mockLeadFindUnique.mockResolvedValue({
      id: 'lead-3',
      sequenceId: 'seq-1',
      firstName: 'Carol',
      lastName: 'Danvers',
    });
    mockSequenceFindUnique.mockResolvedValue({ name: 'Outreach Cadence' });
    mockLeadUpdate.mockResolvedValue({});
    mockEnrollmentUpdateMany.mockResolvedValue({ count: 1 });
    mockTaskUpdateMany.mockResolvedValue({ count: 1 });

    await pauseSequence('lead-3', 'meeting_booked', 'user-1');

    expect(mockEnrollmentUpdateMany).toHaveBeenCalledWith({
      where: { leadId: 'lead-3', sequenceId: 'seq-1', status: 'active' },
      data: expect.objectContaining({
        status: 'paused',
        pausedReason: 'meeting_booked',
      }),
    });
  });

  it('4. Closed stage (won) terminates eligibility with stage_won reason', () => {
    const result = evaluateAutomationEligibility({
      tenantId: 't1',
      enrollment: { id: 'e1', status: 'active', currentStep: 1 },
      lead: {
        id: 'l1',
        email: 'prospect@acme.com',
        emailInvalid: false,
        stage: 'won',
        sequenceId: 'seq-1',
        sequenceStep: 1,
        sequenceStatus: 'active',
        assignedToId: 'u1',
        campaignId: 'c1',
        archivedAt: null,
      },
    });

    expect(result.decision).toBe('TERMINATE');
    expect(result.reason).toBe('lead_stage_won');
  });
});
