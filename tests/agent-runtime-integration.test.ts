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
    // 1. Mock Groq yielding a tool call
    mockGroqCreate
      .mockResolvedValueOnce({
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'call_123',
                  function: {
                    name: 'create_task',
                    arguments: JSON.stringify({
                      title: 'Follow up',
                      channel: 'email',
                      dueDate: new Date().toISOString(),
                      leadId: 'lead-1',
                    }),
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
            message: { content: 'I have created the task.' },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      });

    // 2. Mock Agent capability allowing the action
    vi.spyOn(prisma.autonomyPolicy, 'findUnique').mockResolvedValue({ mode: 'auto' } as any);

    // 3. Mock domain logic
    vi.spyOn(prisma.lead, 'findUnique').mockResolvedValue({ id: 'lead-1', assignedToId: 'u-sdr-1', campaignId: null } as any);
    vi.spyOn(prisma.task, 'create').mockResolvedValue({ id: 'task-1' } as any);
    
    // We mock AgentAction upser/update
    const upsertAction = vi.spyOn(prisma.agentAction, 'upsert').mockResolvedValue({ id: 'action-1' } as any);
    const updateAction = vi.spyOn(prisma.agentAction, 'update').mockResolvedValue({} as any);
    vi.spyOn(prisma.aiCall, 'create').mockResolvedValue({} as any);

    const generator = streamChat({
      messages: [{ role: 'user', content: 'Create a task to follow up.' }],
      systemPrompt: 'You are an AI.',
      modelId: 'llama3-70b-8192' as ModelId, // Groq
      today: new Date().toISOString(),
      sessionUser,
      executionId: 'exec-123',
      playbookVersionId: 'pbv-1',
    });

    const chunks = [];
    for await (const chunk of generator) {
      chunks.push(chunk);
    }

    expect(chunks.join('')).toContain('I have created the task.');

    // Verify AgentAction was created with execution key, not just groq's tool call id
    expect(upsertAction).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          actionKey: 'agent:exec-123:tool:0:create_task',
          tool: 'create_task',
          playbookVersionId: 'pbv-1',
        }),
      })
    );

    // Verify AgentAction was updated to completed
    expect(updateAction).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'completed' }),
      })
    );

    // Verify domain service was called
    expect(prisma.task.create).toHaveBeenCalled();
  });
});
