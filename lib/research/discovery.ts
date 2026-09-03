import { Prisma } from '@prisma/client';

import {
  buildCompanyDiscoveryQueries,
  buildContactDiscoveryQueries,
  buildQueriesFromBuilderParams,
  normalizeResearchQueryLimit,
  type DiscoveryQuery,
  type ResearchBuilderParams,
} from '@telestar/core-research/buildDiscoveryQueries';
import { isCandidateExcludedByIcp } from '@telestar/core-research/icpDiscoveryFilter';
import {
  parseCompanyHits,
  parseContactHits,
  type ParsedCandidate,
  type RawSearchHit,
} from '@telestar/core-research/parseDiscoveryResults';
import { scoreCandidateHeuristic } from '@telestar/core-research/scoreCandidates';
import { runQueryAcrossProviders, type SearchDeps } from '@telestar/core-search/search/companyIntelSearch';

import { prisma } from '@/lib/prisma';

import { searchDepsFor } from './searchGateway';

// Discovery: find companies and people the CRM has never seen.
//
// This is the half the CRM was missing. `lib/research/engine.ts` and the two research caches enrich a
// record that already exists; nothing here replaces them. Discovery runs the other direction — search
// the open web from an ICP, reject the junk, and only then does a record exist at all.
//
// The pipeline is harvest → reject → dedupe → score, and every stage is deterministic. No AI decides
// whether a candidate is real; an AI-fit layer may re-rank later, which is why `fitSource` is stored
// next to the score.

/** One pass scores at most this many queries so a run cannot hold a worker indefinitely. */
export const DISCOVERY_QUERY_BATCH = 10;

/**
 * The CRM stores enums lowercase; `@telestar/core-research` speaks `COMPANY` / `CONTACT`. The
 * translation lives here rather than reshaping either side — the package is shared with the leadgen
 * app, and the CRM's enum casing is a convention every other model already follows.
 */
export type ResearchRunKind = 'company' | 'contact';

const PACKAGE_KIND = { company: 'COMPANY', contact: 'CONTACT' } as const;

export type CreateRunInput = {
  tenantId: string;
  kind: ResearchRunKind;
  createdById?: string | null;
  campaignId?: string | null;
  icpVersionId?: string | null;
  /** Free-form builder params. When absent the queries come from the ICP rules. */
  builderParams?: ResearchBuilderParams | null;
  queryLimit?: number;
};

export async function createResearchRun(input: CreateRunInput): Promise<{ id: string; queries: number }> {
  const { tenantId, kind } = input;
  const limit = normalizeResearchQueryLimit(input.queryLimit);

  let queries: DiscoveryQuery[] = [];
  if (input.builderParams) {
    queries = buildQueriesFromBuilderParams(PACKAGE_KIND[kind], input.builderParams);
  } else if (input.icpVersionId) {
    const version = await prisma.icpVersion.findFirst({
      where: { id: input.icpVersionId, tenantId },
      select: { rulesJson: true },
    });
    if (!version) throw new Error('ICP version not found in this tenant');
    queries =
      kind === 'company'
        ? buildCompanyDiscoveryQueries(version.rulesJson as never, limit)
        : buildContactDiscoveryQueries(version.rulesJson as never, limit);
  }

  // A run with no queries would sit "queued" forever looking like a stuck worker. It is a bad
  // request, and saying so at creation is the only place a human is still watching.
  if (queries.length === 0) {
    throw new Error('No discovery queries could be built — the ICP or builder params are empty');
  }

  const run = await prisma.researchRun.create({
    data: {
      tenantId,
      kind,
      status: 'queued',
      icpVersionId: input.icpVersionId ?? null,
      campaignId: input.campaignId ?? null,
      createdById: input.createdById ?? null,
      queriesJson: queries as never,
      paramsJson: (input.builderParams ?? null) as never,
    },
    select: { id: true },
  });

  return { id: run.id, queries: queries.length };
}

export type DiscoveryPassResult = {
  runId: string;
  queriesRun: number;
  discovered: number;
  duplicates: number;
  rejected: number;
  /** False while queries remain — the caller re-enqueues rather than looping unbounded. */
  finished: boolean;
};

