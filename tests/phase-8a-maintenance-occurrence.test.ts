import { vi, describe, it, expect, beforeEach } from 'vitest';

/**
 * The maintenance sweeps, from the occurrence's point of view.
 *
 * Prisma is mocked here for the same reason `tests/maintenance-worker.test.ts` mocks it: these
 * repairs are deliberately **global** — no tenant filter — so running them against the shared test
 * database would reach into every other suite's rows. What is under test is which identity
 * maintenance hands onward and how it manages `Task.lockedAt`; the behaviour of the helper it
 * delegates to is proven against a real database in `phase-8a-occurrence-advance.test.ts`.
 */

const mockTaskFindMany = vi.fn();
const mockTaskUpdateMany = vi.fn();
const mockTaskFindFirst = vi.fn();
const mockEnrollmentFindMany = vi.fn();
const mockStepFindFirst = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: {
      findMany: (...a: unknown[]) => mockTaskFindMany(...a),
      updateMany: (...a: unknown[]) => mockTaskUpdateMany(...a),
      findFirst: (...a: unknown[]) => mockTaskFindFirst(...a),
    },
    sequenceEnrollment: { findMany: (...a: unknown[]) => mockEnrollmentFindMany(...a) },
    sequenceStep: { findFirst: (...a: unknown[]) => mockStepFindFirst(...a) },
  },
}));

const mockEnqueueReschedule = vi.fn();
vi.mock('@/lib/bullmq/enqueue', () => ({
  enqueue: vi.fn(),
  enqueueImmediate: vi.fn(),
  enqueueReschedule: (...a: unknown[]) => mockEnqueueReschedule(...a),
}));

const mockEnsureOccurrenceStepTask = vi.fn();
vi.mock('@/lib/sequences/occurrenceTask', () => ({
  ensureOccurrenceStepTask: (...a: unknown[]) => mockEnsureOccurrenceStepTask(...a),
  resolveOccurrenceTask: vi.fn(),
}));

import { handleRepair } from '@/workers/maintenance';
import { enrollmentStepTaskId } from '@/lib/sequences/identity';

const TENANT = 'default-tenant';
const ENROLLMENT_ID = 'enr-8a';

