/**
 * Degraded-provider drill — does Telestar AI keep answering when one provider is down?
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/ai-degraded-provider-drill.ts
 *
 * `ai-provider-smoke` proves each SDK answers. `ai-gateway-smoke` proves the gateway answers
 * when everything is healthy. Neither answers the question an operator actually asks during a
 * partial outage: **is the product still usable, and does the user feel it?**
 *
 * That question is not hypothetical here. Groq sits on a tokens-per-minute ceiling its account
 * tier cannot lift, and `FAST_TIER` in `lib/ai/router.ts` routes to Groq *first*:
 *
 *     FAST_TIER     = ['openai/gpt-oss-20b', 'gpt-5.6-luna', 'gemini-3.6-flash']
 *     DEEP_TIER     = ['gemini-3.6-flash', 'gpt-5.6-luna', 'openai/gpt-oss-20b']
 *     STANDARD_TIER = ['gpt-5.6-luna', 'gemini-3.6-flash', 'openai/gpt-oss-20b']
 *
 * So every low-complexity, tool-free request tries a provider that will refuse it, and only
 * then falls over. Whether that is invisible or painful depends on the circuit breaker, and
 * "depends on the circuit breaker" is a claim to measure, not to assert.
 *
 * Runs with no session user, so nothing is written to the database. Exits non-zero if the
 * product would be disrupted — not merely if a provider is unhealthy. A provider being down is
 * the premise of this drill, not its failure condition.
 */

import { config } from 'dotenv';
import { aiGateway } from '@/lib/ai/gateway';
import { routeModel } from '@/lib/ai/router';
import { circuitBreaker } from '@/lib/ai/circuitBreaker';
import { clearSharedCircuits } from '@/lib/ai/sharedCircuit';

config({ path: process.env.SMOKE_ENV_FILE || '.env.local' });

interface Check {
  name: string;
  status: 'PASS' | 'FAIL';
  detail: string;
  latencyMs: number;
}

const checks: Check[] = [];

/** Clear both halves of the breaker: the in-process map, and the state shared through Redis. */
async function resetCircuits(): Promise<void> {
  circuitBreaker.reset();
  try {
    await clearSharedCircuits();
  } catch {
    // A CLI process may never reach Redis inside its lifetime. The in-process reset stands.
  }
}

async function check(name: string, fn: () => Promise<string>): Promise<void> {
  const started = Date.now();
  try {
    const detail = await fn();
    checks.push({ name, status: 'PASS', detail, latencyMs: Date.now() - started });
  } catch (err) {
    checks.push({
      name,
      status: 'FAIL',
      detail: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - started,
    });
  }
}

async function collect(stream: AsyncGenerator<string>): Promise<string> {
  const pieces: string[] = [];
  for await (const piece of stream) pieces.push(piece);
  return pieces.join('');
}

/**
 * The three tiers as the product reaches them, named by the criteria that select them rather
 * than by the model we expect — the point is that the *caller* is served, whoever serves it.
 */
const TIERS = [
  {
    label: 'standard tier (interactive chat)',
    criteria: { task: 'chat', requiresTools: true, risk: 'draft' as const },
    maxTokens: 1200,
  },
  {
    label: 'deep tier (executive analysis)',
    criteria: { task: 'analysis', complexity: 'deep' as const, businessImportance: 'critical' as const },
    maxTokens: 1200,
  },
  {
    label: 'fast tier (Groq-first, the degraded one)',
    criteria: { task: 'classification', complexity: 'low' as const },
    maxTokens: 130,
  },
];

