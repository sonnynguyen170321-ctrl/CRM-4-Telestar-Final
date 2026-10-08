import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import { enqueue } from '@/lib/bullmq/enqueue';
import { JobType, type ResearchVerifyPayload } from '@/lib/bullmq/types';
import { prisma } from '@/lib/prisma';

import { describeReason } from './verificationReasons';

export { describeReason };

/**
 * Verification of a company run's candidates: each one checked against its own evidence before a rep
 * sees it (owner, 2026-10-08 — research listed news sites, job boards, associations, vendors and
 * companies in the wrong country as prospects).
 *
 * This file is the orchestration only — claiming candidates, recording outcomes, retrying, settling
 * the run. What a candidate IS and whether it fits is decided by the injected `verifyBatch`
 * (lib/research/verifyBatch.ts: classify from evidence, then score with the lead ICP engine).
 *
 * The run stays `running` until every candidate is settled, so the stale-run rule and Resume cover a
 * dead verify slice: Resume re-enqueues discovery, discovery finds its cursor at the end and hands back
 * to verification (and `reopenVerification` lets a run that failed verification be resumed at all).
 * Candidates are claimed per row and every write is conditional on the claim, so two slices never
 * settle the same candidate; a live slice refreshes its claims and the run's heartbeat while it works,
 * so only a dead slice's claims are ever taken over.
 */

/** Small enough that a batch, page fetches and model calls included, finishes well inside the claim. */
export const VERIFY_BATCH = 12;
/** Transient failures before a candidate is settled as `unverified` instead of retried again. */
export const MAX_VERIFY_ATTEMPTS = 3;
/** A claim not refreshed for this long belongs to a dead slice. Live slices refresh every HEARTBEAT. */
export const VERIFY_CLAIM_STALE_MS = 10 * 60 * 1000;
export const VERIFY_HEARTBEAT_MS = 30 * 1000;
/** When another slice holds what is left, or a domain is busy elsewhere, look again after this. */
export const VERIFY_RECHECK_DELAY_MS = 60 * 1000;

/**
 * Reasons that say the check could not run, which says nothing about the company. A run made only of
 * these failed; Resume puts them back in the queue (`reopenVerification`). Fixed codes, never raw error
 * text: what lands in `verificationReason` is shown to reps.
 */
export const INFRA_REASONS = [
  'classifier_unavailable',
  'classification_unparseable',
  'verify_error',
  'no_outcome',
  'domain_busy',
  'cache_unreadable',
  'run_rules_unreadable',
] as const;
const INFRA = new Set<string>(INFRA_REASONS);

export type ClaimedCandidate = {
  id: string;
  name: string;
  domain: string | null;
  sourceJson: Prisma.JsonValue;
  matchHintsJson: Prisma.JsonValue;
  verifyAttempts: number;
  verifyClaimToken: string | null;
};

export type CandidateOutcome =
  | {
      kind: 'verdict';
      verification: 'verified_fit' | 'needs_review' | 'rejected' | 'unverified';
      reason: string;
      fitScore: number | null;
      verificationJson: Prisma.InputJsonValue;
      classificationId?: string | null;
    }
  /**
   * Could not decide this time. `countsAsAttempt: false` for waiting on someone else (a domain another
   * slice is classifying): that is not a failure of this candidate and must not use up its retries.
   */
  | { kind: 'retry'; reason: string; countsAsAttempt?: boolean };

export type VerifyBatchFn = (input: { tenantId: string; runId: string; candidates: ClaimedCandidate[] }) => Promise<Map<string, CandidateOutcome>>;

type EnqueueVerifyFn = (payload: ResearchVerifyPayload, tenantId: string, options?: { delay?: number }) => Promise<unknown>;

const defaultEnqueue: EnqueueVerifyFn = (payload, tenantId, options) =>
  enqueue(JobType.RESEARCH_VERIFY, payload, { tenantId, ...(options?.delay ? { delay: options.delay } : {}) });

