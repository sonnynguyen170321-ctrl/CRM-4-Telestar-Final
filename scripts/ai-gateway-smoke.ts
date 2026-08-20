/**
 * Gateway smoke test — the real routing path, against real providers.
 *
 * `scripts/ai-provider-smoke.ts` proves each SDK answers. This proves the thing the product
 * actually calls: `AiGateway`, with its registry, router, parameter adaptation, streaming and
 * tool loop. A provider that answers a raw SDK call and fails here is the more dangerous of the
 * two failures, because it is the one the SDR sees.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/ai-gateway-smoke.ts
 *
 * Runs with no session user on purpose, so nothing is written to the database. Exits non-zero
 * if any check fails.
 */

import { config } from 'dotenv';
import { aiGateway } from '@/lib/ai/gateway';
import { MODEL_REGISTRY } from '@/lib/ai/registry';
import { routeModel } from '@/lib/ai/router';
import { circuitBreaker } from '@/lib/ai/circuitBreaker';

// Safe to load after the imports: the gateway builds its SDK clients lazily, per credential
// value, precisely so a key that arrives after module load is still seen.
config({ path: process.env.SMOKE_ENV_FILE || '.env.local' });

interface Check {
  name: string;
  status: 'PASS' | 'FAIL';
  detail: string;
  latencyMs: number;
}

const checks: Check[] = [];

async function check(name: string, fn: () => Promise<string>): Promise<void> {
  const startedAt = Date.now();
  try {
    checks.push({ name, status: 'PASS', detail: await fn(), latencyMs: Date.now() - startedAt });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    checks.push({
      name,
      status: 'FAIL',
      detail: raw.replace(/(sk|gsk|AIza)[A-Za-z0-9_\-]{10,}/g, '<redacted>').slice(0, 300),
      latencyMs: Date.now() - startedAt,
    });
  }
}

async function collect(stream: AsyncGenerator<string>): Promise<string> {
  const pieces: string[] = [];
  for await (const piece of stream) pieces.push(piece);
  return pieces.join('');
}

/**
 * Drains the event stream, returning the text and the model that actually produced it.
 *
 * Reading only the text is how a broken provider hides: the gateway fails over, the check sees
 * a good answer, and the check passes while the model it was written to exercise is dead. That
 * is exactly what happened to the Gemini tool loop here.
 */
async function collectAttributed(
  stream: AsyncGenerator<import('@/lib/ai/gateway').GatewayEvent>,
): Promise<{ text: string; provider: string | null; modelId: string | null }> {
  const pieces: string[] = [];
  let provider: string | null = null;
  let modelId: string | null = null;
  for await (const event of stream) {
    if (event.kind === 'text') pieces.push(event.text);
    if (event.kind === 'done') {
      provider = event.result.provider;
      modelId = event.result.modelId;
    }
  }
  return { text: pieces.join(''), provider, modelId };
}

