import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { SessionUser } from '@/lib/auth';

/**
 * `applyBulkTaskAction` and `POST /api/tasks/bulk`, which are now one implementation.
 *
 * The body of the route moved into `lib/tasks/bulkAction.ts` so the chat assistant's
 * `update_tasks` / `complete_tasks` tools could reach it without a second copy. That move is only
 * safe if the behaviour the route had is still exactly the behaviour the module has, so these
 * tests pin the five rules that were previously implicit in the route — the per-task access check,
 * the `status: 'pending'` compare-and-set, the outcome requirement, the refusal of an unmanaged
 * reassignment target before anything is written, and the refusal to run with no tenant context —
 * plus the one rule the move added, the cadence gate that applies to the agent and not to a human.
 *
 * A note on why the no-tenant case is a test and not a comment: `lib/prisma.ts` answers `[]` to a
 * `findMany` with no tenant context, so without the guard this function would report every id as
 * `Not found` and return a tidy, confident, entirely wrong result. That silent-success shape is
 * the defect class this repository keeps paying for.
 */

const taskFindMany = vi.fn();
const taskUpdateMany = vi.fn();
const taskUpdate = vi.fn();
const activityCreate = vi.fn();
const leadUpdate = vi.fn();
const noteCreate = vi.fn();
const canAccessUser = vi.fn();
const canAccessLead = vi.fn();
const advanceSequence = vi.fn();
const requireAuthMock = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: {
      findMany: (...a: unknown[]) => taskFindMany(...a),
      updateMany: (...a: unknown[]) => taskUpdateMany(...a),
      update: (...a: unknown[]) => taskUpdate(...a),
    },
    activity: { create: (...a: unknown[]) => activityCreate(...a) },
    lead: { update: (...a: unknown[]) => leadUpdate(...a) },
    note: { create: (...a: unknown[]) => noteCreate(...a) },
  },
}));

vi.mock('@/lib/auth', () => ({
  requireAuth: () => requireAuthMock(),
  canAccessUser: (...a: unknown[]) => canAccessUser(...a),
  canAccessLead: (...a: unknown[]) => canAccessLead(...a),
}));

vi.mock('@/lib/sequences/engine', () => ({
  advanceSequence: (...a: unknown[]) => advanceSequence(...a),
}));

import { applyBulkTaskAction } from '@/lib/tasks/bulkAction';
import { POST } from '@/app/api/tasks/bulk/route';

const SDR = {
  id: 'user-sdr',
  tenantId: 'tenant-a',
  role: 'sdr',
  email: 'sdr@telestar.test',
  firstName: 'Judy',
  lastName: 'Nguyen',
} as unknown as SessionUser;

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    userId: 'user-sdr',
    leadId: 'lead-1',
    type: 'manual',
    title: 'Follow up with Acme',
    status: 'pending',
    sequenceId: null,
    lead: { id: 'lead-1', assignedToId: 'user-sdr', campaignId: null },
    ...overrides,
  };
}

function bulkRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/tasks/bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  canAccessUser.mockResolvedValue(true);
  canAccessLead.mockResolvedValue(true);
  taskUpdateMany.mockResolvedValue({ count: 1 });
  taskUpdate.mockResolvedValue({});
  activityCreate.mockResolvedValue({});
  leadUpdate.mockResolvedValue({});
  noteCreate.mockResolvedValue({});
  advanceSequence.mockResolvedValue(undefined);
  requireAuthMock.mockResolvedValue(SDR);
});

describe('applyBulkTaskAction refuses to run blind', () => {
  it('throws rather than reporting "Not found" for every id when there is no tenant context', async () => {
    const noTenant = { ...SDR, tenantId: null } as unknown as SessionUser;

    await expect(
      applyBulkTaskAction(noTenant, { action: 'complete', taskIds: ['task-1'] }, 'human')
    ).rejects.toThrow(/no tenant context/i);

    // The point of throwing is that nothing is read, so nothing can be misreported.
    expect(taskFindMany).not.toHaveBeenCalled();
  });
});

describe('every task is checked on its own', () => {
  it("reports another rep's task as Forbidden and still applies the ones that pass", async () => {
    taskFindMany.mockResolvedValue([
      task({ id: 'mine' }),
      task({ id: 'theirs', userId: 'user-other', lead: { id: 'lead-2', assignedToId: 'user-other', campaignId: null } }),
    ]);
    canAccessUser.mockImplementation(async (_u: unknown, id: string) => id === 'user-sdr');
    canAccessLead.mockImplementation(
      async (_u: unknown, lead: { assignedToId: string }) => lead.assignedToId === 'user-sdr'
    );

    const result = await applyBulkTaskAction(
      SDR,
      { action: 'skip', taskIds: ['mine', 'theirs'] },
      'human'
    );

    expect(result.updated).toBe(1);
    expect(result.failed).toEqual([{ taskId: 'theirs', reason: 'Forbidden' }]);
    // A partial result, not a 403 — one bad id must not cost the SDR the rest of their selection.
    expect(taskUpdateMany).toHaveBeenCalledTimes(1);
  });

  it('reports an id that does not exist instead of failing the call', async () => {
    taskFindMany.mockResolvedValue([]);

    const result = await applyBulkTaskAction(
      SDR,
      { action: 'skip', taskIds: ['ghost'] },
      'human'
    );

    expect(result).toEqual({ updated: 0, failed: [{ taskId: 'ghost', reason: 'Not found' }] });
  });
});

