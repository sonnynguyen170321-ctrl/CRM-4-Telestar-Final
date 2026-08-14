import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';

/**
 * Durable approval requests, and the rule that approval is not a bypass (Phase 6b).
 *
 * The autonomy policy is real: these tests store an `AutonomyPolicy` row to make `tasks`
 * require approval, exactly as a tenant would from a settings page, and then drive the same
 * resolution path production uses. Forcing the outcome by mocking `decideCapability` would
 * assert that a mock returned what it was told to.
 *
 * Covers Phase 6b acceptance: one durable request per action, no execution while pending,
 * resume through current authorization, rejected and expired never executing, and a state
 * change after approval still refusing.
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
const { executeWorkOrder } = await import('@/lib/workorders/execution');
const { createWorkOrder, activateWorkOrder, requireWorkOrder, finishWorkOrder } = await import(
  '@/lib/workorders/service'
);
const {
  ApprovalError,
  approveRequest,
  expireStaleRequests,
  levelSatisfies,
  rejectRequest,
  requestApproval,
  resumeApprovedAction,
} = await import('@/lib/workorders/approvals');
const { resetWorkOrders, runAs, setupWorkOrderFixture } = await import(
  './helpers/workOrderFixture'
);
type WorkOrderFixture = Awaited<ReturnType<typeof setupWorkOrderFixture>>;

const hasDb = Boolean(process.env.DATABASE_URL);

let fx: WorkOrderFixture;
const run = <T>(fn: () => Promise<T>) => runAs(fx.tenantId, fn);

beforeAll(async () => {
  if (!hasDb) return;
  fx = await setupWorkOrderFixture('woappr');
});

beforeEach(async () => {
  if (!hasDb) return;
  mockExecuteTool.mockReset();
  mockExecuteTool.mockResolvedValue('tool ok');
  await resetWorkOrders(fx);
  await runAs(fx.tenantId, async () => {
    await prisma.agentApprovalRequest.deleteMany({ where: { tenantId: fx.tenantId } });
    await prisma.agentAction.deleteMany({ where: { tenantId: fx.tenantId } });
    await prisma.autonomyPolicy.deleteMany({ where: { tenantId: fx.tenantId } });
  });
});

/** Make `tasks` require approval for the director role, the way a tenant policy would. */
async function requireApprovalForTasks(mode: 'approval' | 'manager_approval') {
  await prisma.autonomyPolicy.upsert({
    where: {
      tenantId_role_capability: {
        tenantId: fx.tenantId,
        role: 'director',
        capability: 'tasks',
      },
    },
    create: {
      tenantId: fx.tenantId,
      role: 'director',
      capability: 'tasks',
      mode,
    },
    update: { mode },
  });
}

async function activeOrder(requestKey: string, type = 'followup') {
  const order = await createWorkOrder({
    tenantId: fx.tenantId,
    type,
    createdById: fx.directorId,
    requestKey,
    leadId: fx.idleLeadId,
  });
  await activateWorkOrder({ workOrderId: order.id, tenantId: fx.tenantId });
  return requireWorkOrder(order.id, fx.tenantId);
}

const TASK_STEP = { toolName: 'create_task', args: { title: 'Follow up' } };

async function runToApproval(requestKey: string, type = 'followup') {
  const order = await activeOrder(requestKey, type);
  const result = await executeWorkOrder({
    workOrderId: order.id,
    tenantId: fx.tenantId,
    actorUserId: fx.directorId,
    steps: [TASK_STEP],
  });
  return { order, result };
}