async function main() {
  console.log('Credential presence');
  for (const [label, provider] of [
    ['OPENAI_API_KEY', 'openai'],
    ['GEMINI_API_KEY', 'google'],
    ['GROQ_API_KEY', 'groq'],
  ] as const) {
    console.log(`  ${label}: ${aiGateway.isProviderConfigured(provider) ? 'SET' : 'NOT SET'}`);
  }
  console.log('');

  // ── Each approved model, forced individually through the gateway ──
  for (const model of Object.values(MODEL_REGISTRY)) {
    await check(`gateway generate via ${model.displayName}`, async () => {
      circuitBreaker.reset();
      const result = await aiGateway.generate({
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        preferredModel: model.internalAlias,
        operation: 'smoke_generate',
        maxTokens: 64,
        timeoutMs: 60_000,
      });
      if (result.modelId !== model.modelId) {
        throw new Error(`attribution mismatch: asked for ${model.modelId}, answered by ${result.modelId}`);
      }
      if (!result.content.trim()) throw new Error('empty completion');
      return `answered by ${result.provider}/${result.modelId}, ${result.usage?.totalTokens ?? '?'} tokens`;
    });

    await check(`gateway stream via ${model.displayName}`, async () => {
      circuitBreaker.reset();
      const text = await collect(
        aiGateway.stream({
          messages: [{ role: 'user', content: 'Count from one to five.' }],
          preferredModel: model.internalAlias,
          operation: 'smoke_stream',
          maxTokens: 128,
          timeoutMs: 60_000,
        }),
      );
      if (!text.trim()) throw new Error('empty stream');
      if (text.includes('temporarily unavailable')) throw new Error('degraded to the unavailable message');
      return `${text.trim().length} chars`;
    });

    await check(`gateway tool loop via ${model.displayName}`, async () => {
      circuitBreaker.reset();
      let called = 0;
      const { text, modelId } = await collectAttributed(
        aiGateway.execute({
          messages: [{ role: 'user', content: 'How many open tasks do I have? Use the tool, then tell me the number.' }],
          systemPrompt: 'You are a CRM assistant. Always use the tool before answering.',
          preferredModel: model.internalAlias,
          operation: 'smoke_tools',
          maxTokens: 256,
          timeoutMs: 60_000,
          tools: [
            {
              type: 'function',
              function: {
                name: 'count_open_tasks',
                description: "Count the current user's open tasks.",
                parameters: { type: 'object', properties: {}, required: [] },
              },
            },
          ],
          executeTool: async () => {
            called += 1;
            return '7 open tasks';
          },
        }),
      );
      // The model under test must be the one that answered. Without this the check passes on a
      // silent failover and proves nothing about the model in its own name.
      if (modelId !== model.modelId) {
        throw new Error(`failed over: asked for ${model.modelId}, answered by ${modelId ?? 'nobody'}`);
      }
      if (called === 0) throw new Error('the model never called the tool');
      if (!text.trim()) throw new Error('tool loop produced no final answer');
      if (!text.includes('7')) throw new Error(`tool result never reached the answer: ${text.slice(0, 100)}`);
      return `tool called ${called}x, answer ${text.trim().length} chars`;
    });
  }

  // ── Routing and failover, without breaking anything real ──
  await check('router picks a healthy model for chat', async () => {
    circuitBreaker.reset();
    const route = routeModel({ task: 'chat', requiresTools: true }, { requireConfiguredProvider: true });
    return `${route.primaryModel.modelId} -> ${route.fallbackModels.map((m) => m.modelId).join(' -> ')}`;
  });

  await check('an open circuit routes around the affected model', async () => {
    circuitBreaker.reset();
    const route = routeModel({ task: 'chat', requiresTools: true }, { requireConfiguredProvider: true });
    const primary = route.primaryModel;
    circuitBreaker.recordFailure(primary.provider, primary.modelId, true);

    const rerouted = routeModel({ task: 'chat', requiresTools: true }, { requireConfiguredProvider: true });
    circuitBreaker.reset();
    if (rerouted.primaryModel.modelId === primary.modelId) {
      throw new Error('routing ignored the open circuit');
    }
    return `${primary.modelId} circuit open -> ${rerouted.primaryModel.modelId}`;
  });

  // Failover is exercised by removing a provider's credentials rather than by forcing a
  // circuit open. A locally forced circuit is published to, and re-read from, shared state,
  // so another instance's healthy view legitimately overwrites it — the manipulation does not
  // survive `circuitBreaker.sync()`, and a check built on it reports a failure that is not one.
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

  await check('OpenAI unavailable -> Gemini answers', async () => {
    circuitBreaker.reset();
    delete process.env.OPENAI_API_KEY;
    try {
      const result = await aiGateway.generate({
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        operation: 'smoke_failover_openai',
        timeoutMs: 60_000,
      });
      if (result.provider !== 'google') throw new Error(`expected google, got ${result.provider}`);
      return `answered by ${result.provider}/${result.modelId}`;
    } finally {
      restoreKeys();
    }
  });

  await check('OpenAI + Gemini unavailable -> Groq answers', async () => {
    circuitBreaker.reset();
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const result = await aiGateway.generate({
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        operation: 'smoke_failover_groq',
        maxTokens: 64,
        timeoutMs: 60_000,
      });
      if (result.provider !== 'groq') throw new Error(`expected groq, got ${result.provider}`);
      return `answered by ${result.provider}/${result.modelId}`;
    } finally {
      restoreKeys();
    }
  });

  await check('all providers unavailable -> controlled degradation, no throw', async () => {
    circuitBreaker.reset();
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GROQ_API_KEY;
    try {
      const text = await collect(
        aiGateway.stream({
          messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
          operation: 'smoke_all_down',
          timeoutMs: 30_000,
        }),
      );
      if (!text.includes('temporarily unavailable')) {
        throw new Error(`expected the degraded message, got: ${text.slice(0, 120)}`);
      }
      return 'degraded cleanly';
    } finally {
      restoreKeys();
    }
  });

  console.log('Gateway smoke test');
  for (const entry of checks) {
    console.log(`  ${entry.status.padEnd(4)} ${entry.name.padEnd(46)} ${String(entry.latencyMs).padStart(6)}ms  ${entry.detail}`);
  }

  const failed = checks.filter((c) => c.status === 'FAIL');
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main();
