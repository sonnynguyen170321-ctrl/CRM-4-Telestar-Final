import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionUser } from '@/lib/auth';

/**
 * The chat assistant's `update_tasks` and `complete_tasks` tools.
 *
 * The request behind them was narrow — "I can view and create tasks, but can't mark, edit, delete,
 * reassign, or bulk-complete existing tasks" — but the surface it opens is not: completing a task
 * calls `advanceSequence`, which for an `autoComplete` email step enqueues a send. So one sentence
 * to a model is one hop from a prospect's inbox, and these tests pin the hop shut.
 *
 * Three properties matter more than the happy path:
 *
 *   1. the tools reuse `applyBulkTaskAction` with `actor: 'agent'`, so the per-task access checks
 *      are the ones already in production rather than a weaker second copy written for chat;
 *   2. the cadence refusal holds **with the capability set to `auto`** — it is an object-level
 *      floor, not a policy a director can raise;
 *   3. a refusal is reported as a refusal. A tool that answered "done" for a task it did not
 *      change would have the model tell the SDR work happened that did not.
 */

const applyBulkTaskActionMock = vi.fn();
const authorizeCapabilityMock = vi.fn();

vi.mock('@/lib/tasks/bulkAction', () => ({
  applyBulkTaskAction: (...a: unknown[]) => applyBulkTaskActionMock(...a),
}));

vi.mock('@/lib/agent/authorization', () => ({
  authorizeCapability: (...a: unknown[]) => authorizeCapabilityMock(...a),
}));

// `lib/ai/tools.ts` reaches the task service and `lib/auth`, which pulls next-auth into the test
// runtime. Neither is under test here — the shared implementation has its own suite in
// `tests/task-bulk-action.test.ts` — so both are stubbed to keep this file about the tool layer.
vi.mock('@/lib/tasks/service', () => ({
  createTask: vi.fn(),
  getTasks: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
  canAccessUser: vi.fn().mockResolvedValue(true),
  canAccessLead: vi.fn().mockResolvedValue(true),
}));

import { executeTool, AI_TOOLS, type ToolContext } from '@/lib/ai/tools';
import { TOOL_CAPABILITY } from '@/lib/agent/toolCapabilities';
import { DEFAULT_AUTONOMY, WRITE_CAPABILITIES } from '@/lib/agent/capabilities';

const SDR = {
  id: 'user-sdr',
  tenantId: 'tenant-a',
  role: 'sdr',
  email: 'sdr@telestar.test',
  firstName: 'Judy',
  lastName: 'Nguyen',
} as unknown as SessionUser;

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    userId: 'user-sdr',
    today: '2026-10-01',
    tenantId: 'tenant-a',
    role: 'sdr',
    sessionUser: SDR,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authorizeCapabilityMock.mockResolvedValue({ outcome: 'ALLOW' });
  applyBulkTaskActionMock.mockResolvedValue({ updated: 1, failed: [] });
});

describe('the tools are registered, not smuggled in', () => {
  it('both are declared and both map to a capability', () => {
    const names = AI_TOOLS.map((t) => t.function.name);
    expect(names).toContain('update_tasks');
    expect(names).toContain('complete_tasks');

    expect(TOOL_CAPABILITY.update_tasks).toBe('task_update');
    expect(TOOL_CAPABILITY.complete_tasks).toBe('task_complete');
  });

  it('both capabilities count as writes, so a session with no role is refused', async () => {
    expect(WRITE_CAPABILITIES.has('task_update')).toBe(true);
    expect(WRITE_CAPABILITIES.has('task_complete')).toBe(true);

    const out = await executeTool(
      'complete_tasks',
      { taskIds: ['task-1'] },
      ctx({ role: undefined })
    );

    expect(out).toMatch(/role/i);
    expect(applyBulkTaskActionMock).not.toHaveBeenCalled();
  });
});

describe('the session user is passed through, never reconstructed', () => {
  it('hands the real SessionUser to applyBulkTaskAction with actor "agent"', async () => {
    await executeTool('complete_tasks', { taskIds: ['task-1'] }, ctx());

    const [user, input, actor] = applyBulkTaskActionMock.mock.calls[0];
    // Identity, not shape: a hand-built user object would have to invent a role and a tenant, and
    // `canAccessUser` / `canAccessLead` believe what they are given.
    expect(user).toBe(SDR);
    expect(actor).toBe('agent');
    expect(input).toMatchObject({ action: 'complete', taskIds: ['task-1'] });
  });

  it('refuses when the session user is missing rather than acting as the bare userId', async () => {
    const out = await executeTool(
      'complete_tasks',
      { taskIds: ['task-1'] },
      ctx({ sessionUser: undefined })
    );

    expect(out).toMatch(/session user context/i);
    expect(applyBulkTaskActionMock).not.toHaveBeenCalled();
  });
});

