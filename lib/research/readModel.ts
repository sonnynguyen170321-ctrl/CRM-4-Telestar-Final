import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { INFRA_REASONS } from '@/lib/research/verificationReasons';

// Read models for the research surface.
//
// Kept apart from the pipeline so the UI can never reach a write path, and so every list here carries
// its tenant filter explicitly rather than inheriting one from a caller.

/**
 * How long a `running` run may go without a row write before it counts as abandoned.
 *
 * Each query bumps `updatedAt` through the cursor write, and a query is bounded by provider timeouts
 * measured in seconds, so five minutes of silence means the worker died — a deploy, an OOM kill —
 * rather than that it is slow. Lives here, beside the read that reports it, and the runner imports it
 * for the claim that acts on it, so "stalled" means one thing on both sides.
 */
export const STALE_RUNNER_MS = 5 * 60_000;

export type ResearchRunRow = {
  id: string;
  kind: string;
  status: string;
  totalQueries: number;
  /** The query budget asked for. `totalQueries` is how many searches the ICP's terms made of it. */
  queryBudget: number | null;
  queryCursor: number;
  /** Candidate rows this run created — counted, not a counter a failed query can leave short. */
  discoveredCount: number;
  duplicateCount: number;
  promotedCount: number;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  errorMessage: string | null;
  /** Pause was pressed; the worker stops after the batch in flight. */
  pauseRequested: boolean;
  /** `running` with nobody writing to it for `STALE_RUNNER_MS` — the worker died. Resume claims it. */
  stalled: boolean;
  /** AiCall rows attributed to this run (classification, fit judging) and their estimated cost in USD. */
  aiCalls: number;
  aiCostUsd: number;
};

export async function listResearchRuns(tenantId: string, limit = 50): Promise<ResearchRunRow[]> {
  const now = Date.now();
  const runs = await prisma.researchRun.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 200),
    select: {
      id: true, kind: true, status: true, queriesJson: true, paramsJson: true, queryCursor: true,
      duplicateCount: true, createdAt: true,
      startedAt: true, finishedAt: true, errorMessage: true,
      pauseRequestedAt: true, updatedAt: true,
    },
  });

  // Promoted counts come from one grouped query rather than a per-run count: a list of 50 runs would
  // otherwise fire 50 extra round trips to render one column.
  const runIds = runs.map((r) => r.id);
  const [promoted, created, aiSpend] = await Promise.all([
    prisma.researchCandidate.groupBy({
      by: ['runId'],
      where: { tenantId, status: 'promoted', runId: { in: runIds } },
      _count: { _all: true },
    }),
    prisma.researchCandidate.groupBy({
      by: ['runId'],
      where: { tenantId, runId: { in: runIds } },
      _count: { _all: true },
    }),
    prisma.aiCall.groupBy({
      by: ['researchRunId'],
      where: { tenantId, researchRunId: { in: runIds } },
      _count: { _all: true },
      _sum: { estimatedCostUsd: true },
    }),
  ]);
  const aiByRun = new Map(aiSpend.map((a) => [a.researchRunId, { calls: a._count._all, cost: Number(a._sum.estimatedCostUsd ?? 0) }]));
  const promotedByRun = new Map(promoted.map((p) => [p.runId, p._count._all]));
  const createdByRun = new Map(created.map((p) => [p.runId, p._count._all]));

  return runs.map((run) => ({
    id: run.id,
    kind: run.kind,
    status: run.status,
    totalQueries: Array.isArray(run.queriesJson) ? run.queriesJson.length : 0,
    queryBudget: readQueryBudget(run.paramsJson),
    queryCursor: run.queryCursor,
    discoveredCount: createdByRun.get(run.id) ?? 0,
    duplicateCount: run.duplicateCount,
    promotedCount: promotedByRun.get(run.id) ?? 0,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    errorMessage: run.errorMessage,
    pauseRequested: run.pauseRequestedAt !== null,
    stalled: run.status === 'running' && now - run.updatedAt.getTime() > STALE_RUNNER_MS,
    aiCalls: aiByRun.get(run.id)?.calls ?? 0,
    aiCostUsd: aiByRun.get(run.id)?.cost ?? 0,
  }));
}

function readQueryBudget(paramsJson: unknown): number | null {
  const value = paramsJson && typeof paramsJson === 'object' ? (paramsJson as { queryBudget?: unknown }).queryBudget : null;
  return typeof value === 'number' ? value : null;
}

/**
 * The workspace's tabs for one run, counted over every candidate in it. They used to be counted in
 * the browser from the first 200 rows, beside an "All" counted on the server.
 *
 * review = not yet promoted from this run; pipeline = promoted here or already promoted in an
 * earlier run; dismissed; all = every candidate. Review and Pipeline overlap on purpose: a prospect
 * already in the library stays reviewable so it can join another campaign (the Phase 4 contract),
 * and it is badged "Already in prospect library" there.
 */
export type CandidateTabCounts = { review: number; pipeline: number; dismissed: number; all: number };

