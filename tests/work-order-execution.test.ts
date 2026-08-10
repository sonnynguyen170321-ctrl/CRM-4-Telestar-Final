import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';

/**
 * Work order execution: the runtime path, idempotency and budgets (Revenue AI Phase 6b).
 *
 * The tool layer is mocked and nothing else is. `executeAgentAction`, the `AgentAction` ledger,
 * capability resolution, the work order services and the database are all real — because the
 * claims under test are about exactly those. Mocking the runtime would leave "the worker uses
 * the Phase 5 runtime rather than bypassing it" asserting only that a mock was called.
 *
 * Covers Phase 6b acceptance: enqueue path, runtime path, duplicate-execution safety, budget
 * exhaustion with partial progress, and `place_call` remaining impossible.
 */

const mockExecuteTool = vi.fn();

vi.mock('@/lib/ai/tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/tools')>();
  return { ...actual, executeTool: (...args: unknown[]) => mockExecuteTool(...args) };
});

vi.mock('@/auth', () => ({
  auth: vi.fn(),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

const { prisma } = await import('@/lib/prisma');
const { executeWorkOrder, workOrderActionKey } = await import('@/lib/workorders/execution');
const { createWorkOrder, activateWorkOrder, requireWorkOrder } = await import(
  '@/lib/workorders/service'
);
const { budgetSnapshot, recordConsumption, reconcileConsumption } = await import(
  '@/lib/workorders/budgets'
);
const { resetWorkOrders, runAs, setupWorkOrderFixture } = await import(
  './helpers/workOrderFixture'
);
type WorkOrderFixture = Awaited<ReturnType<typeof setupWorkOrderFixture>>;

const hasDb = Boolean(process.env.DATABASE_URL);

let fx: WorkOrderFixture;
const run = <T>(fn: () => Promise<T>) => runAs(fx.tenantId, fn);

beforeAll(async () => {
  if (!hasDb) return;
  fx = await setupWorkOrderFixture('woexec');
});

beforeEach(async () => {
  if (!hasDb) return;
  mockExecuteTool.mockReset();
  mockExecuteTool.mockResolvedValue('tool ok');
  await resetWorkOrders(fx);
  await runAs(fx.tenantId, async () => {
    await prisma.agentApprovalRequest.deleteMany({ where: { tenantId: fx.tenantId } });
    await prisma.agentAction.deleteMany({ where: { tenantId: fx.tenantId } });
    await prisma.aiCall.deleteMany({ where: { tenantId: fx.tenantId } });
    await prisma.autonomyPolicy.deleteMany({ where: { tenantId: fx.tenantId } });
  });
});

async function activeOrder(type: string, requestKey: string, leadId: string | null = fx.idleLeadId) {
  const order = await createWorkOrder({
    tenantId: fx.tenantId,
    type,
    createdById: fx.directorId,
    requestKey,
    leadId,
  });
  await activateWorkOrder({ workOrderId: order.id, tenantId: fx.tenantId });
  return requireWorkOrder(order.id, fx.tenantId);
}

describe.skipIf(!hasDb)('execution runs through the Phase 5 agent runtime', () => {
  it('writes an AgentAction for every step, attributed to the work order', async () => {
    await run(async () => {
      const order = await activeOrder('research_batch', 'exec-runtime');

      const result = await executeWorkOrder({
        workOrderId: order.id,
        tenantId: fx.tenantId,
        actorUserId: fx.directorId,
        steps: [{ toolName: 'search_web', args: { query: 'telestar' } }],
      });

      expect(result.status).toBe('completed');
      expect(result.completedSteps).toBe(1);

      // The ledger row is the proof the runtime ran it. A path that bypassed
      // `executeAgentAction` would still have called the tool and left nothing here.
      const actions = await prisma.agentAction.findMany({
        where: { tenantId: fx.tenantId, workOrderId: order.id },
      });
      expect(actions).toHaveLength(1);
      expect(actions[0].tool).toBe('search_web');
      expect(actions[0].capability).toBe('research');
      expect(actions[0].status).toBe('completed');
      expect(actions[0].authorizationOutcome).toBe('ALLOW');
    });
  });

  it('carries the pinned playbook version into the ledger as provenance', async () => {
    await run(async () => {
      const order = await activeOrder('research_batch', 'exec-provenance');
      await executeWorkOrder({
        workOrderId: order.id,
        tenantId: fx.tenantId,
        actorUserId: fx.directorId,
        steps: [{ toolName: 'search_web', args: { query: 'x' } }],
      });

      const action = await prisma.agentAction.findFirst({
        where: { tenantId: fx.tenantId, workOrderId: order.id },
      });
      expect(action?.playbookVersionId).toBe(fx.versionOneId);
    });
  });

  it('completes the work order when the plan runs out', async () => {
    await run(async () => {
      const order = await activeOrder('research_batch', 'exec-completes');
      await executeWorkOrder({
        workOrderId: order.id,
        tenantId: fx.tenantId,
        actorUserId: fx.directorId,
        steps: [{ toolName: 'search_web', args: { query: 'x' } }],
      });

      expect((await requireWorkOrder(order.id, fx.tenantId)).status).toBe('completed');
    });
  });

  it('refuses an unregistered tool and stops, rather than handing it to the runtime', async () => {
    await run(async () => {
      const order = await activeOrder('research_batch', 'exec-unregistered');
      const result = await executeWorkOrder({
        workOrderId: order.id,
        tenantId: fx.tenantId,
        actorUserId: fx.directorId,
        steps: [{ toolName: 'rm_minus_rf', args: {} }],
      });

      expect(result.status).toBe('refused');
      expect(mockExecuteTool).not.toHaveBeenCalled();
    });
  });

  it('refuses a tool the work order type does not permit', async () => {
    await run(async () => {
      // `campaign_analysis` may research and summarise; it may not create tasks.
      const order = await activeOrder('campaign_analysis', 'exec-out-of-type', null);
      const result = await executeWorkOrder({
        workOrderId: order.id,
        tenantId: fx.tenantId,
        actorUserId: fx.directorId,
        steps: [{ toolName: 'create_task', args: { title: 'nope' } }],
      });

      expect(result.status).toBe('refused');
      expect(result.steps[0].detail).toMatch(/does not cover/i);
      expect(mockExecuteTool).not.toHaveBeenCalled();
    });
  });

  it('refuses to act for a deactivated user', async () => {
    await run(async () => {
      const order = await activeOrder('research_batch', 'exec-deactivated');
      await prisma.user.update({ where: { id: fx.sdrId }, data: { isActive: false } });

      await expect(
        executeWorkOrder({
          workOrderId: order.id,
          tenantId: fx.tenantId,
          actorUserId: fx.sdrId,
          steps: [{ toolName: 'search_web', args: { query: 'x' } }],
        })
      ).rejects.toThrow(/deactivated/);

      await prisma.user.update({ where: { id: fx.sdrId }, data: { isActive: true } });
    });
  });
});

describe.skipIf(!hasDb)('a duplicate execution cannot duplicate a CRM mutation', () => {
  it('runs the tool once across two identical executions', async () => {
    await run(async () => {
      const order = await activeOrder('research_batch', 'exec-idempotent');
      const steps = [{ toolName: 'search_web', args: { query: 'once' } }];

      await executeWorkOrder({
        workOrderId: order.id,
        tenantId: fx.tenantId,
        actorUserId: fx.directorId,
        steps,
      });
      expect(mockExecuteTool).toHaveBeenCalledTimes(1);

      // Re-activate and replay — the same job being redelivered by BullMQ.
      await activateWorkOrder({ workOrderId: order.id, tenantId: fx.tenantId }).catch(
        () => undefined
      );
      await prisma.workOrder.updateMany({
        where: { id: order.id, tenantId: fx.tenantId },
        data: { status: 'active', completedAt: null },
      });

      await executeWorkOrder({
        workOrderId: order.id,
        tenantId: fx.tenantId,
        actorUserId: fx.directorId,
        steps,
      });

      // The ledger recognised the completed action and returned its recorded result instead of
      // calling the tool a second time. This is what makes three BullMQ retries safe.
      expect(mockExecuteTool).toHaveBeenCalledTimes(1);
      const actions = await prisma.agentAction.findMany({
        where: { tenantId: fx.tenantId, workOrderId: order.id },
      });
      expect(actions).toHaveLength(1);
    });
  });

  it('derives the action key from the work order and step, not from the clock', () => {
    const a = workOrderActionKey('wo-1', 2, 'search_web');
    const b = workOrderActionKey('wo-1', 2, 'search_web');
    expect(a).toBe(b);
    expect(a).toBe('workorder:wo-1:step:2:search_web');
    expect(workOrderActionKey('wo-1', 3, 'search_web')).not.toBe(a);
  });
});

describe.skipIf(!hasDb)('budget exhaustion pauses with partial progress', () => {
  it('stops before the step that would exceed the budget and reports how far it got', async () => {
    await run(async () => {
      const order = await activeOrder('research_batch', 'exec-budget');

      // Room for exactly one tool call.
      await prisma.workOrder.updateMany({
        where: { id: order.id, tenantId: fx.tenantId },
        data: { maxToolCalls: 1, toolCallsUsed: 0 },
      });

      const result = await executeWorkOrder({
        workOrderId: order.id,
        tenantId: fx.tenantId,
        actorUserId: fx.directorId,
        steps: [
          { toolName: 'search_web', args: { query: 'one' } },
          { toolName: 'search_web', args: { query: 'two' } },
        ],
      });

      expect(result.status).toBe('paused');
      expect(result.pausedReason).toBe('budget_exhausted');
      // Partial completion, stated as a number rather than implied.
      expect(result.completedSteps).toBe(1);
      expect(result.totalSteps).toBe(2);
      expect(mockExecuteTool).toHaveBeenCalledTimes(1);

      const after = await requireWorkOrder(order.id, fx.tenantId);
      expect(after.status).toBe('paused');
      expect(after.pausedReason).toBe('budget_exhausted');
      // A pause, not a completion and not a failure.
      expect(after.completedAt).toBeNull();
    });
  });

  it('never starts a step once a budget is already exhausted', async () => {
    await run(async () => {
      const order = await activeOrder('research_batch', 'exec-budget-zero');
      await prisma.workOrder.updateMany({
        where: { id: order.id, tenantId: fx.tenantId },
        data: { maxToolCalls: 1, toolCallsUsed: 1 },
      });

      const result = await executeWorkOrder({
        workOrderId: order.id,
        tenantId: fx.tenantId,
        actorUserId: fx.directorId,
        steps: [{ toolName: 'search_web', args: { query: 'x' } }],
      });

      expect(result.status).toBe('paused');
      expect(result.completedSteps).toBe(0);
      expect(mockExecuteTool).not.toHaveBeenCalled();
    });
  });

  it('counts a failed tool call against the budget', async () => {
    await run(async () => {
      const order = await activeOrder('research_batch', 'exec-budget-failure');
      mockExecuteTool.mockRejectedValueOnce(new Error('provider exploded'));

      await executeWorkOrder({
        workOrderId: order.id,
        tenantId: fx.tenantId,
        actorUserId: fx.directorId,
        steps: [{ toolName: 'search_web', args: { query: 'x' } }],
      });

      // Counting only successes would let a retry loop run unbounded inside its budget.
      const after = await requireWorkOrder(order.id, fx.tenantId);
      expect(after.toolCallsUsed).toBe(1);
    });
  });

  it('treats an unactivated order as having spent no wall clock', () => {
    const snapshot = budgetSnapshot({
      researchBudget: 10,
      tokenBudget: 10,
      maxToolCalls: 10,
      maxExecutionDuration: 600,
      researchUsed: 0,
      tokensUsed: 0,
      toolCallsUsed: 0,
      activatedAt: null,
    });
    expect(snapshot.secondsRemaining).toBe(600);
    expect(snapshot.exhausted).toEqual([]);
  });

  it('reports duration exhaustion once the wall clock passes the limit', () => {
    const activatedAt = new Date(Date.now() - 7_200_000);
    const snapshot = budgetSnapshot({
      researchBudget: 10,
      tokenBudget: 10,
      maxToolCalls: 10,
      maxExecutionDuration: 3_600,
      researchUsed: 0,
      tokensUsed: 0,
      toolCallsUsed: 0,
      activatedAt,
    });
    expect(snapshot.exhausted).toContain('duration');
  });
});

describe.skipIf(!hasDb)('consumption counters follow the ledgers', () => {
  it('increments atomically rather than read-modify-write', async () => {
    await run(async () => {
      const order = await activeOrder('research_batch', 'exec-counters');

      await Promise.all([
        recordConsumption(fx.tenantId, order.id, { toolCalls: 1 }),
        recordConsumption(fx.tenantId, order.id, { toolCalls: 1 }),
        recordConsumption(fx.tenantId, order.id, { toolCalls: 1 }),
      ]);

      // A lost update would show fewer than three.
      expect((await requireWorkOrder(order.id, fx.tenantId)).toolCallsUsed).toBe(3);
    });
  });

  it('reconciles drifted counters back to the ledgers and says it drifted', async () => {
    await run(async () => {
      const order = await activeOrder('research_batch', 'exec-reconcile');
      await prisma.aiCall.create({
        data: {
          tenantId: fx.tenantId,
          workOrderId: order.id,
          operation: 'research',
          provider: 'tavily',
          searchCredits: 2,
          totalTokens: 150,
          latencyMs: 10,
          status: 'ok',
        },
      });

      // Counters deliberately wrong: `recordConsumption` never throws, so a database blip
      // during a run leaves them low. Reconciliation is the repair, and it reports the gap
      // rather than papering over it.
      await prisma.workOrder.updateMany({
        where: { id: order.id, tenantId: fx.tenantId },
        data: { researchUsed: 0, tokensUsed: 0 },
      });

      const reconciled = await reconcileConsumption(fx.tenantId, order.id);
      expect(reconciled.drifted).toBe(true);
      expect(reconciled.research).toBe(2);
      expect(reconciled.tokens).toBe(150);

      const after = await requireWorkOrder(order.id, fx.tenantId);
      expect(after.researchUsed).toBe(2);
      expect(after.tokensUsed).toBe(150);
    });
  });
});

describe.skipIf(!hasDb)('place_call remains impossible', () => {
  it('cannot be run inside any work order, whatever the plan asks for', async () => {
    await run(async () => {
      const order = await activeOrder('outreach_launch', 'exec-place-call');
      const result = await executeWorkOrder({
        workOrderId: order.id,
        tenantId: fx.tenantId,
        actorUserId: fx.directorId,
        steps: [{ toolName: 'place_call', args: { to: '+84900000000' } }],
      });

      expect(result.status).toBe('refused');
      expect(mockExecuteTool).not.toHaveBeenCalled();
      // No tool is even registered for it, so it fails closed at the first gate.
      const actions = await prisma.agentAction.findMany({
        where: { tenantId: fx.tenantId, workOrderId: order.id },
      });
      expect(actions).toHaveLength(0);
    });
  });
});

describe.skipIf(!hasDb)('a cancelled work order stops mid-plan', () => {
  it('does not run the remaining steps', async () => {
    await run(async () => {
      const order = await activeOrder('research_batch', 'exec-cancelled');
      mockExecuteTool.mockImplementationOnce(async () => {
        // Cancel between step 1 and step 2, the way a human would from the admin surface.
        await prisma.workOrder.updateMany({
          where: { id: order.id, tenantId: fx.tenantId },
          data: { status: 'cancelled' },
        });
        return 'ok';
      });

      const result = await executeWorkOrder({
        workOrderId: order.id,
        tenantId: fx.tenantId,
        actorUserId: fx.directorId,
        steps: [
          { toolName: 'search_web', args: { query: 'one' } },
          { toolName: 'search_web', args: { query: 'two' } },
        ],
      });

      expect(result.completedSteps).toBe(1);
      expect(mockExecuteTool).toHaveBeenCalledTimes(1);
      expect(result.steps[1].status).toBe('not_attempted');
    });
  });
});

describe.skipIf(!hasDb)('an AI provider outage does not break the CRM', () => {
  it('records the failure and leaves the work order recoverable', async () => {
    await run(async () => {
      const order = await activeOrder('research_batch', 'exec-provider-down');
      mockExecuteTool.mockRejectedValue(new Error('ECONNREFUSED api.groq.com'));

      const result = await executeWorkOrder({
        workOrderId: order.id,
        tenantId: fx.tenantId,
        actorUserId: fx.directorId,
        steps: [{ toolName: 'search_web', args: { query: 'x' } }],
      });

      expect(result.status).toBe('refused');
      expect(result.steps[0].status).toBe('failed');

      // The failure is recorded, not swallowed, and the CRM row is still readable and sane.
      const action = await prisma.agentAction.findFirst({
        where: { tenantId: fx.tenantId, workOrderId: order.id },
      });
      expect(action?.status).toBe('failed');

      const lead = await prisma.lead.findUnique({ where: { id: fx.idleLeadId } });
      expect(lead?.assignedToId).toBe(fx.sdrId);
    });
  });
});
