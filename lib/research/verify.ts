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
 * The run stays `running` until every candidate is settled, so the existing stale-run rule and Resume
 * cover a dead verify slice: Resume re-enqueues discovery, discovery finds its cursor at the end and
 * hands back to verification. Candidates are claimed per row, so two slices never verify the same one,
 * and a claim left by a dead slice is taken over after `VERIFY_CLAIM_STALE_MS`.
 */

export const VERIFY_BATCH = 24;
/** Transient failures before a candidate is settled as `unverified` instead of retried again. */
export const MAX_VERIFY_ATTEMPTS = 2;
export const VERIFY_CLAIM_STALE_MS = 5 * 60 * 1000;

export type ClaimedCandidate = {
  id: string;
  name: string;
  domain: string | null;
  sourceJson: Prisma.JsonValue;
  matchHintsJson: Prisma.JsonValue;
  verifyAttempts: number;
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
  /** Could not decide this time (site timed out, classifier unavailable, domain claimed elsewhere). */
  | { kind: 'retry'; reason: string };

export type VerifyBatchFn = (input: { tenantId: string; runId: string; candidates: ClaimedCandidate[] }) => Promise<Map<string, CandidateOutcome>>;

type EnqueueVerifyFn = (payload: ResearchVerifyPayload, tenantId: string) => Promise<unknown>;

const defaultEnqueue: EnqueueVerifyFn = (payload, tenantId) => enqueue(JobType.RESEARCH_VERIFY, payload, { tenantId });

/**
 * Called when discovery has finished a company run. Returns true when there is something to verify —
 * the run then stays `running` and verification takes it from here; false means nothing was found and
 * discovery settles the run itself.
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
  await (deps.enqueueVerify ?? defaultEnqueue)({ runId, sliceToken: randomUUID() }, tenantId);
  return true;
}

export type VerifySliceOutcome = 'not_found' | 'not_running' | 'paused' | 'continued' | 'finished' | 'waiting';

export async function runVerificationSlice(
  payload: ResearchVerifyPayload,
  tenantId: string,
  deps: { verifyBatch: VerifyBatchFn; enqueueVerify?: EnqueueVerifyFn; now?: () => Date }
): Promise<{ outcome: VerifySliceOutcome; settled: number }> {
  const { runId } = payload;
  const now = deps.now?.() ?? new Date();
  const enqueueVerify = deps.enqueueVerify ?? defaultEnqueue;

  const run = await prisma.researchRun.findFirst({ where: { id: runId, tenantId }, select: { status: true, pauseRequestedAt: true } });
  if (!run) return { outcome: 'not_found', settled: 0 };
  if (run.status !== 'running') return { outcome: 'not_running', settled: 0 };
  if (run.pauseRequestedAt) {
    await prisma.researchRun.updateMany({ where: { id: runId, tenantId, status: 'running' }, data: { status: 'paused', pauseRequestedAt: null } });
    return { outcome: 'paused', settled: 0 };
  }

  const claimed = await claimPendingCandidates(tenantId, runId, now);
  if (claimed.length === 0) {
    const pending = await prisma.researchCandidate.count({ where: { tenantId, runId, verification: 'pending' } });
    if (pending === 0) {
      await finalizeVerification(tenantId, runId, now);
      return { outcome: 'finished', settled: 0 };
    }
    // Everything left is claimed by another slice that is still alive. Whoever settles the last
    // candidate settles the run; this slice has nothing to do.
    return { outcome: 'waiting', settled: 0 };
  }

  let outcomes: Map<string, CandidateOutcome>;
  try {
    outcomes = await deps.verifyBatch({ tenantId, runId, candidates: claimed });
  } catch (error) {
    // The whole batch failed (a bug, a dead database read) — every claimed row counts one attempt.
    console.error('[research] verify batch failed', { runId, error });
    const reason = `verify_error: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200);
    outcomes = new Map(claimed.map((c) => [c.id, { kind: 'retry', reason }]));
  }

  let settled = 0;
  for (const candidate of claimed) {
    const outcome = outcomes.get(candidate.id) ?? { kind: 'retry' as const, reason: 'no_outcome' };
    settled += (await recordOutcome(tenantId, candidate, outcome, now)) ? 1 : 0;
  }
  // Heartbeat: a run under verification writes no cursor, so its row must show it is alive.
  await prisma.researchRun.updateMany({ where: { id: runId, tenantId, status: 'running' }, data: { updatedAt: now } });

  const remaining = await prisma.researchCandidate.count({ where: { tenantId, runId, verification: 'pending' } });
  if (remaining === 0) {
    await finalizeVerification(tenantId, runId, now);
    return { outcome: 'finished', settled };
  }
  await enqueueVerify({ runId, sliceToken: randomUUID() }, tenantId);
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
    select: { id: true, name: true, domain: true, sourceJson: true, matchHintsJson: true, verifyAttempts: true },
    orderBy: { createdAt: 'asc' },
  });
}

/** Writes one outcome. True when the candidate is now settled (not back in the queue). */
async function recordOutcome(tenantId: string, candidate: ClaimedCandidate, outcome: CandidateOutcome, now: Date): Promise<boolean> {
  if (outcome.kind === 'retry') {
    const attempts = candidate.verifyAttempts + 1;
    const exhausted = attempts >= MAX_VERIFY_ATTEMPTS;
    await prisma.researchCandidate.updateMany({
      where: { id: candidate.id, tenantId },
      data: exhausted
        ? { verification: 'unverified', verificationReason: outcome.reason, verifyAttempts: attempts, verifiedAt: now, verifyClaimToken: null, verifyClaimedAt: null }
        : { verifyAttempts: attempts, verifyClaimToken: null, verifyClaimedAt: null },
    });
    return exhausted;
  }
  await prisma.researchCandidate.updateMany({
    where: { id: candidate.id, tenantId },
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
  return true;
}

/** Infrastructure reasons: the check could not run, which says nothing about the company. */
const INFRA_REASON = /^(classifier_unavailable|verify_error|no_outcome|budget)/;

/**
 * Settle the run once every candidate is settled. A run whose every candidate could not be checked for
 * an infrastructure reason failed — reporting it as a run full of "unverified" companies would hide a
 * dead classifier. Otherwise it succeeded, with a note when some could not be checked, and with a plain
 * account of the rejections when nothing made the shortlist.
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
  const infraUnverified = unverified.filter((r) => INFRA_REASON.test(r.verificationReason ?? '')).reduce((n, r) => n + r._count._all, 0);
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
    data: { status: 'succeeded', verificationWarning: warning, errorMessage: emptyShortlist, verificationFinishedAt: now, finishedAt: now },
  });
}