async function candidateTabCounts(tenantId: string, runId: string, verification?: VerificationFilter): Promise<CandidateTabCounts> {
  // Counted within the verification view on screen, so "Needs review (12)" is twelve rows the rep can see.
  const rows = await prisma.researchCandidate.findMany({
    where: { tenantId, runId, ...verificationWhere(verification) },
    select: { status: true, dedupeFingerprint: true },
  });
  const fingerprints = Array.from(new Set(rows.map((row) => row.dedupeFingerprint)));
  const taken = new Set(
    fingerprints.length
      ? (
          await prisma.researchProspect.findMany({
            where: { tenantId, dedupeFingerprint: { in: fingerprints }, promotedAccountId: { not: null } },
            select: { dedupeFingerprint: true },
          })
        ).map((entry) => entry.dedupeFingerprint)
      : []
  );
  const counts: CandidateTabCounts = { review: 0, pipeline: 0, dismissed: 0, all: rows.length };
  for (const row of rows) {
    if (row.status === 'promoted' || taken.has(row.dedupeFingerprint)) counts.pipeline += 1;
    if (row.status === 'dismissed') counts.dismissed += 1;
    if (row.status === 'discovered') counts.review += 1;
  }
  return counts;
}

export type CandidateListQuery = {
  runId?: string;
  status?: string;
  minFitScore?: number;
  /** Hides candidates whose fingerprint was already promoted in an earlier run. */
  hidePreviouslyPromoted?: boolean;
  /**
   * Which verification band to list (2026-10-08). `shortlist` — checked and fitting or worth a look,
   * plus rows from before verification existed — is what a rep works; `rejected`, `unverified` and
   * `pending` are shown on request, never mixed into it.
   */
  verification?: VerificationFilter;
  page?: number;
  pageSize?: number;
};