describe.skipIf(!hasDb)('an approval-required action does not execute', () => {
  it('creates exactly one durable request and runs nothing', async () => {
    await run(async () => {
      await requireApprovalForTasks('approval');
      const { result } = await runToApproval('appr-one');

      expect(result.status).toBe('paused');
      expect(result.pausedReason).toBe('awaiting_approval');
      expect(result.completedSteps).toBe(0);
      expect(result.approvalRequestIds).toHaveLength(1);

      // The action did not run, and left no completed ledger row behind.
      expect(mockExecuteTool).not.toHaveBeenCalled();

      const requests = await prisma.agentApprovalRequest.findMany({
        where: { tenantId: fx.tenantId },
      });
      expect(requests).toHaveLength(1);
      expect(requests[0].status).toBe('pending');
      expect(requests[0].requiredLevel).toBe('user');
      expect(requests[0].capability).toBe('tasks');
      expect(requests[0].toolName).toBe('create_task');
    });
  });

  it('records the exact intent a human is being asked to judge', async () => {
    await run(async () => {
      await requireApprovalForTasks('approval');
      await runToApproval('appr-intent');

      const request = await prisma.agentApprovalRequest.findFirst({
        where: { tenantId: fx.tenantId },
      });
      expect(request?.args).toEqual({ title: 'Follow up' });
      expect(request?.leadId).toBe(fx.idleLeadId);
      expect(request?.playbookVersionId).toBe(fx.versionOneId);
    });
  });

  it('pauses the work order and keeps its lease while a human decides', async () => {
    await run(async () => {
      await requireApprovalForTasks('approval');
      // `outreach_launch`, not `followup`: only a prospect-touching type takes an exclusive
      // lease at all. An assistance order holds nothing, so there would be nothing to keep.
      const { order } = await runToApproval('appr-keeps-lease', 'outreach_launch');

      const after = await requireWorkOrder(order.id, fx.tenantId);
      expect(after.status).toBe('paused');
      expect(after.pausedReason).toBe('awaiting_approval');

      // Letting another order take the lead while a human decides is how an approval gets
      // granted for work that has since been superseded.
      const lease = await prisma.workOrderLease.findUnique({
        where: { tenantId_leadId: { tenantId: fx.tenantId, leadId: fx.idleLeadId } },
      });
      expect(lease).not.toBeNull();
      expect(lease?.releasedAt).toBeNull();
      expect(lease?.workOrderId).toBe(order.id);
    });
  });

  it('takes no lease for an assistance order, so there is none to keep', async () => {
    await run(async () => {
      await requireApprovalForTasks('approval');
      await runToApproval('appr-no-lease', 'followup');

      const lease = await prisma.workOrderLease.findUnique({
        where: { tenantId_leadId: { tenantId: fx.tenantId, leadId: fx.idleLeadId } },
      });
      expect(lease).toBeNull();
    });
  });

  it('asks the same human only once when the job is redelivered', async () => {
    await run(async () => {
      await requireApprovalForTasks('approval');
      const { order } = await runToApproval('appr-idempotent');

      await prisma.workOrder.updateMany({
        where: { id: order.id, tenantId: fx.tenantId },
        data: { status: 'active', pausedReason: null },
      });
      await executeWorkOrder({
        workOrderId: order.id,
        tenantId: fx.tenantId,
        actorUserId: fx.directorId,
        steps: [TASK_STEP],
      });

      const requests = await prisma.agentApprovalRequest.findMany({
        where: { tenantId: fx.tenantId },
      });
      expect(requests).toHaveLength(1);
    });
  });

  it('raises a manager-level request when policy demands one', async () => {
    await run(async () => {
      await requireApprovalForTasks('manager_approval');
      await runToApproval('appr-manager-level');

      const request = await prisma.agentApprovalRequest.findFirst({
        where: { tenantId: fx.tenantId },
      });
      expect(request?.requiredLevel).toBe('manager');
    });
  });
});

