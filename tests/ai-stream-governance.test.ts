/**
 * Streaming AI generation under the same governance as non-streaming (TEL-P1-016).
 *
 * `stream()` used to open a provider connection with no budget reservation, no timeout, no
 * usage reconciliation, no attribution row and no accounting when the consumer walked away.
 * Streamed tokens were free as far as the ledger knew, which made the tenant budget
 * bypassable by using the streaming endpoint.
 *
 * These tests drive the governance, not the SDKs: the provider stream itself is replaced so
 * that budget settlement, attribution, failover and cancellation are what is under test.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearBudgetReservations,
  getTenantBudgetState,
  setTenantCurrentSpend,
  setTenantMonthlyLimit,
} from '@/lib/ai/budget';
import { circuitBreaker } from '@/lib/ai/circuitBreaker';
import { __setCircuitNamespace, clearSharedCircuits } from '@/lib/ai/sharedCircuit';
import { AiGateway } from '@/lib/ai/gateway';
import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/auth';

const recordedCalls: Array<Record<string, unknown>> = [];

vi.mock('@/lib/ai/usage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/usage')>();
  return {
    ...actual,
    recordAiCall: vi.fn(async (record: Record<string, unknown>) => {
      recordedCalls.push(record);
      // A non-zero cost when tokens were consumed, so reconciliation is observable — and
      // zero when they were not.
      //
      // This used to return a flat 0.002 for every call, failures included. That was
      // invisible while the gateway settled one reservation per turn, and wrong the moment it
      // began settling per attempt: three providers failing before emitting a token billed
      // $0.006 for tokens no provider produced. The real `estimateCost` prices null token
      // counts at zero, and the fixture now says the same thing.
      const consumed =
        (record.promptTokens as number | null) !== null ||
        (record.completionTokens as number | null) !== null;
      return { estimatedCostUsd: consumed ? 0.002 : 0, aiCallId: 'ai-call-test' };
    }),
  };
});

const TENANT = 'tenant-stream-governance';

const sessionUser = {
  id: 'user-stream-test',
  tenantId: TENANT,
  role: 'sdr',
  email: 'stream@test.invalid',
  name: 'Stream Test',
} as unknown as SessionUser;

interface FakeChunk {
  text: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number; estimatedCostUsd: number } | null;
}

function usage(prompt = 100, completion = 50): FakeChunk['usage'] {
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: prompt + completion,
    estimatedCostUsd: 0.004,
  };
}

/** The private seam the gateway uses to reach a provider, exposed for substitution. */
interface ProviderStreamHost {
  openProviderStream: (
    model: unknown,
    messages: unknown,
    adapterOptions: unknown,
    signal: AbortSignal,
  ) => AsyncGenerator<FakeChunk>;
}

/** Replaces the provider stream so governance, not SDK plumbing, is under test. */
function stubProviderStream(
  gateway: AiGateway,
  impl: (signal: AbortSignal, attempt: number) => AsyncGenerator<FakeChunk>,
) {
  let attempt = 0;
  return vi
    .spyOn(gateway as unknown as ProviderStreamHost, 'openProviderStream')
    .mockImplementation((_model, _messages, _adapterOptions, signal) => {
      attempt += 1;
      return impl(signal, attempt);
    });
}

async function drain(stream: AsyncGenerator<string>): Promise<string[]> {
  const pieces: string[] = [];
  for await (const piece of stream) pieces.push(piece);
  return pieces;
}

const originalKeys = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
};

