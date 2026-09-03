import { prisma } from '@/lib/prisma';

// Read models for the research surface.
//
// Kept apart from the pipeline so the UI can never reach a write path, and so every list here carries
// its tenant filter explicitly rather than inheriting one from a caller.

export type ResearchRunRow = {
  id: string;
  kind: string;
  status: string;
  totalQueries: number;
  queryCursor: number;
  discoveredCount: number;
  duplicateCount: number;
  promotedCount: number;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  errorMessage: string | null;
};

export async function listResearchRuns(tenantId: string, limit = 50): Promise<ResearchRunRow[]> {
  const runs = await prisma.researchRun.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 200),
    select: {
      id: true, kind: true, status: true, queriesJson: true, queryCursor: true,
      discoveredCount: true, duplicateCount: true, createdAt: true,
      startedAt: true, finishedAt: true, errorMessage: true,
      _count: { select: { candidates: true } },
    },
  });

  // Promoted counts come from one grouped query rather than a per-run count: a list of 50 runs would
  // otherwise fire 50 extra round trips to render one column.
  const promoted = await prisma.researchCandidate.groupBy({
    by: ['runId'],
    where: { tenantId, status: 'promoted', runId: { in: runs.map((r) => r.id) } },
    _count: { _all: true },
  });
  const promotedByRun = new Map(promoted.map((p) => [p.runId, p._count._all]));

  return runs.map((run) => ({
    id: run.id,
    kind: run.kind,
    status: run.status,
    totalQueries: Array.isArray(run.queriesJson) ? run.queriesJson.length : 0,
    queryCursor: run.queryCursor,
    discoveredCount: run.discoveredCount,
    duplicateCount: run.duplicateCount,
    promotedCount: promotedByRun.get(run.id) ?? 0,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    errorMessage: run.errorMessage,
  }));
}

export type CandidateListQuery = {
  runId?: string;
  status?: string;
  minFitScore?: number;
  /** Hides candidates whose fingerprint was already promoted in an earlier run. */
  hidePreviouslyPromoted?: boolean;
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

  const [rows, total] = await Promise.all([
    prisma.researchCandidate.findMany({
      where: where as never,
      // Fit descending, then newest: the whole point of the heuristic score is that the operator reads
      // the top of the list and stops.
      orderBy: [{ fitScore: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, runId: true, kind: true, status: true, name: true, domain: true,
        linkedinUrl: true, title: true, companyName: true, location: true,
        fitScore: true, fitReason: true, fitSource: true, emailGuess: true,
        dedupeFingerprint: true, promotedAccountId: true, promotedContactId: true,
        createdAt: true,
      },
    }),
    prisma.researchCandidate.count({ where: where as never }),
  ]);

  if (!query.hidePreviouslyPromoted || rows.length === 0) {
    return { items: rows.map((row) => ({ ...row, previouslyPromoted: false })), total, page, pageSize };
  }

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

  const items = rows
    .map((row) => ({ ...row, previouslyPromoted: taken.has(row.dedupeFingerprint) }))
    .filter((row) => !row.previouslyPromoted);

  return { items, total, page, pageSize };
}

/** Everything the evidence drawer shows for one candidate. */
export async function getCandidateEvidence(candidateId: string, tenantId: string) {
  const candidate = await prisma.researchCandidate.findFirst({
    where: { id: candidateId, tenantId },
    select: {
      id: true, name: true, domain: true, linkedinUrl: true, title: true, companyName: true,
      location: true, fitScore: true, fitReason: true, fitSource: true, status: true,
      matchHintsJson: true, sourceJson: true, promotedAccountId: true, promotedContactId: true,
    },
  });
  if (!candidate) return null;

  const [evidence, attempts, ledger] = await Promise.all([
    prisma.researchEvidence.findMany({
      where: { tenantId, candidateId },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: {
        id: true, sourceKind: true, provider: true, sourceUrl: true,
        sourceTitle: true, sourceSnippet: true, query: true, confidence: true, observedAt: true,
      },
    }),
    prisma.researchProviderAttempt.findMany({
      where: { tenantId, candidateId },
      orderBy: { startedAt: 'asc' },
      take: 50,
      select: { id: true, stage: true, provider: true, status: true, startedAt: true, finishedAt: true },
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

  return { candidate, evidence, attempts, history: ledger };
}
