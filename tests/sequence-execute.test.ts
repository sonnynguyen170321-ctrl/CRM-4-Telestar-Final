import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Prisma model mocks
const mockTaskFindUnique = vi.fn();
const mockTaskUpdateMany = vi.fn();
const mockTaskUpdate = vi.fn();
const mockStepFindFirst = vi.fn();
const mockAccountFindFirst = vi.fn();
const mockAbVariantUpdate = vi.fn();
const mockLeadUpdate = vi.fn();

const mockEnrollmentFindFirst = vi.fn();
const mockEnrollmentUpdate = vi.fn();
const mockEnrollmentUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const mockSuppressionFindFirst = vi.fn();
const mockActivityCreate = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: {
      findUnique: (...a: unknown[]) => mockTaskFindUnique(...a),
      updateMany: (...a: unknown[]) => mockTaskUpdateMany(...a),
      update: (...a: unknown[]) => mockTaskUpdate(...a),
    },
    sequenceStep: { findFirst: (...a: unknown[]) => mockStepFindFirst(...a) },
    emailAccount: { findFirst: (...a: unknown[]) => mockAccountFindFirst(...a) },
    sequenceEnrollment: {
      findFirst: (...a: unknown[]) => mockEnrollmentFindFirst(...a),
      findUnique: (...a: unknown[]) => mockEnrollmentFindFirst(...a),
      update: (...a: unknown[]) => mockEnrollmentUpdate(...a),
      updateMany: (...a: unknown[]) => mockEnrollmentUpdateMany(...a),
    },
    suppressionEntry: { findFirst: (...a: unknown[]) => mockSuppressionFindFirst(...a) },
    activity: { create: (...a: unknown[]) => mockActivityCreate(...a) },
    jobRun: { upsert: vi.fn().mockResolvedValue({}) },
    abTestVariant: { update: (...a: unknown[]) => mockAbVariantUpdate(...a) },
    lead: { update: (...a: unknown[]) => mockLeadUpdate(...a) },
    notification: { create: vi.fn().mockResolvedValue({}) },
  },
}));

const mockEnqueueReschedule = vi.fn().mockResolvedValue('job-2');
vi.mock('@/lib/bullmq/enqueue', () => ({
  enqueue: vi.fn().mockResolvedValue('job-1'),
  enqueueImmediate: vi.fn().mockResolvedValue('job-1'),
  enqueueReschedule: (...a: unknown[]) => mockEnqueueReschedule(...a),
}));

const mockCreateOutbound = vi.fn();
const mockEnqueueSend = vi.fn();
vi.mock('@/lib/workflows/email', () => ({
  createOutboundMessage: (...a: unknown[]) => mockCreateOutbound(...a),
  enqueueEmailSendWorkflow: (...a: unknown[]) => mockEnqueueSend(...a),
}));

vi.mock('@/lib/templates/render', () => ({
  renderTemplate: (text: string) => `rendered:${text}`,
}));

const mockAdvance = vi.fn();
vi.mock('@/lib/sequences/engine', () => ({
  createTaskForStep: vi.fn(),
  advanceSequence: (...a: unknown[]) => mockAdvance(...a),
  pauseSequence: vi.fn(),
  unenrollLead: vi.fn(),
}));

const { handleExecuteTask } = await import('@/workers/sequence');

const TENANT_ID = 'default-tenant';

function buildLead(over: Record<string, unknown> = {}) {
  return {
    id: 'lead-1',
    email: 'prospect@acme.com',
    emailInvalid: false,
    sequenceId: 'seq-1',
    sequenceStatus: 'active',
    assignedToId: 'user-1',
    assignedTo: { id: 'user-1', firstName: 'Sam', lastName: 'Rep', role: 'sdr' },
    ...over,
  };
}

function buildTask(over: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    status: 'pending',
    type: 'email',
    sequenceId: 'seq-1',
    sequenceStep: 1,
    leadId: 'lead-1',
    tenantId: TENANT_ID,
    lead: buildLead(),
    ...over,
  };
}

function buildStep(over: Record<string, unknown> = {}) {
  return {
    id: 'step-1',
    order: 1,
    channel: 'email',
    autoComplete: true,
    templateId: 'tmpl-1',
    template: { id: 'tmpl-1', subject: 'Hi {{firstName}}', body: 'Body', abVariants: [] },
    ...over,
  };
}

