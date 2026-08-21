import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeAgentAction } from '@/lib/agent/runtime';
import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/auth';

/**
 * The chat tool loop, end to end through the real agent runtime.
 *
 * This used to drive `lib/ai/provider.ts`, which had its own Groq client and its own idea of
 * which model to call. That module is gone; the loop now lives in `lib/ai/chatRuntime.ts` on
 * top of `AiGateway`. The properties under test are unchanged and are the ones that must never
 * regress:
 *
 *   - a tool call reaches `executeAgentAction`, never a Prisma client held by the AI layer;
 *   - action keys are built from a per-turn ordinal that keeps counting across loop
 *     iterations, so two `create_task` calls are two distinct durable actions;
 *   - a completed action short-circuits on retry rather than writing twice;
 *   - a write-capable tool is refused outright when the turn has no durable execution id.
 */

vi.mock('@/lib/auth', () => ({
  canAccessLead: vi.fn().mockResolvedValue(true),
  canAccessUser: vi.fn().mockResolvedValue(true),
  requireAuth: vi.fn(),
}));

// Budget is governed and tested in `tests/ai-stream-governance.test.ts`. Here it would only
// add a database dependency to a suite about tool authorization.
vi.mock('@/lib/ai/budget', () => ({
  checkAndReserveAiBudget: vi.fn().mockResolvedValue(null),
}));

const { runChatTurn } = await import('@/lib/ai/chatRuntime');
const { aiGateway } = await import('@/lib/ai/gateway');
const { circuitBreaker } = await import('@/lib/ai/circuitBreaker');

interface StubChunk {
  text: string;
  usage: null;
  toolCalls?: Array<{ id: string; name: string; arguments: string }> | null;
}

/** The seam the gateway uses to reach a provider, replaced so the loop is what is under test. */
interface ProviderStreamHost {
  openProviderStream: (
    model: unknown,
    messages: unknown,
    adapterOptions: unknown,
    signal: AbortSignal,
  ) => AsyncGenerator<StubChunk>;
}

/**
 * Queues one provider turn per call. Each entry is what the model "says" on that iteration:
 * either tool calls, or final text.
 */
function stubProviderTurns(turns: Array<{ text?: string; toolCalls?: Array<{ name: string; args: unknown }> }>) {
  let index = 0;
  return vi
    .spyOn(aiGateway as unknown as ProviderStreamHost, 'openProviderStream')
    .mockImplementation(() => {
      const turn = turns[index] ?? { text: 'Done.' };
      index += 1;
      return (async function* () {
        if (turn.text) yield { text: turn.text, usage: null };
        yield {
          text: '',
          usage: null,
          toolCalls: turn.toolCalls
            ? turn.toolCalls.map((call, position) => ({
                id: `call_${index}_${position}`,
                name: call.name,
                arguments: JSON.stringify(call.args),
              }))
            : null,
        };
      })();
    });
}

async function drain(generator: AsyncGenerator<string>): Promise<string> {
  const pieces: string[] = [];
  for await (const piece of generator) pieces.push(piece);
  return pieces.join('');
}

