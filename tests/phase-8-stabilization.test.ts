import { vi, describe, it, expect, beforeEach } from 'vitest';

// --- Mocks ---
const mockTaskFindUnique = vi.fn();
const mockTaskFindFirst = vi.fn();
const mockTaskFindMany = vi.fn();
const mockTaskUpdate = vi.fn();
const mockTaskUpdateMany = vi.fn();
const mockTaskCreate = vi.fn();

const mockLeadFindUnique = vi.fn();
const mockLeadFindFirst = vi.fn();
const mockLeadFindMany = vi.fn();
const mockLeadUpdate = vi.fn();

const mockEnrollmentFindUnique = vi.fn();
const mockEnrollmentFindFirst = vi.fn();
const mockEnrollmentFindMany = vi.fn();
const mockEnrollmentUpdate = vi.fn();

const mockOutboundUpsert = vi.fn();
const mockOutboundFindFirst = vi.fn();
const mockOutboundUpdate = vi.fn();

const mockInboundFindUnique = vi.fn();
const mockInboundCreate = vi.fn();
const mockInboundUpdate = vi.fn();

const mockActivityCreate = vi.fn();
const mockNotificationCreate = vi.fn();
const mockAccountFindUnique = vi.fn();
const mockAccountFindFirst = vi.fn();
const mockAccountUpdate = vi.fn();
const mockSequenceStepFindFirst = vi.fn();
const mockEnqueue = vi.fn();
const mockEnqueueReschedule = vi.fn();
const mockEnsureOccurrenceStepTask = vi.fn();
const mockHandoff = vi.fn();
const mockClassifyReply = vi.fn();
const mockApplyClassification = vi.fn();
const mockPauseEnrollmentOccurrence = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: {
      findUnique: (...args: unknown[]) => mockTaskFindUnique(...args),
      findFirst: (...args: unknown[]) => mockTaskFindFirst(...args),
      findMany: (...args: unknown[]) => mockTaskFindMany(...args),
      update: (...args: unknown[]) => mockTaskUpdate(...args),
      updateMany: (...args: unknown[]) => mockTaskUpdateMany(...args),
      create: (...args: unknown[]) => mockTaskCreate(...args),
    },
    lead: {
      findUnique: (...args: unknown[]) => mockLeadFindUnique(...args),
      findFirst: (...args: unknown[]) => mockLeadFindFirst(...args),
      findMany: (...args: unknown[]) => mockLeadFindMany(...args),
      update: (...args: unknown[]) => mockLeadUpdate(...args),
    },
    sequenceEnrollment: {
      findUnique: (...args: unknown[]) => mockEnrollmentFindUnique(...args),
      findFirst: (...args: unknown[]) => mockEnrollmentFindFirst(...args),
      findMany: (...args: unknown[]) => mockEnrollmentFindMany(...args),
      update: (...args: unknown[]) => mockEnrollmentUpdate(...args),
    },
    outboundMessage: {
      upsert: (...args: unknown[]) => mockOutboundUpsert(...args),
      findFirst: (...args: unknown[]) => mockOutboundFindFirst(...args),
      update: (...args: unknown[]) => mockOutboundUpdate(...args),
    },
    inboundMessage: {
      findUnique: (...args: unknown[]) => mockInboundFindUnique(...args),
      create: (...args: unknown[]) => mockInboundCreate(...args),
      update: (...args: unknown[]) => mockInboundUpdate(...args),
    },
    activity: {
      create: (...args: unknown[]) => mockActivityCreate(...args),
    },
    notification: {
      create: (...args: unknown[]) => mockNotificationCreate(...args),
    },
    emailAccount: {
      findUnique: (...args: unknown[]) => mockAccountFindUnique(...args),
      findFirst: (...args: unknown[]) => mockAccountFindFirst(...args),
      update: (...args: unknown[]) => mockAccountUpdate(...args),
    },
    sequenceStep: {
      findFirst: (...args: unknown[]) => mockSequenceStepFindFirst(...args),
    },
    suppressionEntry: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    abTestVariant: {
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock('@/lib/bullmq/enqueue', () => ({
  enqueue: (...args: unknown[]) => mockEnqueue(...args),
  enqueueReschedule: (...args: unknown[]) => mockEnqueueReschedule(...args),
}));

vi.mock('@/lib/sequences/occurrenceTask', () => ({
  ensureOccurrenceStepTask: (...args: unknown[]) => mockEnsureOccurrenceStepTask(...args),
}));

vi.mock('@/lib/prospects/ownership', () => ({
  handoffProspectToHuman: (...args: unknown[]) => mockHandoff(...args),
}));

vi.mock('@/lib/replies/classification', () => ({
  classifyReply: (...args: unknown[]) => mockClassifyReply(...args),
}));

vi.mock('@/lib/replies/handling', () => ({
  applyReplyClassification: (...args: unknown[]) => mockApplyClassification(...args),
}));

vi.mock('@/lib/sequences/lifecycle', () => ({
  pauseEnrollmentOccurrence: (...args: unknown[]) => mockPauseEnrollmentOccurrence(...args),
  resumeEnrollmentOccurrence: vi.fn(),
}));

vi.mock('@/lib/sequences/engine', () => ({
  createTaskForStep: vi.fn(),
  advanceSequence: vi.fn(),
  unenrollLead: vi.fn(),
}));

vi.mock('@/lib/email/EmailService', () => ({
  EmailService: {
    fromAccount: vi.fn(),
  },
}));

vi.mock('@/lib/email/bounceDetection', () => ({
  isBounceMessage: vi.fn().mockReturnValue(false),
  isAutoReply: vi.fn().mockReturnValue(false),
  extractBouncedRecipient: vi.fn().mockReturnValue(null),
}));

vi.mock('@/lib/tenant-context', () => ({
  tenantStorage: {
    run: (_: unknown, fn: () => unknown) => fn(),
  },
}));

const { handleExecuteTask } = await import('@/workers/sequence');
const { handleRepair } = await import('@/workers/maintenance');
const { handleApplyReply, handleEmailSync } = await import('@/workers/sync');
const { EmailService } = await import('@/lib/email/EmailService');

describe('Phase 8 Stabilization Backlog (S1-S4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- S1: Stranded locked task & exception recovery ---
  describe('S1: Stranded locked task exception handling', () => {
    const baseTask = {
      id: 'task-s1',
      status: 'pending',
      type: 'email',
      sequenceId: 'seq-1',
      sequenceStep: 1,
      leadId: 'lead-1',
      tenantId: 'tenant-1',
      lead: {
        id: 'lead-1',
        email: 'prospect@acme.com',
        assignedToId: 'user-1',
        assignedTo: { id: 'user-1', firstName: 'SDR', lastName: 'User', role: 'sdr', isActive: true, timezone: 'UTC' },
        campaign: { id: 'camp-1', status: 'active' },
        sequence: { id: 'seq-1', isActive: true, isArchived: false },
      },
    };

    const baseStep = {
      id: 'step-1',
      sequenceId: 'seq-1',
      order: 1,
      delayDays: 0,
      delayHours: 0,
      autoComplete: true,
      channel: 'email',
      templateId: 'tpl-1',
      template: { id: 'tpl-1', subject: 'Hello {{firstName}}', body: 'Body text' },
    };

    const baseEnrollment = {
      id: 'enr-1',
      leadId: 'lead-1',
      sequenceId: 'seq-1',
      status: 'active',
      occupancyKey: 'tenant-1:lead-1',
      currentStep: 1,
    };

    it('releases lockedAt when OutboundMessage creation fails', async () => {
      mockTaskFindUnique.mockResolvedValue(baseTask);
      mockSequenceStepFindFirst.mockResolvedValue(baseStep);
      mockEnrollmentFindUnique.mockResolvedValue(baseEnrollment);
      mockAccountFindFirst.mockResolvedValue({ id: 'acct-1', userId: 'user-1', isActive: true });
      mockTaskUpdateMany.mockResolvedValue({ count: 1 }); // Lock acquired
      mockOutboundUpsert.mockRejectedValue(new Error('DB connection failed during OutboundMessage upsert'));

      await expect(
        handleExecuteTask({ taskId: 'task-s1', expectedEnrollmentId: 'enr-1' })
      ).rejects.toThrow('DB connection failed during OutboundMessage upsert');

      // Assert lock was claimed first...
      expect(mockTaskUpdateMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ where: expect.objectContaining({ id: 'task-s1', lockedAt: null }) })
      );

      // ...and then released in the catch block!
      expect(mockTaskUpdateMany).toHaveBeenLastCalledWith({
        where: { id: 'task-s1', status: 'pending' },
        data: { lockedAt: null },
      });
    });

    it('releases lockedAt when EMAIL_SEND enqueue fails', async () => {
      mockTaskFindUnique.mockResolvedValue(baseTask);
      mockSequenceStepFindFirst.mockResolvedValue(baseStep);
      mockEnrollmentFindUnique.mockResolvedValue(baseEnrollment);
      mockAccountFindFirst.mockResolvedValue({ id: 'acct-1', userId: 'user-1', isActive: true });
      mockTaskUpdateMany.mockResolvedValue({ count: 1 });
      mockOutboundUpsert.mockResolvedValue({ id: 'out-1' });
      mockEnqueue.mockRejectedValue(new Error('Redis connection down'));

      await expect(
        handleExecuteTask({ taskId: 'task-s1', expectedEnrollmentId: 'enr-1' })
      ).rejects.toThrow('Redis connection down');

      expect(mockTaskUpdateMany).toHaveBeenLastCalledWith({
        where: { id: 'task-s1', status: 'pending' },
        data: { lockedAt: null },
      });
    });

    it('retries idempotently after releasing lock without duplicate OutboundMessage or email', async () => {
      // First attempt fails during enqueue
      mockTaskFindUnique.mockResolvedValue(baseTask);
      mockSequenceStepFindFirst.mockResolvedValue(baseStep);
      mockEnrollmentFindUnique.mockResolvedValue(baseEnrollment);
      mockAccountFindFirst.mockResolvedValue({ id: 'acct-1', userId: 'user-1', isActive: true });
      mockTaskUpdateMany.mockResolvedValue({ count: 1 });
      mockOutboundUpsert.mockResolvedValue({ id: 'out-1' });
      mockEnqueue.mockRejectedValueOnce(new Error('Transient failure'));

      await expect(
        handleExecuteTask({ taskId: 'task-s1', expectedEnrollmentId: 'enr-1' })
      ).rejects.toThrow('Transient failure');

      // Second attempt (retry) succeeds
      mockEnqueue.mockResolvedValueOnce('job-email-1');
      mockTaskUpdate.mockResolvedValue({ id: 'task-s1', status: 'completed' });
      mockLeadUpdate.mockResolvedValue({});

      const result = await handleExecuteTask({ taskId: 'task-s1', expectedEnrollmentId: 'enr-1' });

      expect(result).toEqual({ status: 'completed', taskId: 'task-s1' });
      // Outbound message was upserted using durable taskId idempotencyKey
      expect(mockOutboundUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { idempotencyKey: 'manual-task:task-s1' },
        })
      );
    });
  });

  // --- S2: Occurrence-aware schedule repair ---
  describe('S2: Occurrence-aware schedule repair', () => {
    it('does not let a pending task from an older occurrence skip repair for a drifted occurrence', async () => {
      const now = new Date();
      const overdueDate = new Date(now.getTime() - 3600000);

      const driftedEnrollment = {
        id: 'enr-current-2',
        leadId: 'lead-multi',
        sequenceId: 'seq-1',
        status: 'active',
        currentStep: 1,
        nextActionAt: overdueDate,
        lead: { id: 'lead-multi', assignedToId: 'user-1', crmPriorityScore: 10 },
        sequence: { id: 'seq-1', name: 'Outreach Sequence' },
      };

      mockEnrollmentFindMany.mockResolvedValue([driftedEnrollment]);

      // Mock task queries:
      // 1. Task lookup for exact occurrence (enr-current-2) -> null (missing!)
      // 2. Fallback query for lead + sequence + step -> finds task belonging to OLD occurrence (enr-old-1)
      mockTaskFindFirst
        .mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
          if (where.id === 'sequence-enrollment-enr-current-2-step1') {
            return null; // Missing task for current occurrence!
          }
          if (where.leadId === 'lead-multi' && where.sequenceStep === 1) {
            return {
              id: 'sequence-enrollment-enr-old-1-step1', // Belongs to OLD occurrence enr-old-1!
              leadId: 'lead-multi',
              sequenceId: 'seq-1',
              sequenceStep: 1,
              status: 'pending',
            };
          }
          return null;
        });

      mockSequenceStepFindFirst.mockResolvedValue({
        id: 'step-1',
        sequenceId: 'seq-1',
        order: 1,
        delayDays: 1,
        delayHours: 0,
      });

      mockEnsureOccurrenceStepTask.mockResolvedValue({});

      const repairResult = await handleRepair({ types: ['enrollment-schedule-drift'] });

      expect(repairResult['enrollment-schedule-drift'].fixed).toBe(1);
      expect(mockEnsureOccurrenceStepTask).toHaveBeenCalledWith(
        expect.objectContaining({
          enrollment: driftedEnrollment,
        })
      );
    });
  });

  // --- S3: Authoritative reply eligibility ---
  describe('S3: Authoritative reply eligibility', () => {
    it('processes inbound reply when Lead.sequenceStatus is stale (paused/null) but SequenceEnrollment is active', async () => {
      const mockAccount = {
        id: 'acct-1', isActive: true, userId: 'user-1', email: 'sdr@example.com',
        provider: 'gmail', lastSyncAt: null, tenantId: 'tenant-1',
      };

      const mockMsg = {
        providerMessageId: 'gmail-s3-1',
        fromEmail: 'lead@acme.com',
        subject: 'Re: Interested',
        date: new Date(),
      };

      mockAccountFindUnique.mockResolvedValue(mockAccount);
      (EmailService.fromAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
        fetchMessagesSince: vi.fn().mockResolvedValue([mockMsg]),
      });

      // Lead has stale sequenceStatus in legacy cache
      mockLeadFindMany.mockResolvedValue([{
        id: 'lead-stale',
        email: 'lead@acme.com',
        sequenceId: 'seq-1',
        sequenceStatus: 'paused', // Stale cache!
        emailInvalid: false,
      }]);

      mockLeadFindUnique.mockResolvedValue({
        id: 'lead-stale',
        stage: 'contacted',
        tenantId: 'tenant-1',
        assignedToId: 'user-1',
        firstName: 'Alice',
        lastName: 'Smith',
        company: 'Acme Inc',
      });

      // Authoritative SequenceEnrollment IS active!
      mockEnrollmentFindFirst.mockResolvedValue({ id: 'enr-active-1', sequenceId: 'seq-1' });
      mockInboundFindUnique.mockResolvedValue(null);
      mockInboundCreate.mockResolvedValue({ id: 'inb-1' });

      mockClassifyReply.mockResolvedValue({
        replyClass: 'C', kind: 'interest', confidence: 0.95, source: 'ai', rationale: 'Interested in demo.',
      });
      mockApplyClassification.mockResolvedValue({ cadence: 'paused', handedOff: true });

      const syncResult = await handleEmailSync({ accountId: 'acct-1' });

      expect(syncResult).toMatchObject({ success: true, replies: 1 });
      expect(mockApplyClassification).toHaveBeenCalledWith(
        expect.objectContaining({
          leadId: 'lead-stale',
          enrollment: { id: 'enr-active-1', sequenceId: 'seq-1' },
        })
      );
    });
  });

  // --- S4: Reply deduplication ---
  describe('S4: Inbound reply deduplication & multi-reply processing', () => {
    const baseLead = {
      id: 'lead-s4',
      stage: 'replied', // Already replied!
      tenantId: 'tenant-1',
      assignedToId: 'user-1',
      firstName: 'Bob',
      lastName: 'Jones',
      company: 'TechCorp',
    };

    it('skips redelivered provider message when inbound.classifiedAt is already set', async () => {
      mockLeadFindUnique.mockResolvedValue(baseLead);
      mockInboundFindUnique.mockResolvedValue({
        id: 'inb-dupe',
        subject: 'Re: Quote',
        body: 'Here is my reply',
        classifiedAt: new Date(), // Already processed!
      });

      const result = await handleApplyReply({
        providerMessageId: 'msg-dupe-123',
        leadId: 'lead-s4',
        accountId: 'acct-1',
      });

      expect(result).toEqual({ skipped: true, reason: 'already_processed' });
      expect(mockClassifyReply).not.toHaveBeenCalled();
      expect(mockHandoff).not.toHaveBeenCalled();
    });

    it('processes a second genuine reply from the same prospect whose stage is already replied', async () => {
      mockLeadFindUnique.mockResolvedValue(baseLead);
      mockEnrollmentFindFirst.mockResolvedValue({ id: 'enr-1', sequenceId: 'seq-1' });
      mockInboundFindUnique.mockResolvedValue({
        id: 'inb-second-reply',
        subject: 'Re: Follow up question',
        body: 'What is your SLA?',
        classifiedAt: null, // New message!
      });

      mockClassifyReply.mockResolvedValue({
        replyClass: 'C', kind: 'pricing', confidence: 0.9, source: 'ai', rationale: 'Asking about SLA.',
      });
      mockApplyClassification.mockResolvedValue({ cadence: 'paused', handedOff: true });

      const result = await handleApplyReply({
        providerMessageId: 'msg-second-456',
        leadId: 'lead-s4',
        accountId: 'acct-1',
      });

      expect(result).toMatchObject({
        success: true,
        leadId: 'lead-s4',
        providerMessageId: 'msg-second-456',
        replyClass: 'C',
        replyKind: 'pricing',
      });

      // Increments reply counter even though stage is already 'replied'
      expect(mockLeadUpdate).toHaveBeenCalledWith({
        where: { id: 'lead-s4' },
        data: { stage: 'replied', emailReplyCount: { increment: 1 } },
      });

      // Event-based occurrence handoff created with eventId 'msg-second-456'
      expect(mockApplyClassification).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'msg-second-456',
        })
      );
    });

    it('preserves Class B behavior (no stage move to replied, no reply count increment, resume proposed)', async () => {
      mockLeadFindUnique.mockResolvedValue({ ...baseLead, stage: 'sequence_active' });
      mockEnrollmentFindFirst.mockResolvedValue({ id: 'enr-1', sequenceId: 'seq-1' });
      mockInboundFindUnique.mockResolvedValue({
        id: 'inb-ooo',
        subject: 'Out of office',
        body: 'I am on leave until next Monday',
        classifiedAt: null,
      });

      mockClassifyReply.mockResolvedValue({
        replyClass: 'B', kind: 'out_of_office', confidence: 1, source: 'deterministic', rationale: 'OOO auto-reply.',
      });
      const resumeDate = new Date(Date.now() + 7 * 86400000);
      mockApplyClassification.mockResolvedValue({ cadence: 'paused', handedOff: false, resumeAt: resumeDate });

      const result = await handleApplyReply({
        providerMessageId: 'msg-ooo-789',
        leadId: 'lead-s4',
        accountId: 'acct-1',
        autoReply: true,
      });

      expect(result).toMatchObject({
        success: true,
        replyClass: 'B',
        replyKind: 'out_of_office',
        handoffApplied: false,
      });

      // Class B must NOT set stage replied or increment emailReplyCount
      expect(mockLeadUpdate).not.toHaveBeenCalled();
      expect(mockOutboundUpdate).not.toHaveBeenCalled();
    });
  });
});
