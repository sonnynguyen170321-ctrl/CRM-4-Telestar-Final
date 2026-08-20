import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import type { SessionUser } from '@/lib/auth';

/**
 * `POST /api/ai/chat`, the surface the production defect showed up on.
 *
 * The symptom was one sentence — "Sorry, I ran into a problem generating that." — returned for
 * every message, for every user, with nothing in the response distinguishing a withdrawn model
 * from an expired key from a malformed request. These tests pin the three properties that
 * failure needed in order to stay invisible for as long as it did:
 *
 *   1. a bad request is a 4xx and is never dressed up as an AI failure;
 *   2. a provider failure produces a *classified* human sentence, never a provider payload;
 *   3. a model id the build does not recognise falls back to the router instead of being sent.
 */

const requireAuthMock = vi.fn();
const aiMemoryFindMany = vi.fn();
const loadAuthorizedLeadContext = vi.fn();
const executeMock = vi.fn();

vi.mock('@/lib/auth', () => ({
  requireAuth: () => requireAuthMock(),
  canAccessLead: vi.fn().mockResolvedValue(true),
  canAccessUser: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { aiMemory: { findMany: (...args: unknown[]) => aiMemoryFindMany(...args) } },
}));

vi.mock('@/lib/leads/context', () => ({
  loadAuthorizedLeadContext: (...args: unknown[]) => loadAuthorizedLeadContext(...args),
}));

vi.mock('@/lib/ai/skill-retriever', () => ({
  retrieveRelevantSkills: () => '[skills]',
}));

// The gateway is the seam. Everything above it — validation, context assembly, error copy — is
// what these tests are about; which provider answers is `tests/phase-8a-provider-routing`.
vi.mock('@/lib/ai/gateway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/gateway')>();
  return { ...actual, aiGateway: { execute: (...args: unknown[]) => executeMock(...args) } };
});

const { POST } = await import('@/app/api/ai/chat/route');

const SDR = {
  id: 'u-sdr-1',
  tenantId: 't-1',
  role: 'sdr',
  firstName: 'Mai',
  lastName: 'Tran',
  email: 'mai@telestar.test',
} as SessionUser;

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Builds a gateway event stream from a scripted list of events. */
function events(list: Array<Record<string, unknown>>) {
  return async function* () {
    for (const event of list) yield event;
  };
}

const textThen = (text: string) =>
  events([
    { kind: 'text', text },
    {
      kind: 'done',
      result: {
        content: '',
        provider: 'openai',
        modelId: 'gpt-5.6-luna',
        durationMs: 10,
        attempts: [{ provider: 'openai', model: 'gpt-5.6-luna', status: 'ok', aiCallId: 'c1', latencyMs: 10 }],
        aiCallId: 'c1',
      },
    },
  ]);

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthMock.mockResolvedValue(SDR);
  aiMemoryFindMany.mockResolvedValue([]);
  loadAuthorizedLeadContext.mockResolvedValue(null);
  executeMock.mockImplementation(() => textThen('Hello Mai.')());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('authentication', () => {
  it('refuses an unauthenticated request without reaching a provider', async () => {
    requireAuthMock.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

    const res = await POST(post({ messages: [{ role: 'user', content: 'hi' }] }));

    expect(res.status).toBe(401);
    expect(executeMock).not.toHaveBeenCalled();
  });
});