function arrangeEligible() {
  mockTaskFindUnique.mockResolvedValue(buildTask());
  mockStepFindFirst.mockResolvedValue(buildStep());
  mockAccountFindFirst.mockResolvedValue({ id: 'acct-1', email: 'sdr@telestar.vn', isActive: true });
  mockEnrollmentFindFirst.mockResolvedValue({ id: 'enr-1', status: 'active', currentStep: 1 });
  mockSuppressionFindFirst.mockResolvedValue(null);
  mockTaskUpdateMany.mockResolvedValue({ count: 1 });
  mockCreateOutbound.mockResolvedValue({ id: 'out-1' });
  mockEnqueueSend.mockResolvedValue('job-1');
  mockTaskUpdate.mockResolvedValue({});
  mockLeadUpdate.mockResolvedValue({});
  mockAdvance.mockResolvedValue(undefined);
  mockEnrollmentUpdate.mockResolvedValue({});
  mockActivityCreate.mockResolvedValue({});
  mockEnqueueReschedule.mockResolvedValue('job-2');
}

describe('handleExecuteTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T10:00:00Z')); // Monday 10:00 UTC
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sends, completes the task, bumps the counter, and advances the sequence', async () => {
    arrangeEligible();

    const result = await handleExecuteTask({ taskId: 'task-1' });

    expect(result).toEqual({ status: 'completed', taskId: 'task-1' });
    expect(mockCreateOutbound).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 'lead-1', accountId: 'acct-1', to: 'prospect@acme.com', tenantId: TENANT_ID }),
    );
    expect(mockEnqueueSend).toHaveBeenCalledWith(
      expect.objectContaining({ outboundMessageId: 'out-1', accountId: 'acct-1', to: 'prospect@acme.com' }),
      TENANT_ID,
    );
    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: expect.objectContaining({ status: 'completed' }),
    });
    expect(mockLeadUpdate).toHaveBeenCalledWith({ where: { id: 'lead-1' }, data: { emailSentCount: { increment: 1 } } });
    expect(mockAdvance).toHaveBeenCalled();
  });

  it('ignores a missing task', async () => {
    mockTaskFindUnique.mockResolvedValue(null);
    expect(await handleExecuteTask({ taskId: 'gone' })).toEqual({ status: 'ignored', reason: 'task_not_found' });
  });

  it('ignores a task that is no longer pending', async () => {
    mockTaskFindUnique.mockResolvedValue(buildTask({ status: 'completed' }));
    expect(await handleExecuteTask({ taskId: 'task-1' })).toEqual({
      status: 'ignored',
      reason: 'task_status_is_completed',
    });
  });

  it('returns manual_action_required for a non-email task', async () => {
    mockTaskFindUnique.mockResolvedValue(buildTask({ type: 'call' }));
    expect(await handleExecuteTask({ taskId: 'task-1' })).toEqual({ status: 'manual_action_required', type: 'call' });
  });

  it('skips when the lead is no longer actively enrolled (paused)', async () => {
    mockTaskFindUnique.mockResolvedValue(buildTask({ lead: buildLead({ sequenceStatus: 'paused' }) }));
    mockStepFindFirst.mockResolvedValue(buildStep());
    mockEnrollmentFindFirst.mockResolvedValue({ id: 'enr-1', status: 'paused', currentStep: 1 });
    const result = await handleExecuteTask({ taskId: 'task-1' });
    expect(result.status).toBe('skipped');
    expect(mockCreateOutbound).not.toHaveBeenCalled();
  });

  it('fails when the assignee has no active mailbox', async () => {
    arrangeEligible();
    mockAccountFindFirst.mockResolvedValue(null);
    expect(await handleExecuteTask({ taskId: 'task-1' })).toEqual({
      status: 'manual_action_required',
      reason: 'no_connected_mailbox',
    });
  });

  it('does not send when the CAS lock is lost to another runner', async () => {
    arrangeEligible();
    mockTaskUpdateMany.mockResolvedValue({ count: 0 });
    expect(await handleExecuteTask({ taskId: 'task-1' })).toEqual({
      status: 'ignored',
      reason: 'concurrency_lock_failed',
    });
    expect(mockCreateOutbound).not.toHaveBeenCalled();
  });

  it('records the A/B variant send when both A and B variants exist', async () => {
    arrangeEligible();
    mockStepFindFirst.mockResolvedValue(
      buildStep({
        template: {
          id: 'tmpl-1',
          subject: 'S',
          body: 'B',
          abVariants: [
            { id: 'va', version: 'A', subject: 'SA', body: 'BA' },
            { id: 'vb', version: 'B', subject: 'SB', body: 'BB' },
          ],
        },
      }),
    );
    mockAbVariantUpdate.mockResolvedValue({});

    await handleExecuteTask({ taskId: 'task-1' });

    expect(mockAbVariantUpdate).toHaveBeenCalledWith({
      where: { id: expect.stringMatching(/^v[ab]$/) },
      data: { sentCount: { increment: 1 } },
    });
  });

  // Selection is hashed from durable ids (spec §42), so a retry, a rebuild from the
  // database, or a second worker all reach the same variant. Math.random could not.
  it('picks the same A/B variant on every run for the same lead and step', async () => {
    const variants = [
      { id: 'va', version: 'A', subject: 'SA', body: 'BA' },
      { id: 'vb', version: 'B', subject: 'SB', body: 'BB' },
    ];

    const chosen: string[] = [];
    for (let run = 0; run < 3; run++) {
      vi.clearAllMocks();
      arrangeEligible();
      mockStepFindFirst.mockResolvedValue(
        buildStep({ template: { id: 'tmpl-1', subject: 'S', body: 'B', abVariants: variants } }),
      );
      mockAbVariantUpdate.mockResolvedValue({});

      await handleExecuteTask({ taskId: 'task-1' });
      chosen.push(mockAbVariantUpdate.mock.calls[0][0].where.id);
    }

    expect(new Set(chosen).size).toBe(1);
  });
});

