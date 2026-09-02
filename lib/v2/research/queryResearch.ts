import "server-only";

import { prisma } from "@/lib/server/prisma";
import { normalizeCompanyName } from "@/lib/v2/identity";
import { lookupProspects } from "./prospectLedger";
import type { CandidateInsight } from "./insightMapper";
import { companyDomainFromUrl, readCompanyScope, resolveCandidateCompanyName, resolveResearchCompanyIdentity, type ResearchCompanyIdentity, type ResearchIdentitySource } from "./candidateIdentity";

// Read-models for /v2/research. Tenant-scoped; soft-delete respected (Inv 5/8).
// The UI derives review guidance from real CRM/research/scoring state only.

export type ResearchRunRow = {
  id: string;
  kind: string;
  status: string;
  icpLabel: string;
  projectName: string;
  queryCount: number;
  queryCursor: number;
  discoveredCount: number;
  duplicateCount: number;
  errorMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export async function queryResearchRuns(organizationId: string): Promise<ResearchRunRow[]> {
  const rows = await prisma.$queryRaw<Array<{
    id: string; kind: string; status: string; icpProfileName: string | null; versionNumber: number | null;
    projectName: string | null; queriesJson: unknown; queryCursor: number; discoveredCount: number; duplicateCount: number;
    errorMessage: string | null; createdAt: Date; finishedAt: Date | null;
  }>>`
    SELECT
      run."id", run."kind"::text AS "kind", run."status"::text AS "status",
      profile."name" AS "icpProfileName", icp."versionNumber",
      project."name" AS "projectName",
      run."queriesJson", run."queryCursor", run."discoveredCount", run."duplicateCount",
      run."errorMessage", run."createdAt", run."finishedAt"
    FROM "V2ResearchRun" run
    LEFT JOIN "V2ICPVersion" icp
      ON icp."id" = run."icpVersionId" AND icp."organizationId" = run."organizationId" AND icp."deletedAt" IS NULL
    LEFT JOIN "V2ICPProfile" profile
      ON profile."id" = icp."icpProfileId" AND profile."organizationId" = run."organizationId"
    LEFT JOIN "V2Project" project
      ON project."id" = run."projectId" AND project."organizationId" = run."organizationId"
    WHERE run."organizationId" = ${organizationId} AND run."deletedAt" IS NULL
    ORDER BY run."createdAt" DESC
    LIMIT 30
  `;
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    icpLabel: `${r.icpProfileName ?? "Archived ICP"}${r.versionNumber ? ` v${Number(r.versionNumber)}` : ""}`,
    projectName: r.projectName ?? "Archived project",
    queryCount: Array.isArray(r.queriesJson) ? r.queriesJson.length : 0,
    queryCursor: Number(r.queryCursor),
    discoveredCount: Number(r.discoveredCount),
    duplicateCount: Number(r.duplicateCount),
    errorMessage: r.errorMessage,
    createdAt: new Date(r.createdAt).toISOString(),
    finishedAt: r.finishedAt ? new Date(r.finishedAt).toISOString() : null,
  }));
}

/** Single run by id - used so a deep-linked or older-than-the-list run always renders (the runs
 *  list is capped at 30). Same LEFT-JOIN label fallback; tenant-scoped; soft-delete respected. */
