import { Prisma } from '@prisma/client';

import {
  buildCompanyDiscoveryQueries,
  buildContactDiscoveryQueries,
  buildQueriesFromBuilderParams,
  normalizeResearchQueryLimit,
  personaTitlesOf,
  type DiscoveryQuery,
  type ResearchBuilderParams,
} from '@telestar/core-research/buildDiscoveryQueries';
import { isCandidateExcludedByIcp } from '@telestar/core-research/icpDiscoveryFilter';
import {
  parseCompanyHitsDetailed,
  parseContactHits,
  type CompanyHitRejections,
  type ParsedCandidate,
  type RawSearchHit,
} from '@telestar/core-research/parseDiscoveryResults';
import { OFF_PERSONA_SCORE_CAP, scoreCandidateHeuristic } from '@telestar/core-research/scoreCandidates';
import { runQueryAcrossProviders, type SearchDeps } from '@telestar/core-search/search/companyIntelSearch';
import { resolveUsableProviderChain } from '@telestar/core-search/search/env';

import { prisma } from '@/lib/prisma';

import { applyAiFit, type AiFitCandidate } from './aiFit';
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

/** How often a working pass touches its run row while it does work that writes nothing else. */
const HEARTBEAT_MS = 60_000;

export type CreateRunInput = {
  tenantId: string;
  kind: ResearchRunKind;
  createdById?: string | null;
  campaignId?: string | null;
  icpVersionId?: string | null;
  /** Free-form builder params. When absent the queries come from the ICP rules. */
  builderParams?: ResearchBuilderParams | null;
  queryLimit?: number;
  /** Re-rank each pass's new candidates with the AI-fit layer (`lib/research/aiFit.ts`). */
  aiFit?: boolean;
};

export async function planResearchRunQueries(
  input: Omit<CreateRunInput, 'createdById'>,
): Promise<DiscoveryQuery[]> {
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

  // Builder mode can emit more queries than the requested budget. Apply the
  // same hard cap after either construction path so payload shape cannot bypass it.
  queries = queries.slice(0, limit);

  // A run with no queries would sit "queued" forever looking like a stuck worker. It is a bad
  // request, and saying so at creation is the only place a human is still watching.
  if (queries.length === 0) {
    throw new Error('No discovery queries could be built — the ICP or builder params are empty');
  }

  return queries;
}