/**
 * Called when discovery has finished a company run. Returns true when there is something to verify —
 * the run then stays with verification; false means nothing was found and discovery settles the run.
 *
 * If the first verify job cannot be queued the run is paused with the reason (as the runner does for a
 * discovery slice), never left `running` with nothing behind it; Resume picks it up.
 */
export async function beginVerification(
  tenantId: string,
  runId: string,
  deps: { enqueueVerify?: EnqueueVerifyFn; now?: () => Date } = {}
): Promise<boolean> {
  const pending = await prisma.researchCandidate.count({ where: { tenantId, runId, verification: 'pending' } });
  if (pending === 0) return false;
  const now = deps.now?.() ?? new Date();
  await prisma.researchRun.updateMany({
    where: { id: runId, tenantId, verificationStartedAt: null },
    data: { verificationStartedAt: now },
  });
  try {
    await (deps.enqueueVerify ?? defaultEnqueue)({ runId, sliceToken: randomUUID() }, tenantId);
  } catch (error) {
    console.error('[research] could not queue verification', { runId, error });
    await prisma.researchRun.updateMany({
      where: { id: runId, tenantId, status: 'running' },
      data: { status: 'paused', errorMessage: 'Checking the companies found could not be queued (background worker unreachable). Resume to continue.' },
    });
  }
  return true;
}

/**
 * For Resume on a run whose discovery is finished: put candidates that could not be checked for an
 * infrastructure reason back in the queue, and say how many are waiting. Zero means there is nothing
 * left to do and the run really is finished.
 */
export async function reopenVerification(tenantId: string, runId: string): Promise<number> {
  await prisma.researchCandidate.updateMany({
    where: { tenantId, runId, verification: 'unverified', verificationReason: { in: [...INFRA_REASONS] } },
    data: { verification: 'pending', verificationReason: null, verifyAttempts: 0, verifyClaimToken: null, verifyClaimedAt: null, verifiedAt: null },
  });
  return prisma.researchCandidate.count({ where: { tenantId, runId, verification: 'pending' } });
}

export type VerifySliceOutcome = 'not_found' | 'not_running' | 'paused' | 'continued' | 'finished' | 'waiting';