beforeEach(async () => {
  recordedCalls.length = 0;
  circuitBreaker.reset();
  // Routing skips a provider with no credentials in this process, so without these the router
  // would find nothing to route to and every test here would assert against the degraded
  // message instead of the governance it is about. The provider stream itself is stubbed —
  // these keys are never used to reach anyone.
  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  process.env.GROQ_API_KEY = 'test-groq-key';
  // These tests deliberately make providers fail, and the gateway publishes those failures
  // to shared circuit state. Without a namespace of its own this file would open every
  // circuit for every other suite running in parallel - and inherit theirs.
  __setCircuitNamespace('test-stream-governance');
  await clearSharedCircuits();
  await prisma.$executeRaw`
    INSERT INTO "Tenant" ("id", "name", "createdAt", "updatedAt")
    VALUES (${TENANT}, 'Stream Governance Test', NOW(), NOW())
    ON CONFLICT ("id") DO NOTHING
  `;
  await clearBudgetReservations(TENANT);
  await setTenantMonthlyLimit(TENANT, 10);
  await setTenantCurrentSpend(TENANT, 0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  for (const [key, original] of Object.entries(originalKeys)) {
    if (original) process.env[key] = original;
    else delete process.env[key];
  }
  await clearSharedCircuits();
  __setCircuitNamespace(null);
  await clearBudgetReservations(TENANT);
  await prisma.$executeRaw`DELETE FROM "Tenant" WHERE "id" = ${TENANT}`;
});

describe('a successful stream is billed and attributed', () => {
  it('yields content, records attribution, and reconciles the reservation', async () => {
    const gateway = new AiGateway();
    stubProviderStream(gateway, async function* () {
      yield { text: 'Hello ', usage: null };
      yield { text: 'world', usage: usage() };
    });

    const pieces = await drain(gateway.stream({ messages: [{ role: 'user', content: 'hi' }], sessionUser }));

    expect(pieces.join('')).toBe('Hello world');
    expect(recordedCalls).toHaveLength(1);
    expect(recordedCalls[0]).toMatchObject({ status: 'ok', tenantId: TENANT, totalTokens: 150 });

    const state = await getTenantBudgetState(TENANT);
    expect(state.reservedUsd).toBeCloseTo(0, 6);
    expect(state.usedUsd).toBeCloseTo(0.002, 6);
  });

  it('carries token counts into the usage ledger rather than discarding them', async () => {
    const gateway = new AiGateway();
    stubProviderStream(gateway, async function* () {
      yield { text: 'x', usage: usage(700, 300) };
    });

    await drain(gateway.stream({ messages: [{ role: 'user', content: 'hi' }], sessionUser }));

    expect(recordedCalls[0]).toMatchObject({ promptTokens: 700, completionTokens: 300, totalTokens: 1000 });
  });
});

describe('provider failure', () => {
  it('fails over to a fallback when the first provider dies before any token', async () => {
    const gateway = new AiGateway();
    stubProviderStream(gateway, async function* (_signal, attempt) {
      if (attempt === 1) throw new Error('provider exploded before first token');
      yield { text: 'from fallback', usage: usage() };
    });

    const pieces = await drain(gateway.stream({ messages: [{ role: 'user', content: 'hi' }], sessionUser }));

    expect(pieces.join('')).toBe('from fallback');
    expect(recordedCalls.map((call) => call.status)).toEqual(['error', 'ok']);

    const state = await getTenantBudgetState(TENANT);
    expect(state.reservedUsd).toBeCloseTo(0, 6);
  });

  it('does not fail over mid-stream, because that would splice two completions together', async () => {
    const gateway = new AiGateway();
    stubProviderStream(gateway, async function* (_signal, attempt) {
      if (attempt === 1) {
        yield { text: 'partial answer', usage: usage(10, 5) };
        throw new Error('provider died mid-stream');
      }
      yield { text: 'SECOND PROVIDER', usage: usage() };
    });

    const pieces = await drain(gateway.stream({ messages: [{ role: 'user', content: 'hi' }], sessionUser }));

    expect(pieces.join('')).toBe('partial answer');
    expect(pieces.join('')).not.toContain('SECOND PROVIDER');
    expect(recordedCalls).toHaveLength(1);
    expect(recordedCalls[0]).toMatchObject({ status: 'error' });

    // Tokens already streamed were billed by the provider, so they are charged.
    const state = await getTenantBudgetState(TENANT);
    expect(state.reservedUsd).toBeCloseTo(0, 6);
    expect(state.usedUsd).toBeGreaterThan(0);
  });

  it('records a timeout as unavailable and stops waiting', async () => {
    const gateway = new AiGateway();
    stubProviderStream(gateway, async function* (signal) {
      // A provider that never produces anything, like a hung connection.
      for (let tick = 0; tick < 100; tick += 1) {
        if (signal.aborted) throw new Error('aborted by deadline');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      yield { text: 'never arrives', usage: null };
    });

    const pieces = await drain(
      gateway.stream({ messages: [{ role: 'user', content: 'hi' }], sessionUser, timeoutMs: 100 }),
    );

    expect(pieces.join('')).toContain('temporarily unavailable');
    expect(recordedCalls.every((call) => call.status === 'unavailable')).toBe(true);
    expect(recordedCalls[0]).toMatchObject({ errorCode: 'timeout' });

    const state = await getTenantBudgetState(TENANT);
    expect(state.reservedUsd).toBeCloseTo(0, 6);
  }, 30_000);
});

describe('consumer cancellation', () => {
  it('releases the reservation when the consumer stops reading', async () => {
    const gateway = new AiGateway();
    stubProviderStream(gateway, async function* () {
      yield { text: 'first', usage: null };
      yield { text: 'second', usage: usage() };
      yield { text: 'third', usage: usage() };
    });

    const stream = gateway.stream({ messages: [{ role: 'user', content: 'hi' }], sessionUser });

    // Abandon after the first token, as a disconnecting browser does.
    for await (const piece of stream) {
      expect(piece).toBe('first');
      break;
    }

    // The hold must not survive the abandoned stream, or an abandoned request would
    // permanently consume a slice of the tenant's budget.
    const state = await getTenantBudgetState(TENANT);
    expect(state.reservedUsd).toBeCloseTo(0, 6);
  });

  it('charges both providers when a billable attempt fails over to another', async () => {
    // The defect this pins: one turn, two provider round trips, both billed by their
    // providers — and a budget that only ever heard about one of them.
    //
    // The gateway used to reserve once per turn and settle once per turn, so whichever
    // attempt settled first was the only spend the tenant's cap ever saw. Provider A could
    // consume tokens, fail, and hand the turn to provider B, and A's money simply never
    // reached `TenantAiBudgetPeriod` — it existed in the AiCall ledger and nowhere that
    // governed anything.
    const gateway = new AiGateway();
    stubProviderStream(gateway, async function* (_signal, attempt) {
      if (attempt === 1) {
        // Usage reported, no visible text — so this attempt is billable *and* may still fail
        // over cleanly, which is exactly the case the single settlement lost.
        yield { text: '', usage: usage() };
        throw new Error('provider unreachable');
      }
      yield { text: 'second provider answered', usage: usage() };
    });

    const pieces = await drain(gateway.stream({ messages: [{ role: 'user', content: 'hi' }], sessionUser }));
    expect(pieces.join('')).toContain('second provider answered');

    const state = await getTenantBudgetState(TENANT);
    // Two billable attempts at 0.002 each. Under the previous single-settlement design this
    // read 0.002 — half the money actually spent.
    expect(state.usedUsd).toBeCloseTo(0.004, 6);
    // And nothing is left held: each attempt released or reconciled its own reservation.
    expect(state.reservedUsd).toBeCloseTo(0, 6);
  });

  it('does not double-settle when cancellation follows a completed stream', async () => {
    const gateway = new AiGateway();
    stubProviderStream(gateway, async function* () {
      yield { text: 'done', usage: usage() };
    });

    const stream = gateway.stream({ messages: [{ role: 'user', content: 'hi' }], sessionUser });
    await drain(stream);
    await stream.return(undefined as never);

    const state = await getTenantBudgetState(TENANT);
    expect(state.usedUsd).toBeCloseTo(0.002, 6);
    expect(state.reservedUsd).toBeCloseTo(0, 6);
  });
});

describe('budget governs streaming exactly as it governs generation', () => {
  it('refuses to open a stream at all once the cap is reached', async () => {
    await setTenantCurrentSpend(TENANT, 10);

    const gateway = new AiGateway();
    const spy = stubProviderStream(gateway, async function* () {
      yield { text: 'should never be reached', usage: null };
    });

    await expect(
      drain(gateway.stream({ messages: [{ role: 'user', content: 'hi' }], sessionUser })),
    ).rejects.toThrow(/AI Budget exceeded/);

    // The point of a pre-provider reservation: no provider connection is opened.
    expect(spy).not.toHaveBeenCalled();
    expect(recordedCalls).toHaveLength(0);
  });

  it('streams without a reservation when there is no tenant to bill', async () => {
    const gateway = new AiGateway();
    stubProviderStream(gateway, async function* () {
      yield { text: 'anonymous', usage: null };
    });

    const pieces = await drain(gateway.stream({ messages: [{ role: 'user', content: 'hi' }] }));

    expect(pieces.join('')).toBe('anonymous');
  });
});

describe('AI down still degrades gracefully', () => {
  it('emits the degraded message and holds no budget when every provider fails', async () => {
    const gateway = new AiGateway();
    stubProviderStream(gateway, async function* () {
      throw new Error('provider unreachable');
    });

    const pieces = await drain(gateway.stream({ messages: [{ role: 'user', content: 'hi' }], sessionUser }));

    expect(pieces.join('')).toContain('Core CRM operations remain operational');

    const state = await getTenantBudgetState(TENANT);
    expect(state.reservedUsd).toBeCloseTo(0, 6);
    expect(state.usedUsd).toBeCloseTo(0, 6);
  }, 30_000);
});
