import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  getVisibleCampaignIds: vi.fn(async () => null),
}));

import { prisma, tenantStorage } from '@/lib/prisma';
import { listResearchRuns, STALE_RUNNER_MS } from '@/lib/research/readModel';
import {
  PASSES_PER_SLICE,
  ResearchRunnerUnavailableError,
  pauseResearchRun,
  runResearchSlice,
  startResearchRun,
} from '@/lib/research/runner';
import type { DiscoveryPassResult } from '@/lib/research/discovery';

/**
 * The research runner, against the real database.
 *
 * The browser used to be the runner: `ResearchWorkspace.executeRun` looped ten-query passes for as
 * long as the tab stayed open. Leaving the page stopped the run and left it `running` forever; two
 * tabs read the same cursor and paid for every query twice. What replaced it is a status claim and a
 * self-continuing job, and both are only as good as the conditional writes they rest on — so these
 * tests run those writes against Postgres rather than against a mock that would agree with anything.
 */

const TENANT = 'default-tenant';
const created: string[] = [];

function asTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ tenantId: TENANT, bypassRls: true }, fn);
}

async function makeRun(data: { status?: string; queryCursor?: number; queries?: number } = {}) {
  const queries = Array.from({ length: data.queries ?? 50 }, (_, i) => ({ query: `q${i}`, hints: [] }));
  const run = await asTenant(() =>
    prisma.researchRun.create({
      data: {
        tenantId: TENANT,
        kind: 'company',
        status: (data.status ?? 'queued') as never,
        queryCursor: data.queryCursor ?? 0,
        queriesJson: queries as never,
      },
      select: { id: true },
    })
  );
  created.push(run.id);
  return run.id;
}

function readRun(id: string) {
  return asTenant(() =>
    prisma.researchRun.findFirst({
      where: { id, tenantId: TENANT },
      select: { status: true, pauseRequestedAt: true, errorMessage: true },
    })
  );
}

/**
 * Backdates the row, which is how a runner that died minutes ago looks.
 *
 * The value goes in as a zone-less string cast to `timestamp`. Prisma stores `DateTime` as UTC in a
 * `timestamp without time zone` column, but a JS `Date` bound into raw SQL travels as `timestamptz`
 * and is shifted into the session's zone on the cast — on a +07:00 machine that wrote a time six
 * hours in the future, and a "stale" row read as fresh.
 */
async function ageRun(id: string, ms: number) {
  const utc = new Date(Date.now() - ms).toISOString().replace('Z', '');
  await asTenant(() =>
    prisma.$executeRaw`UPDATE "ResearchRun" SET "updatedAt" = ${utc}::timestamp WHERE "id" = ${id}`
  );
}

function pass(overrides: Partial<DiscoveryPassResult> = {}): DiscoveryPassResult {
  return { runId: 'x', queriesRun: 10, discovered: 3, duplicates: 0, rejected: 0, finished: false, ...overrides };
}

afterEach(async () => {
  if (created.length) {
    await asTenant(() => prisma.researchRun.deleteMany({ where: { tenantId: TENANT, id: { in: created.splice(0) } } }));
  }
});

