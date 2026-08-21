import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { circuitBreaker } from '@/lib/ai/circuitBreaker';
import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/auth';

/**
 * A credential that reaches a tool result must not reach the model's context.
 *
 * Tool results are CRM content: lead notes typed by a rep, imported spreadsheet columns,
 * prospect email bodies, scraped research, and provider error strings. `AGENTS.md` classifies
 * every one of those as untrusted. A rep who pastes a connection string into a lead note has
 * created a path from the database to the model's context, and from there into an answer that
 * another user can read.
 *
 * Before this, `lib/ai/engine/security-guards.ts` existed and was imported by nothing outside
 * its own tests — a security control that was written, tested, and never wired in.
 */

vi.mock('@/lib/auth', () => ({
  canAccessLead: vi.fn().mockResolvedValue(true),
  canAccessUser: vi.fn().mockResolvedValue(true),
  requireAuth: vi.fn(),
}));

// Budget is governed and tested in `tests/ai-stream-governance.test.ts`. Here it would only
// add a database dependency to a suite about what reaches the model's context.
vi.mock('@/lib/ai/budget', () => ({
  checkAndReserveAiBudget: vi.fn().mockResolvedValue(null),
}));

const executeAgentAction = vi.fn();
vi.mock('@/lib/agent/runtime', () => ({
  executeAgentAction: (...args: unknown[]) => executeAgentAction(...args),
}));

const { runChatTurn } = await import('@/lib/ai/chatRuntime');
const { aiGateway } = await import('@/lib/ai/gateway');

interface StubChunk {
  text: string;
  usage: null;
  toolCalls?: Array<{ id: string; name: string; arguments: string }> | null;
}

interface ProviderStreamHost {
  openProviderStream: (
    model: unknown,
    messages: unknown,
    adapterOptions: unknown,
    signal: AbortSignal,
  ) => AsyncGenerator<StubChunk>;
}

/** Every message the gateway sent to a provider, across all iterations of the tool loop. */
function stubProviderAndCapture(
  turns: Array<{ text?: string; toolCalls?: Array<{ name: string; args: unknown }> }>,
): { seen: unknown[][] } {
  const seen: unknown[][] = [];
  let index = 0;
  vi.spyOn(aiGateway as unknown as ProviderStreamHost, 'openProviderStream').mockImplementation(
    (_model, messages) => {
      seen.push(messages as unknown[]);
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
    },
  );
  return { seen };
}

async function drain(generator: AsyncGenerator<string>): Promise<string> {
  const pieces: string[] = [];
  for await (const piece of generator) pieces.push(piece);
  return pieces.join('');
}

const sessionUser: SessionUser = {
  id: 'u-sdr-1',
  tenantId: 't-1',
  role: 'sdr',
  firstName: 'Test',
  lastName: 'SDR',
  email: 'sdr@example.com',
};

describe('tool results are scrubbed before they reach the model', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    circuitBreaker.reset();
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GROQ_API_KEY = 'test-key';
    vi.spyOn(circuitBreaker, 'sync').mockResolvedValue(undefined);
    vi.spyOn(circuitBreaker, 'publish').mockResolvedValue(undefined);
    vi.spyOn(circuitBreaker, 'tryEnterHalfOpen').mockResolvedValue(true);
    vi.spyOn(circuitBreaker, 'exitHalfOpen').mockResolvedValue(undefined);
    vi.spyOn(prisma.aiCall, 'create').mockResolvedValue({ id: 'ai-call-1' } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redacts a credential a rep pasted into a lead note', async () => {
    // The realistic version of this: someone put staging credentials in a note "so the team
    // has them", and months later an SDR asks the assistant to summarise the lead.
    const leaked = 'postgresql://crm:hunter2@10.20.30.40:5432/telestar_crm';
    executeAgentAction.mockResolvedValue({
      status: 'completed',
      result: `Lead note: onboarding blocked, db is ${leaked} — ask ops.`,
    });

    const { seen } = stubProviderAndCapture([
      { toolCalls: [{ name: 'get_lead_context', args: { leadId: 'lead-1' } }] },
      { text: 'Here is the summary.' },
    ]);

    await drain(
      runChatTurn({
        sessionUser,
        messages: [{ role: 'user', content: 'Summarise this lead.' }],
        systemPrompt: 'You are an AI.',
        executionId: 'exec-test-uuid',
        turnId: 'turn-1',
      }),
    );

    // The second provider call is the one carrying the tool result back to the model.
    expect(seen.length).toBeGreaterThan(1);
    const secondTurn = JSON.stringify(seen[1]);
    expect(secondTurn).not.toContain(leaked);
    expect(secondTurn).toContain('[REDACTED_SECRET]');
  });

  it('redacts an API key quoted inside a tool error', async () => {
    // Provider errors quote credentials: OpenAI's own 401 body includes a partially masked key,
    // and integration errors routinely echo the token that failed.
    const leaked = 'sk-proj-abcdEFGH1234ijklMNOP5678qrstUVWX9012yzABcdef';
    executeAgentAction.mockResolvedValue({
      status: 'failed',
      error: `Upstream rejected the request for key ${leaked}`,
    });

    const { seen } = stubProviderAndCapture([
      { toolCalls: [{ name: 'get_lead_context', args: { leadId: 'lead-1' } }] },
      { text: 'That lookup failed.' },
    ]);

    await drain(
      runChatTurn({
        sessionUser,
        messages: [{ role: 'user', content: 'Look up that lead.' }],
        systemPrompt: 'You are an AI.',
        executionId: 'exec-test-uuid',
        turnId: 'turn-2',
      }),
    );

    const secondTurn = JSON.stringify(seen[1]);
    expect(secondTurn).not.toContain(leaked);
  });

  it('leaves an ordinary tool result untouched', async () => {
    // The scrubber must not corrupt normal CRM data, or it will be removed by whoever notices.
    const ordinary = 'Sarah Chen replied yesterday. Two prior touches. Overdue for follow-up.';
    executeAgentAction.mockResolvedValue({ status: 'completed', result: ordinary });

    const { seen } = stubProviderAndCapture([
      { toolCalls: [{ name: 'get_lead_context', args: { leadId: 'lead-1' } }] },
      { text: 'Summary ready.' },
    ]);

    await drain(
      runChatTurn({
        sessionUser,
        messages: [{ role: 'user', content: 'Summarise this lead.' }],
        systemPrompt: 'You are an AI.',
        executionId: 'exec-test-uuid',
        turnId: 'turn-3',
      }),
    );

    expect(JSON.stringify(seen[1])).toContain('Sarah Chen replied yesterday');
  });
});