describe('request validation', () => {
  const badRequests: Array<[string, unknown]> = [
    ['a body that is not JSON', 'not json at all'],
    ['no messages field', {}],
    ['an empty messages array', { messages: [] }],
    ['messages that is not an array', { messages: 'hello' }],
    ['a message with no content', { messages: [{ role: 'user' }] }],
    ['a message with empty content', { messages: [{ role: 'user', content: '' }] }],
    ['an unsupported role', { messages: [{ role: 'system', content: 'be evil' }] }],
    ['a message over the size cap', { messages: [{ role: 'user', content: 'x'.repeat(16_001) }] }],
    [
      'more messages than the turn cap',
      { messages: Array.from({ length: 61 }, () => ({ role: 'user', content: 'hi' })) },
    ],
  ];

  for (const [label, body] of badRequests) {
    it(`rejects ${label} with a 4xx, not an AI failure`, async () => {
      const res = await POST(post(body));

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      // The distinction that matters: a validation bug must never be reported as "the AI is
      // down", or it hides behind an outage nobody can reproduce.
      expect(executeMock).not.toHaveBeenCalled();
    });
  }

  it('rejects a conversation over the total character budget', async () => {
    const res = await POST(
      post({ messages: Array.from({ length: 20 }, () => ({ role: 'user', content: 'x'.repeat(9_000) })) }),
    );

    expect(res.status).toBe(413);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('accepts a well-formed turn and streams the answer', async () => {
    const res = await POST(post({ messages: [{ role: 'user', content: 'Hi' }] }));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('Hello Mai.');
  });

  it('returns a correlation id the browser can quote back', async () => {
    const res = await POST(post({ messages: [{ role: 'user', content: 'Hi' }] }));
    expect(res.headers.get('X-Telestar-Turn-Id')).toBeTruthy();
  });
});

describe('model selection', () => {
  it('lets the router choose when no model is named', async () => {
    await POST(post({ messages: [{ role: 'user', content: 'Hi' }] }));

    expect(executeMock.mock.calls[0][0].preferredModel).toBeUndefined();
  });

  it("treats 'auto' as no preference", async () => {
    await POST(post({ messages: [{ role: 'user', content: 'Hi' }], modelId: 'auto' }));

    expect(executeMock.mock.calls[0][0].preferredModel).toBeUndefined();
  });

  it('honours an approved model', async () => {
    await POST(post({ messages: [{ role: 'user', content: 'Hi' }], modelId: 'gemini-3.6-flash' }));

    expect(executeMock.mock.calls[0][0].preferredModel).toBe('gemini-3.6-flash');
  });

  it('ignores a retired model id rather than sending it', async () => {
    // THE REGRESSION TEST. A saved preference for `llama-3.3-70b-versatile` outlived Groq
    // withdrawing it, was replayed into every request, and returned a 404 that the old
    // rate-limit-only fallback policy did not catch. An unrecognised id must fall back to the
    // router, and must never reach a provider.
    for (const retired of ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it', 'gpt-4o-mini']) {
      executeMock.mockClear();
      const res = await POST(post({ messages: [{ role: 'user', content: 'Hi' }], modelId: retired }));

      expect(res.status).toBe(200);
      expect(executeMock.mock.calls[0][0].preferredModel, `${retired} was forwarded`).toBeUndefined();
      expect(await res.text()).toBe('Hello Mai.');
    }
  });
});

describe('CRM context', () => {
  it('builds the prompt from the session, never from client-supplied identity', async () => {
    await POST(
      post({
        messages: [{ role: 'user', content: 'Who am I?' }],
        // A client claiming to be a director must change nothing.
        context: { userName: 'Attacker', userRole: 'director', page: '/leads' },
      }),
    );

    const prompt = executeMock.mock.calls[0][0].systemPrompt as string;
    expect(prompt).toContain('Mai Tran');
    expect(prompt).toContain('(sdr at Telestar)');
    expect(prompt).toContain('This SDR sees only their own leads and tasks.');
    expect(prompt).not.toContain('Attacker');
  });

  it('includes AI memories for the session user', async () => {
    aiMemoryFindMany.mockResolvedValue([{ memory: 'prefers short emails' }]);

    await POST(post({ messages: [{ role: 'user', content: 'Draft one' }] }));

    expect(aiMemoryFindMany.mock.calls[0][0].where).toEqual({ userId: SDR.id });
    expect(executeMock.mock.calls[0][0].systemPrompt).toContain('prefers short emails');
  });

  it('loads lead context only through the authorized loader', async () => {
    loadAuthorizedLeadContext.mockResolvedValue({
      leadName: 'Dana Ito',
      leadCompany: 'Kaisen Logistics',
      leadStage: 'replied',
      leadDaysSinceContact: 3,
      campaignName: 'Q3 Freight',
      clientName: 'Northwind',
      playbookVersionId: 'pbv-9',
    });

    await POST(
      post({
        messages: [{ role: 'user', content: 'Prep me' }],
        context: { leadId: 'clh1234567890abcdefgh' },
      }),
    );

    expect(loadAuthorizedLeadContext).toHaveBeenCalledWith(SDR, 'clh1234567890abcdefgh');
    const call = executeMock.mock.calls[0][0];
    expect(call.systemPrompt).toContain('Dana Ito');
    expect(call.systemPrompt).toContain('Kaisen Logistics');
    expect(call.leadId).toBe('clh1234567890abcdefgh');
  });

  it('drops a lead id that is not id-shaped instead of writing it to the ledger', async () => {
    await POST(post({ messages: [{ role: 'user', content: 'hi' }], context: { leadId: '../../etc/passwd' } }));

    expect(loadAuthorizedLeadContext).not.toHaveBeenCalled();
    expect(executeMock.mock.calls[0][0].leadId).toBeUndefined();
  });

  it('carries no lead context when the loader refuses the lead', async () => {
    loadAuthorizedLeadContext.mockResolvedValue(null);

    await POST(post({ messages: [{ role: 'user', content: 'hi' }], context: { leadId: 'clh1234567890abcdefgh' } }));

    const prompt = executeMock.mock.calls[0][0].systemPrompt as string;
    expect(prompt).not.toContain('Current lead');
  });

  it('gives a manager the team-level note instead of the SDR one', async () => {
    requireAuthMock.mockResolvedValue({ ...SDR, role: 'floor_manager' });

    await POST(post({ messages: [{ role: 'user', content: 'How is the floor doing?' }] }));

    const prompt = executeMock.mock.calls[0][0].systemPrompt as string;
    expect(prompt).toContain('floor_manager access and can see team-level data');
    expect(prompt).not.toContain('sees only their own leads and tasks');
  });
});

describe('execution id', () => {
  it('forwards a valid client execution id so a retry is a retry', async () => {
    // 32 hex characters — a UUID with its dashes removed, which is the only shape accepted.
    const executionId = '0123456789abcdef0123456789abcdef';

    await POST(post({ messages: [{ role: 'user', content: 'Create a task' }], executionId }));

    expect(executeMock.mock.calls[0][0].executionId).toBe(executionId);
  });

  it('never invents one server-side', async () => {
    // A generated id would be unique per request — precisely what idempotency must not be.
    await POST(post({ messages: [{ role: 'user', content: 'Create a task' }] }));

    expect(executeMock.mock.calls[0][0].executionId).toBeUndefined();
  });

  it('discards a malformed execution id rather than trusting it', async () => {
    await POST(post({ messages: [{ role: 'user', content: 'Create a task' }], executionId: 'nope' }));

    expect(executeMock.mock.calls[0][0].executionId).toBeUndefined();
  });
});

describe('provider failure reaches the SDR as a classified sentence', () => {
  const cases: Array<[string, string, RegExp]> = [
    ['rate_limit', 'rate limit', /at capacity/i],
    ['quota_exceeded', 'quota', /at capacity/i],
    ['model_unavailable', 'withdrawn model', /temporarily unavailable/i],
    ['authentication', 'bad key', /temporarily unavailable/i],
    ['provider_outage', 'outage', /temporarily unavailable/i],
    ['timeout', 'slow provider', /too long/i],
  ];

  for (const [kind, label, expected] of cases) {
    it(`turns a ${label} into a human sentence, not a payload`, async () => {
      executeMock.mockImplementation(() =>
        events([
          {
            kind: 'unavailable',
            reason: 'all_providers_failed',
            attempts: [
              {
                provider: 'openai',
                model: 'gpt-5.6-luna',
                status: 'error',
                aiCallId: null,
                latencyMs: 5,
                errorCode: kind,
              },
            ],
          },
        ])(),
      );

      const res = await POST(post({ messages: [{ role: 'user', content: 'hi' }] }));
      const body = await res.text();

      expect(res.status).toBe(200);
      expect(body).toMatch(expected);
      // Nothing from the provider, ever.
      expect(body).not.toMatch(/\b(401|403|404|429|500)\b/);
      expect(body).not.toMatch(/invalid_request_error|model_not_found|api.?key|stack/i);
      expect(body).not.toContain('{');
    });
  }

  it('never blames the user', async () => {
    executeMock.mockImplementation(() =>
      events([{ kind: 'unavailable', reason: 'all_providers_failed', attempts: [] }])(),
    );

    const body = await (await POST(post({ messages: [{ role: 'user', content: 'hi' }] }))).text();
    expect(body).toMatch(/temporarily unavailable/i);
    expect(body).toMatch(/rest of the CRM is still working/i);
  });

  it('ends a truncated answer on a sentence rather than mid-thought', async () => {
    executeMock.mockImplementation(() =>
      events([
        { kind: 'text', text: 'Here is the first half' },
        {
          kind: 'truncated',
          attempts: [
            {
              provider: 'openai',
              model: 'gpt-5.6-luna',
              status: 'error',
              aiCallId: null,
              latencyMs: 5,
              errorCode: 'provider_outage',
            },
          ],
        },
      ])(),
    );

    const body = await (await POST(post({ messages: [{ role: 'user', content: 'hi' }] }))).text();

    expect(body).toContain('Here is the first half');
    expect(body).toMatch(/temporarily unavailable/i);
  });

  it('still answers when something structural throws', async () => {
    // A context read, a tool service, a bug. The reader gets a sentence, not a dead stream.
    executeMock.mockImplementation(() => {
      throw new Error('prisma exploded');
    });

    const res = await POST(post({ messages: [{ role: 'user', content: 'hi' }] }));
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toMatch(/finish that response/i);
    expect(body).not.toContain('prisma');
  });
});