describe('startResearchRun — one runner per run', () => {
  it('claims a fresh run and queues exactly one slice', async () => {
    const runId = await makeRun();
    const enqueueSlice = vi.fn(async () => undefined);

    const result = await asTenant(() => startResearchRun({ tenantId: TENANT, runId, enqueueSlice }));

    expect(result).toEqual({ status: 'started' });
    expect(enqueueSlice).toHaveBeenCalledTimes(1);
    expect((await readRun(runId))?.status).toBe('running');
  });

  it('lets only one of two simultaneous starts through — the double click and the second tab', async () => {
    const runId = await makeRun();
    const enqueueSlice = vi.fn(async () => undefined);

    const results = await Promise.all([
      asTenant(() => startResearchRun({ tenantId: TENANT, runId, enqueueSlice })),
      asTenant(() => startResearchRun({ tenantId: TENANT, runId, enqueueSlice })),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual(['already_running', 'started']);
    // The whole point: two clicks used to mean every query searched, paid for and counted twice.
    expect(enqueueSlice).toHaveBeenCalledTimes(1);
  });

  it('refuses a run that someone is still working', async () => {
    const runId = await makeRun({ status: 'running', queryCursor: 20 });
    const enqueueSlice = vi.fn(async () => undefined);

    const result = await asTenant(() => startResearchRun({ tenantId: TENANT, runId, enqueueSlice }));

    expect(result).toEqual({ status: 'already_running' });
    expect(enqueueSlice).not.toHaveBeenCalled();
  });

  it('takes over a running run nobody has written to for the stale window', async () => {
    const runId = await makeRun({ status: 'running', queryCursor: 20 });
    await ageRun(runId, STALE_RUNNER_MS + 60_000);
    const enqueueSlice = vi.fn(async () => undefined);

    const result = await asTenant(() => startResearchRun({ tenantId: TENANT, runId, enqueueSlice }));

    expect(result).toEqual({ status: 'started' });
    expect(enqueueSlice).toHaveBeenCalledTimes(1);
  });

  it('resumes a paused run and a failed run that still has queries left', async () => {
    const paused = await makeRun({ status: 'paused', queryCursor: 30 });
    const failed = await makeRun({ status: 'failed', queryCursor: 30 });
    const enqueueSlice = vi.fn(async () => undefined);

    expect(await asTenant(() => startResearchRun({ tenantId: TENANT, runId: paused, enqueueSlice }))).toEqual({
      status: 'started',
    });
    expect(await asTenant(() => startResearchRun({ tenantId: TENANT, runId: failed, enqueueSlice }))).toEqual({
      status: 'started',
    });
    expect((await readRun(failed))?.errorMessage).toBeNull();
  });

  it('will not re-enter a failed run whose cursor is at the end — it would come back "succeeded"', async () => {
    const runId = await makeRun({ status: 'failed', queryCursor: 50, queries: 50 });
    const enqueueSlice = vi.fn(async () => undefined);

    const result = await asTenant(() => startResearchRun({ tenantId: TENANT, runId, enqueueSlice }));

    expect(result).toEqual({ status: 'already_finished', runStatus: 'failed' });
    expect(enqueueSlice).not.toHaveBeenCalled();
    expect((await readRun(runId))?.status).toBe('failed');
  });

  it('undoes the claim when the worker cannot be reached, instead of leaving a run nobody works', async () => {
    const runId = await makeRun({ status: 'paused', queryCursor: 10 });
    const enqueueSlice = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED redis:6379');
    });

    await expect(asTenant(() => startResearchRun({ tenantId: TENANT, runId, enqueueSlice }))).rejects.toBeInstanceOf(
      ResearchRunnerUnavailableError
    );

    const row = await readRun(runId);
    expect(row?.status).toBe('paused');
    expect(row?.errorMessage).toMatch(/worker could not be reached/i);
  });

  it('answers not_found for another tenant\'s run id', async () => {
    const runId = await makeRun();
    const result = await tenantStorage.run({ tenantId: 'some-other-tenant', bypassRls: true }, () =>
      startResearchRun({ tenantId: 'some-other-tenant', runId, enqueueSlice: vi.fn() })
    );
    expect(result).toEqual({ status: 'not_found' });
  });
});

describe('pauseResearchRun', () => {
  it('flags a running run and leaves the status to the worker', async () => {
    const runId = await makeRun({ status: 'running', queryCursor: 10 });

    expect(await asTenant(() => pauseResearchRun({ tenantId: TENANT, runId }))).toEqual({
      status: 'pause_requested',
    });

    const row = await readRun(runId);
    expect(row?.status).toBe('running');
    expect(row?.pauseRequestedAt).not.toBeNull();
  });

  it('pauses a queued run at once — there is no worker to tell', async () => {
    const runId = await makeRun();
    expect(await asTenant(() => pauseResearchRun({ tenantId: TENANT, runId }))).toEqual({ status: 'paused' });
    expect((await readRun(runId))?.status).toBe('paused');
  });

  it('refuses a run that is not running', async () => {
    const runId = await makeRun({ status: 'succeeded', queryCursor: 50 });
    expect(await asTenant(() => pauseResearchRun({ tenantId: TENANT, runId }))).toEqual({ status: 'not_running' });
  });
});