describe.skipIf(!hasDb)('deciding a request', () => {
  it('refuses a manager-level approval from a role that may not grant one', async () => {
    await run(async () => {
      await requireApprovalForTasks('manager_approval');
      await runToApproval('appr-sdr-denied');
      const request = await prisma.agentApprovalRequest.findFirstOrThrow({
        where: { tenantId: fx.tenantId },
      });

      await expect(
        approveRequest({
          requestId: request.id,
          tenantId: fx.tenantId,
          approver: { id: fx.sdrId, role: 'sdr' },
        })
      ).rejects.toBeInstanceOf(ApprovalError);

      expect(
        (await prisma.agentApprovalRequest.findFirstOrThrow({ where: { id: request.id } })).status
      ).toBe('pending');
    });
  });

  it('cannot be decided twice', async () => {
    await run(async () => {
      await requireApprovalForTasks('approval');
      await runToApproval('appr-decide-twice');
      const request = await prisma.agentApprovalRequest.findFirstOrThrow({
        where: { tenantId: fx.tenantId },
      });

      await approveRequest({
        requestId: request.id,
        tenantId: fx.tenantId,
        approver: { id: fx.directorId, role: 'director' },
      });

      await expect(
        rejectRequest({
          requestId: request.id,
          tenantId: fx.tenantId,
          approver: { id: fx.directorId, role: 'director' },
        })
      ).rejects.toBeInstanceOf(ApprovalError);
    });
  });

  it('ranks a manager approval above a user approval, and not the reverse', () => {
    expect(levelSatisfies('manager', 'user')).toBe(true);
    expect(levelSatisfies('manager', 'manager')).toBe(true);
    expect(levelSatisfies('user', 'user')).toBe(true);
    expect(levelSatisfies('user', 'manager')).toBe(false);
  });
});

