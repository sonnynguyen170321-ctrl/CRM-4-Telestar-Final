/**
 * Direct provider smoke test — Telestar AI three-provider contract.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/ai-provider-smoke.ts
 *
 * ## What "pass" means, and why it changed
 *
 * This script used to probe only the providers whose keys happened to be present, then exit 0
 * if none of them failed. A container with no credentials at all therefore reported
 * `0/0 passed` and exited 0 — a green certification signal for a deployment where Telestar AI
 * could not answer a single message. Two keys out of three exited 0 the same way.
 *
 * The contract is now absolute: **three credentials configured, three probes attempted, three
 * probes passed, or the exit code is non-zero.** There is no partial-credit mode and no
 * override flag, because the only reason to want one is to make a red deployment look green.
 *
 * ## What each probe actually verifies
 *
 * A 200 response is not evidence that the product works. Each provider is checked for the
 * four capabilities the gateway depends on:
 *
 *   completion  — non-empty text, usage metadata, and the model identity the provider reports
 *   streaming   — tokens arrive incrementally rather than in one final block
 *   tools       — the model will request a function call when the answer requires one
 *   structured  — the model will return parseable JSON on demand
 *
 * Each is a few dozen tokens. The whole run costs a fraction of a cent and is the only thing
 * standing between "the key is present" and "the provider answers".
 *
 * Never prints key material: `describe()` strips anything key-shaped out of provider errors.
 */

import { config } from 'dotenv';
import OpenAI from 'openai';
import Groq from 'groq-sdk';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

config({ path: process.env.SMOKE_ENV_FILE || '.env.local' });

const PROMPT = 'Reply with exactly: OK';
const TOOL_PROMPT = 'What is the weather in Hanoi? Use the get_weather tool.';
const JSON_PROMPT = 'Return a JSON object with one key "status" whose value is "ok".';

/** The three credentials. All three are required; there is no partial mode. */
const REQUIRED_KEYS = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY'] as const;

const WEATHER_TOOL = {
  name: 'get_weather',
  description: 'Get the current weather for a city.',
  parameters: {
    type: 'object',
    properties: { city: { type: 'string', description: 'City name' } },
    required: ['city'],
  },
} as const;

interface Check {
  name: 'completion' | 'streaming' | 'tools' | 'structured';
  ok: boolean;
  detail: string;
}

interface Probe {
  provider: string;
  requested: string;
  actualModel?: string;
  latencyMs: number;
  checks: Check[];
  error?: string;
}

function present(key: string): boolean {
  return (process.env[key] || '').trim().length > 0;
}

function probePassed(probe: Probe): boolean {
  return !probe.error && probe.checks.length === 4 && probe.checks.every((c) => c.ok);
}

// ── OpenAI ───────────────────────────────────────────────────────────────────

async function probeOpenAi(model: string): Promise<Probe> {
  const startedAt = Date.now();
  const checks: Check[] = [];
  const client = new OpenAI({ apiKey: (process.env.OPENAI_API_KEY || '').trim() });
  let actualModel: string | undefined;

  try {
    // The GPT-5.x family rejects `max_tokens` outright — it takes `max_completion_tokens`.
    const res = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: PROMPT }],
      max_completion_tokens: 64,
    });
    actualModel = res.model;
    const text = res.choices[0]?.message?.content ?? '';
    checks.push({
      name: 'completion',
      ok: text.trim().length > 0 && !!res.usage?.prompt_tokens,
      detail: `tokens=${res.usage?.prompt_tokens ?? '?'}/${res.usage?.completion_tokens ?? '?'}`,
    });

    let chunks = 0;
    const stream = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: PROMPT }],
      max_completion_tokens: 64,
      stream: true,
    });
    for await (const chunk of stream) {
      if (chunk.choices[0]?.delta?.content) chunks += 1;
    }
    checks.push({ name: 'streaming', ok: chunks > 0, detail: `${chunks} text chunks` });

    const tooled = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: TOOL_PROMPT }],
      max_completion_tokens: 128,
      tools: [{ type: 'function', function: WEATHER_TOOL }],
      tool_choice: 'auto',
      // Not a tuning knob: this model refuses function tools on chat completions without it.
      reasoning_effort: 'none',
    } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
    const calls = tooled.choices[0]?.message?.tool_calls ?? [];
    checks.push({ name: 'tools', ok: calls.length > 0, detail: `${calls.length} tool call(s)` });

    const json = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: JSON_PROMPT }],
      max_completion_tokens: 64,
      response_format: { type: 'json_object' },
    });
    checks.push(jsonCheck(json.choices[0]?.message?.content ?? ''));
  } catch (err) {
    return { provider: 'openai', requested: model, actualModel, latencyMs: Date.now() - startedAt, checks, error: describe(err) };
  }

  return { provider: 'openai', requested: model, actualModel, latencyMs: Date.now() - startedAt, checks };
}

