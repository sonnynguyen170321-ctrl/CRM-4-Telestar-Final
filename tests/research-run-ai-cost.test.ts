import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { recordAiCall } from '@/lib/ai/usage';
import { listResearchRuns } from '@/lib/research/readModel';
import { createTestTenant } from './helpers/testTenant';

/**
 * AI spend attributed to a research run (2026-10-10): the run list reports how many AiCall rows the run caused and
 * what they cost, from the run's own rows only and never across tenants.
 */

const inTenant = <T>(tenantId: string, fn: () => Promise<T>) => tenantStorage.run({ tenantId, bypassRls: true }, fn);

async function tenantWithRun() {
  const tenantId = `t-run-cost-${randomUUID()}`;
  await createTestTenant(tenantId, 'Run cost');
  const run = await inTenant(tenantId, () =>
    prisma.researchRun.create({ data: { tenantId, kind: 'company', status: 'succeeded', queriesJson: [] as never, paramsJson: {} as never } })
  );
  return { tenantId, runId: run.id };
}

const call = (tenantId: string, researchRunId: string | null, cost: string | null) =>
  prisma.aiCall.create({
    data: { tenantId, researchRunId, operation: 'research_classify', provider: 'groq', latencyMs: 5, status: 'ok', estimatedCostUsd: cost },
  });

describe('recordAiCall', () => {
  it('persists the research run it was spent on', async () => {
    const { tenantId, runId } = await tenantWithRun();
    const out = await inTenant(tenantId, () =>
      recordAiCall({ tenantId, researchRunId: runId, operation: 'research_classify', provider: 'groq', model: 'llama-3.3-70b-versatile', promptTokens: 10, completionTokens: 5, totalTokens: 15, latencyMs: 3, status: 'ok' })
    );
    const row = await inTenant(tenantId, () => prisma.aiCall.findFirst({ where: { id: out.aiCallId ?? '' } }));
    expect(row?.researchRunId).toBe(runId);
  });
});

describe('listResearchRuns AI spend', () => {
  let a: { tenantId: string; runId: string };
  let b: { tenantId: string; runId: string };

  beforeEach(async () => {
    a = await tenantWithRun();
    b = await tenantWithRun();
  });

  it('sums the calls and cost attributed to the run, ignoring unattributed calls', async () => {
    await inTenant(a.tenantId, async () => {
      await call(a.tenantId, a.runId, '0.250000');
      await call(a.tenantId, a.runId, '0.170000');
      await call(a.tenantId, a.runId, null);
      await call(a.tenantId, null, '9.000000');
    });
    const [row] = await listResearchRuns(a.tenantId);
    expect(row.aiCalls).toBe(3);
    expect(row.aiCostUsd).toBeCloseTo(0.42, 6);
  });

  it('reports zero for a run that spent nothing', async () => {
    const [row] = await listResearchRuns(a.tenantId);
    expect(row).toMatchObject({ aiCalls: 0, aiCostUsd: 0 });
  });

  it('keeps tenants apart: a call cannot carry a foreign run, and each list counts only its own', async () => {
    // The composite (researchRunId, tenantId) key refuses the cross-tenant attribution outright.
    await expect(inTenant(b.tenantId, () => call(b.tenantId, a.runId, '5.000000'))).rejects.toThrow();
    await inTenant(b.tenantId, () => call(b.tenantId, b.runId, '1.000000'));
    const [rowA] = await listResearchRuns(a.tenantId);
    expect(rowA).toMatchObject({ aiCalls: 0, aiCostUsd: 0 });
    const [rowB] = await listResearchRuns(b.tenantId);
    expect(rowB).toMatchObject({ aiCalls: 1, aiCostUsd: 1 });
  });
});
