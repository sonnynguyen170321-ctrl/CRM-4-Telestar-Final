/**
 * Direct provider smoke test — Telestar AI three-provider contract.
 *
 * Calls each provider SDK once with the approved production model and reports
 * status, latency and usage. Never prints key material.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/ai-provider-smoke.ts
 *
 * Exits non-zero if any configured provider fails.
 */

import { config } from 'dotenv';
import OpenAI from 'openai';
import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

config({ path: process.env.SMOKE_ENV_FILE || '.env.local' });

const PROMPT = 'Reply with exactly: OK';

interface Probe {
  provider: string;
  requested: string;
  status: 'PASS' | 'FAIL';
  actualModel?: string;
  latencyMs: number;
  usage?: string;
  error?: string;
}

function present(key: string): boolean {
  return (process.env[key] || '').trim().length > 0;
}

async function probeOpenAi(model: string): Promise<Probe> {
  const startedAt = Date.now();
  try {
    const client = new OpenAI({ apiKey: (process.env.OPENAI_API_KEY || '').trim() });
    // The GPT-5.x family rejects `max_tokens` outright — it takes `max_completion_tokens`.
    const res = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: PROMPT }],
      max_completion_tokens: 64,
    });
    return {
      provider: 'openai',
      requested: model,
      status: 'PASS',
      actualModel: res.model,
      latencyMs: Date.now() - startedAt,
      usage: `${res.usage?.prompt_tokens ?? '?'}/${res.usage?.completion_tokens ?? '?'}`,
    };
  } catch (err) {
    return {
      provider: 'openai',
      requested: model,
      status: 'FAIL',
      latencyMs: Date.now() - startedAt,
      error: describe(err),
    };
  }
}

async function probeGroq(model: string): Promise<Probe> {
  const startedAt = Date.now();
  try {
    const client = new Groq({ apiKey: (process.env.GROQ_API_KEY || '').trim() });
    const res = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: PROMPT }],
      max_tokens: 16,
    });
    return {
      provider: 'groq',
      requested: model,
      status: 'PASS',
      actualModel: res.model,
      latencyMs: Date.now() - startedAt,
      usage: `${res.usage?.prompt_tokens ?? '?'}/${res.usage?.completion_tokens ?? '?'}`,
    };
  } catch (err) {
    return {
      provider: 'groq',
      requested: model,
      status: 'FAIL',
      latencyMs: Date.now() - startedAt,
      error: describe(err),
    };
  }
}

async function probeGemini(model: string): Promise<Probe> {
  const startedAt = Date.now();
  try {
    const client = new GoogleGenerativeAI((process.env.GEMINI_API_KEY || '').trim());
    const genModel = client.getGenerativeModel({ model });
    const res = await genModel.generateContent(PROMPT);
    const meta = res.response.usageMetadata;
    return {
      provider: 'google',
      requested: model,
      status: 'PASS',
      actualModel: model,
      latencyMs: Date.now() - startedAt,
      usage: `${meta?.promptTokenCount ?? '?'}/${meta?.candidatesTokenCount ?? '?'}`,
    };
  } catch (err) {
    return {
      provider: 'google',
      requested: model,
      status: 'FAIL',
      latencyMs: Date.now() - startedAt,
      error: describe(err),
    };
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
  for (const key of ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY']) {
    console.log(`  ${key}: ${present(key) ? 'SET' : 'NOT SET'}`);
  }
  console.log('');

  const probes: Probe[] = [];
  if (present('OPENAI_API_KEY')) probes.push(await probeOpenAi(openaiModel));
  if (present('GEMINI_API_KEY')) probes.push(await probeGemini(geminiModel));
  if (present('GROQ_API_KEY')) probes.push(await probeGroq(groqModel));

  console.log('Direct provider smoke test');
  for (const probe of probes) {
    console.log(
      `  ${probe.status.padEnd(4)} ${probe.provider.padEnd(7)} requested=${probe.requested}` +
        ` actual=${probe.actualModel ?? '-'} ${probe.latencyMs}ms` +
        (probe.usage ? ` tokens=${probe.usage}` : '') +
        (probe.error ? `\n         ${probe.error}` : ''),
    );
  }

  const failed = probes.filter((p) => p.status === 'FAIL');
  console.log(`\n${probes.length - failed.length}/${probes.length} passed`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main();