export async function queryResearchRun(organizationId: string, runId: string): Promise<ResearchRunRow | null> {
  const rows = await prisma.$queryRaw<Array<{
    id: string; kind: string; status: string; icpProfileName: string | null; versionNumber: number | null;
    projectName: string | null; queriesJson: unknown; queryCursor: number; discoveredCount: number; duplicateCount: number;
    errorMessage: string | null; createdAt: Date; finishedAt: Date | null;
  }>>`
    SELECT
      run."id", run."kind"::text AS "kind", run."status"::text AS "status",
      profile."name" AS "icpProfileName", icp."versionNumber",
      project."name" AS "projectName",
      run."queriesJson", run."queryCursor", run."discoveredCount", run."duplicateCount",
      run."errorMessage", run."createdAt", run."finishedAt"
    FROM "V2ResearchRun" run
    -- filter-ok: status - run history must render even after its ICP/project was archived/unpublished
    LEFT JOIN "V2ICPVersion" icp
      ON icp."id" = run."icpVersionId" AND icp."organizationId" = run."organizationId" AND icp."deletedAt" IS NULL
    LEFT JOIN "V2ICPProfile" profile
      ON profile."id" = icp."icpProfileId" AND profile."organizationId" = run."organizationId"
    LEFT JOIN "V2Project" project
      ON project."id" = run."projectId" AND project."organizationId" = run."organizationId"
    WHERE run."organizationId" = ${organizationId} AND run."id" = ${runId} AND run."deletedAt" IS NULL
    LIMIT 1
  `;
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    icpLabel: `${r.icpProfileName ?? "Archived ICP"}${r.versionNumber ? ` v${Number(r.versionNumber)}` : ""}`,
    projectName: r.projectName ?? "Archived project",
    queryCount: Array.isArray(r.queriesJson) ? r.queriesJson.length : 0,
    queryCursor: Number(r.queryCursor),
    discoveredCount: Number(r.discoveredCount),
    duplicateCount: Number(r.duplicateCount),
    errorMessage: r.errorMessage,
    createdAt: new Date(r.createdAt).toISOString(),
    finishedAt: r.finishedAt ? new Date(r.finishedAt).toISOString() : null,
  };
}

/** Defensive parse of the persisted candidate insight JSON into the typed shape. */
function parseInsight(value: unknown): CandidateInsight | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const summary = typeof o.summary === "string" ? o.summary : null;
  const whatTheySell = strArr(o.whatTheySell);
  const industry = strArr(o.industry);
  if (!summary && whatTheySell.length === 0 && industry.length === 0) return null;
  return {
    summary,
    whatTheySell,
    industry,
    size: typeof o.size === "string" ? o.size : null,
    hq: typeof o.hq === "string" ? o.hq : null,
    geoMarkets: strArr(o.geoMarkets),
    signals: strArr(o.signals),
    citations: Array.isArray(o.citations)
      ? (o.citations as unknown[])
          .filter((c): c is { url: string; title?: unknown } => Boolean(c) && typeof (c as { url?: unknown }).url === "string")
          .map((c) => ({ url: c.url, title: typeof c.title === "string" ? c.title : null }))
      : [],
  };
}