describe('runResearchSlice — the job', () => {
  it('runs a full slice and hands over to a continuation, so 50 queries become 50', async () => {
    const runId = await makeRun({ status: 'running' });
    const runPass = vi.fn(async () => pass());
    const enqueueSlice = vi.fn(async () => undefined);

    const result = await asTenant(() => runResearchSlice({ runId, startToken: 't' }, TENANT, { runPass, enqueueSlice }));

    expect(result).toEqual({ outcome: 'continued', passes: PASSES_PER_SLICE });
    expect(runPass).toHaveBeenCalledTimes(PASSES_PER_SLICE);
    expect(enqueueSlice).toHaveBeenCalledTimes(1);
  });

  it('stops at the pass that finishes the run and queues nothing after it', async () => {
    const runId = await makeRun({ status: 'running' });
    const runPass = vi
      .fn<() => Promise<DiscoveryPassResult>>()
      .mockResolvedValueOnce(pass())
      .mockResolvedValueOnce(pass({ finished: true }));
    const enqueueSlice = vi.fn(async () => undefined);

    const result = await asTenant(() => runResearchSlice({ runId, startToken: 't' }, TENANT, { runPass, enqueueSlice }));

    expect(result).toEqual({ outcome: 'finished', passes: 2 });
    expect(enqueueSlice).not.toHaveBeenCalled();
  });

  it('honours Pause at the next batch boundary and never starts another pass', async () => {
    const runId = await makeRun({ status: 'running' });
    await asTenant(() => pauseResearchRun({ tenantId: TENANT, runId }));
    const runPass = vi.fn(async () => pass());
    const enqueueSlice = vi.fn(async () => undefined);

    const result = await asTenant(() => runResearchSlice({ runId, startToken: 't' }, TENANT, { runPass, enqueueSlice }));

    expect(result.outcome).toBe('paused');
    expect(runPass).not.toHaveBeenCalled();
    const row = await readRun(runId);
    expect(row?.status).toBe('paused');
    expect(row?.pauseRequestedAt).toBeNull();
  });

  it('fails a run whose batch ran no query, rather than looping on it forever', async () => {
    const runId = await makeRun({ status: 'running' });
    const runPass = vi.fn(async () => pass({ queriesRun: 0 }));

    const result = await asTenant(() =>
      runResearchSlice({ runId, startToken: 't' }, TENANT, { runPass, enqueueSlice: vi.fn() })
    );

    expect(result.outcome).toBe('stalled');
    const row = await readRun(runId);
    expect(row?.status).toBe('failed');
    expect(row?.errorMessage).toMatch(/stopped making progress/);
  });

  it('marks the run failed with the reason before the job itself fails', async () => {
    const runId = await makeRun({ status: 'running' });
    const runPass = vi.fn(async () => {
      throw new Error('ICP version unreadable');
    });

    await expect(
      asTenant(() => runResearchSlice({ runId, startToken: 't' }, TENANT, { runPass, enqueueSlice: vi.fn() }))
    ).rejects.toThrow('ICP version unreadable');

    const row = await readRun(runId);
    expect(row?.status).toBe('failed');
    expect(row?.errorMessage).toMatch(/ICP version unreadable/);
  });

  it('pauses with a reason when the continuation cannot be queued, rather than looking alive', async () => {
    const runId = await makeRun({ status: 'running' });
    const runPass = vi.fn(async () => pass());
    const enqueueSlice = vi.fn(async () => {
      throw new Error('redis down');
    });

    const result = await asTenant(() => runResearchSlice({ runId, startToken: 't' }, TENANT, { runPass, enqueueSlice }));

    expect(result.outcome).toBe('continuation_unqueued');
    const row = await readRun(runId);
    expect(row?.status).toBe('paused');
    expect(row?.errorMessage).toMatch(/could not be queued/);
  });

  it('does nothing for a run that is no longer running', async () => {
    const runId = await makeRun({ status: 'paused', queryCursor: 10 });
    const runPass = vi.fn(async () => pass());

    const result = await asTenant(() =>
      runResearchSlice({ runId, startToken: 't' }, TENANT, { runPass, enqueueSlice: vi.fn() })
    );

    expect(result).toEqual({ outcome: 'not_running', passes: 0 });
    expect(runPass).not.toHaveBeenCalled();
  });
});

describe('the run list reports what the row says', () => {
  it('marks a running run stalled once nobody has written to it for the stale window', async () => {
    const fresh = await makeRun({ status: 'running', queryCursor: 10 });
    const dead = await makeRun({ status: 'running', queryCursor: 10 });
    await ageRun(dead, STALE_RUNNER_MS + 60_000);

    const runs = await asTenant(() => listResearchRuns(TENANT, 200));
    const byId = new Map(runs.map((run) => [run.id, run]));

    expect(byId.get(fresh)?.stalled).toBe(false);
    expect(byId.get(dead)?.stalled).toBe(true);
  });
});