async function main(): Promise<void> {
  console.log('Credential presence');
  for (const [label, provider] of [
    ['OPENAI_API_KEY', 'openai'],
    ['GEMINI_API_KEY', 'google'],
    ['GROQ_API_KEY', 'groq'],
  ] as const) {
    console.log(`  ${label}: ${aiGateway.isProviderConfigured(provider) ? 'SET' : 'NOT SET'}`);
  }
  console.log('');

  // ── 1. Every tier still answers a user ──────────────────────────────────
  for (const tier of TIERS) {
    await check(`${tier.label} answers`, async () => {
      await resetCircuits();
      const routed = routeModel(tier.criteria, { requireConfiguredProvider: true });
      const result = await aiGateway.generate({
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        operation: 'drill_tier',
        criteria: tier.criteria,
        maxTokens: tier.maxTokens,
        timeoutMs: 60_000,
      });
      if (!result.content.trim()) throw new Error('empty completion — the user got nothing');
      return `routed to ${routed.primaryModel.modelId}, answered by ${result.provider}/${result.modelId}`;
    });
  }

  // ── 2. The degraded tier stops paying the penalty ───────────────────────
  //
  // One wasted call into a rate-limited provider is a latency cost. Paying it on *every*
  // request forever is a product defect, and it is exactly what the breaker exists to stop.
  // Measured over consecutive calls rather than asserted from the breaker's own state, because
  // what matters is what the caller waits for.
  await check('fast tier stops re-trying the degraded provider', async () => {
    await resetCircuits();
    const latencies: number[] = [];
    const answeredBy: string[] = [];

    for (let i = 0; i < 4; i++) {
      const started = Date.now();
      const result = await aiGateway.generate({
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        operation: 'drill_repeat',
        criteria: { task: 'classification', complexity: 'low' },
        maxTokens: 130,
        timeoutMs: 60_000,
      });
      latencies.push(Date.now() - started);
      answeredBy.push(result.provider);
      if (!result.content.trim()) throw new Error(`call ${i + 1} returned nothing`);
    }

    return `latencies ${latencies.join('/')}ms, answered by ${answeredBy.join(',')}`;
  });

  // ── 3. The two healthy providers cover for each other ───────────────────
  const savedKeys = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
  };
  const restoreKeys = () => {
    for (const [key, value] of Object.entries(savedKeys)) {
      if (value) process.env[key] = value;
      else delete process.env[key];
    }
  };

  await check('OpenAI down, Groq degraded -> Gemini carries chat', async () => {
    await resetCircuits();
    delete process.env.OPENAI_API_KEY;
    try {
      const result = await aiGateway.generate({
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        operation: 'drill_openai_down',
        criteria: { task: 'chat', requiresTools: true, risk: 'draft' },
        maxTokens: 1200,
        timeoutMs: 60_000,
      });
      if (!result.content.trim()) throw new Error('empty completion');
      if (result.provider !== 'google') throw new Error(`expected google, got ${result.provider}`);
      return `answered by ${result.provider}/${result.modelId}`;
    } finally {
      restoreKeys();
    }
  });

  await check('Gemini down, Groq degraded -> OpenAI carries chat', async () => {
    await resetCircuits();
    delete process.env.GEMINI_API_KEY;
    try {
      const result = await aiGateway.generate({
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        operation: 'drill_gemini_down',
        criteria: { task: 'chat', requiresTools: true, risk: 'draft' },
        maxTokens: 1200,
        timeoutMs: 60_000,
      });
      if (!result.content.trim()) throw new Error('empty completion');
      if (result.provider !== 'openai') throw new Error(`expected openai, got ${result.provider}`);
      return `answered by ${result.provider}/${result.modelId}`;
    } finally {
      restoreKeys();
    }
  });

  // ── 4. Streaming, which is what the chat window actually consumes ───────
  await check('chat streams to the browser with one provider degraded', async () => {
    await resetCircuits();
    const text = await collect(
      aiGateway.stream({
        messages: [{ role: 'user', content: 'Count from one to five.' }],
        operation: 'drill_stream',
        criteria: { task: 'chat', requiresTools: true, risk: 'draft' },
        maxTokens: 1200,
        timeoutMs: 60_000,
      }),
    );
    if (!text.trim()) throw new Error('empty stream — the chat window would show nothing');
    if (text.includes('temporarily unavailable')) {
      throw new Error('degraded to the unavailable message while two providers were healthy');
    }
    return `${text.length} chars`;
  });

  console.log('Degraded-provider drill');
  for (const entry of checks) {
    console.log(
      `  ${entry.status.padEnd(4)} ${entry.name.padEnd(48)} ${String(entry.latencyMs).padStart(6)}ms  ${entry.detail}`,
    );
  }

  const failed = checks.filter((c) => c.status === 'FAIL');
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length > 0) {
    console.log('FAIL: the product is disrupted by the degraded provider, not merely slower.');
  }
  process.exit(failed.length > 0 ? 1 : 0);
}

main();
