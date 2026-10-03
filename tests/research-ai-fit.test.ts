import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  getVisibleCampaignIds: vi.fn(async () => null),
}));

import type { AiFit } from '@telestar/core-research/fitPrompt';
import { OFF_PERSONA_SCORE_CAP } from '@telestar/core-research/scoreCandidates';

import { prisma, tenantStorage } from '@/lib/prisma';
import { AI_REFINE_WINDOW, MAX_AI_CANDIDATES_PER_PASS, applyAiFit, type AiFitCandidate } from '@/lib/research/aiFit';

/**
 * The AI-fit layer, against the real database.
 *
 * The `aiFit` toggle existed and did nothing for its whole life; these pin what it now does and,
 * as much, what it must not do — fail a run, run unbounded, or lift a contact the persona rule
 * already placed outside the target titles.
 */

const TENANT = 'default-tenant';
const runs: string[] = [];

function asTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ tenantId: TENANT, bypassRls: true }, fn);
}

async function seed(count: number, offPersonaIndexes: number[] = []) {
  const run = await asTenant(() =>
    prisma.researchRun.create({
      data: { tenantId: TENANT, kind: 'contact', status: 'running', queriesJson: [] as never },
      select: { id: true },
    })
  );
  runs.push(run.id);
  const candidates: AiFitCandidate[] = [];
  for (let i = 0; i < count; i += 1) {
    const row = await asTenant(() =>
      prisma.researchCandidate.create({
        data: {
          tenantId: TENANT,
          runId: run.id,
          kind: 'contact',
          status: 'discovered',
          name: `Person ${i}`,
          title: offPersonaIndexes.includes(i) ? 'Lead Developer' : 'CEO',
          sourceJson: {} as never,
          matchHintsJson: [] as never,
          dedupeFingerprint: `aifit:${run.id}:${i}`,
          fitScore: 70,
          fitReason: 'heuristic',
          fitSource: 'heuristic',
        },
        select: { id: true },
      })
    );
    candidates.push({
      id: row.id,
      name: `Person ${i}`,
      title: offPersonaIndexes.includes(i) ? 'Lead Developer' : 'CEO',
      companyName: 'Acme SaaS',
      domain: null,
      snippet: null,
      offPersona: offPersonaIndexes.includes(i),
      heuristicScore: offPersonaIndexes.includes(i) ? 30 : 70,
    });
  }
  return { runId: run.id, candidates };
}

function scoresAll(score: number) {
  return vi.fn(async (_input: unknown, parse: (raw: string) => Map<number, AiFit> | null) => {
    const raw = JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ i, score, reason: 'strong fit' })));
    return { available: true, data: parse(raw), raw, aiCallId: 'ai-1', attempts: [] };
  });
}

function readCandidates(runId: string) {
  return asTenant(() =>
    prisma.researchCandidate.findMany({
      where: { tenantId: TENANT, runId },
      orderBy: { name: 'asc' },
      select: { name: true, fitScore: true, fitReason: true, fitSource: true },
    })
  );
}

afterEach(async () => {
  if (runs.length) {
    const ids = runs.splice(0);
    await asTenant(() => prisma.researchCandidate.deleteMany({ where: { tenantId: TENANT, runId: { in: ids } } }));
    await asTenant(() => prisma.researchRun.deleteMany({ where: { tenantId: TENANT, id: { in: ids } } }));
  }
});

describe('applyAiFit', () => {
  it('writes the model score and marks the source as ai', async () => {
    const { runId, candidates } = await seed(3);
    const generate = scoresAll(88);

    const result = await asTenant(() =>
      applyAiFit(
        { tenantId: TENANT, runId, kind: 'contact', targetSignals: ['saas'], personaTitles: ['CEO'], candidates },
        { generate: generate as never }
      )
    );

    expect(result).toEqual({ scored: 3, attempted: 3, unavailableReason: null });
    const rows = await readCandidates(runId);
    expect(rows.every((row) => row.fitScore === 88 && row.fitSource === 'ai')).toBe(true);
    expect(rows[0].fitReason).toBe('AI: strong fit');
  });

  it('moves a score at most AI_REFINE_WINDOW from the heuristic — refine, never replace', async () => {
    const { runId, candidates } = await seed(2);

    await asTenant(() =>
      applyAiFit(
        { tenantId: TENANT, runId, kind: 'contact', targetSignals: [], personaTitles: ['CEO'], candidates },
        { generate: scoresAll(5) as never }
      )
    );

    // Heuristic 70; the model said 5. One confident answer cannot sink a strong match to the floor.
    const rows = await readCandidates(runId);
    expect(rows.every((row) => row.fitScore === 70 - AI_REFINE_WINDOW)).toBe(true);
  });

  it('cannot lift an off-persona contact over the persona cap, whatever the model says', async () => {
    const { runId, candidates } = await seed(2, [1]);

    await asTenant(() =>
      applyAiFit(
        { tenantId: TENANT, runId, kind: 'contact', targetSignals: [], personaTitles: ['CEO'], candidates },
        { generate: scoresAll(95) as never }
      )
    );

    const rows = await readCandidates(runId);
    expect(rows[0].fitScore).toBe(95);
    expect(rows[1].fitScore).toBe(OFF_PERSONA_SCORE_CAP);
    expect(rows[1].fitReason).toMatch(/^Off-persona title "Lead Developer"/);
  });

  it('keeps the heuristic score, and says why, when no AI provider answers', async () => {
    const { runId, candidates } = await seed(2);
    const generate = vi.fn(async () => ({
      available: false,
      data: null,
      raw: null,
      aiCallId: 'ai-x',
      reason: 'no generation provider configured',
      attempts: [],
    }));

    const result = await asTenant(() =>
      applyAiFit(
        { tenantId: TENANT, runId, kind: 'contact', targetSignals: [], personaTitles: [], candidates },
        { generate: generate as never }
      )
    );

    expect(result.scored).toBe(0);
    expect(result.unavailableReason).toBe('no generation provider configured');
    const rows = await readCandidates(runId);
    expect(rows.every((row) => row.fitSource === 'heuristic' && row.fitScore === 70)).toBe(true);
    // One failed call is enough to know; it does not pay for the remaining batches.
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('never sends more than its per-pass cap to the model', async () => {
    const candidates: AiFitCandidate[] = Array.from({ length: MAX_AI_CANDIDATES_PER_PASS + 25 }, (_, i) => ({
      id: `missing-${i}`,
      name: `P${i}`,
      title: 'CEO',
      companyName: null,
      domain: null,
      snippet: null,
      offPersona: false,
      heuristicScore: 60,
    }));
    const generate = scoresAll(70);

    const result = await asTenant(() =>
      applyAiFit(
        { tenantId: TENANT, runId: 'no-such-run', kind: 'contact', targetSignals: [], personaTitles: [], candidates },
        { generate: generate as never }
      )
    );

    expect(result.attempted).toBe(MAX_AI_CANDIDATES_PER_PASS);
    expect(generate).toHaveBeenCalledTimes(Math.ceil(MAX_AI_CANDIDATES_PER_PASS / 30));
    // Ids from no run in this tenant update nothing — the write is scoped by tenant and run.
    expect(result.scored).toBe(0);
  });
});