describe('AgentRuntime Integration Path', () => {
  const sessionUser: SessionUser = {
    id: 'u-sdr-1',
    tenantId: 't-1',
    role: 'sdr',
    firstName: 'Test',
    lastName: 'SDR',
    email: 'sdr@example.com',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    circuitBreaker.reset();
    process.env.GROQ_API_KEY = 'test-key';
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.GEMINI_API_KEY = 'test-key';
    vi.spyOn(circuitBreaker, 'sync').mockResolvedValue(undefined);
    vi.spyOn(circuitBreaker, 'publish').mockResolvedValue(undefined);
    vi.spyOn(circuitBreaker, 'tryEnterHalfOpen').mockResolvedValue(true);
    vi.spyOn(circuitBreaker, 'exitHalfOpen').mockResolvedValue(undefined);
    vi.spyOn(prisma.aiCall, 'create').mockResolvedValue({ id: 'ai-call-1' } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes write tools through AgentRuntime and creates durable AgentAction', async () => {
    stubProviderTurns([
      {
        toolCalls: [
          { name: 'create_task', args: { title: 'Task 1' } },
          { name: 'create_task', args: { title: 'Task 2' } },
        ],
      },
      { toolCalls: [{ name: 'create_task', args: { title: 'Task 3' } }] },
      { text: 'Done.' },
    ]);

    vi.spyOn(prisma.autonomyPolicy, 'findUnique').mockResolvedValue({ mode: 'auto' } as never);
    vi.spyOn(prisma.lead, 'findUnique').mockResolvedValue({
      id: 'lead-1',
      assignedToId: 'u-sdr-1',
      campaignId: null,
    } as never);
    vi.spyOn(prisma.task, 'create').mockResolvedValue({ id: 'task-1' } as never);

    const upsertAction = vi.spyOn(prisma.agentAction, 'upsert').mockResolvedValue({ id: 'action-1' } as never);
    vi.spyOn(prisma.agentAction, 'update').mockResolvedValue({} as never);

    const output = await drain(
      runChatTurn({
        sessionUser,
        messages: [{ role: 'user', content: 'Create a task to follow up.' }],
        systemPrompt: 'You are an AI.',
        executionId: 'exec-test-uuid',
        playbookVersionId: 'pbv-1',
        turnId: 'turn-1',
      }),
    );

    expect(output).toContain('Done.');

    // The ordinal keeps counting across iterations. Restarting it per iteration would give the
    // third call the same action key as the first, and the runtime would treat a genuinely new
    // task as a replay of one already written.
    expect(upsertAction).toHaveBeenCalledTimes(3);
    for (const [position, ordinal] of [0, 1, 2].entries()) {
      expect(upsertAction).toHaveBeenNthCalledWith(
        position + 1,
        expect.objectContaining({
          create: expect.objectContaining({ actionKey: `agent:exec-test-uuid:tool:${ordinal}:create_task` }),
        }),
      );
    }
  });

  it('rejects retried tool calls that were already completed', async () => {
    stubProviderTurns([
      { toolCalls: [{ name: 'create_task', args: { title: 'Duplicate' } }] },
      { text: 'Done.' },
    ]);

    vi.spyOn(prisma.autonomyPolicy, 'findUnique').mockResolvedValue({ mode: 'auto' } as never);
    vi.spyOn(prisma.agentAction, 'findUnique').mockResolvedValue({
      id: 'action-2',
      status: 'completed',
      result: 'Already finished',
    } as never);

    const upsertAction = vi.spyOn(prisma.agentAction, 'upsert');

    await drain(
      runChatTurn({
        sessionUser,
        messages: [{ role: 'user', content: 'Create the task again.' }],
        systemPrompt: 'You are an AI.',
        executionId: 'exec-retry',
        playbookVersionId: 'pbv-1',
        turnId: 'turn-2',
      }),
    );

    // Bypassed by idempotency: the completed action's result is replayed, nothing is written.
    expect(upsertAction).not.toHaveBeenCalled();
  });

  it('refuses and writes nothing when the session carries no tenant', async () => {
    // Tenancy comes from the authenticated session and has no fallback. A row written
    // under a guessed tenant is worse than a refusal: it looks like real data, and the
    // `$extends` tenancy layer would then scope other reads to it.
    const findAction = vi.spyOn(prisma.agentAction, 'findUnique');
    const upsertAction = vi.spyOn(prisma.agentAction, 'upsert');
    const createTask = vi.spyOn(prisma.task, 'create');
    const policyLookup = vi.spyOn(prisma.autonomyPolicy, 'findUnique');

    const { tenantId: _omitted, ...tenantlessUser } = sessionUser;

    const result = await executeAgentAction({
      actionKey: 'agent:exec-no-tenant:tool:0:create_task',
      toolName: 'create_task',
      args: { title: 'Should never be created' },
      sessionUser: tenantlessUser as SessionUser,
    });

    expect(result.status).toBe('refused');
    expect(result.error).toMatch(/no tenant context/i);

    // Refused before the ledger is read, so a tenantless session cannot even probe another
    // tenant's action keys.
    expect(findAction).not.toHaveBeenCalled();
    expect(upsertAction).not.toHaveBeenCalled();
    expect(policyLookup).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
  });

  it('records what became of every tool call, refusals included', async () => {
    // The turn reported `toolCallCount` and nothing else, so "called three tools" and "called
    // three tools and every one was refused" logged identically. Those are different incidents:
    // the second is usually a missing execution id or a capability the role does not hold.
    stubProviderTurns([
      { toolCalls: [{ name: 'create_task', args: { title: 'Nope' } }] },
      { text: 'Done.' },
    ]);
    vi.spyOn(prisma.autonomyPolicy, 'findUnique').mockResolvedValue({ mode: 'auto' } as never);

    let seen: import('@/lib/ai/chatRuntime').ChatTurnOutcome | undefined;
    await drain(
      runChatTurn(
        {
          sessionUser,
          messages: [{ role: 'user', content: 'Create a task.' }],
          systemPrompt: 'You are an AI.',
          // No executionId, so the write-capable tool is refused before the CRM is reached.
          playbookVersionId: 'pbv-1',
          turnId: 'turn-tools',
        },
        (outcome) => {
          seen = outcome;
        },
      ),
    );

    expect(seen?.toolCallCount).toBe(1);
    expect(seen?.toolCalls).toEqual([
      { name: 'create_task', status: 'refused_no_execution_id' },
    ]);
  });

  it('refuses a write-capable tool when the turn has no durable execution id', async () => {
    stubProviderTurns([
      { toolCalls: [{ name: 'create_task', args: { title: 'Nope' } }] },
      { text: 'Done.' },
    ]);

    vi.spyOn(prisma.autonomyPolicy, 'findUnique').mockResolvedValue({ mode: 'auto' } as never);
    const upsertAction = vi.spyOn(prisma.agentAction, 'upsert');
    const createTask = vi.spyOn(prisma.task, 'create');

    await drain(
      runChatTurn({
        sessionUser,
        messages: [{ role: 'user', content: 'Create a task.' }],
        systemPrompt: 'You are an AI.',
        // No executionId: the client sent none, or sent something malformed. Without a durable
        // namespace a retry would write a second row, so the write is refused rather than
        // performed under an id nothing can match again.
        playbookVersionId: 'pbv-1',
        turnId: 'turn-3',
      }),
    );

    expect(upsertAction).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
  });

  it('refuses a tool call whose arguments are not valid JSON, without running it', async () => {
    // A model emitting broken JSON is a normal failure mode, not an exception. Running the
    // tool with `{}` would silently create a task with no title; aborting the turn would lose
    // the conversation. Neither is acceptable, so the loop refuses that one call and continues.
    let index = 0;
    vi.spyOn(aiGateway as unknown as ProviderStreamHost, 'openProviderStream').mockImplementation(() => {
      const turn = index++;
      return (async function* () {
        if (turn === 0) {
          yield {
            text: '',
            usage: null,
            toolCalls: [{ id: 'call_bad', name: 'create_task', arguments: '{"title": ' }],
          };
          return;
        }
        yield { text: 'I need a bit more detail.', usage: null };
      })();
    });

    vi.spyOn(prisma.autonomyPolicy, 'findUnique').mockResolvedValue({ mode: 'auto' } as never);
    const upsertAction = vi.spyOn(prisma.agentAction, 'upsert');
    const createTask = vi.spyOn(prisma.task, 'create');

    const output = await drain(
      runChatTurn({
        sessionUser,
        messages: [{ role: 'user', content: 'Create a task.' }],
        systemPrompt: 'You are an AI.',
        executionId: 'exec-malformed',
        turnId: 'turn-4',
      }),
    );

    expect(upsertAction).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
    expect(output).toContain('I need a bit more detail.');
  });
});