describe('handleExecuteTask — deferral (Phase 6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // 08:00 UTC Monday — an hour before the step's 09:00 send window opens.
    vi.setSystemTime(new Date('2026-08-10T08:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function arrangeOutsideSendWindow() {
    arrangeEligible();
    mockStepFindFirst.mockResolvedValue(
      buildStep({
        sendWindowStartMinutes: 540, // 09:00
        sendWindowEndMinutes: 660,   // 11:00
        delayDays: 0,
        delayHours: 0,
      }),
    );
    mockTaskFindUnique.mockResolvedValue(
      buildTask({ lead: buildLead({ timezone: 'UTC', campaignId: 'camp-1' }) }),
    );
  }

  it('defers instead of sending when evaluated before the send window opens', async () => {
    arrangeOutsideSendWindow();

    const result = await handleExecuteTask({ taskId: 'task-1' });

    expect(result).toMatchObject({ status: 'deferred', reason: 'before_send_window' });
    expect(mockCreateOutbound).not.toHaveBeenCalled();
    expect(mockEnqueueSend).not.toHaveBeenCalled();
  });

  it('moves the task and the enrollment to the new due time', async () => {
    arrangeOutsideSendWindow();

    await handleExecuteTask({ taskId: 'task-1' });

    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: { dueDate: expect.any(Date) },
    });
    expect(mockEnrollmentUpdate).toHaveBeenCalledWith({
      where: { id: 'enr-1' },
      data: { nextActionAt: expect.any(Date), lastEvaluatedAt: expect.any(Date) },
    });
  });

  // The payload is identical to the job currently running, so a plain enqueue would
  // rebuild the same dedupe key and be dropped — leaving a pending task with nothing
  // scheduled behind it.
  it('re-enqueues the task under a discriminated dedupe key', async () => {
    arrangeOutsideSendWindow();

    await handleExecuteTask({ taskId: 'task-1' });

    expect(mockEnqueueReschedule).toHaveBeenCalledTimes(1);
    const [jobType, payload, opts] = mockEnqueueReschedule.mock.calls[0];
    expect(jobType).toBe('sequence.execute-task');
    expect(payload).toEqual({ taskId: 'task-1' });
    expect(opts.discriminator).toMatch(/^defer:/);
    expect(opts.delay).toBeGreaterThan(0);
  });

  it('records the deferral reason as an activity on the lead', async () => {
    arrangeOutsideSendWindow();

    await handleExecuteTask({ taskId: 'task-1' });

    expect(mockActivityCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'sequence_deferred',
        leadId: 'lead-1',
        userId: 'user-1',
        metadata: expect.objectContaining({ reason: 'before_send_window' }),
      }),
    });
  });

  // =========================================================================
  // Pre-send occurrence revalidation (Phase 8a)
  //
  // The check near the top of the handler is several awaits old by the time the send happens —
  // mailbox, suppression and eligibility all run in between — and a human can replace the cadence
  // in that window. With no transaction available (Neon HTTP has none), ownership is re-checked as
  // close to the prospect-facing write as it can be.
  // =========================================================================
  const owningEnrollment = {
    id: 'enr-1',
    leadId: 'lead-1',
    sequenceId: 'seq-1',
    status: 'active',
    currentStep: 1,
    occupancyKey: `${TENANT_ID}:lead-1`,
  };

  it('refuses at the send boundary when the occurrence lost ownership after the lock', async () => {
    arrangeEligible();
    mockEnrollmentFindFirst
      .mockResolvedValueOnce(owningEnrollment) // entry validation: still ours
      .mockResolvedValueOnce({ ...owningEnrollment, status: 'unenrolled', occupancyKey: null });

    const result = await handleExecuteTask({ taskId: 'task-1', expectedEnrollmentId: 'enr-1' });

    expect(result).toEqual({
      status: 'skipped',
      reason: 'occurrence_no_longer_active',
      taskId: 'task-1',
    });
    expect(mockCreateOutbound).not.toHaveBeenCalled();
    expect(mockEnqueueSend).not.toHaveBeenCalled();
    expect(mockAdvance).not.toHaveBeenCalled();
    // The execution lock is released rather than stranding the task claimed.
    expect(mockTaskUpdateMany).toHaveBeenCalledWith({
      where: { id: 'task-1', status: 'pending' },
      data: { lockedAt: null },
    });
  });

  it('refuses at the send boundary when the same occurrence advanced past this step', async () => {
    arrangeEligible();
    mockEnrollmentFindFirst
      .mockResolvedValueOnce(owningEnrollment) // entry check: on step 1, eligible
      .mockResolvedValueOnce({ ...owningEnrollment, currentStep: 2 }); // advanced meanwhile

    const result = await handleExecuteTask({ taskId: 'task-1', expectedEnrollmentId: 'enr-1' });

    expect(result).toEqual({
      status: 'skipped',
      reason: 'occurrence_step_changed',
      taskId: 'task-1',
    });
    expect(mockCreateOutbound).not.toHaveBeenCalled();
    expect(mockEnqueueSend).not.toHaveBeenCalled();
  });

  it('refuses at the send boundary when the occupancy moved to another cadence', async () => {
    arrangeEligible();
    mockEnrollmentFindFirst
      .mockResolvedValueOnce(owningEnrollment)
      .mockResolvedValueOnce({ ...owningEnrollment, occupancyKey: `${TENANT_ID}:other-lead` });

    const result = await handleExecuteTask({ taskId: 'task-1', expectedEnrollmentId: 'enr-1' });

    expect((result as { reason?: string }).reason).toBe('occurrence_no_longer_active');
    expect(mockCreateOutbound).not.toHaveBeenCalled();
  });

  it('sends and advances the same occurrence when ownership holds at both checks', async () => {
    arrangeEligible();
    mockEnrollmentFindFirst.mockResolvedValue(owningEnrollment);

    const result = await handleExecuteTask({ taskId: 'task-1', expectedEnrollmentId: 'enr-1' });

    expect(result).toEqual({ status: 'completed', taskId: 'task-1' });
    expect(mockCreateOutbound).toHaveBeenCalledTimes(1);
    expect(mockAdvance).toHaveBeenCalledWith(expect.anything(), 'user-1', 'enr-1');
  });

  it('does not send when the mailbox is paused, and defers instead', async () => {
    arrangeEligible();
    vi.setSystemTime(new Date('2026-08-10T10:00:00Z')); // inside any window
    mockAccountFindFirst.mockResolvedValue({
      id: 'acct-1',
      email: 'sdr@telestar.vn',
      isActive: true,
      sendPausedAt: new Date('2026-08-01T00:00:00Z'),
      sendPauseReason: 'Warmup adjustment',
    });

    const result = await handleExecuteTask({ taskId: 'task-1' });

    expect(result).toMatchObject({ status: 'deferred', reason: 'mailbox_paused' });
    expect(mockCreateOutbound).not.toHaveBeenCalled();
  });
});
