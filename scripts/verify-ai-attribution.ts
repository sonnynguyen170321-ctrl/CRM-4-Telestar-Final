/**
 * Verifies that the `AiCall` ledger names models that actually exist and actually answered.
 *
 * The registry used to map the alias `gpt-5.6-luna` onto the API id `gpt-4o-mini`, so every row
 * claimed a model that was never called and a spend review was reading fiction. This checks the
 * property directly against the rows the application has written:
 *
 *   - every model named is in the current registry;
 *   - the provider recorded matches that model's provider;
 *   - a successful LLM call carries token counts and a cost;
 *   - no row names a retired model.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/verify-ai-attribution.ts
 *   SINCE_MINUTES=30 OPERATION=chat node node_modules/tsx/dist/cli.mjs scripts/verify-ai-attribution.ts
 *
 * Exits non-zero on any mismatch.
 */

import { config } from 'dotenv';
import { findModelMetadata, MODEL_REGISTRY } from '@/lib/ai/registry';
import { createAdminClient } from '@/lib/db/adminClient.mjs';

config({ path: process.env.SMOKE_ENV_FILE || '.env.local' });

const prisma = createAdminClient();

const SINCE_MINUTES = Number(process.env.SINCE_MINUTES || 120);
const OPERATION = process.env.OPERATION || null;

async function main() {
  const since = new Date(Date.now() - SINCE_MINUTES * 60_000);

  const calls = await prisma.aiCall.findMany({
    where: {
      createdAt: { gte: since },
      ...(OPERATION ? { operation: OPERATION } : {}),
      // Search/fetch providers record credits, not a model.
      provider: { in: ['openai', 'google', 'groq', 'gemini'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: {
      id: true,
      createdAt: true,
      operation: true,
      provider: true,
      model: true,
      status: true,
      promptTokens: true,
      completionTokens: true,
      totalTokens: true,
      estimatedCostUsd: true,
      latencyMs: true,
      errorCode: true,
    },
  });

  console.log(`AiCall rows in the last ${SINCE_MINUTES} minutes${OPERATION ? ` for operation=${OPERATION}` : ''}: ${calls.length}\n`);

  if (calls.length === 0) {
    console.log('Nothing to verify. Run some traffic first.');
    await prisma.$disconnect();
    process.exit(0);
  }

  const problems: string[] = [];
  const byModel = new Map<string, { ok: number; failed: number; tokens: number }>();

  for (const call of calls) {
    const label = `${call.id} ${call.operation}`;

    // A row with no model is only legitimate when nothing was called.
    if (!call.model) {
      if (call.status !== 'unavailable') {
        problems.push(`${label}: status=${call.status} but no model recorded`);
      }
      continue;
    }

    const metadata = findModelMetadata(call.model);
    if (!metadata) {
      problems.push(`${label}: names "${call.model}", which is not in the registry`);
      continue;
    }
    if (metadata.modelId !== call.model) {
      problems.push(`${label}: recorded the alias "${call.model}" rather than the model id "${metadata.modelId}"`);
    }
    // `gemini` and `google` are the same provider under two spellings in the AiCall enum.
    const recorded = call.provider === 'gemini' ? 'google' : call.provider;
    if (recorded !== metadata.provider) {
      problems.push(`${label}: provider "${call.provider}" but ${call.model} belongs to ${metadata.provider}`);
    }
    if (call.status === 'ok') {
      if (!call.totalTokens) problems.push(`${label}: succeeded on ${call.model} with no token count`);
      if (call.estimatedCostUsd === null) problems.push(`${label}: succeeded on ${call.model} with no cost estimate`);
    }

    const bucket = byModel.get(call.model) ?? { ok: 0, failed: 0, tokens: 0 };
    if (call.status === 'ok') bucket.ok += 1;
    else bucket.failed += 1;
    bucket.tokens += call.totalTokens ?? 0;
    byModel.set(call.model, bucket);
  }

  console.log('By model');
  for (const [model, stats] of byModel) {
    const known = MODEL_REGISTRY[model] ? MODEL_REGISTRY[model].displayName : 'UNKNOWN MODEL';
    console.log(`  ${model.padEnd(22)} ${known.padEnd(20)} ok=${stats.ok} failed=${stats.failed} tokens=${stats.tokens}`);
  }

  console.log('\nMost recent 10');
  for (const call of calls.slice(0, 10)) {
    console.log(
      `  ${call.createdAt.toISOString()}  ${String(call.operation).padEnd(22)} ${String(call.provider).padEnd(7)} ` +
        `${String(call.model).padEnd(22)} ${String(call.status).padEnd(12)} ${call.latencyMs}ms ` +
        `tokens=${call.totalTokens ?? '-'} ${call.errorCode ? `(${call.errorCode})` : ''}`,
    );
  }

  await prisma.$disconnect();

  if (problems.length > 0) {
    console.error(`\nFAIL: ${problems.length} attribution problem(s).`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }

  console.log('\nPASS: every row names a registered model, its own provider, and carries usage.');
  process.exit(0);
}

main();
