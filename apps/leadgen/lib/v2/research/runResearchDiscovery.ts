import "server-only";

import { randomBytes } from "node:crypto";

import { prisma } from "@/lib/server/prisma";
import { recordAuditEvent } from "@/lib/v2/audit";
import { normalizeCompanyName, normalizeIdentityDomain } from "@/lib/v2/identity";
import { upgradeSourceRulesToV2 } from "@/lib/v2/icp/authoring";
import {
  runQueryAcrossProviders,
  searchDepsFromEnv,
} from "@telestar/core-search/search/companyIntelSearch";
import type { V2JobDatabase } from "@/lib/v2/jobs/types";
import {
  buildCompanyDiscoveryQueries,
  buildContactDiscoveryQueries,
  buildQueriesFromBuilderParams,
  isEmptyResearchBuilderParams,
  normalizeResearchBuilderParams,
  RESEARCH_QUERY_PLAN_VERSION,
  DEFAULT_DISCOVERY_QUERY_LIMIT,
  normalizeResearchQueryLimit,
  type DiscoveryQuery,
  type ResearchBuilderParams,
} from "./buildDiscoveryQueries";
import { rerankResults } from "@telestar/core-search/search/rerankResults";
import { parseCompanyHits, parseContactHits, type ParsedCandidate, type RawSearchHit } from "./parseDiscoveryResults";
import { isCandidateExcludedByIcp } from "./icpDiscoveryFilter";
import type { IcpVersionRulesV2 } from "@telestar/core-scoring/rules/schema-v2";
import { lookupProspects, upsertProspects, wasSeenInPriorRun } from "./prospectLedger";
import { scoreCandidateHeuristic } from "./scoreCandidates";

// How far the opt-in AI re-rank may move a candidate away from the deterministic heuristic.
const AI_FIT_MAX_DEVIATION = 25;

/** Clamp the AI's score to a window around the deterministic one (AGENTS: AI output is not truth). */
export function boundAiFit(heuristicScore: number, aiScore: number): number {
  const low = Math.max(0, heuristicScore - AI_FIT_MAX_DEVIATION);
  const high = Math.min(100, heuristicScore + AI_FIT_MAX_DEVIATION);
  return Math.round(Math.min(high, Math.max(low, aiScore)));
}
import { scoreCandidatesWithAi, type AiFit } from "./scoreCandidatesWithAi";
import { filterLiveCandidates } from "./verifyCandidates";
import {
  buildResearchEvidenceKey,
  recordResearchEvidence,
  recordResearchFieldObservation,
  recordResearchProviderAttempt,
} from "./evidenceStore";
import { markResearchDiscoveryChunk, planResearchRuntime } from "./researchRuntimeBridge";

// The native discovery runtime. Runs are tenant-scoped, resumable by query cursor, and
// candidates are run-local (same prospect can be visible in multiple runs). Each durable
// RESEARCH_DISCOVERY job drains one bounded batch and enqueues the next cursor if needed.

const DEFAULT_RESEARCH_QUERY_BATCH_SIZE = 3;
const MAX_RESEARCH_QUERY_BATCH_SIZE = 5;

type ResearchRunRecord = {
  id: string;
  organizationId: string;
  icpVersionId: string;
  projectId: string;
  kind: "COMPANY" | "CONTACT";
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  queriesJson: unknown;
  paramsJson: unknown;
  queryCursor: number;
  discoveredCount: number;
  duplicateCount: number;
  errorMessage: string | null;
  createdByUserId: string | null;
};

export type CreateResearchRunResult =
  | { ok: true; runId: string; queries: DiscoveryQuery[] }
  | { ok: false; error: string };

