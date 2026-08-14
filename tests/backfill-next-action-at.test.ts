import { describe, it, expect, vi, beforeEach } from 'vitest';
import { backfillHistoricalNextActionAt } from '@/lib/sequences/backfillNextActionAt';
import * as occurrenceTaskModule from '@/lib/sequences/occurrenceTask';
import type { PrismaClient } from '@prisma/client';

describe('backfillHistoricalNextActionAt', () => {
  let mockPrisma: any;
  let enrollmentsStore: any[];
  let updatedRows: Record<string, any>;

  beforeEach(() => {
    vi.clearAllMocks();
    updatedRows = {};
    enrollmentsStore = [];

    mockPrisma = {
      sequenceEnrollment: {
        findMany: vi.fn(async ({ where }: any) => {
          return enrollmentsStore.filter((e) => {
            if (where?.tenantId && e.tenantId !== where.tenantId) return false;
            return true;
          });
        }),
        update: vi.fn(async ({ where, data }: any) => {
          updatedRows[where.id] = data;
          const idx = enrollmentsStore.findIndex((e) => e.id === where.id);
          if (idx !== -1) {
            enrollmentsStore[idx] = { ...enrollmentsStore[idx], ...data };
          }
          return enrollmentsStore[idx];
        }),
      },
    } as unknown as PrismaClient;
  });

  it('repairs historical active enrollment with authoritative pending task', async () => {
    const dueDate = new Date('2026-09-01T10:00:00.000Z');
    enrollmentsStore = [
      {
        id: 'enr-1',
        leadId: 'lead-1',
        sequenceId: 'seq-1',
        currentStep: 1,
        status: 'active',
        nextActionAt: null,
        tenantId: 'tenant-alpha',
      },
    ];

    vi.spyOn(occurrenceTaskModule, 'resolveOccurrenceTask').mockResolvedValueOnce({
      task: {
        id: 'task-1',
        status: 'pending',
        dueDate,
      } as any,
      expectedEnrollmentId: 'enr-1',
    });

    const res = await backfillHistoricalNextActionAt({
      dryRun: false,
      client: mockPrisma,
    });

    expect(res.totalEvaluated).toBe(1);
    expect(res.repaired).toBe(1);
    expect(res.alreadyPopulated).toBe(0);
    expect(res.terminalSkipped).toBe(0);
    expect(res.unmatched.length).toBe(0);
    expect(updatedRows['enr-1']).toEqual({ nextActionAt: dueDate });
  });

  it('reports historical active enrollment without authoritative task rather than guessing', async () => {
    enrollmentsStore = [
      {
        id: 'enr-2',
        leadId: 'lead-2',
        sequenceId: 'seq-2',
        currentStep: 2,
        status: 'active',
        nextActionAt: null,
        tenantId: 'tenant-alpha',
      },
    ];

    vi.spyOn(occurrenceTaskModule, 'resolveOccurrenceTask').mockResolvedValueOnce(null);

    const res = await backfillHistoricalNextActionAt({
      dryRun: false,
      client: mockPrisma,
    });

    expect(res.totalEvaluated).toBe(1);
    expect(res.repaired).toBe(0);
    expect(res.unmatched.length).toBe(1);
    expect(res.unmatched[0].id).toBe('enr-2');
    expect(updatedRows['enr-2']).toBeUndefined();
  });

  it('leaves already populated enrollments unchanged', async () => {
    const existingDate = new Date('2026-08-20T12:00:00.000Z');
    enrollmentsStore = [
      {
        id: 'enr-3',
        leadId: 'lead-3',
        sequenceId: 'seq-3',
        currentStep: 1,
        status: 'active',
        nextActionAt: existingDate,
        tenantId: 'tenant-alpha',
      },
    ];

    const spy = vi.spyOn(occurrenceTaskModule, 'resolveOccurrenceTask');

    const res = await backfillHistoricalNextActionAt({
      dryRun: false,
      client: mockPrisma,
    });

    expect(res.totalEvaluated).toBe(1);
    expect(res.alreadyPopulated).toBe(1);
    expect(res.repaired).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    expect(updatedRows['enr-3']).toBeUndefined();
  });

  it('skips completed / terminal enrollments and does not reschedule them', async () => {
    enrollmentsStore = [
      {
        id: 'enr-4-completed',
        leadId: 'lead-4',
        sequenceId: 'seq-4',
        currentStep: 3,
        status: 'completed',
        nextActionAt: null,
        tenantId: 'tenant-alpha',
      },
      {
        id: 'enr-5-cancelled',
        leadId: 'lead-5',
        sequenceId: 'seq-5',
        currentStep: 2,
        status: 'cancelled',
        nextActionAt: null,
        tenantId: 'tenant-alpha',
      },
    ];

    const spy = vi.spyOn(occurrenceTaskModule, 'resolveOccurrenceTask');

    const res = await backfillHistoricalNextActionAt({
      dryRun: false,
      client: mockPrisma,
    });

    expect(res.totalEvaluated).toBe(2);
    expect(res.terminalSkipped).toBe(2);
    expect(res.repaired).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it('is completely idempotent over multiple executions', async () => {
    const dueDate = new Date('2026-09-05T09:00:00.000Z');
    enrollmentsStore = [
      {
        id: 'enr-6',
        leadId: 'lead-6',
        sequenceId: 'seq-6',
        currentStep: 1,
        status: 'active',
        nextActionAt: null,
        tenantId: 'tenant-alpha',
      },
    ];

    vi.spyOn(occurrenceTaskModule, 'resolveOccurrenceTask').mockResolvedValue({
      task: {
        id: 'task-6',
        status: 'pending',
        dueDate,
      } as any,
      expectedEnrollmentId: 'enr-6',
    });

    // Pass 1: Repairs row
    const pass1 = await backfillHistoricalNextActionAt({
      dryRun: false,
      client: mockPrisma,
    });
    expect(pass1.repaired).toBe(1);
    expect(pass1.alreadyPopulated).toBe(0);

    // Pass 2: Row is already populated, should not re-update
    const pass2 = await backfillHistoricalNextActionAt({
      dryRun: false,
      client: mockPrisma,
    });
    expect(pass2.repaired).toBe(0);
    expect(pass2.alreadyPopulated).toBe(1);
  });

  it('honors dry-run mode without mutating database', async () => {
    const dueDate = new Date('2026-09-10T14:00:00.000Z');
    enrollmentsStore = [
      {
        id: 'enr-7',
        leadId: 'lead-7',
        sequenceId: 'seq-7',
        currentStep: 1,
        status: 'active',
        nextActionAt: null,
        tenantId: 'tenant-alpha',
      },
    ];

    vi.spyOn(occurrenceTaskModule, 'resolveOccurrenceTask').mockResolvedValueOnce({
      task: {
        id: 'task-7',
        status: 'pending',
        dueDate,
      } as any,
      expectedEnrollmentId: 'enr-7',
    });

    const res = await backfillHistoricalNextActionAt({
      dryRun: true,
      client: mockPrisma,
    });

    expect(res.dryRun).toBe(true);
    expect(res.repaired).toBe(1);
    expect(mockPrisma.sequenceEnrollment.update).not.toHaveBeenCalled();
    expect(updatedRows['enr-7']).toBeUndefined();
  });

  it('strictly isolates tenant boundaries when tenantId is specified', async () => {
    enrollmentsStore = [
      {
        id: 'enr-tenant-a',
        leadId: 'lead-a',
        sequenceId: 'seq-a',
        currentStep: 1,
        status: 'active',
        nextActionAt: null,
        tenantId: 'tenant-A',
      },
      {
        id: 'enr-tenant-b',
        leadId: 'lead-b',
        sequenceId: 'seq-b',
        currentStep: 1,
        status: 'active',
        nextActionAt: null,
        tenantId: 'tenant-B',
      },
    ];

    vi.spyOn(occurrenceTaskModule, 'resolveOccurrenceTask').mockResolvedValue({
      task: {
        id: 'task-tenant',
        status: 'pending',
        dueDate: new Date('2026-09-15T08:00:00.000Z'),
      } as any,
    });

    const res = await backfillHistoricalNextActionAt({
      dryRun: false,
      tenantId: 'tenant-A',
      client: mockPrisma,
    });

    expect(res.totalEvaluated).toBe(1);
    expect(res.repaired).toBe(1);
    expect(updatedRows['enr-tenant-a']).toBeDefined();
    expect(updatedRows['enr-tenant-b']).toBeUndefined();
  });
});
