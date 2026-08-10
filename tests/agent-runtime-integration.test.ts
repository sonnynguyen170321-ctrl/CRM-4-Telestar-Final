import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ModelId } from '@/lib/ai/provider';
import { streamChat } from '@/lib/ai/provider';
import { executeAgentAction } from '@/lib/agent/runtime';
import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/auth';

vi.mock('@/lib/auth', () => ({
  canAccessLead: vi.fn().mockResolvedValue(true),
  canAccessUser: vi.fn().mockResolvedValue(true),
  requireAuth: vi.fn(),
}));

const mockGroqCreate = vi.fn();
vi.mock('groq-sdk', () => {
  return {
    default: class Groq {
      chat = {
        completions: {
          create: mockGroqCreate,
        }
      }
    }
  };
});

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
    process.env.GROQ_API_KEY = 'test-key';
  });

  it('routes write tools through AgentRuntime and creates durable AgentAction', async () => {
    // 1. Mock Groq yielding two tool calls in iteration 1, one in iteration 2
    mockGroqCreate
      .mockResolvedValueOnce({
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'call_1',
                  function: {
                    name: 'create_task',
                    arguments: JSON.stringify({ title: 'Task 1' }),
                  },
                },
                {
                  id: 'call_2',
                  function: {
                    name: 'create_task',
                    arguments: JSON.stringify({ title: 'Task 2' }),
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      })
      .mockResolvedValueOnce({
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'call_3',
                  function: {
                    name: 'create_task',
                    arguments: JSON.stringify({ title: 'Task 3' }),
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      })
      .mockResolvedValueOnce({
        choices: [
          {
            finish_reason: 'stop',
            message: { content: 'Done.' },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      });

    // 2. Mock Agent capability allowing the action
    vi.spyOn(prisma.autonomyPolicy, 'findUnique').mockResolvedValue({ mode: 'auto' } as any);

    // 3. Mock domain logic
    vi.spyOn(prisma.lead, 'findUnique').mockResolvedValue({ id: 'lead-1', assignedToId: 'u-sdr-1', campaignId: null } as any);
    vi.spyOn(prisma.task, 'create').mockResolvedValue({ id: 'task-1' } as any);
    
    // We mock AgentAction upsert/update
    const upsertAction = vi.spyOn(prisma.agentAction, 'upsert').mockResolvedValue({ id: 'action-1' } as any);
    vi.spyOn(prisma.agentAction, 'update').mockResolvedValue({} as any);
    vi.spyOn(prisma.aiCall, 'create').mockResolvedValue({} as any);

    const generator = streamChat({
      messages: [{ role: 'user', content: 'Create a task to follow up.' }],
      systemPrompt: 'You are an AI.',
      modelId: 'llama3-70b-8192' as ModelId, // Groq
      today: new Date().toISOString(),
      sessionUser,
      executionId: 'exec-test-uuid',
      playbookVersionId: 'pbv-1',
    });

    const chunks = [];
    for await (const chunk of generator) {
      chunks.push(chunk);
    }

    expect(chunks.join('')).toContain('Done.');

    // Verify AgentAction was created with monotonically increasing execution keys
    expect(upsertAction).toHaveBeenCalledTimes(3);
    expect(upsertAction).toHaveBeenNthCalledWith(1,
      expect.objectContaining({
        create: expect.objectContaining({ actionKey: 'agent:exec-test-uuid:tool:0:create_task' }),
      })
    );
    expect(upsertAction).toHaveBeenNthCalledWith(2,
      expect.objectContaining({
        create: expect.objectContaining({ actionKey: 'agent:exec-test-uuid:tool:1:create_task' }),
      })
    );
    expect(upsertAction).toHaveBeenNthCalledWith(3,
      expect.objectContaining({
        create: expect.objectContaining({ actionKey: 'agent:exec-test-uuid:tool:2:create_task' }),
      })
    );
  });

  it('rejects retried tool calls that were already completed', async () => {
    // Return a duplicate tool call for a retry scenario
    mockGroqCreate.mockResolvedValueOnce({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: '',
            tool_calls: [
              {
                id: 'call_retry',
                function: {
                  name: 'create_task',
                  arguments: JSON.stringify({ title: 'Duplicate' }),
                },
              },
            ],
          },
        },
      ],
    }).mockResolvedValueOnce({
      choices: [{ finish_reason: 'stop', message: { content: 'Done.' } }]
    });

    vi.spyOn(prisma.autonomyPolicy, 'findUnique').mockResolvedValue({ mode: 'auto' } as any);
    
    // existingAction returns a completed action
    vi.spyOn(prisma.agentAction, 'findUnique').mockResolvedValue({
      id: 'action-2',
      status: 'completed',
      result: 'Already finished',
    } as any);

    const upsertAction = vi.spyOn(prisma.agentAction, 'upsert');

    const generator = streamChat({
      messages: [{ role: 'user', content: 'Create the task again.' }],
      systemPrompt: 'You are an AI.',
      modelId: 'llama3-70b-8192' as ModelId,
      today: new Date().toISOString(),
      sessionUser,
      executionId: 'exec-retry',
      playbookVersionId: 'pbv-1',
    });

    const chunks = [];
    for await (const chunk of generator) {
      chunks.push(chunk);
    }

    // AgentAction should not be upserted (bypassed due to idempotency)
    expect(upsertAction).not.toHaveBeenCalled();
    // The generator should still yield since we return early inside executeAgentAction
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

  it('refuses a write-capable tool when the turn has no durable execution id', async () => {
    mockGroqCreate
      .mockResolvedValueOnce({
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'call_no_exec',
                  function: { name: 'create_task', arguments: JSON.stringify({ title: 'Nope' }) },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      })
      .mockResolvedValueOnce({
        choices: [{ finish_reason: 'stop', message: { content: 'Done.' } }],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      });

    vi.spyOn(prisma.autonomyPolicy, 'findUnique').mockResolvedValue({ mode: 'auto' } as any);
    vi.spyOn(prisma.aiCall, 'create').mockResolvedValue({} as any);
    const upsertAction = vi.spyOn(prisma.agentAction, 'upsert');
    const createTask = vi.spyOn(prisma.task, 'create');

    const generator = streamChat({
      messages: [{ role: 'user', content: 'Create a task.' }],
      systemPrompt: 'You are an AI.',
      modelId: 'llama3-70b-8192' as ModelId,
      today: new Date().toISOString(),
      sessionUser,
      // No executionId: the client sent none, or sent something malformed. Without a durable
      // namespace a retry would write a second row, so the write is refused rather than
      // performed under an id nothing can match again.
      playbookVersionId: 'pbv-1',
    });

    for await (const _chunk of generator) {
      // drain
    }

    expect(upsertAction).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
  });
});