/** Compact "3d ago" / "just now" label for the researched-date chip. */
export function relativeAgo(value: Date | string): string {
  const then = new Date(value).getTime();
  const diffMs = Date.now() - then;
  if (!Number.isFinite(diffMs) || diffMs < 0) return "just now";
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export type ResearchRecommendedAction =
  | "research_company"
  | "add_to_pipeline"
  | "review_duplicate"
  | "find_company_website"
  | "open_lead"
  | "wait_for_jobs"
  | "dismiss";

export type ResearchScoreState = "not_in_pipeline" | "not_scored" | "score_pending" | "scored";

export type ResearchCandidateRow = {
  id: string;
  kind: string;
  name: string;
  domain: string | null;
  linkedinUrl: string | null;
  title: string | null;
  companyName: string | null;
  location: string | null;
  status: string;
  fitScore: number | null;
  fitReason: string | null;
  fitSource: string | null;
  translatedName: string | null;
  translatedSnippet: string | null;
  emailGuess: string | null;
  emailStatus: string | null;
  phone: string | null;
  insight: CandidateInsight | null;
  enrichedAt: string | null;
  matchHints: string[];
  sourceUrl: string | null;
  sourceSnippet: string | null;
  sourceProvider: string | null;
  duplicateReason: string | null;
  firstSeenAt: string | null;
  timesSeen: number;
  researchedAgoLabel: string | null;
  promotedCompanyId: string | null;
  promotedContactId: string | null;
  readiness: "ready" | "known" | "queued" | "closed";
  latestResearchStatus: string | null;
  latestProfileStatus: string | null;
  latestResearchAt: string | null;
  hasCompany: boolean;
  hasContact: boolean;
  hasLeadAssignment: boolean;
  companyId: string | null;
  contactId: string | null;
  leadAssignmentId: string | null;
  latestQualification: string | null;
  scoreState: ResearchScoreState;
  person: { name: string; title: string | null; linkedinUrl: string | null };
  company: ResearchCompanyIdentity;
  websiteUrl: string | null;
  identitySource: ResearchIdentitySource;
  recommendedAction: ResearchRecommendedAction;
};

export type ResearchCandidateDrawer = {
  candidate: ResearchCandidateRow;
  matchedCompany: { id: string; name: string; domain: string | null; websiteUrl: string | null } | null;
  matchedContact: { id: string; fullName: string; title: string | null } | null;
  research: {
    snapshotStatus: string | null;
    profileStatus: string | null;
    researchedAt: string | null;
    companySummary: string | null;
  };
  lead: {
    leadAssignmentId: string | null;
    latestQualification: string | null;
    scoreState: ResearchScoreState;
  };
  availableActions: ResearchRecommendedAction[];
  evidence: {
    coverage: { evidenceCount: number; observationCount: number; attemptCount: number };
    sourceEvidence: Array<{ sourceKind: string; provider: string | null; title: string | null; url: string | null; snippet: string | null; confidence: number | null; observedAt: string }>;
    people: Array<{ value: string; confidence: number | null }>;
    emailWaterfall: Array<{ stage: string; status: string; detail: string; email: string | null }>;
    learnedPatterns: Array<{ pattern: string; confidence: number; sampleCount: number }>;
    timeline: Array<{ label: string; status: string; detail: string | null; at: string }>;
  };
};

type CandidateBase = Awaited<ReturnType<typeof loadBaseCandidates>>[number];
type CompanyMatch = { id: string; name: string; canonicalDomain: string | null; websiteUrl: string | null; nameNormalized: string | null };
type ContactMatch = { id: string; fullName: string; title: string | null; linkedinUrl: string | null };
type LeadMatch = {
  id: string;
  companyId: string;
  contactId: string | null;
  projectId: string;
  icpVersionId: string;
  latestHardRuleAssessmentId: string | null;
  latestHardRuleAssessment: { qualification: string } | null;
};
type SnapshotMatch = { companyId: string; status: string; createdAt: Date };
type ProfileMatch = { companyId: string; profileStatus: string; createdAt: Date };

export async function queryResearchCandidates(
  organizationId: string,
  runId: string
): Promise<ResearchCandidateRow[]> {
  const rows = await loadBaseCandidates(organizationId, { runId });
  return enrichCandidates(organizationId, rows);
}

export async function queryResearchCandidateDrawer(
  organizationId: string,
  candidateId: string
): Promise<ResearchCandidateDrawer | null> {
  const rows = await loadBaseCandidates(organizationId, { candidateId });
  const [candidate] = await enrichCandidates(organizationId, rows);
  if (!candidate) return null;

  const [company, contact, profile, evidenceRows, observations, attempts, learnedPatterns] = await Promise.all([
    candidate.companyId
      ? prisma.v2Company.findFirst({
          where: { id: candidate.companyId, organizationId, deletedAt: null },
          select: { id: true, name: true, canonicalDomain: true, websiteUrl: true },
        })
      : null,
    candidate.contactId
      ? prisma.v2Contact.findFirst({
          where: { id: candidate.contactId, organizationId, deletedAt: null },
          select: { id: true, fullName: true, title: true },
        })
      : null,
    candidate.companyId
      ? prisma.v2CompanyIntelligenceProfile.findFirst({
          where: { organizationId, companyId: candidate.companyId },
          orderBy: [{ createdAt: "desc" }],
          select: { companySummary: true },
        })
      : null,
    prisma.v2ResearchEvidence.findMany({
      where: { organizationId, candidateId: candidate.id },
      orderBy: [{ createdAt: "desc" }],
      take: 30,
      select: { sourceKind: true, provider: true, sourceUrl: true, sourceTitle: true, sourceSnippet: true, confidence: true, evidenceJson: true, observedAt: true, createdAt: true },
    }),
    prisma.v2ResearchFieldObservation.findMany({
      where: { organizationId, candidateId: candidate.id },
      orderBy: [{ createdAt: "desc" }],
      take: 60,
      select: { fieldName: true, valueText: true, valueJson: true, confidence: true, sourceKind: true, createdAt: true },
    }),
    prisma.v2ResearchProviderAttempt.findMany({
      where: { organizationId, candidateId: candidate.id },
      orderBy: [{ createdAt: "desc" }],
      take: 20,
      select: { stage: true, provider: true, status: true, errorMessage: true, responseJson: true, createdAt: true },
    }),
    candidate.domain
      ? prisma.v2ResearchEmailPattern.findMany({
          where: { organizationId, domain: candidate.domain },
          orderBy: [{ confidence: "desc" }, { sampleCount: "desc" }],
          take: 8,
          select: { pattern: true, confidence: true, sampleCount: true },
        })
      : Promise.resolve([]),
  ]);

  return {
    candidate,
    matchedCompany: company
      ? { id: company.id, name: company.name, domain: company.canonicalDomain, websiteUrl: company.websiteUrl }
      : null,
    matchedContact: contact ? { id: contact.id, fullName: contact.fullName, title: contact.title } : null,
    research: {
      snapshotStatus: candidate.latestResearchStatus,
      profileStatus: candidate.latestProfileStatus,
      researchedAt: candidate.latestResearchAt,
      companySummary: profile?.companySummary ?? null,
    },
    lead: {
      leadAssignmentId: candidate.leadAssignmentId,
      latestQualification: candidate.latestQualification,
      scoreState: candidate.scoreState,
    },
    availableActions: actionsFor(candidate),
    evidence: buildDrawerEvidence(evidenceRows, observations, attempts, learnedPatterns),
  };
}


function buildDrawerEvidence(
  evidenceRows: Array<{ sourceKind: string; provider: string | null; sourceUrl: string | null; sourceTitle: string | null; sourceSnippet: string | null; confidence: number | null; evidenceJson: unknown; observedAt: Date; createdAt: Date }>,
  observations: Array<{ fieldName: string; valueText: string | null; valueJson: unknown; confidence: number | null; sourceKind: string; createdAt: Date }>,
  attempts: Array<{ stage: string; provider: string; status: string; errorMessage: string | null; responseJson: unknown; createdAt: Date }>,
  learnedPatterns: Array<{ pattern: string; confidence: number; sampleCount: number }>
): ResearchCandidateDrawer["evidence"] {
  const emailWaterfall = evidenceRows.flatMap((row) => {
    if (row.sourceKind !== "contact_email_waterfall") return [];
    const value = row.evidenceJson as { waterfall?: unknown } | null;
    if (!value || !Array.isArray(value.waterfall)) return [];
    return value.waterfall.slice(0, 20).flatMap((step) => {
      if (!step || typeof step !== "object") return [];
      const item = step as Record<string, unknown>;
      return [{
        stage: String(item.stage ?? "unknown"),
        status: String(item.status ?? "unknown"),
        detail: String(item.detail ?? "No detail"),
        email: typeof item.email === "string" ? item.email : null,
      }];
    });
  });

  return {
    coverage: { evidenceCount: evidenceRows.length, observationCount: observations.length, attemptCount: attempts.length },
    sourceEvidence: evidenceRows
      .filter((row) => row.sourceKind !== "contact_email_waterfall")
      .slice(0, 12)
      .map((row) => ({
        sourceKind: row.sourceKind,
        provider: row.provider,
        title: row.sourceTitle,
        url: row.sourceUrl,
        snippet: row.sourceSnippet,
        confidence: row.confidence,
        observedAt: new Date(row.observedAt ?? row.createdAt).toISOString(),
      })),
    people: observations
      .filter((row) => row.fieldName === "team_hint")
      .slice(0, 12)
      .map((row) => ({ value: row.valueText ?? "Team hint", confidence: row.confidence })),
    emailWaterfall,
    learnedPatterns: learnedPatterns.map((row) => ({ pattern: row.pattern, confidence: row.confidence, sampleCount: row.sampleCount })),
    timeline: attempts.slice(0, 12).map((attempt) => ({
      label: `${attempt.stage} / ${attempt.provider}`,
      status: attempt.status,
      detail: attempt.errorMessage,
      at: new Date(attempt.createdAt).toISOString(),
    })),
  };
}
async function loadBaseCandidates(organizationId: string, filter: { runId?: string; candidateId?: string }) {
  return prisma.v2ResearchCandidate.findMany({
    where: {
      organizationId,
      deletedAt: null,
      ...(filter.runId ? { runId: filter.runId } : {}),
      ...(filter.candidateId ? { id: filter.candidateId } : {}),
    },
    include: { run: { select: { projectId: true, icpVersionId: true, paramsJson: true } } },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    take: filter.candidateId ? 1 : 500,
  });
}

async function enrichCandidates(organizationId: string, rows: CandidateBase[]): Promise<ResearchCandidateRow[]> {
  if (rows.length === 0) return [];

  const companies = await loadCompanies(organizationId, rows);
  const companyById = new Map(companies.map((company) => [company.id, company]));
  const companyByDomain = new Map(companies.filter((company) => company.canonicalDomain).map((company) => [company.canonicalDomain!, company]));
  const companyByName = new Map(companies.filter((company) => company.nameNormalized).map((company) => [company.nameNormalized!, company]));

  const contacts = await loadContacts(organizationId, rows);
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const contactByLinkedin = new Map(contacts.filter((contact) => contact.linkedinUrl).map((contact) => [contact.linkedinUrl!, contact]));

  const companyIds = Array.from(new Set(rows.map((r) => resolveCompany(r, companyById, companyByDomain, companyByName)?.id).filter((id): id is string => Boolean(id))));
  const [snapshots, profiles, leads, ledger] = await Promise.all([
    loadLatestSnapshots(organizationId, companyIds),
    loadLatestProfiles(organizationId, companyIds),
    loadLeadAssignments(organizationId, companyIds),
    lookupProspects(organizationId, rows.map((r) => r.dedupeFingerprint)),
  ]);
  const snapshotByCompany = latestByCompany(snapshots);
  const profileByCompany = latestByCompany(profiles);

  return rows.map((r) => {
    const source = readCandidateSource(r.sourceJson);
    const company = resolveCompany(r, companyById, companyByDomain, companyByName);
    const identity = resolveResearchCompanyIdentity({
      kind: r.kind,
      candidateName: r.name,
      candidateCompanyName: r.companyName,
      candidateDomain: r.domain,
      sourceUrl: source.url,
      runParamsJson: r.run.paramsJson,
      matchedCompany: company ?? null,
      promotedCompanyId: r.promotedCompanyId,
    });
    const contact = resolveContact(r, contactById, contactByLinkedin);
    const lead = resolveLead(r, company?.id ?? null, contact?.id ?? null, leads);
    const snapshot = company ? snapshotByCompany.get(company.id) : null;
    const profile = company ? profileByCompany.get(company.id) : null;
    const latestQualification = lead?.latestHardRuleAssessment?.qualification ?? null;
    const scoreState = deriveScoreState(r.status, Boolean(lead), Boolean(lead?.latestHardRuleAssessmentId));
    const entry = ledger.get(r.dedupeFingerprint) ?? null;
    const base = mapBaseCandidate(r, identity, Boolean(company), Boolean(contact), company?.id ?? null, contact?.id ?? null, lead?.id ?? null, latestQualification, scoreState, snapshot ?? null, profile ?? null, entry);
    return { ...base, recommendedAction: deriveRecommendedAction(base) };
  });
}

async function loadCompanies(organizationId: string, rows: CandidateBase[]) {
  const promotedIds = rows.map((r) => r.promotedCompanyId).filter((id): id is string => Boolean(id));
  const domains = rows.flatMap((r) => {
    const source = readCandidateSource(r.sourceJson);
    const scope = readCompanyScope(r.run.paramsJson);
    return [r.domain, scope.domain, companyDomainFromUrl(source.url)].filter((domain): domain is string => Boolean(domain));
  });
  const names = rows.flatMap((r) => {
    const scope = readCompanyScope(r.run.paramsJson);
    const candidateName = resolveCandidateCompanyName(r.kind, r.name, r.companyName);
    return [scope.companyName, candidateName]
      .map((name) => (name ? name.trim() : null))
      .filter((name): name is string => Boolean(name));
  });
  const normalizedNames = Array.from(new Set(names.map((name) => normalizeCompanyName(name)).filter((name): name is string => Boolean(name))));
  const or = [
    promotedIds.length ? { id: { in: Array.from(new Set(promotedIds)) } } : null,
    domains.length ? { canonicalDomain: { in: Array.from(new Set(domains)) } } : null,
    normalizedNames.length ? { nameNormalized: { in: normalizedNames } } : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (or.length === 0) return [];
  return prisma.v2Company.findMany({
    where: { organizationId, deletedAt: null, OR: or },
    select: { id: true, name: true, nameNormalized: true, canonicalDomain: true, websiteUrl: true },
  });
}
async function loadContacts(organizationId: string, rows: CandidateBase[]) {
  const promotedIds = rows.map((r) => r.promotedContactId).filter((id): id is string => Boolean(id));
  const linkedinUrls = rows.map((r) => r.linkedinUrl).filter((url): url is string => Boolean(url));
  const [promotedContacts, identifiers] = await Promise.all([
    promotedIds.length
      ? prisma.v2Contact.findMany({
          where: { organizationId, id: { in: Array.from(new Set(promotedIds)) }, deletedAt: null },
          select: { id: true, fullName: true, title: true },
        })
      : Promise.resolve([]),
    linkedinUrls.length
      ? prisma.v2ContactIdentifier.findMany({
          where: { organizationId, type: "LINKEDIN", normalizedValue: { in: Array.from(new Set(linkedinUrls)) } },
          select: { normalizedValue: true, contact: { select: { id: true, fullName: true, title: true, deletedAt: true } } },
        })
      : Promise.resolve([]),
  ]);

  const byId = new Map<string, ContactMatch>();
  for (const contact of promotedContacts) byId.set(contact.id, { ...contact, linkedinUrl: null });
  for (const identifier of identifiers) {
    if (identifier.contact.deletedAt) continue;
    byId.set(identifier.contact.id, { ...identifier.contact, linkedinUrl: identifier.normalizedValue });
  }
  return Array.from(byId.values());
}

async function loadLatestSnapshots(organizationId: string, companyIds: string[]) {
  if (companyIds.length === 0) return [];
  return prisma.v2CompanyResearchSnapshot.findMany({
    where: { organizationId, companyId: { in: companyIds } },
    orderBy: [{ createdAt: "desc" }],
    select: { companyId: true, status: true, createdAt: true },
  });
}

async function loadLatestProfiles(organizationId: string, companyIds: string[]) {
  if (companyIds.length === 0) return [];
  return prisma.v2CompanyIntelligenceProfile.findMany({
    where: { organizationId, companyId: { in: companyIds } },
    orderBy: [{ createdAt: "desc" }],
    select: { companyId: true, profileStatus: true, createdAt: true },
  });
}

async function loadLeadAssignments(organizationId: string, companyIds: string[]) {
  if (companyIds.length === 0) return [];
  return prisma.v2LeadAssignment.findMany({
    where: { organizationId, companyId: { in: companyIds }, deletedAt: null, status: "ACTIVE" },
    select: {
      id: true,
      companyId: true,
      contactId: true,
      projectId: true,
      icpVersionId: true,
      latestHardRuleAssessmentId: true,
      latestHardRuleAssessment: { select: { qualification: true } },
    },
  });
}

function readCandidateSource(value: unknown): { url: string | null; snippet: string | null; provider: string | null; duplicateReason: string | null } {
  const source = (value ?? {}) as { url?: string; snippet?: string | null; provider?: string | null; duplicateReason?: string | null };
  return {
    url: typeof source.url === "string" ? source.url : null,
    snippet: typeof source.snippet === "string" ? source.snippet : null,
    provider: typeof source.provider === "string" ? source.provider : null,
    duplicateReason: typeof source.duplicateReason === "string" ? source.duplicateReason : null,
  };
}
function mapBaseCandidate(
  r: CandidateBase,
  identity: ResearchCompanyIdentity,
  hasCompany: boolean,
  hasContact: boolean,
  companyId: string | null,
  contactId: string | null,
  leadAssignmentId: string | null,
  latestQualification: string | null,
  scoreState: ResearchScoreState,
  snapshot: SnapshotMatch | null,
  profile: ProfileMatch | null,
  ledger: { firstSeenAt: Date; timesSeen: number } | null
): Omit<ResearchCandidateRow, "recommendedAction"> {
  const source = readCandidateSource(r.sourceJson);
  const timesSeen = ledger?.timesSeen ?? 1;
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    domain: identity.domain,
    linkedinUrl: r.linkedinUrl,
    title: r.title,
    companyName: identity.displayName === "Company unresolved" ? null : identity.displayName,
    location: r.location,
    status: r.status,
    fitScore: r.fitScore,
    fitReason: r.fitReason,
    fitSource: r.fitSource,
    translatedName: r.translatedName,
    translatedSnippet: r.translatedSnippet,
    emailGuess: r.emailGuess,
    emailStatus: r.emailStatus,
    phone: r.phone,
    insight: parseInsight(r.insightJson),
    enrichedAt: r.enrichedAt ? new Date(r.enrichedAt).toISOString() : null,
    matchHints: Array.isArray(r.matchHintsJson) ? (r.matchHintsJson as unknown[]).filter((h): h is string => typeof h === "string") : [],
    sourceUrl: source.url,
    sourceSnippet: source.snippet,
    sourceProvider: source.provider,
    duplicateReason: typeof source.duplicateReason === "string" ? source.duplicateReason : null,
    firstSeenAt: ledger?.firstSeenAt ? new Date(ledger.firstSeenAt).toISOString() : null,
    timesSeen,
    researchedAgoLabel: timesSeen > 1 && ledger?.firstSeenAt ? relativeAgo(ledger.firstSeenAt) : null,
    promotedCompanyId: r.promotedCompanyId,
    promotedContactId: r.promotedContactId,
    readiness: deriveReadiness(r.status, Boolean(r.promotedCompanyId)),
    latestResearchStatus: snapshot?.status ?? null,
    latestProfileStatus: profile?.profileStatus ?? null,
    latestResearchAt: snapshot?.createdAt ? new Date(snapshot.createdAt).toISOString() : null,
    hasCompany,
    hasContact,
    hasLeadAssignment: Boolean(leadAssignmentId),
    companyId,
    contactId,
    leadAssignmentId,
    latestQualification,
    scoreState,
    person: { name: r.name, title: r.title, linkedinUrl: r.linkedinUrl },
    company: identity,
    websiteUrl: identity.websiteUrl,
    identitySource: identity.identitySource,
  };
}

function resolveCompany(
  r: CandidateBase,
  companyById: Map<string, CompanyMatch>,
  companyByDomain: Map<string, CompanyMatch>,
  companyByName: Map<string, CompanyMatch>
) {
  if (r.promotedCompanyId && companyById.has(r.promotedCompanyId)) return companyById.get(r.promotedCompanyId)!;
  const source = readCandidateSource(r.sourceJson);
  const scope = readCompanyScope(r.run.paramsJson);
  const domains = [scope.domain, r.domain?.trim().toLowerCase() ?? null, companyDomainFromUrl(source.url)].filter((domain): domain is string => Boolean(domain));
  for (const domain of domains) {
    const company = companyByDomain.get(domain);
    if (company) return company;
  }
  const candidateName = resolveCandidateCompanyName(r.kind, r.name, r.companyName);
  const normalizedName = normalizeCompanyName(scope.companyName ?? candidateName ?? "");
  return normalizedName ? companyByName.get(normalizedName) ?? null : null;
}

function resolveContact(r: CandidateBase, contactById: Map<string, ContactMatch>, contactByLinkedin: Map<string, ContactMatch>) {
  if (r.promotedContactId && contactById.has(r.promotedContactId)) return contactById.get(r.promotedContactId)!;
  if (r.linkedinUrl && contactByLinkedin.has(r.linkedinUrl)) return contactByLinkedin.get(r.linkedinUrl)!;
  return null;
}

function resolveLead(r: CandidateBase, companyId: string | null, contactId: string | null, leads: LeadMatch[]) {
  if (!companyId) return null;
  const matchingContext = leads.filter((lead) => lead.companyId === companyId && lead.projectId === r.run.projectId && lead.icpVersionId === r.run.icpVersionId);
  if (r.kind === "CONTACT" && contactId) return matchingContext.find((lead) => lead.contactId === contactId) ?? null;
  return matchingContext.find((lead) => lead.contactId === null) ?? matchingContext[0] ?? null;
}

function latestByCompany<T extends { companyId: string; createdAt: Date }>(rows: T[]) {
  const map = new Map<string, T>();
  for (const row of rows) {
    const current = map.get(row.companyId);
    if (!current || row.createdAt > current.createdAt) map.set(row.companyId, row);
  }
  return map;
}

function deriveReadiness(status: string, promoted: boolean): ResearchCandidateRow["readiness"] {
  if (promoted || status === "PROMOTED") return "queued";
  if (status === "DUPLICATE") return "known";
  if (status === "DISMISSED") return "closed";
  return "ready";
}

function deriveScoreState(status: string, hasLead: boolean, hasAssessment: boolean): ResearchScoreState {
  if (!hasLead) return "not_in_pipeline";
  if (hasAssessment) return "scored";
  if (status === "PROMOTED") return "score_pending";
  return "not_scored";
}

function deriveRecommendedAction(candidate: Omit<ResearchCandidateRow, "recommendedAction">): ResearchRecommendedAction {
  if (candidate.status === "DISMISSED") return "dismiss";
  if (candidate.leadAssignmentId) return "open_lead";
  if (candidate.status === "PROMOTED") return "wait_for_jobs";
  if (candidate.kind === "CONTACT" && !candidate.company.domain) return "find_company_website";
  if (candidate.status === "DUPLICATE") return "review_duplicate";
  if (candidate.hasCompany && !candidate.latestProfileStatus) return "research_company";
  return "add_to_pipeline";
}

function actionsFor(candidate: ResearchCandidateRow): ResearchRecommendedAction[] {
  if (candidate.recommendedAction === "open_lead") return ["open_lead"];
  if (candidate.recommendedAction === "review_duplicate") return ["review_duplicate", "add_to_pipeline", "dismiss"];
  if (candidate.recommendedAction === "research_company") return ["research_company", "add_to_pipeline", "dismiss"];
  if (candidate.recommendedAction === "find_company_website") return ["find_company_website", "dismiss"];
  if (candidate.recommendedAction === "wait_for_jobs") return ["wait_for_jobs"];
  if (candidate.recommendedAction === "dismiss") return [];
  return ["add_to_pipeline", "dismiss"];
}