export async function createResearchRun(input: {
  organizationId: string;
  actorUserId: string;
  icpVersionId: string;
  kind: "COMPANY" | "CONTACT";
  builderParams?: unknown;
  queryLimit?: unknown;
  aiFit?: boolean;
}): Promise<CreateResearchRunResult> {
  const icpRows = await prisma.$queryRaw<Array<{ id: string; rulesJson: unknown; projectId: string }>>`
    SELECT icp."id", icp."rulesJson", project."id" AS "projectId"
    FROM "V2ICPVersion" icp
    INNER JOIN "V2ICPProfile" profile
      ON profile."id" = icp."icpProfileId" AND profile."organizationId" = icp."organizationId" AND profile."status" = 'ACTIVE'
    INNER JOIN "V2Offer" offer
      ON offer."id" = profile."offerId" AND offer."organizationId" = icp."organizationId" AND offer."status" = 'ACTIVE'
    INNER JOIN "V2Project" project
      ON project."id" = offer."projectId" AND project."organizationId" = icp."organizationId" AND project."status" = 'ACTIVE'
    WHERE icp."organizationId" = ${input.organizationId}
      AND icp."id" = ${input.icpVersionId}
      AND icp."status" = 'PUBLISHED'
      AND icp."deletedAt" IS NULL
    LIMIT 1
  `;
  const icp = icpRows[0];
  if (!icp) return { ok: false, error: "Published ICP version not found." };

  let normalizedParams = normalizeResearchBuilderParams(input.builderParams);
  // Lookalike: crawl + comprehend the seed FIRST so peer queries search the seed's real
  // industry/offering, not its brand name (which just returns the seed itself).
  if (normalizedParams?.seed && normalizedParams.mode === "LOOKALIKE") {
    const { comprehendSeed } = await import("./comprehendSeed");
    const comp = await comprehendSeed({ name: normalizedParams.seed.name, domain: normalizedParams.seed.domain ?? null });
    normalizedParams = {
      ...normalizedParams,
      industries: Array.from(new Set([...normalizedParams.industries, ...comp.industries])),
      keywords: Array.from(new Set([...normalizedParams.keywords, ...comp.keywords])),
    };
  }
  const queryLimit = normalizedParams?.queryLimit ?? normalizeResearchQueryLimit(input.queryLimit);
  const useBuilder = normalizedParams && !isEmptyResearchBuilderParams(normalizedParams);
  const aiFit = input.aiFit ?? normalizedParams?.aiFit;
  const paramsToStore: ResearchBuilderParams = useBuilder && normalizedParams
    ? { ...normalizedParams, ...(typeof aiFit === "boolean" ? { aiFit } : {}) }
    : { queryPlanVersion: RESEARCH_QUERY_PLAN_VERSION, mode: "ICP", queryLimit, industries: [], keywords: [], titles: [], geos: [], seniority: [], excludeKeywords: [], excludeDomains: [], ...(typeof aiFit === "boolean" ? { aiFit } : {}) };
  const queries = useBuilder && normalizedParams ? buildQueriesFromBuilderParams(input.kind, normalizedParams) : buildQueriesForIcp(icp.rulesJson, input.kind, queryLimit);

  if (queries.length === 0) {
    return { ok: false, error: "This run has no valid search terms. Add ICP targets or builder filters first." };
  }

  const runId = createResearchRunId();
  await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "V2ResearchRun" (
      "id", "organizationId", "icpVersionId", "projectId", "kind", "status",
      "queriesJson", "paramsJson", "queryCursor", "createdByUserId", "createdAt", "updatedAt"
    )
    VALUES (
      ${runId}, ${input.organizationId}, ${input.icpVersionId}, ${icp.projectId}, ${input.kind}::"V2ResearchRunKind", 'QUEUED',
      ${JSON.stringify(queries)}::jsonb, ${JSON.stringify(paramsToStore)}::jsonb, 0, ${input.actorUserId}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    RETURNING "id"
  `;

  await planResearchRuntime({
    organizationId: input.organizationId,
    researchRunId: runId,
    projectId: icp.projectId,
    icpVersionId: input.icpVersionId,
    kind: input.kind,
    queryCount: queries.length,
    batchSize: researchBatchSize(),
    createdByUserId: input.actorUserId,
  });

  await enqueueResearchBatchJob(prisma as unknown as V2JobDatabase, {
    organizationId: input.organizationId,
    runId,
    cursor: 0,
    createdByUserId: input.actorUserId,
  });

  await recordAuditEvent(prisma, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    eventType: "research.run_created",
    entityType: "V2ResearchRun",
    entityId: runId,
    metadataJson: { kind: input.kind, icpVersionId: input.icpVersionId, queryCount: queries.length, queryLimit, mode: paramsToStore.mode },
  });
  return { ok: true, runId, queries };
}

export function buildQueriesForIcp(rulesJson: unknown, kind: "COMPANY" | "CONTACT", limit = DEFAULT_DISCOVERY_QUERY_LIMIT): DiscoveryQuery[] {
  try {
    const { rules } = upgradeSourceRulesToV2(rulesJson);
    const queryLimit = normalizeResearchQueryLimit(limit);
    return kind === "COMPANY" ? buildCompanyDiscoveryQueries(rules, queryLimit) : buildContactDiscoveryQueries(rules, queryLimit);
  } catch {
    return [];
  }
}

export async function enqueueResearchBatchJob(
  db: V2JobDatabase,
  input: { organizationId: string; runId: string; cursor: number; createdByUserId?: string | null }
) {
  const { enqueueV2Job } = await import("@/lib/v2/jobs/enqueueJob");
  return enqueueV2Job(db, {
    organizationId: input.organizationId,
    jobType: "RESEARCH_DISCOVERY",
    sourceType: "MANUAL",
    sourceId: input.runId,
    idempotencyKey: `research:${input.runId}:batch:${input.cursor}`,
    payload: { researchRunId: input.runId, cursor: input.cursor },
    createdByUserId: input.createdByUserId ?? null,
  });
}

async function enqueueResearchEnrichJob(
  db: V2JobDatabase,
  input: { organizationId: string; runId: string; candidateId: string; createdByUserId?: string | null }
) {
  const { enqueueV2Job } = await import("@/lib/v2/jobs/enqueueJob");
  return enqueueV2Job(db, {
    organizationId: input.organizationId,
    jobType: "RESEARCH_ENRICH",
    sourceType: "MANUAL",
    sourceId: input.runId,
    idempotencyKey: `research-enrich:${input.candidateId}`,
    payload: { candidateId: input.candidateId },
    createdByUserId: input.createdByUserId ?? null,
  });
}


type DomainResolutionSource = "parsed" | "scope_domain" | "existing_company" | "unresolved";

function readScopedDomain(paramsJson: unknown): string | null {
  if (!paramsJson || typeof paramsJson !== "object" || Array.isArray(paramsJson)) return null;
  const scope = (paramsJson as { scope?: unknown }).scope;
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return null;
  const raw = (scope as { domain?: unknown }).domain;
  return typeof raw === "string" && raw.trim() ? normalizeIdentityDomain(raw) : null;
}

async function resolveContactCandidateDomains(
  organizationId: string,
  values: Array<{ parsed: ParsedCandidate; hints: string[] }>,
  scopedDomain: string | null
): Promise<Array<{ parsed: ParsedCandidate; hints: string[]; domainResolutionSource?: DomainResolutionSource }>> {
  const needsExistingCompany = values.filter((value) =>
    value.parsed.kind === "CONTACT" &&
    !value.parsed.domain &&
    !scopedDomain &&
    Boolean(value.parsed.companyName?.trim())
  );
  const names = Array.from(new Set(needsExistingCompany
    .map((value) => normalizeCompanyName(value.parsed.companyName))
    .filter((name): name is string => Boolean(name))));
  const companyRows = names.length > 0
    ? await prisma.v2Company.findMany({
        where: {
          organizationId,
          nameNormalized: { in: names },
          canonicalDomain: { not: null },
          status: "ACTIVE",
          deletedAt: null,
        },
        select: { nameNormalized: true, canonicalDomain: true },
      })
    : [];
  const domainByName = new Map(companyRows
    .filter((row) => row.nameNormalized && row.canonicalDomain)
    .map((row) => [row.nameNormalized!, row.canonicalDomain!]));

  return values.map((value) => {
    const parsed = value.parsed;
    if (parsed.kind !== "CONTACT") {
      return { ...value, domainResolutionSource: parsed.domain ? "parsed" : "unresolved" };
    }
    if (parsed.domain) return { ...value, domainResolutionSource: "parsed" };
    if (scopedDomain) {
      return { ...value, parsed: { ...parsed, domain: scopedDomain }, domainResolutionSource: "scope_domain" };
    }
    const normalizedName = normalizeCompanyName(parsed.companyName);
    const existingDomain = normalizedName ? domainByName.get(normalizedName) ?? null : null;
    if (existingDomain) {
      return { ...value, parsed: { ...parsed, domain: existingDomain }, domainResolutionSource: "existing_company" };
    }
    return { ...value, domainResolutionSource: "unresolved" };
  });
}
function researchAutoEnrichTop(): number {
  const value = Number(process.env.RESEARCH_AUTOENRICH_TOP ?? 5);
  return Number.isInteger(value) && value >= 0 ? value : 5;
}

/** Auto-enrich the run's top-fit live company candidates into business insight. Idempotent per
 *  candidate (enqueue key), so re-running across batches converges on the run's top-N. */
async function enqueueTopFitEnrichment(organizationId: string, runId: string, kind: "COMPANY" | "CONTACT", createdByUserId: string | null) {
  if (kind !== "COMPANY") return;
  const top = researchAutoEnrichTop();
  if (top <= 0) return;
  const rows = await prisma.v2ResearchCandidate.findMany({
    where: { organizationId, runId, status: "DISCOVERED", deletedAt: null, enrichedAt: null, domain: { not: null } },
    orderBy: [{ fitScore: "desc" }, { createdAt: "asc" }],
    take: top,
    select: { id: true },
  });
  for (const row of rows) {
    await enqueueResearchEnrichJob(prisma as unknown as V2JobDatabase, { organizationId, runId, candidateId: row.id, createdByUserId });
  }
}

/** V2Job handler body: execute one run batch + harvest candidates. */
export async function executeResearchDiscovery(input: { organizationId: string; researchRunId: string }): Promise<{
  discovered: number;
  duplicates: number;
  cursor: number;
  totalQueries: number;
}> {
  const run = await loadResearchRun(input.organizationId, input.researchRunId);
  if (!run) throw new Error("Research run not found.");

  const queries = readQueries(run.queriesJson);
  const cursor = Math.max(0, Math.min(Number(run.queryCursor) || 0, queries.length));
  if (run.status === "SUCCEEDED" || run.queryCursor >= queries.length) {
    await finalizeRunCounts(run.id, input.organizationId, queries.length, true);
    return { discovered: run.discoveredCount, duplicates: run.duplicateCount, cursor: queries.length, totalQueries: queries.length };
  }

  const deps = searchDepsFromEnv();
  if (deps.providers.length === 0) {
    await markResearchDiscoveryChunk(input.organizationId, run.id, cursor, "FAILED", { errorCode: "RESEARCH_NO_PROVIDER" });
    await prisma.$queryRaw`
      UPDATE "V2ResearchRun"
      SET "status" = 'FAILED', "finishedAt" = CURRENT_TIMESTAMP,
          "errorMessage" = 'No search provider configured (EXA/BRAVE/SERPER key required).',
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${run.id} AND "organizationId" = ${input.organizationId}
    `;
    throw new Error("RESEARCH_NO_PROVIDER: configure a search provider API key.");
  }

  await prisma.$queryRaw`
    UPDATE "V2ResearchRun"
    SET "status" = 'RUNNING', "startedAt" = COALESCE("startedAt", CURRENT_TIMESTAMP), "errorMessage" = NULL, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${run.id} AND "organizationId" = ${input.organizationId}
  `;
  const batchSize = researchBatchSize();
  const batchQueries = queries.slice(cursor, cursor + batchSize);
  await markResearchDiscoveryChunk(input.organizationId, run.id, cursor, "RUNNING");
  try {
  const candidates = new Map<string, { parsed: ParsedCandidate; hints: string[] }>();

  // Run the batch's provider calls concurrently (bounded by batch size) instead of serially.
  // Track per-provider hard failures (auth/credit/timeout/network) so a run where every
  // provider rejects every query surfaces a real error instead of a false "0 candidates".
  const providerHttpErrors = new Map<string, number | null>();
  const responses = await Promise.all(
    batchQueries.map(async (q) => {
      const startedAt = new Date();
      const resp = await runQueryAcrossProviders(
        { query: q.query, purpose: "company_profile", category: run.kind === "CONTACT" ? "people" : "company" },
        deps
      );
      for (const a of resp.attempts) {
        if (a.status !== "ok" && !providerHttpErrors.has(a.provider)) providerHttpErrors.set(a.provider, a.httpStatus);
      }
      await safeRecordProviderAttempt({
        organizationId: input.organizationId,
        runId: run.id,
        stage: "research.discovery",
        provider: "search_federation",
        status: resp.results.length > 0 ? "SUCCEEDED" : "FAILED",
        requestJson: { query: q.query, purpose: "company_profile" },
        responseJson: {
          resultCount: resp.results.length,
          providers: Array.from(new Set(resp.results.map((r) => r.provider))),
          // Sanitized attempt trace (no keys/bodies) so silent failures are diagnosable.
          attempts: resp.attempts.map((a) => ({ provider: a.provider, status: a.status, httpStatus: a.httpStatus, rejectionReason: a.rejectionReason })),
        },
        startedAt,
        finishedAt: new Date(),
      });
      return { q, resp };
    })
  );
  // Provider-error signal: the batch produced 0 results AND at least one provider hard-failed
  // (HTTP/timeout/network — not merely "zero results"). Dead/invalid keys land here.
  const batchHadResults = responses.some((r) => r.resp.results.length > 0);
  const providerErrorMessage =
    !batchHadResults && providerHttpErrors.size > 0
      ? `Search providers rejected the queries (${Array.from(providerHttpErrors.entries())
          .map(([p, s]) => (s ? `${p} ${s}` : p))
          .join(", ")}). Check the provider API keys / credits.`
      : null;
  // Never re-harvest the lookalike seed's own domain (it dominates its own brand SERP).
  const seedDomain = (run.paramsJson as { seed?: { domain?: string } } | null)?.seed?.domain;
  const excludeRoots = seedDomain ? [seedDomain] : [];
  for (const { q, resp } of responses) {
    // R4: optional local neural rerank (off by default) — reorder by semantic relevance to the
    // query before parsing. Best-effort: returns provider order unchanged when disabled/unavailable.
    const ranked = await rerankResults(q.query, resp.results);
    const hits: RawSearchHit[] = ranked.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet ?? r.highlight,
      provider: r.provider,
    }));
    const parsed = run.kind === "COMPANY" ? parseCompanyHits(q.query, hits, excludeRoots) : parseContactHits(q.query, hits);
    for (const c of parsed) {
      if (!candidates.has(c.dedupeFingerprint)) candidates.set(c.dedupeFingerprint, { parsed: c, hints: q.hints });
    }
  }

  // ICP exclusion gate: drop candidates the ICP hard-excludes (services/consulting, excluded
  // industries, competitors) BEFORE the expensive liveness probe + auto-enrichment, so search/enrich
  // quota is not spent on companies a full assessment would terminally reject anyway.
  const icpRules = await loadIcpRulesForRun(input.organizationId, run.icpVersionId);
  if (icpRules) {
    for (const [fp, v] of candidates) {
      if (isCandidateExcludedByIcp(v.parsed, icpRules).excluded) candidates.delete(fp);
    }
  }

  // Liveness gate: drop dead/404/parked domains before scoring + persisting (company kind only).
  const allValues = await resolveContactCandidateDomains(input.organizationId, Array.from(candidates.values()), readScopedDomain(run.paramsJson));
  const livenessCache = new Map<string, boolean>();
  const liveParsed = await filterLiveCandidates(allValues.map((v) => v.parsed), livenessCache);
  const liveFingerprints = new Set(liveParsed.map((p) => p.dedupeFingerprint));
  const values = allValues.filter((v) => liveFingerprints.has(v.parsed.dedupeFingerprint));

  // Opt-in AI re-rank; null keeps the deterministic heuristic (never fails the run).
  const targetSignals = Array.from(new Set(batchQueries.flatMap((q) => q.hints)));
  const aiFitFlag = (run.paramsJson as { aiFit?: boolean } | null)?.aiFit;
  const aiFit = await scoreCandidatesWithAi(input.organizationId, {
    kind: run.kind,
    targetSignals,
    aiFit: aiFitFlag,
    candidates: values.map(({ parsed }) => ({
      name: parsed.name,
      title: parsed.title,
      companyName: parsed.companyName,
      domain: parsed.domain,
      snippet: parsed.source.snippet,
    })),
  });

  await insertCandidates(input.organizationId, run.id, values, aiFit);

  const nextCursor = Math.min(cursor + batchQueries.length, queries.length);
  const done = nextCursor >= queries.length;
  const counts = await finalizeRunCounts(run.id, input.organizationId, nextCursor, done, providerErrorMessage);

  // Auto-enrich the run's current top-fit company candidates into business insight.
  await enqueueTopFitEnrichment(input.organizationId, run.id, run.kind, run.createdByUserId);

  if (!done) {
    await enqueueResearchBatchJob(prisma as unknown as V2JobDatabase, {
      organizationId: input.organizationId,
      runId: run.id,
      cursor: nextCursor,
      createdByUserId: run.createdByUserId,
    });
  }

  await markResearchDiscoveryChunk(input.organizationId, run.id, cursor, "SUCCEEDED", { processedUnits: batchQueries.length });


  return { discovered: counts.discovered, duplicates: counts.duplicates, cursor: nextCursor, totalQueries: queries.length };
  } catch (error) {
    await markResearchDiscoveryChunk(input.organizationId, run.id, cursor, "FAILED", {
      errorCode: error instanceof Error ? error.message.slice(0, 80) : "RESEARCH_DISCOVERY_FAILED",
    });
    throw error;
  }
}

/** Load + upgrade the run's ICP rules to V2 for the discovery exclusion gate. Null on any failure —
 *  a missing/invalid ICP must never fail the run; it just skips ICP exclusion. */
async function loadIcpRulesForRun(organizationId: string, icpVersionId: string): Promise<IcpVersionRulesV2 | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ rulesJson: unknown }>>`
      SELECT "rulesJson" FROM "V2ICPVersion"
      WHERE "id" = ${icpVersionId} AND "organizationId" = ${organizationId}
      LIMIT 1
    `;
    if (!rows[0]) return null;
    return upgradeSourceRulesToV2(rows[0].rulesJson).rules;
  } catch {
    return null;
  }
}

async function loadResearchRun(organizationId: string, runId: string): Promise<ResearchRunRecord | null> {
  const rows = await prisma.$queryRaw<ResearchRunRecord[]>`
    SELECT "id", "organizationId", "icpVersionId", "projectId", "kind"::text AS "kind", "status"::text AS "status",
      "queriesJson", "paramsJson", "queryCursor", "discoveredCount", "duplicateCount", "errorMessage", "createdByUserId"
    FROM "V2ResearchRun"
    WHERE "id" = ${runId} AND "organizationId" = ${organizationId} AND "deletedAt" IS NULL
    LIMIT 1
  `;
  return rows[0] ?? null;
}

function readQueries(value: unknown): DiscoveryQuery[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((q) => {
      if (!q || typeof q !== "object") return null;
      const obj = q as Record<string, unknown>;
      const query = typeof obj.query === "string" ? obj.query.trim() : "";
      const hints = Array.isArray(obj.hints) ? obj.hints.filter((h): h is string => typeof h === "string") : [];
      return query ? { query, hints } : null;
    })
    .filter((q): q is DiscoveryQuery => Boolean(q));
}

async function insertCandidates(
  organizationId: string,
  runId: string,
  values: Array<{ parsed: ParsedCandidate; hints: string[]; domainResolutionSource?: DomainResolutionSource }>,
  aiFit: Map<number, AiFit> | null
) {
  if (values.length === 0) return;

  const domainList = values.map((c) => c.parsed.domain).filter((d): d is string => Boolean(d));
  const linkedinUrls = values.map((c) => c.parsed.linkedinUrl).filter((u): u is string => Boolean(u));
  const fingerprints = values.map((c) => c.parsed.dedupeFingerprint);
  const [existingCompanies, existingLinkedin, priorLedger] = await Promise.all([
    domainList.length > 0
      ? prisma.v2Company.findMany({ where: { organizationId, canonicalDomain: { in: domainList }, deletedAt: null }, select: { canonicalDomain: true } })
      : Promise.resolve([]),
    linkedinUrls.length > 0
      ? prisma.v2ContactIdentifier.findMany({ where: { organizationId, type: "LINKEDIN", normalizedValue: { in: linkedinUrls } }, select: { normalizedValue: true } })
      : Promise.resolve([]),
    // Durable ledger read BEFORE this run's upsert: tells us which prospects a prior run saw.
    lookupProspects(organizationId, fingerprints),
  ]);
  const knownDomains = new Set(existingCompanies.map((c) => c.canonicalDomain).filter(Boolean));
  const knownLinkedin = new Set(existingLinkedin.map((c) => c.normalizedValue));

  for (let i = 0; i < values.length; i += 1) {
    const { parsed, hints } = values[i];
    const priorEntry = priorLedger.get(parsed.dedupeFingerprint);
    const heuristic = scoreCandidateHeuristic(parsed, hints);
    const ai = aiFit?.get(i) ?? null;
    // AI is advisory, not production truth: it may REFINE the deterministic score but not replace it
    // outright, so a hallucinated 95 cannot bury a candidate with real evidence (or vice versa).
    const fitScore = ai ? boundAiFit(heuristic.score, ai.fitScore) : heuristic.score;
    const fitReason = ai ? ai.fitReason : heuristic.reason;
    const location = ai?.location ?? parsed.location ?? null;
    const duplicateReason =
      parsed.domain && knownDomains.has(parsed.domain) ? "existing_company" :
      parsed.linkedinUrl && knownLinkedin.has(parsed.linkedinUrl) ? "existing_contact" :
      wasSeenInPriorRun(priorEntry, runId) ? "seen_before" : null;
    await prisma.v2ResearchCandidate.createMany({
      data: [{
        organizationId,
        runId,
        kind: parsed.kind,
        name: parsed.name,
        domain: parsed.domain,
        linkedinUrl: parsed.linkedinUrl,
        title: parsed.title,
        companyName: parsed.companyName,
        location,
        sourceJson: { ...parsed.source, duplicateReason, domainResolutionSource: values[i].domainResolutionSource ?? (parsed.domain ? "parsed" : "unresolved") } as unknown as object,
        matchHintsJson: hints as unknown as object,
        dedupeFingerprint: parsed.dedupeFingerprint,
        fitScore,
        fitReason,
        fitSource: ai ? "ai" : "heuristic",
        status: duplicateReason ? "DUPLICATE" : "DISCOVERED",
      }],
      skipDuplicates: true,
    });
    await recordDiscoveryCandidateEvidence(organizationId, runId, parsed, hints, duplicateReason, fitScore, values[i].domainResolutionSource ?? (parsed.domain ? "parsed" : "unresolved"));
  }

  // Bump the durable ledger AFTER dedupe classification so future runs see today's sighting.
  await upsertProspects(
    organizationId,
    runId,
    values.map(({ parsed }) => ({
      kind: parsed.kind,
      dedupeFingerprint: parsed.dedupeFingerprint,
      domain: parsed.domain,
      linkedinUrl: parsed.linkedinUrl,
      displayName: parsed.name,
    }))
  );
}

async function finalizeRunCounts(
  runId: string,
  organizationId: string,
  cursor: number,
  done: boolean,
  errorMessage: string | null = null
) {
  const rows = await prisma.$queryRaw<Array<{ status: string; count: bigint }>>`
    SELECT "status"::text AS "status", COUNT(*) AS "count"
    FROM "V2ResearchCandidate"
    WHERE "organizationId" = ${organizationId} AND "runId" = ${runId} AND "deletedAt" IS NULL
    GROUP BY "status"
  `;
  const countFor = (status: string) => Number(rows.find((row) => row.status === status)?.count ?? 0);
  const discovered = countFor("DISCOVERED");
  const duplicates = countFor("DUPLICATE");
  await prisma.$queryRaw`
    UPDATE "V2ResearchRun"
    SET "queryCursor" = ${cursor},
        "discoveredCount" = ${discovered},
        "duplicateCount" = ${duplicates},
        "status" = ${done ? "SUCCEEDED" : "QUEUED"}::"V2ResearchRunStatus",
        "finishedAt" = ${done ? new Date() : null},
        "errorMessage" = ${errorMessage},
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${runId} AND "organizationId" = ${organizationId}
  `;
  return { discovered, duplicates };
}

export function researchBatchSize() {
  const configured = Number(process.env.RESEARCH_QUERY_BATCH_SIZE ?? DEFAULT_RESEARCH_QUERY_BATCH_SIZE);
  if (!Number.isInteger(configured) || configured < 1) return DEFAULT_RESEARCH_QUERY_BATCH_SIZE;
  return Math.min(configured, MAX_RESEARCH_QUERY_BATCH_SIZE);
}

function createResearchRunId() {
  return `rr_${Date.now().toString(36)}_${randomBytes(5).toString("hex")}`;
}

async function recordDiscoveryCandidateEvidence(
  organizationId: string,
  runId: string,
  parsed: ParsedCandidate,
  hints: string[],
  duplicateReason: string | null,
  fitScore: number,
  domainResolutionSource: DomainResolutionSource
) {
  try {
    const candidate = await prisma.v2ResearchCandidate.findFirst({
      where: { organizationId, runId, dedupeFingerprint: parsed.dedupeFingerprint, deletedAt: null },
      select: { id: true },
    });
    if (!candidate) return;

    const evidenceId = await recordResearchEvidence({
      organizationId,
      runId,
      candidateId: candidate.id,
      idempotencyKey: buildResearchEvidenceKey(["discovery", runId, parsed.dedupeFingerprint, parsed.source.url]),
      sourceKind: "search_result",
      provider: parsed.source.provider,
      sourceUrl: parsed.source.url,
      sourceTitle: null,
      sourceSnippet: parsed.source.snippet,
      query: parsed.source.query,
      confidence: fitScore,
      evidenceJson: {
        kind: parsed.kind,
        matchHints: hints,
        duplicateReason,
        domain: parsed.domain,
        domainResolutionSource,
        linkedinUrl: parsed.linkedinUrl,
      },
    });

    if (parsed.domain) {
      await recordResearchFieldObservation({
        organizationId,
        candidateId: candidate.id,
        evidenceId,
        fieldName: "domain",
        valueText: parsed.domain,
        confidence: domainResolutionSource === "scope_domain" ? 90 : domainResolutionSource === "existing_company" ? 75 : 80,
        sourceKind: "search_result",
      });
    }
    if (parsed.linkedinUrl) {
      await recordResearchFieldObservation({
        organizationId,
        candidateId: candidate.id,
        evidenceId,
        fieldName: "linkedin_url",
        valueText: parsed.linkedinUrl,
        confidence: 75,
        sourceKind: "search_result",
      });
    }
  } catch {
    // Evidence ledger is additive; discovery must keep its prior success/failure semantics.
  }
}

async function safeRecordProviderAttempt(input: Parameters<typeof recordResearchProviderAttempt>[0]) {
  try {
    await recordResearchProviderAttempt(input);
  } catch {
    // Provider attempt ledger is additive and must not change discovery semantics.
  }
}