export async function listResearchCandidates(query: CandidateListQuery, tenantId: string) {
  const pageSize = Math.min(query.pageSize ?? 50, 200);
  const page = Math.max(query.page ?? 1, 1);

  const where: Record<string, unknown> = { tenantId };
  if (query.runId) where.runId = query.runId;
  if (query.status) where.status = query.status;
  if (typeof query.minFitScore === 'number') where.fitScore = { gte: query.minFitScore };
  Object.assign(where, verificationWhere(query.verification));

  const [rows, total, grouped] = await Promise.all([
    prisma.researchCandidate.findMany({
      where: where as never,
      // Verified fits first, then those worth a look (enum order), then fit descending, then newest: the
      // operator reads the top of the list and stops. Unverified legacy rows (null) sort last.
      orderBy: [{ verification: { sort: 'asc', nulls: 'last' } }, { fitScore: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, runId: true, kind: true, status: true, name: true, domain: true,
        linkedinUrl: true, title: true, companyName: true, location: true,
        fitScore: true, fitReason: true, fitSource: true, emailGuess: true,
        dedupeFingerprint: true, promotedAccountId: true, promotedContactId: true,
        createdAt: true, verification: true, verificationReason: true, verificationJson: true,
      },
    }),
    prisma.researchCandidate.count({ where: where as never }),
    prisma.researchCandidate.groupBy({
      by: ['status'],
      where: { tenantId, ...(query.runId ? { runId: query.runId } : {}) },
      _count: { _all: true },
    }),
  ]);

  const counts = Object.fromEntries(
    grouped.map((entry) => [entry.status, entry._count._all]),
  ) as Record<string, number>;
  const tabCounts = query.runId ? await candidateTabCounts(tenantId, query.runId, query.verification) : null;
  const verificationCounts = query.runId ? await candidateVerificationCounts(tenantId, query.runId) : null;
  if (rows.length === 0) return { items: [], total, page, pageSize, counts, tabCounts, verificationCounts };

  // "Already taken in an earlier run" is a property of the fingerprint, not of this run's row, so it
  // needs the ledger. Without it a weekly run re-offers everything the team already imported.
  const ledger = await prisma.researchProspect.findMany({
    where: {
      tenantId,
      dedupeFingerprint: { in: rows.map((r) => r.dedupeFingerprint) },
      promotedAccountId: { not: null },
    },
    select: { dedupeFingerprint: true },
  });
  const taken = new Set(ledger.map((entry) => entry.dedupeFingerprint));

  const annotated = rows.map((row) => ({
    ...row,
    previouslyPromoted: taken.has(row.dedupeFingerprint),
  }));
  const items = query.hidePreviouslyPromoted
    ? annotated.filter((row) => !row.previouslyPromoted)
    : annotated;

  return { items, total, page, pageSize, counts, tabCounts, verificationCounts };
}

export const VERIFICATION_FILTERS = ['shortlist', 'rejected', 'unverified', 'pending', 'all'] as const;
export type VerificationFilter = (typeof VERIFICATION_FILTERS)[number];

function verificationWhere(view: VerificationFilter | undefined): Record<string, unknown> {
  if (view === 'shortlist') return { OR: [{ verification: { in: ['verified_fit', 'needs_review'] } }, { verification: null }] };
  if (view && view !== 'all') return { verification: view };
  return {};
}

export type CandidateVerificationCounts = Record<Exclude<VerificationFilter, 'all'>, number> & { retryable: number };

/** Counted over the whole run, so the verification filters add up whatever page is showing. */
async function candidateVerificationCounts(tenantId: string, runId: string): Promise<CandidateVerificationCounts> {
  const grouped = await prisma.researchCandidate.groupBy({
    by: ['verification', 'verificationReason'],
    where: { tenantId, runId },
    _count: { _all: true },
  });
  const counts: CandidateVerificationCounts = { shortlist: 0, rejected: 0, unverified: 0, pending: 0, retryable: 0 };
  for (const row of grouped) {
    const n = row._count._all;
    if (row.verification === 'verified_fit' || row.verification === 'needs_review' || row.verification === null) counts.shortlist += n;
    else counts[row.verification] += n;
    // Unchecked for a reason another try can fix: what "Check again" would reopen.
    if (row.verification === 'unverified' && (INFRA_REASONS as readonly string[]).includes(row.verificationReason ?? '')) counts.retryable += n;
  }
  return counts;
}

/**
 * Attempts the drawer shows for a candidate: its own, plus the discovery attempts of the run
 * that surfaced it (those carry `runId` and no `candidateId`). `tenantId` sits above the OR so
 * both arms are tenant-bound, and `runId` is required on ResearchCandidate so the run arm can
 * never widen to "any run". Exported for the test that pins exactly that.
 */
export function candidateAttemptsWhere(input: {
  tenantId: string;
  candidateId: string;
  runId: string;
}): Prisma.ResearchProviderAttemptWhereInput {
  return {
    tenantId: input.tenantId,
    OR: [{ candidateId: input.candidateId }, { candidateId: null, runId: input.runId }],
  };
}

function tallyByProvider(rows: Array<{ provider: string; status: string; _count: { _all: number } }>) {
  const byProvider = new Map<string, { provider: string; ok: number; failed: number }>();
  for (const row of rows) {
    const entry = byProvider.get(row.provider) ?? { provider: row.provider, ok: 0, failed: 0 };
    if (row.status === 'ok') entry.ok += row._count._all;
    else entry.failed += row._count._all;
    byProvider.set(row.provider, entry);
  }
  return [...byProvider.values()].sort((a, b) => b.ok + b.failed - (a.ok + a.failed));
}

/** Everything the evidence drawer shows for one candidate. */
export async function getCandidateEvidence(candidateId: string, tenantId: string) {
  const candidate = await prisma.researchCandidate.findFirst({
    where: { id: candidateId, tenantId },
    select: {
      id: true, name: true, domain: true, linkedinUrl: true, title: true, companyName: true,
      location: true, fitScore: true, fitReason: true, fitSource: true, status: true,
      matchHintsJson: true, sourceJson: true, promotedAccountId: true, promotedContactId: true,
      runId: true,
    },
  });
  if (!candidate) return null;
  const { runId, ...candidateView } = candidate;

  const [evidence, attempts, runTally, ledger] = await Promise.all([
    prisma.researchEvidence.findMany({
      where: { tenantId, candidateId },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: {
        id: true, sourceKind: true, provider: true, sourceUrl: true,
        sourceTitle: true, sourceSnippet: true, query: true, confidence: true, observedAt: true,
      },
    }),
    // Discovery attempts carry the run, not the candidate — the candidate does not exist until the
    // query has returned. Filtering on candidateId alone showed "Provider attempts (0)" for every
    // candidate that had not been enriched yet, under a ledger full of evidence from those very
    // queries. Candidate-scoped attempts still come first; the run's own follow.
    // This candidate's own lookups, listed. The run's searches are a tally, counted over all of
    // them: reading the oldest 50 of both together let the run's discovery attempts crowd out the
    // candidate's own, and made a "whole run" tally out of its first few queries.
    prisma.researchProviderAttempt.findMany({
      where: { tenantId, candidateId },
      orderBy: { startedAt: 'asc' },
      take: 50,
      select: { id: true, stage: true, provider: true, status: true, startedAt: true, finishedAt: true, candidateId: true },
    }),
    prisma.researchProviderAttempt.groupBy({
      by: ['provider', 'status'],
      where: { tenantId, runId, candidateId: null },
      _count: { _all: true },
    }),
    prisma.researchCandidate
      .findFirst({ where: { id: candidateId, tenantId }, select: { dedupeFingerprint: true } })
      .then((row) =>
        row
          ? prisma.researchProspect.findFirst({
              where: { tenantId, dedupeFingerprint: row.dedupeFingerprint },
              select: { timesSeen: true, firstSeenAt: true, lastSeenAt: true, promotedAccountId: true },
            })
          : null
      ),
  ]);

  return {
    candidate: candidateView,
    evidence,
    attempts: attempts.map(({ candidateId: attemptCandidateId, ...attempt }) => ({
      ...attempt,
      runScoped: attemptCandidateId === null,
    })),
    runAttemptTally: tallyByProvider(runTally),
    history: ledger,
  };
}