describe('the cadence floor is reported, not smoothed over', () => {
  it('passes the refusal through verbatim even though task_complete defaults to auto', async () => {
    // The policy says `auto`. The gate still fires, because it is object-level.
    expect(DEFAULT_AUTONOMY.task_complete).toBe('auto');

    applyBulkTaskActionMock.mockResolvedValue({
      updated: 0,
      failed: [
        {
          taskId: 'task-1',
          reason:
            'This task is a step in a live sequence — completing it advances the cadence and can send mail, so it has to be completed from the task list by a person.',
        },
      ],
    });

    const out = await executeTool('complete_tasks', { taskIds: ['task-1'] }, ctx());

    expect(out).toMatch(/0 tasks completed/);
    expect(out).toMatch(/live sequence/);
    // The id is named, so the SDR can act on the one that did not close.
    expect(out).toContain('task-1');
  });

  it('names every task that did not change, not just a count', async () => {
    applyBulkTaskActionMock.mockResolvedValue({
      updated: 1,
      failed: [
        { taskId: 'task-2', reason: 'Forbidden' },
        { taskId: 'task-3', reason: 'Already completed or skipped' },
      ],
    });

    const out = await executeTool(
      'complete_tasks',
      { taskIds: ['task-1', 'task-2', 'task-3'] },
      ctx()
    );

    expect(out).toMatch(/1 task completed/);
    expect(out).toContain('task-2: Forbidden');
    expect(out).toContain('task-3: Already completed or skipped');
  });

  it('turns a refused reassignment target into prose and reports nothing as changed', async () => {
    applyBulkTaskActionMock.mockResolvedValue({ updated: 0, failed: [], refusedTarget: 'user-boss' });

    const out = await executeTool(
      'update_tasks',
      { taskIds: ['task-1'], action: 'reassign', userId: 'user-boss' },
      ctx()
    );

    expect(out).toMatch(/nothing was changed/i);
    expect(out).not.toMatch(/reassigned/);
  });
});

describe('arguments are validated before anything is touched', () => {
  it('refuses an empty id list and tells the model where ids come from', async () => {
    const out = await executeTool('complete_tasks', { taskIds: [] }, ctx());

    expect(out).toMatch(/get_my_tasks/);
    expect(applyBulkTaskActionMock).not.toHaveBeenCalled();
  });

  it('caps a batch at 50 ids', async () => {
    const many = Array.from({ length: 51 }, (_, i) => `task-${i}`);

    const out = await executeTool('complete_tasks', { taskIds: many }, ctx());

    expect(out).toMatch(/51 tasks/);
    expect(out).toMatch(/limit for one call is 50/);
    expect(applyBulkTaskActionMock).not.toHaveBeenCalled();
  });

  it('rejects a reschedule with no due date instead of silently picking one', async () => {
    const out = await executeTool(
      'update_tasks',
      { taskIds: ['task-1'], action: 'reschedule' },
      ctx()
    );

    expect(out).toMatch(/dueDate is required/);
    expect(applyBulkTaskActionMock).not.toHaveBeenCalled();
  });

  it('rejects an action the schema does not know, rather than falling through to a default verb', async () => {
    const out = await executeTool(
      'update_tasks',
      { taskIds: ['task-1'], action: 'delete' },
      ctx()
    );

    expect(out).toMatch(/rejected and nothing was changed/);
    expect(applyBulkTaskActionMock).not.toHaveBeenCalled();
  });

  it('cannot complete through update_tasks — the verb is not in that tool\'s enum', async () => {
    const declared = AI_TOOLS.find((t) => t.function.name === 'update_tasks')!;
    expect(declared.function.parameters.properties.action.enum).not.toContain('complete');

    // And the schema is what enforces it, not the enum alone: `complete` is a valid
    // `bulkTaskAction`, so the tool would accept it if the enum were only documentation.
    const out = await executeTool(
      'update_tasks',
      { taskIds: ['task-1'], action: 'complete' },
      ctx()
    );

    // It does go through, because `update_tasks` and `complete_tasks` share one schema — which is
    // why `update_tasks` carries `task_update` and the cadence floor lives below both of them
    // rather than in the enum. This test exists to make that trade-off visible; if it ever needs
    // to be a refusal, the check belongs in the handler, not in the JSON Schema.
    expect(applyBulkTaskActionMock).toHaveBeenCalledTimes(1);
    expect(out).toMatch(/1 task completed/);
  });

  it('accepts a single id sent as a bare string, which models do', async () => {
    await executeTool('complete_tasks', { taskIds: 'task-1' }, ctx());

    expect(applyBulkTaskActionMock.mock.calls[0][1]).toMatchObject({ taskIds: ['task-1'] });
  });

  it('accepts a comma-joined list, which models also do', async () => {
    await executeTool('complete_tasks', { taskIds: 'task-1, task-2' }, ctx());

    expect(applyBulkTaskActionMock.mock.calls[0][1]).toMatchObject({
      taskIds: ['task-1', 'task-2'],
    });
  });
});

describe('an invented id is answered by the CRM, not by the tool', () => {
  it('reports "Not found" for a hallucinated id without failing the rest', async () => {
    applyBulkTaskActionMock.mockResolvedValue({
      updated: 1,
      failed: [{ taskId: 'clxxxxxxxxxxxxxxxxxxxxxxx', reason: 'Not found' }],
    });

    const out = await executeTool(
      'complete_tasks',
      { taskIds: ['task-1', 'clxxxxxxxxxxxxxxxxxxxxxxx'] },
      ctx()
    );

    expect(out).toContain('Not found');
    expect(out).toMatch(/1 task completed/);
  });

  it('surfaces a thrown error as a failure, never as a completion', async () => {
    applyBulkTaskActionMock.mockRejectedValue(
      new Error('applyBulkTaskAction refused: no tenant context on the session user')
    );

    const out = await executeTool('complete_tasks', { taskIds: ['task-1'] }, ctx());

    expect(out).toMatch(/nothing was changed/i);
    expect(out).toMatch(/no tenant context/);
  });
});
