import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ModelId } from '@/lib/ai/provider';
import { streamChat } from '@/lib/ai/provider';
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
    const updateAction = vi.spyOn(prisma.agentAction, 'update').mockResolvedValue({} as any);
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
});