describe.skipIf(!hasDb)('resuming re-derives authorization instead of trusting the approval', () => {
  it('proceeds when the world has not changed', async () => {
    await run(async () => {
      await requireApprovalForTasks('approval');
      await runToApproval('appr-resume-ok');
      const request = await prisma.agentApprovalRequest.findFirstOrThrow({
        where: { tenantId: fx.tenantId },
      });

      await approveRequest({
        requestId: request.id,
        tenantId: fx.tenantId,
        approver: { id: fx.directorId, role: 'director' },
      });

      const resume = await resumeApprovedAction({
        requestId: request.id,
        tenantId: fx.tenantId,
        actor: { role: 'director', tenantId: fx.tenantId },
      });
      expect(resume.status).toBe('proceed');
    });
  });

  it('refuses when the policy tightened after the human approved', async () => {
    await run(async () => {
      await requireApprovalForTasks('approval');
      await runToApproval('appr-tightened');
      const request = await prisma.agentApprovalRequest.findFirstOrThrow({
        where: { tenantId: fx.tenantId },
      });

      await approveRequest({
        requestId: request.id,
        tenantId: fx.tenantId,
        approver: { id: fx.directorId, role: 'director' },
      });

      // A director signed off at user level; the tenant then raised the bar to manager.
      await requireApprovalForTasks('manager_approval');

      const resume = await resumeApprovedAction({
        requestId: request.id,
        tenantId: fx.tenantId,
        actor: { role: 'director', tenantId: fx.tenantId },
      });

      expect(resume.status).toBe('refused');
      expect(resume.status === 'refused' && resume.reason).toBe('insufficient_approval_level');
    });
  });

  it('refuses when the capability became human_only after approval', async () => {
    await run(async () => {
      await requireApprovalForTasks('approval');
      await runToApproval('appr-human-only');
      const request = await prisma.agentApprovalRequest.findFirstOrThrow({
        where: { tenantId: fx.tenantId },
      });
      await approveRequest({
        requestId: request.id,
        tenantId: fx.tenantId,
        approver: { id: fx.directorId, role: 'director' },
      });

      await prisma.autonomyPolicy.updateMany({
        where: { tenantId: fx.tenantId, capability: 'tasks' },
        data: { mode: 'human_only' },
      });

      const resume = await resumeApprovedAction({
        requestId: request.id,
        tenantId: fx.tenantId,
        actor: { role: 'director', tenantId: fx.tenantId },
      });
      expect(resume.status).toBe('refused');
      expect(resume.status === 'refused' && resume.reason).toBe('authorization_changed');
    });
  });

  it('refuses when the work order was cancelled after approval', async () => {
    await run(async () => {
      await requireApprovalForTasks('approval');
      const { order } = await runToApproval('appr-cancelled');
      const request = await prisma.agentApprovalRequest.findFirstOrThrow({
        where: { tenantId: fx.tenantId },
      });
      await approveRequest({
        requestId: request.id,
        tenantId: fx.tenantId,
        approver: { id: fx.directorId, role: 'director' },
      });

      await finishWorkOrder({
        workOrderId: order.id,
        tenantId: fx.tenantId,
        status: 'cancelled',
      });

      const resume = await resumeApprovedAction({
        requestId: request.id,
        tenantId: fx.tenantId,
        actor: { role: 'director', tenantId: fx.tenantId },
      });
      expect(resume.status).toBe('refused');
      expect(resume.status === 'refused' && resume.reason).toBe('work_order_not_executable');
    });
  });

  it('refuses while the request is still pending', async () => {
    await run(async () => {
      await requireApprovalForTasks('approval');
      await runToApproval('appr-still-pending');
      const request = await prisma.agentApprovalRequest.findFirstOrThrow({
        where: { tenantId: fx.tenantId },
      });

      const resume = await resumeApprovedAction({
        requestId: request.id,
        tenantId: fx.tenantId,
        actor: { role: 'director', tenantId: fx.tenantId },
      });
      expect(resume.status).toBe('refused');
      expect(resume.status === 'refused' && resume.reason).toBe('still_pending');
    });
  });

  it('never executes a rejected request', async () => {
    await run(async () => {
      await requireApprovalForTasks('approval');
      await runToApproval('appr-rejected');
      const request = await prisma.agentApprovalRequest.findFirstOrThrow({
        where: { tenantId: fx.tenantId },
      });

      await rejectRequest({
        requestId: request.id,
        tenantId: fx.tenantId,
        approver: { id: fx.directorId, role: 'director' },
        reason: 'wrong prospect',
      });

      const resume = await resumeApprovedAction({
        requestId: request.id,
        tenantId: fx.tenantId,
        actor: { role: 'director', tenantId: fx.tenantId },
      });
      expect(resume.status).toBe('refused');
      expect(resume.status === 'refused' && resume.reason).toBe('rejected');
      expect(mockExecuteTool).not.toHaveBeenCalled();
    });
  });

  it('never executes an expired request, even if it was approved', async () => {
    await run(async () => {
      await requireApprovalForTasks('approval');
      await runToApproval('appr-expired');
      const request = await prisma.agentApprovalRequest.findFirstOrThrow({
        where: { tenantId: fx.tenantId },
      });
      await approveRequest({
        requestId: request.id,
        tenantId: fx.tenantId,
        approver: { id: fx.directorId, role: 'director' },
      });

      // Approval does not stop the clock.
      await prisma.agentApprovalRequest.updateMany({
        where: { id: request.id },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      const resume = await resumeApprovedAction({
        requestId: request.id,
        tenantId: fx.tenantId,
        actor: { role: 'director', tenantId: fx.tenantId },
      });
      expect(resume.status).toBe('refused');
      expect(resume.status === 'refused' && resume.reason).toBe('expired');
    });
  });

  it('refuses an unknown request rather than defaulting to permitted', async () => {
    await run(async () => {
      const resume = await resumeApprovedAction({
        requestId: 'does-not-exist',
        tenantId: fx.tenantId,
        actor: { role: 'director', tenantId: fx.tenantId },
      });
      expect(resume.status).toBe('refused');
      expect(resume.status === 'refused' && resume.reason).toBe('not_found');
    });
  });
});

describe.skipIf(!hasDb)('expiry', () => {
  it('sweeps pending requests past their deadline', async () => {
    await run(async () => {
      const order = await activeOrder('appr-sweep');
      const { request } = await requestApproval({
        tenantId: fx.tenantId,
        actionKey: 'sweep-me',
        workOrderId: order.id,
        capability: 'tasks',
        toolName: 'create_task',
        args: {},
        requiredLevel: 'user',
        requestedById: fx.directorId,
      });

      await prisma.agentApprovalRequest.updateMany({
        where: { id: request.id },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      expect(await expireStaleRequests(fx.tenantId)).toBe(1);
      const after = await prisma.agentApprovalRequest.findFirstOrThrow({
        where: { id: request.id },
      });
      expect(after.status).toBe('expired');
      expect(after.resolvedAt).not.toBeNull();
    });
  });

  it('refuses to decide an expired request', async () => {
    await run(async () => {
      const order = await activeOrder('appr-decide-expired');
      const { request } = await requestApproval({
        tenantId: fx.tenantId,
        actionKey: 'decide-expired',
        workOrderId: order.id,
        capability: 'tasks',
        toolName: 'create_task',
        args: {},
        requiredLevel: 'user',
        requestedById: fx.directorId,
      });
      await prisma.agentApprovalRequest.updateMany({
        where: { id: request.id },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      await expect(
        approveRequest({
          requestId: request.id,
          tenantId: fx.tenantId,
          approver: { id: fx.directorId, role: 'director' },
        })
      ).rejects.toBeInstanceOf(ApprovalError);
    });
  });

  it('returns the existing request rather than raising a second one', async () => {
    await run(async () => {
      const order = await activeOrder('appr-dedupe');
      const base = {
        tenantId: fx.tenantId,
        actionKey: 'same-action',
        workOrderId: order.id,
        capability: 'tasks' as const,
        toolName: 'create_task',
        args: {},
        requiredLevel: 'user' as const,
        requestedById: fx.directorId,
      };

      const first = await requestApproval(base);
      const second = await requestApproval(base);

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.request.id).toBe(first.request.id);
    });
  });
});

/**
 * An edit made while approving (Task 1 — the approved-copy hand-off).
 *
 * The dangerous version of this feature is a "revise" endpoint separate from the decision: the
 * args and the decision would then be two writes, and a retry landing between them would execute
 * wording nobody signed. So the edit rides the same compare-and-set that stamps the approval, and
 * these tests assert the durable row rather than a return value — execution replays `args`, so
 * `args` is what has to be right.
 */
describe.skipIf(!hasDb)('approving with an edit', () => {
  const DRAFTED = [
    {
      stepOrder: 1,
      subject: 'Your Q3 hiring push',
      body: 'Saw the 12 SDR openings in Da Nang.',
      citedEvidenceIds: ['ev-1'],
      aiGenerated: true,
    },
    {
      stepOrder: 2,
      subject: 'Following up',
      body: 'Circling back on the hiring push.',
      citedEvidenceIds: ['ev-1'],
      aiGenerated: true,
    },
  ];

  async function pendingLaunchRequest(actionKey: string, args: Record<string, unknown>) {
    const order = await activeOrder(`appr-edit-${actionKey}`, 'outreach_launch');
    const { request } = await requestApproval({
      tenantId: fx.tenantId,
      actionKey,
      workOrderId: order.id,
      capability: 'sequence_enroll',
      toolName: 'enroll_lead_in_sequence',
      args,
      requiredLevel: 'user',
      requestedById: fx.directorId,
    });
    return request;
  }

  const approve = (requestId: string, editedCopy?: unknown) =>
    approveRequest({
      requestId,
      tenantId: fx.tenantId,
      approver: { id: fx.directorId, role: 'director' },
      ...(editedCopy === undefined ? {} : { editedCopy }),
    });

  it('stores the human wording, not the model draft, as what will execute', async () => {
    await run(async () => {
      const request = await pendingLaunchRequest('edit-wins', {
        leadId: fx.idleLeadId,
        sequenceId: 'seq-1',
        approvedCopy: DRAFTED,
      });

      await approve(request.id, [
        { stepOrder: 1, subject: 'Da Nang hiring', body: 'Noticed you are hiring SDRs.' },
        { stepOrder: 2, subject: 'Following up', body: 'Circling back on the hiring push.' },
      ]);

      const stored = await prisma.agentApprovalRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
      const copy = (stored.args as { approvedCopy: Array<Record<string, unknown>> }).approvedCopy;

      expect(stored.status).toBe('approved');
      expect(copy[0].body).toBe('Noticed you are hiring SDRs.');
      expect(copy[0].subject).toBe('Da Nang hiring');
      // The rest of the args are the planner's and stay exactly as planned — an approval form is
      // not a way to point the launch at a different lead or a different cadence.
      expect((stored.args as { leadId: string }).leadId).toBe(fx.idleLeadId);
      expect((stored.args as { sequenceId: string }).sequenceId).toBe('seq-1');
    });
  });

  it('records a rewritten step as the human\'s and an untouched one as the model\'s', async () => {
    await run(async () => {
      const request = await pendingLaunchRequest('edit-provenance', {
        leadId: fx.idleLeadId,
        approvedCopy: DRAFTED,
      });

      // Step 2 is resubmitted byte-identical, and claims to be human-written; step 1 is genuinely
      // rewritten but claims to be model output. Both claims are ignored — provenance is derived.
      await approve(request.id, [
        { stepOrder: 1, subject: 'Da Nang hiring', body: 'Rewritten by a human.', aiGenerated: true },
        { stepOrder: 2, subject: 'Following up', body: 'Circling back on the hiring push.' },
      ]);

      const stored = await prisma.agentApprovalRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
      const copy = (stored.args as { approvedCopy: Array<Record<string, unknown>> }).approvedCopy;

      expect(copy[0].aiGenerated).toBe(false);
      expect(copy[1].aiGenerated).toBe(true);
      // Citations describe the evidence the draft used. Rewriting a sentence does not restate it.
      expect(copy[0].citedEvidenceIds).toEqual(['ev-1']);
    });
  });

  it('leaves the draft alone when no edit is supplied', async () => {
    await run(async () => {
      const request = await pendingLaunchRequest('edit-absent', {
        leadId: fx.idleLeadId,
        approvedCopy: DRAFTED,
      });

      await approve(request.id);

      const stored = await prisma.agentApprovalRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
      expect(stored.args).toEqual({ leadId: fx.idleLeadId, approvedCopy: DRAFTED });
    });
  });

  it('refuses to inject copy into a request that carries none', async () => {
    await run(async () => {
      // Personalization off means the planner attached nothing. Accepting an edit here would
      // record an approval the launch then refuses — approved in the UI, dead at execution.
      const request = await pendingLaunchRequest('edit-inject', {
        leadId: fx.idleLeadId,
        sequenceId: 'seq-1',
      });

      await expect(
        approve(request.id, [{ stepOrder: 1, body: 'Copy nobody planned.' }])
      ).rejects.toMatchObject({ code: 'edit_not_supported' });

      const stored = await prisma.agentApprovalRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
      // Refused before the decision, so the request is still awaiting one.
      expect(stored.status).toBe('pending');
    });
  });

  it('refuses a malformed edit without deciding the request', async () => {
    await run(async () => {
      const request = await pendingLaunchRequest('edit-malformed', {
        leadId: fx.idleLeadId,
        approvedCopy: DRAFTED,
      });

      await expect(approve(request.id, [{ stepOrder: 1, body: '   ' }])).rejects.toThrow();

      const stored = await prisma.agentApprovalRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
      expect(stored.status).toBe('pending');
      expect(stored.args).toEqual({ leadId: fx.idleLeadId, approvedCopy: DRAFTED });
    });
  });

  it('cannot edit a request someone else already decided', async () => {
    await run(async () => {
      const request = await pendingLaunchRequest('edit-raced', {
        leadId: fx.idleLeadId,
        approvedCopy: DRAFTED,
      });

      await approve(request.id);
      await expect(
        approve(request.id, [{ stepOrder: 1, body: 'Too late.' }])
      ).rejects.toBeInstanceOf(ApprovalError);

      const stored = await prisma.agentApprovalRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
      const copy = (stored.args as { approvedCopy: Array<Record<string, unknown>> }).approvedCopy;
      expect(copy[0].body).toBe(DRAFTED[0].body);
    });
  });
});