export async function createResearchRun(input: CreateRunInput): Promise<{ id: string; queries: number }> {
  const queries = await planResearchRunQueries(input);
  const { tenantId, kind } = input;

  const run = await prisma.researchRun.create({
    data: {
      tenantId,
      kind,
      status: 'queued',
      icpVersionId: input.icpVersionId ?? null,
      campaignId: input.campaignId ?? null,
      createdById: input.createdById ?? null,
      queriesJson: queries as never,
      // The only reader is the pass, for `aiFit`. Builder params ride along for the record, and an
      // ICP-mode run that asked for AI fit stores just the flag.
      // `queryBudget` is the size asked for; `queriesJson.length` is what the ICP's terms made of it.
      paramsJson: {
        ...(input.builderParams ?? {}),
        ...(input.aiFit ? { aiFit: true } : {}),
        queryBudget: normalizeResearchQueryLimit(input.queryLimit),
      } as never,
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
  /**
   * Set only when the run finished broken: either there was no usable provider to search with, or
   * every provider that was asked failed and nothing was found. Null on an honestly empty run.
   */
  errorMessage?: string | null;
};

/**
 * Why a run that worked found no companies, in words an operator can act on. Production's FMCG run
 * (2026-10-07) found nothing and said only "succeeded"; the cause was a size band typed into every
 * query as a quoted phrase no page contains.
 */
export function describeEmptyRun(input: { queriesRun: number; hitsSeen: number; filtered: CompanyHitRejections; rejectedByIcp: number }): string {
  const { queriesRun, hitsSeen, filtered, rejectedByIcp } = input;
  if (hitsSeen === 0) {
    return `No companies found: the search returned nothing for ${queriesRun} quer${queriesRun === 1 ? 'y' : 'ies'}. ` +
      'Try fewer or broader keywords, or more countries.';
  }
  const parts = [
    filtered.notACompanySite && `${filtered.notACompanySite} directory, research, news or job site(s)`,
    filtered.institutional && `${filtered.institutional} government or education site(s)`,
    filtered.roundup && `${filtered.roundup} "top companies" list(s) or market report(s)`,
    rejectedByIcp && `${rejectedByIcp} company(ies) the ICP excludes`,
    filtered.duplicate && `${filtered.duplicate} repeat(s) of a company already found`,
  ].filter(Boolean);
  return `No companies found: ${hitsSeen} result(s) came back, and none was a prospect company` +
    (parts.length ? ` — ${parts.join(', ')}.` : '.') +
    ' Try naming what the companies do (e.g. "aircraft maintenance") rather than a category word.';
}

function describeProviderFailures(failures: Map<string, number | null>): string {
  const detail = [...failures.entries()]
    .map(([provider, status]) => (status ? `${provider} ${status}` : provider))
    .join(', ');
  return `Search providers rejected the queries (${detail}). Check the provider API keys and credit.`;
}

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
    select: { id: true, kind: true, status: true, queriesJson: true, queryCursor: true, icpVersionId: true, paramsJson: true },
  });
  if (!run) throw new Error('Research run not found in this tenant');

  const queries = readQueries(run.queriesJson);
  const rules = await loadRules(tenantId, run.icpVersionId);
  // Judged against the run's whole persona set, not only the query that surfaced a candidate: a CTO
  // found by the "CEO" query is on-persona when the run also searched for CTOs.
  const personaTitles = personaTitlesOf(queries);
  const aiFitRequested = readAiFitFlag(run.paramsJson);
  const createdThisPass: AiFitCandidate[] = [];

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
  // Raw results the providers returned, before parsing. The difference between "the web had
  // nothing" and "nothing we got back was readable" is only visible here.
  let hitsSeen = 0;
  // Results refused as prospects, by reason (directory/research/job site, government or education,
  // roundup page). An empty run reports these, so "nothing found" says what was found instead.
  const filtered: CompanyHitRejections = { notACompanySite: 0, institutional: 0, roundup: 0, duplicate: 0, unreadable: 0 };
  const providerFailures = new Map<string, number | null>();
  const deps = params.deps ?? searchDepsFor({ tenantId, runId, stage: 'discovery' });

  // A run with nowhere to search has to say so, before it spends anything.
  //
  // `COMPANY_INTEL_SEARCH_ENABLED` defaults to false, and with it off `resolveUsableProviderChain`
  // returns an empty chain. The harvest loop then queries nothing, so no provider can fail, so
  // `providerFailures` stays empty — and the completion check below, which only calls a run broken
  // when a provider *failed*, marked the whole thing `succeeded` with zero candidates and a green
  // toast. The comment there warns that a dead API key spends a week looking like a narrow ICP;
  // having no provider at all slipped past the guard entirely and looked the same way.
  //
  // Only checked when the chain came from the environment. Tests inject `deps` with their own
  // providers, and the env says nothing about those.
  if (!params.deps && resolveUsableProviderChain().length === 0) {
    const errorMessage =
      'No usable search provider. Set COMPANY_INTEL_SEARCH_ENABLED=true and configure at least one ' +
      'provider: DDG_SEARCH_ENABLED=true (free, no key), SEARXNG_URL, or an EXA_API_KEY / ' +
      'BRAVE_SEARCH_API_KEY / SERPER_API_KEY.';
    await prisma.researchRun.updateMany({
      where: { id: runId, tenantId },
      data: { status: 'failed', errorMessage, finishedAt: new Date() },
    });
    return { ...result, finished: true, errorMessage };
  }

  while (cursor < queries.length && result.queriesRun < budget) {
    const query = queries[cursor];
    let harvested: Awaited<ReturnType<typeof harvestQuery>> = {
      discovered: 0,
      duplicates: 0,
      rejected: 0,
      hits: 0,
      providerFailures: new Map(),
    };
    try {
      harvested = await harvestQuery({
        tenantId,
        runId,
        kind: run.kind as ResearchRunKind,
        query,
        rules,
        deps,
        personaTitles,
        created: createdThisPass,
      });
    } catch (error) {
      // A dead provider or a malformed SERP page kills one query, not the run. The attempt is already
      // recorded by the gateway, so the failure is visible without stopping the other 49 queries.
      console.error('[research] query failed', { runId, query: query.query, error });
      // A throw is not a provider answering badly — it is the query never completing. It counts as a
      // hard failure so a run that threw on every query cannot report itself successful.
      harvested.providerFailures.set('pipeline', null);
    }

    for (const [provider, status] of harvested.providerFailures) {
      if (!providerFailures.has(provider)) providerFailures.set(provider, status);
    }

    result.discovered += harvested.discovered;
    result.duplicates += harvested.duplicates;
    result.rejected += harvested.rejected;
    hitsSeen += harvested.hits;
    for (const [reason, count] of Object.entries(harvested.filtered ?? {})) filtered[reason as keyof CompanyHitRejections] += count;
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

  // Re-rank what this pass found, before the run can be marked finished — a `succeeded` run is one
  // whose scores are final. Advisory: any failure leaves the heuristic scores standing.
  if (aiFitRequested && createdThisPass.length > 0) {
    // The cursor write is the run's heartbeat, and re-ranking writes none. A slow model would let the
    // row go quiet past STALE_RUNNER_MS, the UI would offer Resume, and a second slice would run the
    // same cursor beside this one. Touch the row while it works.
    const heartbeat = setInterval(() => {
      void prisma.researchRun
        .updateMany({ where: { id: runId, tenantId, status: 'running' }, data: { updatedAt: new Date() } })
        .catch((error) => console.error('[research] heartbeat failed', { runId, error }));
    }, HEARTBEAT_MS);
    try {
      const signals = Array.from(new Set(queries.flatMap((q) => q.hints))).slice(0, 40);
      await applyAiFit({
        tenantId,
        runId,
        kind: run.kind as ResearchRunKind,
        targetSignals: signals,
        personaTitles,
        candidates: createdThisPass,
      });
    } catch (error) {
      console.error('[research] AI fit failed; heuristic scores kept', { runId, error });
    } finally {
      clearInterval(heartbeat);
    }
  }

  result.finished = cursor >= queries.length;
  if (result.finished) {
    // The counter on the row, not this pass's tally: a run finished across several passes may have
    // found everything it found in an earlier one.
    const candidateRows = await prisma.researchCandidate.count({ where: { runId, tenantId } });

    // Zero candidates plus at least one provider that hard-failed is a broken run, not an empty one.
    // Reporting it as `succeeded` is how a dead API key spends a week looking like a narrow ICP.
    const nothingFound = candidateRows === 0;
    const providersBroke = providerFailures.size > 0;

    // The other way to find nothing while everything reports fine: the providers answered, and the
    // parser threw every result away. A contact run did exactly this in production — Exa was asked
    // for a category it does not have, with a `site:` operator a neural engine does not honour, so
    // it returned 200 and pages that were not profiles. `succeeded` with zero candidates reads as
    // "the ICP is narrow"; it was misconfiguration. An ICP rejection is not this: that is the
    // filter working, and it is counted separately.
    const parsedNothing = nothingFound && hitsSeen > 0 && result.duplicates === 0 && result.rejected === 0;
    const filteredTotal = Object.values(filtered).reduce((sum, n) => sum + n, 0);

    const brokenRun = nothingFound && (providersBroke || parsedNothing);
    result.errorMessage = brokenRun
      ? providersBroke
        ? describeProviderFailures(providerFailures)
        : filteredTotal > 0
          ? // Say what the results were — directories, research sites, roundups — not just that none
            // of them counted, so the operator knows to reword the search rather than widen it.
            describeEmptyRun({ queriesRun: cursor, hitsSeen, filtered, rejectedByIcp: result.rejected })
          : `Providers returned ${hitsSeen} result(s) and none could be read as a ${run.kind === 'contact' ? 'person' : 'company'}. ` +
            'Check the query plan and the provider category before treating this as an empty market.'
      : nothingFound
        ? // Not broken, and still not silent: a run that found nothing says what it saw (production,
          // 2026-10-07: an FMCG run of four queries found nothing and said only "succeeded").
          describeEmptyRun({ queriesRun: cursor, hitsSeen, filtered, rejectedByIcp: result.rejected })
        : null;

    await prisma.researchRun.updateMany({
      where: { id: runId, tenantId },
      data: {
        status: brokenRun ? 'failed' : 'succeeded',
        errorMessage: result.errorMessage,
        finishedAt: new Date(),
      },
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
  personaTitles?: string[];
  /** Collects every candidate this query created, for the AI-fit re-rank at the end of the pass. */
  created?: AiFitCandidate[];
}): Promise<{ discovered: number; duplicates: number; rejected: number; hits: number; filtered?: CompanyHitRejections; providerFailures: Map<string, number | null> }> {
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

  // A provider that answered with nothing is a real, empty result. A provider that returned 401, timed
  // out, or could not be reached answered nothing at all, and the difference decides whether a run of
  // zero candidates means "the ICP matched nothing" or "the API key is dead".
  const providerFailures = new Map<string, number | null>();
  for (const attempt of response.attempts) {
    if (attempt.status !== 'ok' && !providerFailures.has(attempt.provider)) {
      providerFailures.set(attempt.provider, attempt.httpStatus ?? null);
    }
  }

  const companyParse = kind === 'company' ? parseCompanyHitsDetailed(query.query, hits) : null;
  const parsed = companyParse ? companyParse.candidates : parseContactHits(query.query, hits);

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

    const outcome = await persistCandidate({
      tenantId,
      runId,
      kind,
      query,
      candidate,
      personaTitles: input.personaTitles ?? [],
    });
    if (outcome.status === 'created') {
      discovered += 1;
      input.created?.push({
        id: outcome.id,
        name: candidate.name,
        title: candidate.title,
        companyName: candidate.companyName,
        domain: candidate.domain,
        snippet: candidate.source.snippet,
        offPersona: outcome.offPersona,
        heuristicScore: outcome.score,
      });
    } else duplicates += 1;
  }

  return { discovered, duplicates, rejected, hits: hits.length, filtered: companyParse?.rejected, providerFailures };
}

async function persistCandidate(input: {
  tenantId: string;
  runId: string;
  kind: ResearchRunKind;
  query: DiscoveryQuery;
  candidate: ParsedCandidate;
  personaTitles: string[];
}): Promise<{ status: 'created'; id: string; offPersona: boolean; score: number } | { status: 'duplicate' }> {
  const { tenantId, runId, kind, query, candidate } = input;
  const hints = query.hints ?? [];
  const fit = scoreCandidateHeuristic(candidate, hints, { personaTitles: input.personaTitles });
  // A titled contact the heuristic put under the persona cap is off-persona; the AI layer may not
  // lift it back over.
  const offPersona =
    candidate.kind === 'CONTACT' &&
    input.personaTitles.length > 0 &&
    Boolean(candidate.title?.trim()) &&
    fit.score <= OFF_PERSONA_SCORE_CAP;

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

  if (!created) return { status: 'duplicate' };

  await recordEvidence(tenantId, runId, created.id, query.query, candidate);
  return { status: 'created', id: created.id, offPersona, score: fit.score };
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
    const titleHint = typeof obj.titleHint === 'string' && obj.titleHint.trim() ? obj.titleHint : undefined;
    return [{ query, hints, ...(titleHint ? { titleHint } : {}) }];
  });
}

function readAiFitFlag(paramsJson: unknown): boolean {
  return Boolean(paramsJson && typeof paramsJson === 'object' && (paramsJson as { aiFit?: unknown }).aiFit === true);
}

async function loadRules(tenantId: string, icpVersionId: string | null): Promise<unknown | null> {
  if (!icpVersionId) return null;
  const version = await prisma.icpVersion.findFirst({
    where: { id: icpVersionId, tenantId },
    select: { rulesJson: true },
  });
  return version?.rulesJson ?? null;
}
