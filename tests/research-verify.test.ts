import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import {
  MAX_VERIFY_ATTEMPTS,
  VERIFY_BATCH,
  VERIFY_CLAIM_STALE_MS,
  VERIFY_RECHECK_DELAY_MS,
  beginVerification,
  reopenVerification,
  runVerificationSlice,
  type CandidateOutcome,
  type VerifyBatchFn,
} from '@/lib/research/verify';
import { startResearchRun } from '@/lib/research/runner';
import { createTestTenant } from './helpers/testTenant';

/**
 * Verification orchestration (2026-10-08) against a real database, with the classifier stubbed: every
 * candidate is settled exactly once, failures are retried a bounded number of times and then shown, a
 * run whose checks all failed says so, and the run is only settled when its last candidate is.
 */

let tenantId: string;
let otherTenantId: string;
const inTenant = <T>(fn: () => Promise<T>, t = tenantId) => tenantStorage.run({ tenantId: t, bypassRls: true }, fn);
const T0 = new Date('2026-10-08T10:00:00Z');
const enqueueVerify = vi.fn(async () => undefined);

async function runWith(count: number, t = tenantId) {
  return inTenant(async () => {
    const run = await prisma.researchRun.create({ data: { tenantId: t, kind: 'company', status: 'running', queriesJson: [] as never } });
    for (let i = 0; i < count; i++) {
      await prisma.researchCandidate.create({
        data: {
          tenantId: t,
          runId: run.id,
          kind: 'company',
          name: `Company ${i}`,
          domain: `company-${i}.com`,
          sourceJson: {} as never,
          matchHintsJson: [] as never,
          dedupeFingerprint: `company:company-${i}.com`,
          verification: 'pending',
        },
      });
    }
    return run.id;
  }, t);
}

const verdict = (verification: 'verified_fit' | 'needs_review' | 'rejected', reason: string): CandidateOutcome => ({
  kind: 'verdict',
  verification,
  reason,
  fitScore: verification === 'rejected' ? 10 : 80,
  verificationJson: { reason },
});
const always = (outcome: CandidateOutcome): VerifyBatchFn => vi.fn<VerifyBatchFn>(async ({ candidates }) => new Map(candidates.map((c) => [c.id, outcome] as const)));
const slice = (runId: string, verifyBatch: VerifyBatchFn, now = T0) =>
  inTenant(() => runVerificationSlice({ runId, sliceToken: randomUUID() }, tenantId, { verifyBatch, enqueueVerify, now: () => now }));
const run = (runId: string) => inTenant(() => prisma.researchRun.findUniqueOrThrow({ where: { id: runId } }));
const candidates = (runId: string) => inTenant(() => prisma.researchCandidate.findMany({ where: { runId }, orderBy: { name: 'asc' } }));

beforeEach(async () => {
  enqueueVerify.mockClear();
  tenantId = `t-research-verify-${randomUUID()}`;
  otherTenantId = `t-research-verify-other-${randomUUID()}`;
  await createTestTenant(tenantId, 'Research verify');
  await createTestTenant(otherTenantId, 'Research verify other');
});

describe('beginVerification', () => {
  it('starts only when there is something to check, and queues the first slice', async () => {
    const empty = await runWith(0);
    expect(await inTenant(() => beginVerification(tenantId, empty, { enqueueVerify, now: () => T0 }))).toBe(false);
    expect(enqueueVerify).not.toHaveBeenCalled();

    const runId = await runWith(2);
    expect(await inTenant(() => beginVerification(tenantId, runId, { enqueueVerify, now: () => T0 }))).toBe(true);
    expect(enqueueVerify).toHaveBeenCalledWith(expect.objectContaining({ runId }), tenantId);
    expect((await run(runId)).verificationStartedAt).toEqual(T0);
  });
});

