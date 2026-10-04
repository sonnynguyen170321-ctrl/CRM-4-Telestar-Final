import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { getCandidateEvidence, listResearchCandidates, listResearchRuns } from '@/lib/research/readModel';
import { validateResearchQueryLimit } from '@/lib/research/access';
import { createTestTenant } from './helpers/testTenant';

/**
 * The Research workspace's counters against the rows (Phase 6 dashboard audit).
 *
 * Before: "Candidates" was a counter a query that threw part-way left short; the Review and
 * Pipeline tabs were counted in the browser from the first 200 rows beside an "All" counted on the
 * server, and a candidate already promoted in an earlier run sat in both; a budget the planner did
 * not know became 50 without a word; the drawer's "whole run" tally was the oldest 50 attempts.
 */

let tenantId: string;
let runId: string;
const inTenant = <T>(fn: () => Promise<T>) => tenantStorage.run({ tenantId, bypassRls: true }, fn);

async function candidate(status: 'discovered' | 'promoted' | 'dismissed', fingerprint = `fp-${randomUUID()}`) {
  const row = await prisma.researchCandidate.create({
    data: {
      tenantId,
      runId,
      kind: 'company',
      name: `Co ${fingerprint.slice(0, 6)}`,
      sourceJson: {},
      matchHintsJson: [],
      dedupeFingerprint: fingerprint,
      status,
    },
  });
  return row.id;
}

beforeEach(async () => {
  tenantId = `t-rcount-${randomUUID()}`;
  await createTestTenant(tenantId, 'Research counters');
  runId = await inTenant(async () => {
    const run = await prisma.researchRun.create({
      data: {
        tenantId,
        kind: 'company',
        status: 'succeeded',
        queriesJson: Array.from({ length: 6 }, (_, index) => ({ query: `q${index}`, hints: [] })),
        paramsJson: { queryBudget: 50 },
        queryCursor: 6,
        // The counter says one; the rows below say three. The rows are what exists.
        discoveredCount: 1,
      },
    });
    return run.id;
  });
});

describe('the run list', () => {
  it('counts candidates from the rows and reports the budget beside the plan', async () => {
    const runs = await inTenant(async () => {
      await candidate('discovered');
      await candidate('discovered');
      await candidate('promoted');
      return listResearchRuns(tenantId);
    });
    expect(runs[0]).toMatchObject({ discoveredCount: 3, totalQueries: 6, queryBudget: 50, promotedCount: 1 });
  });
});

describe('the candidate tabs', () => {
  it('count the whole run; a prospect already in the library is in Review and in Pipeline', async () => {
    const result = await inTenant(async () => {
      await candidate('discovered'); // new — review
      await candidate('discovered', 'fp-taken'); // promoted in an earlier run: still reviewable, and pipeline
      await candidate('promoted'); // pipeline
      await candidate('dismissed'); // dismissed
      await prisma.researchProspect.create({
        data: { tenantId, kind: 'company', dedupeFingerprint: 'fp-taken', displayName: 'Taken', promotedAccountId: `acct-${randomUUID()}` },
      });
      return listResearchCandidates({ runId, pageSize: 1 }, tenantId);
    });
    expect(result.tabCounts).toEqual({ review: 2, pipeline: 2, dismissed: 1, all: 4 });
  });
});

describe('the query budget', () => {
  it('refuses a size the planner does not offer instead of quietly using 50', () => {
    expect(validateResearchQueryLimit('director', 150)).toMatchObject({ ok: false, options: [50, 100, 200, 1000] });
    expect(validateResearchQueryLimit('director', 100)).toEqual({ ok: true });
  });
});

describe('the evidence drawer', () => {
  it('tallies every search the run made and still lists the candidate\'s own lookups', async () => {
    const evidence = await inTenant(async () => {
      const id = await candidate('discovered');
      await prisma.researchProviderAttempt.createMany({
        data: Array.from({ length: 60 }, (_, index) => ({
          tenantId,
          runId,
          stage: 'discovery',
          provider: index % 3 === 0 ? 'brave' : 'exa',
          status: index % 10 === 0 ? 'failed' : 'ok',
          startedAt: new Date(Date.now() - 3_600_000 + index),
        })),
      });
      await prisma.researchProviderAttempt.create({
        data: { tenantId, runId, candidateId: id, stage: 'enrichment', provider: 'exa', status: 'ok', startedAt: new Date() },
      });
      return getCandidateEvidence(id, tenantId);
    });
    const total = (evidence?.runAttemptTally ?? []).reduce((sum, row) => sum + row.ok + row.failed, 0);
    expect(total).toBe(60);
    expect(evidence?.runAttemptTally?.find((row) => row.provider === 'exa')).toEqual({ provider: 'exa', ok: 36, failed: 4 });
    expect(evidence?.attempts.filter((attempt) => !attempt.runScoped)).toHaveLength(1);
  });
});

describe('wiring', () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

  it('keeps a busy run from looking dead while it re-ranks', () => {
    const discovery = read('lib/research/discovery.ts');
    expect(discovery).toMatch(/const heartbeat = setInterval\(/);
    expect(discovery).toMatch(/clearInterval\(heartbeat\)/);
  });

  it('takes the tab counts from the server', () => {
    expect(read('components/research/ResearchWorkspace.tsx')).toMatch(/setServerTabCounts\(data\.tabCounts \?\? null\)/);
  });
});