/**
 * Runs one bounded pass over a run's queries, resuming from `queryCursor`.
 *
 * The cursor advances per query, not per pass, so a crash halfway loses at most the query in flight.
 * Re-running a completed query is safe anyway: candidates carry a unique
 * `(tenantId, runId, dedupeFingerprint)`, so a repeat is counted as a duplicate rather than inserted
 * twice.
 */
export async function runDiscoveryPass(params: {
  tenantId: string;
  runId: string;
  maxQueries?: number;
  /**
   * Provider chain override. Production builds it from the environment; tests pass a fixed one so the
   * harvest → reject → dedupe → score path can be exercised without paying a search provider or
   * depending on what the live web happens to return today.
   */
  deps?: SearchDeps;
}): Promise<DiscoveryPassResult> {
  const { tenantId, runId } = params;
  const budget = Math.max(1, Math.min(params.maxQueries ?? DISCOVERY_QUERY_BATCH, DISCOVERY_QUERY_BATCH));

  const run = await prisma.researchRun.findFirst({
    where: { id: runId, tenantId },
    select: { id: true, kind: true, status: true, queriesJson: true, queryCursor: true, icpVersionId: true },
  });
  if (!run) throw new Error('Research run not found in this tenant');

  const queries = readQueries(run.queriesJson);
  const rules = await loadRules(tenantId, run.icpVersionId);

  await prisma.researchRun.updateMany({
    where: { id: runId, tenantId, startedAt: null },
    data: { status: 'running', startedAt: new Date() },
  });

  const result: DiscoveryPassResult = {
    runId,
    queriesRun: 0,
    discovered: 0,
    duplicates: 0,
    rejected: 0,
    finished: false,
  };

  let cursor = run.queryCursor;
  const deps = params.deps ?? searchDepsFor({ tenantId, runId, stage: 'discovery' });

  while (cursor < queries.length && result.queriesRun < budget) {
    const query = queries[cursor];
    let harvested = { discovered: 0, duplicates: 0, rejected: 0 };
    try {
      harvested = await harvestQuery({
        tenantId,
        runId,
        kind: run.kind as ResearchRunKind,
        query,
        rules,
        deps,
      });
    } catch (error) {
      // A dead provider or a malformed SERP page kills one query, not the run. The attempt is already
      // recorded by the gateway, so the failure is visible without stopping the other 49 queries.
      console.error('[research] query failed', { runId, query: query.query, error });
    }

    result.discovered += harvested.discovered;
    result.duplicates += harvested.duplicates;
    result.rejected += harvested.rejected;
    cursor += 1;
    result.queriesRun += 1;

    // Incremented by this query's delta, not the running total — the row counts every query once, and
    // the cursor moves in the same write so a crash resumes where the counters already are.
    await prisma.researchRun.updateMany({
      where: { id: runId, tenantId },
      data: {
        queryCursor: cursor,
        discoveredCount: { increment: harvested.discovered },
        duplicateCount: { increment: harvested.duplicates },
      },
    });
  }

  result.finished = cursor >= queries.length;
  if (result.finished) {
    await prisma.researchRun.updateMany({
      where: { id: runId, tenantId },
      data: { status: 'succeeded', finishedAt: new Date() },
    });
  }

  return result;
}

async function harvestQuery(input: {
  tenantId: string;
  runId: string;
  kind: ResearchRunKind;
  query: DiscoveryQuery;
  rules: unknown | null;
  deps: SearchDeps;
}): Promise<{ discovered: number; duplicates: number; rejected: number }> {
  const { tenantId, runId, kind, query, rules, deps } = input;

  // `company_profile` is the widest of the chain's purposes — discovery is looking for who exists at
  // all, not for one specific fact about a company it already named. The category steers providers
  // that support it (Exa) towards company pages or people pages.
  const response = await runQueryAcrossProviders(
    { query: query.query, purpose: 'company_profile', category: kind === 'contact' ? 'people' : 'company' },
    deps
  );

  const hits: RawSearchHit[] = response.results.map((r) => ({
    title: r.title,
    url: r.url,
    // `highlight` is where Exa puts body text and where Brave puts extra_snippets; `snippet` is null
    // on Exa entirely. Preferring one over the other silently starved the parser of text.
    snippet: r.snippet ?? r.highlight ?? null,
    provider: r.provider,
  }));

  const parsed = kind === 'company' ? parseCompanyHits(query.query, hits) : parseContactHits(query.query, hits);

  let discovered = 0;
  let duplicates = 0;
  let rejected = 0;

  for (const candidate of parsed) {
    if (rules) {
      const exclusion = isCandidateExcludedByIcp(candidate, rules as never);
      if (exclusion.excluded) {
        rejected += 1;
        continue;
      }
    }

    const outcome = await persistCandidate({ tenantId, runId, kind, query, candidate });
    if (outcome === 'created') discovered += 1;
    else duplicates += 1;
  }

  return { discovered, duplicates, rejected };
}