describe('runVerificationSlice', () => {
  it('settles every candidate, then the run, with the verdict written beside the workflow status', async () => {
    const runId = await runWith(3);
    const result = await slice(runId, always(verdict('verified_fit', 'weighted_qualified')));
    expect(result).toEqual({ outcome: 'finished', settled: 3 });
    for (const c of await candidates(runId)) {
      expect(c).toMatchObject({ status: 'discovered', verification: 'verified_fit', verificationReason: 'weighted_qualified', fitScore: 80, fitSource: 'icp', verifyClaimToken: null });
    }
    expect(await run(runId)).toMatchObject({ status: 'succeeded', verificationFinishedAt: T0, errorMessage: null, verificationWarning: null });
  });

  it('works in batches and hands the rest to the next slice', async () => {
    const runId = await runWith(VERIFY_BATCH + 2);
    expect(await slice(runId, always(verdict('needs_review', 'x')))).toEqual({ outcome: 'continued', settled: VERIFY_BATCH });
    expect(enqueueVerify).toHaveBeenCalledTimes(1);
    expect((await run(runId)).status).toBe('running');
    expect(await slice(runId, always(verdict('needs_review', 'x')))).toEqual({ outcome: 'finished', settled: 2 });
  });

  it('retries a candidate it could not check, then shows it as unverified with the reason', async () => {
    const runId = await runWith(1);
    const flaky = always({ kind: 'retry', reason: 'site_timeout' });
    for (let i = 1; i < MAX_VERIFY_ATTEMPTS; i++) {
      expect((await slice(runId, flaky)).outcome).toBe('continued');
      expect((await candidates(runId))[0]).toMatchObject({ verification: 'pending', verifyAttempts: i });
    }
    expect((await slice(runId, flaky)).outcome).toBe('finished');
    expect((await candidates(runId))[0]).toMatchObject({ verification: 'unverified', verificationReason: 'site_timeout' });
    // A site that timed out is about that company, not about the checker: the run still succeeds.
    expect(await run(runId)).toMatchObject({ status: 'succeeded', verificationWarning: '1 of 1 could not be checked: 1 site timed out.' });
  });

  it('fails the run, with the reason, when nothing could be checked because the checker was down', async () => {
    const runId = await runWith(2);
    const down = always({ kind: 'retry', reason: 'classifier_unavailable' });
    for (let i = 0; i < MAX_VERIFY_ATTEMPTS; i++) await slice(runId, down);
    const settled = await run(runId);
    expect(settled.status).toBe('failed');
    expect(settled.errorMessage).toMatch(/^Found 2 companies but could not check any of them \(2 checker unavailable\)/);
  });

  it('counts a thrown batch as one attempt for every candidate in it, never as success', async () => {
    const runId = await runWith(2);
    const broken = vi.fn<VerifyBatchFn>(async () => {
      throw new Error('boom');
    });
    expect((await slice(runId, broken)).outcome).toBe('continued');
    for (const c of await candidates(runId)) expect(c).toMatchObject({ verification: 'pending', verifyAttempts: 1, verifyClaimToken: null });
    // A fixed code reaches the row, never the error text (it is shown to reps).
    for (let i = 1; i < MAX_VERIFY_ATTEMPTS; i++) await slice(runId, broken);
    for (const c of await candidates(runId)) expect(c).toMatchObject({ verification: 'unverified', verificationReason: 'verify_error' });
  });

  it('waiting on a domain another slice is classifying does not use up a retry, and rechecks later', async () => {
    const runId = await runWith(1);
    const busy = vi.fn<VerifyBatchFn>(async ({ candidates: cs }) =>
      new Map(cs.map((c) => [c.id, { kind: 'retry', reason: 'domain_busy', countsAsAttempt: false } as const]))
    );
    for (let i = 0; i < MAX_VERIFY_ATTEMPTS + 2; i++) await slice(runId, busy);
    expect((await candidates(runId))[0]).toMatchObject({ verification: 'pending', verifyAttempts: 0 });
    expect(enqueueVerify).toHaveBeenLastCalledWith(expect.objectContaining({ runId }), tenantId, { delay: VERIFY_RECHECK_DELAY_MS });
  });

  it('a slice whose claim was taken over writes nothing', async () => {
    const runId = await runWith(1);
    const late = vi.fn<VerifyBatchFn>(async ({ candidates: cs }) => {
      // Another slice takes the row over while this one works, and settles it.
      await inTenant(() =>
        prisma.researchCandidate.updateMany({ where: { runId }, data: { verifyClaimToken: 'newer', verification: 'verified_fit', verificationReason: 'newer' } })
      );
      return new Map(cs.map((c) => [c.id, verdict('rejected', 'late')]));
    });
    await slice(runId, late);
    expect((await candidates(runId))[0]).toMatchObject({ verification: 'verified_fit', verificationReason: 'newer' });
  });

  it('refreshes its claims while a slow batch works, so no other slice takes them', async () => {
    const runId = await runWith(1);
    let refreshed: Date | null = null;
    const slow = vi.fn<VerifyBatchFn>(async ({ candidates: cs }) => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      refreshed = (await candidates(runId))[0].verifyClaimedAt;
      return new Map(cs.map((c) => [c.id, verdict('verified_fit', 'ok')]));
    });
    let tick = T0.getTime();
    const clock = () => new Date((tick += 1000));
    await inTenant(() => runVerificationSlice({ runId, sliceToken: randomUUID() }, tenantId, { verifyBatch: slow, enqueueVerify, now: clock, heartbeatMs: 20 }));
    expect(refreshed).not.toBeNull();
    expect(refreshed!.getTime()).toBeGreaterThan(T0.getTime() + 1000);
  });
});