describe('the cadence gate', () => {
  it('refuses when an agent completes a task that belongs to a live sequence', async () => {
    taskFindMany.mockResolvedValue([task({ sequenceId: 'seq-1', type: 'email' })]);

    const result = await applyBulkTaskAction(
      SDR,
      { action: 'complete', taskIds: ['task-1'] },
      'agent'
    );

    expect(result.updated).toBe(0);
    expect(result.failed[0].reason).toMatch(/live sequence/i);
    // Nothing was written and, crucially, no send was enqueued.
    expect(taskUpdateMany).not.toHaveBeenCalled();
    expect(advanceSequence).not.toHaveBeenCalled();
  });

  it('lets a human complete the same task — the gate is on the actor, not on the task', async () => {
    taskFindMany.mockResolvedValue([task({ sequenceId: 'seq-1', type: 'email' })]);

    const result = await applyBulkTaskAction(
      SDR,
      { action: 'complete', taskIds: ['task-1'] },
      'human'
    );

    expect(result.updated).toBe(1);
    expect(advanceSequence).toHaveBeenCalledTimes(1);
  });

  it('lets an agent complete a task with no sequence — the gate is on sequenceId, not on the verb', async () => {
    taskFindMany.mockResolvedValue([task({ sequenceId: null })]);

    const result = await applyBulkTaskAction(
      SDR,
      { action: 'complete', taskIds: ['task-1'] },
      'agent'
    );

    expect(result.updated).toBe(1);
    expect(result.failed).toEqual([]);
    // `advanceSequence` returns immediately for a null sequenceId; it is still called, as the
    // human path calls it, because the shared implementation must not branch on the actor here.
    expect(advanceSequence).toHaveBeenCalledTimes(1);
  });

  it('lets an agent skip a cadence task — skipping does not advance anything', async () => {
    taskFindMany.mockResolvedValue([task({ sequenceId: 'seq-1', type: 'email' })]);

    const result = await applyBulkTaskAction(
      SDR,
      { action: 'skip', taskIds: ['task-1'] },
      'agent'
    );

    expect(result.updated).toBe(1);
    expect(advanceSequence).not.toHaveBeenCalled();
  });
});

describe('the rules the route used to hold', () => {
  it('refuses to complete a phone task with no outcome', async () => {
    taskFindMany.mockResolvedValue([task({ type: 'phone' })]);

    const result = await applyBulkTaskAction(
      SDR,
      { action: 'complete', taskIds: ['task-1'] },
      'human'
    );

    expect(result.updated).toBe(0);
    expect(result.failed[0].reason).toMatch(/need an outcome/);
    expect(taskUpdateMany).not.toHaveBeenCalled();
  });

  it('reports an already-closed task from the compare-and-set rather than double-counting it', async () => {
    taskFindMany.mockResolvedValue([task()]);
    taskUpdateMany.mockResolvedValue({ count: 0 });

    const result = await applyBulkTaskAction(
      SDR,
      { action: 'complete', taskIds: ['task-1'] },
      'human'
    );

    expect(result.updated).toBe(0);
    expect(result.failed).toEqual([{ taskId: 'task-1', reason: 'Already completed or skipped' }]);
    // The CAS is the whole defence against a double send: no Activity, no advance.
    expect(activityCreate).not.toHaveBeenCalled();
    expect(advanceSequence).not.toHaveBeenCalled();

    // And the write really was conditional on the status.
    expect(taskUpdateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'task-1', status: 'pending' },
    });
  });

  it('refuses a reassignment target the caller does not manage, before writing anything', async () => {
    taskFindMany.mockResolvedValue([task()]);
    canAccessUser.mockImplementation(async (_u: unknown, id: string) => id !== 'user-other');

    const result = await applyBulkTaskAction(
      SDR,
      { action: 'reassign', taskIds: ['task-1'], userId: 'user-other' },
      'human'
    );

    expect(result).toEqual({ updated: 0, failed: [], refusedTarget: 'user-other' });
    expect(taskFindMany).not.toHaveBeenCalled();
    expect(taskUpdate).not.toHaveBeenCalled();
  });

  it('writes no Activity for a reschedule — ActivityType has no member for it', async () => {
    taskFindMany.mockResolvedValue([task()]);

    const result = await applyBulkTaskAction(
      SDR,
      { action: 'reschedule', taskIds: ['task-1'], dueDate: new Date('2026-10-05T09:00:00.000Z') },
      'human'
    );

    expect(result.updated).toBe(1);
    // Inventing an activity type here would corrupt the leaderboard, which counts outreach.
    expect(activityCreate).not.toHaveBeenCalled();
  });
});

describe('POST /api/tasks/bulk', () => {
  it('answers 403 when the reassignment target was refused', async () => {
    taskFindMany.mockResolvedValue([task()]);
    canAccessUser.mockImplementation(async (_u: unknown, id: string) => id !== 'user-other');

    const res = await POST(
      bulkRequest({ action: 'reassign', taskIds: ['task-1'], userId: 'user-other' })
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/Forbidden/) });
  });

  it('acts as a human, so the cadence gate does not apply to the task list', async () => {
    taskFindMany.mockResolvedValue([task({ sequenceId: 'seq-1', type: 'email' })]);

    const res = await POST(bulkRequest({ action: 'complete', taskIds: ['task-1'] }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ updated: 1, failed: [] });
    expect(advanceSequence).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed body before reaching the tasks', async () => {
    const res = await POST(bulkRequest({ action: 'reschedule', taskIds: ['task-1'] }));

    expect(res.status).toBe(400);
    expect(taskFindMany).not.toHaveBeenCalled();
  });
});