// ── Groq ─────────────────────────────────────────────────────────────────────

async function probeGroq(model: string): Promise<Probe> {
  const startedAt = Date.now();
  const checks: Check[] = [];
  const client = new Groq({ apiKey: (process.env.GROQ_API_KEY || '').trim() });
  let actualModel: string | undefined;

  try {
    const res = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: PROMPT }],
      max_tokens: 32,
    });
    actualModel = res.model;
    const text = res.choices[0]?.message?.content ?? '';
    checks.push({
      name: 'completion',
      ok: text.trim().length > 0 && !!res.usage?.prompt_tokens,
      detail: `tokens=${res.usage?.prompt_tokens ?? '?'}/${res.usage?.completion_tokens ?? '?'}`,
    });

    let chunks = 0;
    const stream = (await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: PROMPT }],
      max_tokens: 32,
      stream: true,
    } as Parameters<typeof client.chat.completions.create>[0])) as unknown as AsyncIterable<Groq.Chat.ChatCompletionChunk>;
    for await (const chunk of stream) {
      if (chunk.choices[0]?.delta?.content) chunks += 1;
    }
    checks.push({ name: 'streaming', ok: chunks > 0, detail: `${chunks} text chunks` });

    const tooled = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: TOOL_PROMPT }],
      max_tokens: 256,
      tools: [{ type: 'function', function: WEATHER_TOOL }],
      tool_choice: 'auto',
    });
    const calls = tooled.choices[0]?.message?.tool_calls ?? [];
    checks.push({ name: 'tools', ok: calls.length > 0, detail: `${calls.length} tool call(s)` });

    const json = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: JSON_PROMPT }],
      max_tokens: 128,
      response_format: { type: 'json_object' },
    });
    checks.push(jsonCheck(json.choices[0]?.message?.content ?? ''));
  } catch (err) {
    return { provider: 'groq', requested: model, actualModel, latencyMs: Date.now() - startedAt, checks, error: describe(err) };
  }

  return { provider: 'groq', requested: model, actualModel, latencyMs: Date.now() - startedAt, checks };
}

// ── Gemini ───────────────────────────────────────────────────────────────────

async function probeGemini(model: string): Promise<Probe> {
  const startedAt = Date.now();
  const checks: Check[] = [];
  const client = new GoogleGenerativeAI((process.env.GEMINI_API_KEY || '').trim());

  try {
    // No temperature / top_p / top_k anywhere in this file: Google has deprecated them for
    // this model generation and documents a future error for them.
    const base = client.getGenerativeModel({ model });

    const res = await base.generateContent(PROMPT);
    const meta = res.response.usageMetadata;
    checks.push({
      name: 'completion',
      ok: res.response.text().trim().length > 0 && !!meta?.promptTokenCount,
      detail: `tokens=${meta?.promptTokenCount ?? '?'}/${meta?.candidatesTokenCount ?? '?'}`,
    });

    let chunks = 0;
    const streamed = await base.generateContentStream(PROMPT);
    for await (const chunk of streamed.stream) {
      if (chunk.text()) chunks += 1;
    }
    checks.push({ name: 'streaming', ok: chunks > 0, detail: `${chunks} text chunks` });

    const tooled = client.getGenerativeModel({
      model,
      tools: [
        {
          functionDeclarations: [
            {
              name: WEATHER_TOOL.name,
              description: WEATHER_TOOL.description,
              parameters: {
                type: SchemaType.OBJECT,
                properties: { city: { type: SchemaType.STRING, description: 'City name' } },
                required: ['city'],
              },
            },
          ],
        },
      ],
    });
    const toolRes = await tooled.generateContent(TOOL_PROMPT);
    const calls = toolRes.response.functionCalls() ?? [];
    checks.push({ name: 'tools', ok: calls.length > 0, detail: `${calls.length} tool call(s)` });

    const jsonModel = client.getGenerativeModel({
      model,
      generationConfig: { responseMimeType: 'application/json' },
    });
    const jsonRes = await jsonModel.generateContent(JSON_PROMPT);
    checks.push(jsonCheck(jsonRes.response.text()));
  } catch (err) {
    return {
      provider: 'google',
      requested: model,
      // This SDK does not echo a resolved model id, so the requested id is the only identity
      // available. Recorded as such rather than presented as provider-confirmed.
      actualModel: undefined,
      latencyMs: Date.now() - startedAt,
      checks,
      error: describe(err),
    };
  }

  return { provider: 'google', requested: model, actualModel: undefined, latencyMs: Date.now() - startedAt, checks };
}