describe('Phase 8a — maintenance keeps the occurrence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTaskFindMany.mockResolvedValue([]);
    mockEnrollmentFindMany.mockResolvedValue([]);
    mockTaskUpdateMany.mockResolvedValue({ count: 1 });
    mockEnqueueReschedule.mockResolvedValue('job-1');
    mockEnsureOccurrenceStepTask.mockResolvedValue('task-1');
  });

  const driftedEnrollment = (over: Record<string, unknown> = {}) => ({
    id: ENROLLMENT_ID,
    leadId: 'lead-1',
    sequenceId: 'seq-1',
    tenantId: TENANT,
    currentStep: 2,
    status: 'active',
    lead: { id: 'lead-1', assignedToId: 'user-1', crmPriorityScore: 'warm' },
    sequence: { id: 'seq-1', name: 'Outbound' },
    ...over,
  });

  const step2 = { id: 'step-2', order: 2, channel: 'email', delayDays: 1, delayHours: 0, autoComplete: true };

  const overdueTask = (over: Record<string, unknown> = {}) => ({
    id: enrollmentStepTaskId(ENROLLMENT_ID, 1),
    tenantId: TENANT,
    status: 'pending',
    type: 'email',
    dueDate: new Date('2026-08-01T09:00:00Z'),
    lockedAt: null,
    ...over,
  });

  // =========================================================================
  // enrollment-schedule-drift
  // =========================================================================
  it('rebuilds a drifted step through the occurrence-aware helper, carrying the exact enrollment', async () => {
    mockEnrollmentFindMany.mockResolvedValue([driftedEnrollment()]);
    mockTaskFindFirst.mockResolvedValue(null); // no pending task for the current step
    mockStepFindFirst.mockResolvedValue(step2);

    const result = await handleRepair({ types: ['enrollment-schedule-drift'] });

    expect(result['enrollment-schedule-drift'].fixed).toBe(1);
    expect(mockEnsureOccurrenceStepTask).toHaveBeenCalledTimes(1);
    const [input] = mockEnsureOccurrenceStepTask.mock.calls[0] as [
      { enrollment: { id: string; currentStep: number }; step: { order: number }; baseDate: Date }
    ];
    // The exact enrollment travels into task identity and the execution payload — the generic
    // `createTaskForStep(enr.lead, …)` this replaced produced an anonymous task and a
    // legacy-shaped job for a Phase 8a cadence.
    expect(input.enrollment.id).toBe(ENROLLMENT_ID);
    expect(input.enrollment.currentStep).toBe(2);
    expect(input.step.order).toBe(2);
    // Base backdated by the step's own cadence so the overdue replacement lands now.
    expect(Date.now() - input.baseDate.getTime()).toBeGreaterThanOrEqual(86_400_000);
  });

  it('records a refusal instead of crashing the sweep when the occurrence lost ownership', async () => {
    mockEnrollmentFindMany.mockResolvedValue([driftedEnrollment()]);
    mockTaskFindFirst.mockResolvedValue(null);
    mockStepFindFirst.mockResolvedValue(step2);
    mockEnsureOccurrenceStepTask.mockRejectedValue(
      new Error('Refusing to schedule: enrollment enr-8a is no longer the active enrollment')
    );

    const result = await handleRepair({ types: ['enrollment-schedule-drift'] });

    // Fail closed: nothing counted as fixed, and no executable job for a replaced cadence.
    expect(result['enrollment-schedule-drift'].fixed).toBe(0);
    expect(result['enrollment-schedule-drift'].details[0]).toContain('repair refused');
  });

  it('leaves an enrollment alone when its current step still has a pending task', async () => {
    mockEnrollmentFindMany.mockResolvedValue([driftedEnrollment()]);
    mockTaskFindFirst.mockResolvedValue({ id: 'task-existing' });

    const result = await handleRepair({ types: ['enrollment-schedule-drift'] });

    expect(result['enrollment-schedule-drift'].fixed).toBe(0);
    expect(mockEnsureOccurrenceStepTask).not.toHaveBeenCalled();
  });

  // =========================================================================
  // missing-delayed: why the sweep holds no claim on Task.lockedAt
  // =========================================================================
  /**
   * Four tests here used to pin the repair claim — CAS `lockedAt`, release on success, release on
   * failure, skip when the CAS lost. The claim is what broke the repair, and they defended it.
   *
   * The sweep enqueues with `delay: 0`, so the job it creates reached the sequence worker's
   * execution lock, `updateMany({ where: { …, lockedAt: null } })`, while the sweep still held that
   * same field. The lock failed, the worker returned `concurrency_lock_failed`, and BullMQ recorded
   * the job **completed** in ~40ms with nothing done. Then, because the discriminator was the
   * task's due date — which never changes for an overdue task — that settled JobRun answered every
   * later sweep `already_executed`, so no repair was ever attempted again.
   *
   * Production, 2026-09-28: two step-3 tasks due 2026-09-22, their repair JobRun `completed` at
   * 03:30:06 that morning, still pending after six nightly sweeps.
   *
   * Nothing is lost by dropping the claim. The maintenance queue runs at concurrency 1, the dedupe
   * key collapses duplicate enqueues within a pass, and the worker's own CAS lock is what actually
   * prevents a double send.
   */
  it('does not touch lockedAt, so the job it enqueues can take the worker lock', async () => {
    mockTaskFindMany.mockResolvedValue([overdueTask()]);

    const result = await handleRepair({ types: ['missing-delayed'] });

    expect(result['missing-delayed'].fixed).toBe(1);
    expect(mockEnqueueReschedule).toHaveBeenCalledTimes(1);
    expect(mockTaskUpdateMany).not.toHaveBeenCalled();
  });

  it('reports a failed re-enqueue rather than counting it as fixed', async () => {
    mockTaskFindMany.mockResolvedValue([overdueTask()]);
    mockEnqueueReschedule.mockRejectedValue(new Error('Redis unreachable'));

    const result = await handleRepair({ types: ['missing-delayed'] });

    expect(result['missing-delayed'].fixed).toBe(0);
    expect(result['missing-delayed'].details[0]).toContain('re-enqueue failed');
  });

  it('can attempt the same overdue task again on a later sweep', async () => {
    // The whole purpose of a nightly sweep. Under the old due-date discriminator the second pass
    // rebuilt the first pass's dedupe key and was refused.
    mockTaskFindMany.mockResolvedValue([overdueTask()]);

    await handleRepair({ types: ['missing-delayed'] });
    await new Promise((r) => setTimeout(r, 5));
    await handleRepair({ types: ['missing-delayed'] });

    const [a, b] = mockEnqueueReschedule.mock.calls;
    expect(b[2].discriminator).not.toBe(a[2].discriminator);
  });

  it('carries the occurrence recovered from the deterministic task id', async () => {
    mockTaskFindMany.mockResolvedValue([overdueTask()]);

    await handleRepair({ types: ['missing-delayed'] });

    const [, payload, opts] = mockEnqueueReschedule.mock.calls[0] as [
      string,
      { taskId: string; expectedEnrollmentId?: string },
      { discriminator: string }
    ];
    expect(payload.expectedEnrollmentId).toBe(ENROLLMENT_ID);
    expect(opts.discriminator).toMatch(/^repair:/);
  });

  it('keeps legacy compatibility for a task that predates occurrence identity', async () => {
    // A generated-id task is the genuine pre-Phase-8a shape: no occurrence is encoded in it, so
    // the payload carries none and the worker falls back to lead+sequence matching.
    mockTaskFindMany.mockResolvedValue([overdueTask({ id: 'clx0legacytaskid0001' })]);

    await handleRepair({ types: ['missing-delayed'] });

    const [, payload] = mockEnqueueReschedule.mock.calls[0] as [
      string,
      { taskId: string; expectedEnrollmentId?: string }
    ];
    expect(payload.taskId).toBe('clx0legacytaskid0001');
    expect(payload.expectedEnrollmentId).toBeUndefined();
  });
});