export async function runVerificationSlice(
  payload: ResearchVerifyPayload,
  tenantId: string,
  deps: { verifyBatch: VerifyBatchFn; enqueueVerify?: EnqueueVerifyFn; now?: () => Date; heartbeatMs?: number }
): Promise<{ outcome: VerifySliceOutcome; settled: number }> {
  const { runId } = payload;
  const now = () => deps.now?.() ?? new Date();
  const enqueueVerify = deps.enqueueVerify ?? defaultEnqueue;

  const run = await prisma.researchRun.findFirst({ where: { id: runId, tenantId }, select: { status: true, pauseRequestedAt: true } });
  if (!run) return { outcome: 'not_found', settled: 0 };
  if (run.status !== 'running') return { outcome: 'not_running', settled: 0 };
  if (run.pauseRequestedAt) {
    await prisma.researchRun.updateMany({ where: { id: runId, tenantId, status: 'running' }, data: { status: 'paused', pauseRequestedAt: null } });
    return { outcome: 'paused', settled: 0 };
  }

  const claimed = await claimPendingCandidates(tenantId, runId, now());
  if (claimed.length === 0) {
    const pending = await prisma.researchCandidate.count({ where: { tenantId, runId, verification: 'pending' } });
    if (pending === 0) {
      await finalizeVerification(tenantId, runId, now());
      return { outcome: 'finished', settled: 0 };
    }
    // Another slice holds what is left. If it dies its claims go stale; looking again later means the run
    // still settles without anyone pressing Resume.
    await enqueueVerify({ runId, sliceToken: randomUUID() }, tenantId, { delay: VERIFY_RECHECK_DELAY_MS });
    return { outcome: 'waiting', settled: 0 };
  }
  const token = claimed[0].verifyClaimToken;

  // While the batch works (page fetches, model calls), keep the run visibly alive and the claims fresh,
  // so neither the stale-run rule nor another slice mistakes this slice for a dead one.
  const heartbeat = setInterval(() => {
    const at = now();
    void prisma.researchRun
      .updateMany({ where: { id: runId, tenantId, status: 'running' }, data: { updatedAt: at } })
      .then(() => prisma.researchCandidate.updateMany({ where: { tenantId, runId, verifyClaimToken: token }, data: { verifyClaimedAt: at } }))
      .catch((error) => console.error('[research] verify heartbeat failed', { runId, error }));
  }, deps.heartbeatMs ?? VERIFY_HEARTBEAT_MS);

  let outcomes: Map<string, CandidateOutcome>;
  try {
    outcomes = await deps.verifyBatch({ tenantId, runId, candidates: claimed });
  } catch (error) {
    // The whole batch failed (a bug, a dead database read): every claimed row counts one attempt. The
    // detail goes to the log; the row gets a fixed code, because the reason is shown to reps.
    console.error('[research] verify batch failed', { runId, error });
    outcomes = new Map(claimed.map((c) => [c.id, { kind: 'retry', reason: 'verify_error' }]));
  } finally {
    clearInterval(heartbeat);
  }

  let settled = 0;
  let waitedOnOthers = 0;
  for (const candidate of claimed) {
    const outcome = outcomes.get(candidate.id) ?? { kind: 'retry' as const, reason: 'no_outcome' };
    if (outcome.kind === 'retry' && outcome.countsAsAttempt === false) waitedOnOthers += 1;
    settled += (await recordOutcome(tenantId, candidate, outcome, now())) ? 1 : 0;
  }
  await prisma.researchRun.updateMany({ where: { id: runId, tenantId, status: 'running' }, data: { updatedAt: now() } });

  const remaining = await prisma.researchCandidate.count({ where: { tenantId, runId, verification: 'pending' } });
  if (remaining === 0) {
    await finalizeVerification(tenantId, runId, now());
    return { outcome: 'finished', settled };
  }
  // Nothing moved because everything was waiting on another slice: do not spin, look again shortly.
  const delay = settled === 0 && waitedOnOthers === claimed.length ? VERIFY_RECHECK_DELAY_MS : undefined;
  await enqueueVerify({ runId, sliceToken: randomUUID() }, tenantId, delay ? { delay } : undefined);
  return { outcome: 'continued', settled };
}