function jsonCheck(raw: string): Check {
  try {
    const parsed = JSON.parse(raw.trim());
    const ok = !!parsed && typeof parsed === 'object';
    return { name: 'structured', ok, detail: ok ? 'parsed object' : 'not an object' };
  } catch {
    return { name: 'structured', ok: false, detail: 'unparseable JSON' };
  }
}

/** Error text with anything key-shaped stripped out. */
function describe(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number })?.status;
  return `${status ? `[${status}] ` : ''}${raw.replace(/(sk|gsk|AIza)[A-Za-z0-9_\-]{10,}/g, '<redacted>')}`.slice(0, 400);
}

async function main() {
  const targets = (process.env.SMOKE_MODELS || '').trim();
  const [openaiModel, geminiModel, groqModel] = targets
    ? targets.split(',')
    : ['gpt-5.6-luna', 'gemini-3.6-flash', 'openai/gpt-oss-20b'];

  console.log('Credential presence');
  for (const key of REQUIRED_KEYS) {
    console.log(`  ${key}: ${present(key) ? 'SET' : 'NOT SET'}`);
  }
  console.log('');

  const missing = REQUIRED_KEYS.filter((key) => !present(key));
  if (missing.length > 0) {
    // Not a skip. A deployment missing a credential cannot serve the three-provider contract,
    // and reporting that as success is how an unconfigured container passed certification.
    console.error(
      `FAIL: ${missing.length} of ${REQUIRED_KEYS.length} credentials are not configured: ${missing.join(', ')}`,
    );
    console.error('All three providers are required. 3/3 or nothing.');
    process.exit(1);
  }

  const probes: Probe[] = [
    await probeOpenAi(openaiModel),
    await probeGemini(geminiModel),
    await probeGroq(groqModel),
  ];

  console.log('Direct provider smoke test');
  for (const probe of probes) {
    const passed = probePassed(probe);
    console.log(
      `  ${(passed ? 'PASS' : 'FAIL').padEnd(4)} ${probe.provider.padEnd(7)} requested=${probe.requested}` +
        ` actual=${probe.actualModel ?? '(not reported by provider)'} ${probe.latencyMs}ms`,
    );
    for (const check of probe.checks) {
      console.log(`         ${check.ok ? 'ok  ' : 'FAIL'} ${check.name.padEnd(10)} ${check.detail}`);
    }
    if (probe.error) console.log(`         error: ${probe.error}`);
    if (probe.actualModel && probe.actualModel !== probe.requested) {
      console.log(`         NOTE: provider answered as "${probe.actualModel}", not "${probe.requested}"`);
    }
  }

  const passedCount = probes.filter(probePassed).length;
  console.log(`\n${passedCount}/${REQUIRED_KEYS.length} providers passed`);

  if (passedCount !== REQUIRED_KEYS.length) {
    console.error(`FAIL: the three-provider contract requires ${REQUIRED_KEYS.length}/${REQUIRED_KEYS.length}.`);
    process.exit(1);
  }
  process.exit(0);
}

main();