async function persistCandidate(input: {
  tenantId: string;
  runId: string;
  kind: ResearchRunKind;
  query: DiscoveryQuery;
  candidate: ParsedCandidate;
}): Promise<'created' | 'duplicate'> {
  const { tenantId, runId, kind, query, candidate } = input;
  const hints = query.hints ?? [];
  const fit = scoreCandidateHeuristic(candidate, hints);

  let created: { id: string } | null = null;
  try {
    created = await prisma.researchCandidate.create({
      data: {
        tenantId,
        runId,
        kind,
        status: 'discovered',
        name: candidate.name,
        domain: candidate.domain,
        linkedinUrl: candidate.linkedinUrl,
        title: candidate.title,
        companyName: candidate.companyName,
        location: candidate.location,
        sourceJson: candidate.source as never,
        matchHintsJson: hints as never,
        dedupeFingerprint: candidate.dedupeFingerprint,
        fitScore: fit.score,
        fitReason: fit.reason,
        fitSource: 'heuristic',
      },
      select: { id: true },
    });
  } catch (error) {
    // The same company legitimately surfaces on several queries in one run. The unique constraint is
    // the dedupe, so losing the race is the expected path, not an error to report.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
  }

  await touchProspectLedger(tenantId, runId, kind, candidate);

  if (!created) return 'duplicate';

  await recordEvidence(tenantId, runId, created.id, query.query, candidate);
  return 'created';
}

/**
 * The cross-run ledger.
 *
 * Within a run the unique constraint dedupes. Across runs it answers "have we already surfaced this
 * company before, and did it ever get promoted" — without it, every weekly run re-presents the same
 * companies as if they were new.
 */
async function touchProspectLedger(
  tenantId: string,
  runId: string,
  kind: ResearchRunKind,
  candidate: ParsedCandidate
): Promise<void> {
  const now = new Date();
  await prisma.researchProspect.upsert({
    where: { tenantId_dedupeFingerprint: { tenantId, dedupeFingerprint: candidate.dedupeFingerprint } },
    create: {
      tenantId,
      kind,
      dedupeFingerprint: candidate.dedupeFingerprint,
      domain: candidate.domain,
      linkedinUrl: candidate.linkedinUrl,
      displayName: candidate.name,
      lastRunId: runId,
    },
    update: { lastSeenAt: now, timesSeen: { increment: 1 }, lastRunId: runId },
  });
}

async function recordEvidence(
  tenantId: string,
  runId: string,
  candidateId: string,
  query: string,
  candidate: ParsedCandidate
): Promise<void> {
  // Keyed on the candidate and the URL that produced it, so a re-run of the same query attaches the
  // same evidence row rather than a second copy of it.
  const idempotencyKey = `discovery:${runId}:${candidate.dedupeFingerprint}:${candidate.source.url}`;
  try {
    await prisma.researchEvidence.create({
      data: {
        tenantId,
        runId,
        candidateId,
        idempotencyKey,
        sourceKind: 'serp',
        provider: candidate.source.provider,
        sourceUrl: candidate.source.url,
        sourceTitle: candidate.name,
        sourceSnippet: candidate.source.snippet,
        query,
      },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
  }
}

function readQueries(json: unknown): DiscoveryQuery[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const obj = entry as Record<string, unknown>;
    const query = typeof obj.query === 'string' ? obj.query : null;
    if (!query) return [];
    const hints = Array.isArray(obj.hints) ? obj.hints.filter((h): h is string => typeof h === 'string') : [];
    return [{ ...(obj as object), query, hints } as DiscoveryQuery];
  });
}

async function loadRules(tenantId: string, icpVersionId: string | null): Promise<unknown | null> {
  if (!icpVersionId) return null;
  const version = await prisma.icpVersion.findFirst({
    where: { id: icpVersionId, tenantId },
    select: { rulesJson: true },
  });
  return version?.rulesJson ?? null;
}