async function claimPendingCandidates(tenantId: string, runId: string, now: Date): Promise<ClaimedCandidate[]> {
  const staleBefore = new Date(now.getTime() - VERIFY_CLAIM_STALE_MS);
  const claimable = { tenantId, runId, verification: 'pending' as const, OR: [{ verifyClaimToken: null }, { verifyClaimedAt: { lt: staleBefore } }] };
  const ids = await prisma.researchCandidate.findMany({ where: claimable, select: { id: true }, orderBy: { createdAt: 'asc' }, take: VERIFY_BATCH });
  if (ids.length === 0) return [];
  const token = randomUUID();
  // Same condition again in the write: a row another slice claimed between the read and here is left alone.
  await prisma.researchCandidate.updateMany({
    where: { ...claimable, id: { in: ids.map((r) => r.id) } },
    data: { verifyClaimToken: token, verifyClaimedAt: now },
  });
  return prisma.researchCandidate.findMany({
    where: { tenantId, runId, verifyClaimToken: token },
    select: { id: true, name: true, domain: true, sourceJson: true, matchHintsJson: true, verifyAttempts: true, verifyClaimToken: true },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Writes one outcome, only while this slice still holds the claim. True when the candidate is now
 * settled (not back in the queue). A slice whose claim was taken over writes nothing: the newer slice's
 * verdict stands.
 */
async function recordOutcome(tenantId: string, candidate: ClaimedCandidate, outcome: CandidateOutcome, now: Date): Promise<boolean> {
  const ours = { id: candidate.id, tenantId, verification: 'pending' as const, verifyClaimToken: candidate.verifyClaimToken };
  if (outcome.kind === 'retry') {
    const attempts = candidate.verifyAttempts + (outcome.countsAsAttempt === false ? 0 : 1);
    const exhausted = attempts >= MAX_VERIFY_ATTEMPTS;
    const written = await prisma.researchCandidate.updateMany({
      where: ours,
      data: exhausted
        ? { verification: 'unverified', verificationReason: outcome.reason, verifyAttempts: attempts, verifiedAt: now, verifyClaimToken: null, verifyClaimedAt: null }
        : { verifyAttempts: attempts, verifyClaimToken: null, verifyClaimedAt: null },
    });
    return exhausted && written.count === 1;
  }
  const written = await prisma.researchCandidate.updateMany({
    where: ours,
    data: {
      verification: outcome.verification,
      verificationReason: outcome.reason,
      verificationJson: outcome.verificationJson,
      fitScore: outcome.fitScore,
      fitReason: outcome.reason,
      fitSource: 'icp',
      classificationId: outcome.classificationId ?? null,
      verifiedAt: now,
      verifyClaimToken: null,
      verifyClaimedAt: null,
    },
  });
  return written.count === 1;
}

/**
 * Settle the run once every candidate is settled. A run whose every candidate could not be checked for
 * an infrastructure reason failed — reporting it as a run full of "unverified" companies would hide a
 * dead classifier — and Resume re-opens those candidates. Otherwise it succeeded, with a note when some
 * could not be checked, and with a plain account of the rejections when nothing made the shortlist.
 */
export async function finalizeVerification(tenantId: string, runId: string, now: Date = new Date()): Promise<void> {
  const rows = await prisma.researchCandidate.groupBy({
    by: ['verification', 'verificationReason'],
    where: { tenantId, runId, verification: { not: null } },
    _count: { _all: true },
  });
  const total = rows.reduce((n, r) => n + r._count._all, 0);
  const count = (v: string) => rows.filter((r) => r.verification === v).reduce((n, r) => n + r._count._all, 0);
  const unverified = rows.filter((r) => r.verification === 'unverified');
  const infraUnverified = unverified.filter((r) => INFRA.has(r.verificationReason ?? '')).reduce((n, r) => n + r._count._all, 0);
  const shortlisted = count('verified_fit') + count('needs_review');

  const topReasons = (subset: typeof rows) =>
    [...subset]
      .sort((a, b) => b._count._all - a._count._all)
      .slice(0, 4)
      .map((r) => `${r._count._all} ${describeReason(r.verificationReason)}`)
      .join(', ');

  if (total > 0 && infraUnverified === total) {
    await prisma.researchRun.updateMany({
      where: { id: runId, tenantId, status: 'running' },
      data: {
        status: 'failed',
        errorMessage: `Found ${total} compan${total === 1 ? 'y' : 'ies'} but could not check any of them (${topReasons(unverified)}). Resume to try again.`,
        verificationFinishedAt: now,
        finishedAt: now,
      },
    });
    return;
  }

  const warning = unverified.length > 0 ? `${count('unverified')} of ${total} could not be checked: ${topReasons(unverified)}.` : null;
  const emptyShortlist =
    total > 0 && shortlisted === 0
      ? `None of the ${total} companies found fit: ${topReasons(rows.filter((r) => r.verification === 'rejected'))}.`
      : null;
  await prisma.researchRun.updateMany({
    where: { id: runId, tenantId, status: 'running' },
    data: { status: 'succeeded', verificationWarning: warning, errorMessage: emptyShortlist, verificationFinishedAt: now, finishedAt: now, pauseRequestedAt: null },
  });
}