describe('a run that failed verification can be resumed', () => {
  it('Resume puts candidates the dead checker left unchecked back in the queue and restarts the run', async () => {
    const runId = await runWith(2);
    const down = always({ kind: 'retry', reason: 'classifier_unavailable' });
    for (let i = 0; i < MAX_VERIFY_ATTEMPTS; i++) await slice(runId, down);
    expect((await run(runId)).status).toBe('failed');

    const enqueueSlice = vi.fn(async () => undefined);
    expect(await inTenant(() => startResearchRun({ tenantId, runId, enqueueSlice }))).toEqual({ status: 'started' });
    expect(enqueueSlice).toHaveBeenCalled();
    for (const c of await candidates(runId)) expect(c).toMatchObject({ verification: 'pending', verifyAttempts: 0 });
  });

  it('a run with nothing left to check stays finished', async () => {
    const runId = await runWith(1);
    await slice(runId, always(verdict('rejected', 'company_type:media_news')));
    await inTenant(() => prisma.researchRun.update({ where: { id: runId }, data: { status: 'failed' } }));
    expect(await inTenant(() => reopenVerification(tenantId, runId))).toBe(0);
    expect((await inTenant(() => startResearchRun({ tenantId, runId, enqueueSlice: vi.fn(async () => undefined) }))).status).toBe('already_finished');
  });

  it('pauses with the reason, instead of hanging, when verification cannot be queued', async () => {
    const runId = await runWith(1);
    const unreachable = vi.fn(async () => {
      throw new Error('redis down');
    });
    expect(await inTenant(() => beginVerification(tenantId, runId, { enqueueVerify: unreachable }))).toBe(true);
    expect(await run(runId)).toMatchObject({ status: 'paused', errorMessage: expect.stringMatching(/could not be queued/) });
  });

  it('says why the shortlist is empty when every company was ruled out', async () => {
    const runId = await runWith(3);
    const reasons = ['company_type:media_news', 'company_type:media_news', 'hq_outside_target'];
    const ruledOut = vi.fn<VerifyBatchFn>(async ({ candidates: cs }) => new Map(cs.map((c, i) => [c.id, verdict("rejected", reasons[i])] as const)));
    await slice(runId, ruledOut);
    expect((await run(runId)).errorMessage).toBe('None of the 3 companies found fit: 2 media / news, 1 outside the target countries.');
  });

  it('never checks the same candidate in two slices, and takes over a dead slice’s claim', async () => {
    const runId = await runWith(VERIFY_BATCH);
    const seen: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow = vi.fn<VerifyBatchFn>(async ({ candidates: cs }) => {
      seen.push(...cs.map((c) => c.id));
      await gate;
      return new Map(cs.map((c) => [c.id, verdict("verified_fit", "ok")] as const));
    });
    const first = slice(runId, slow);
    await vi.waitFor(() => expect(seen).toHaveLength(VERIFY_BATCH));
    // A second slice while the first holds every claim: nothing to do.
    expect(await slice(runId, always(verdict('rejected', 'second')))).toEqual({ outcome: 'waiting', settled: 0 });
    release();
    await first;
    expect(new Set((await candidates(runId)).map((c) => c.verification))).toEqual(new Set(['verified_fit']));

    // A claim left by a slice that died is taken over once it is stale.
    const runId2 = await runWith(1);
    await inTenant(() => prisma.researchCandidate.updateMany({ where: { runId: runId2 }, data: { verifyClaimToken: 'dead', verifyClaimedAt: T0 } }));
    expect((await slice(runId2, always(verdict('verified_fit', 'ok')), new Date(T0.getTime() + VERIFY_CLAIM_STALE_MS - 1000))).outcome).toBe('waiting');
    expect((await slice(runId2, always(verdict('verified_fit', 'ok')), new Date(T0.getTime() + VERIFY_CLAIM_STALE_MS + 1000))).outcome).toBe('finished');
  });

  it('stops at a pause, ignores a run that is not running, and cannot reach another tenant’s run', async () => {
    const runId = await runWith(1);
    await inTenant(() => prisma.researchRun.update({ where: { id: runId }, data: { pauseRequestedAt: T0 } }));
    expect(await slice(runId, always(verdict('verified_fit', 'ok')))).toEqual({ outcome: 'paused', settled: 0 });
    expect((await run(runId)).status).toBe('paused');
    expect(await slice(runId, always(verdict('verified_fit', 'ok')))).toEqual({ outcome: 'not_running', settled: 0 });

    const theirs = await runWith(1, otherTenantId);
    expect(await slice(theirs, always(verdict('verified_fit', 'ok')))).toEqual({ outcome: 'not_found', settled: 0 });
  });
});
