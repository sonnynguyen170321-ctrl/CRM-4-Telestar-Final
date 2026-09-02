import "server-only";

import { buildHomeOverview, type HomeOverview, type HomeRawCounts } from "./buildHomeOverview";
import { traceQuery, withSpan } from "@/lib/v2/observability/trace";

// R1: thin tenant-scoped loader for the home command center. Gathers real counts
// (LeadAssignment-level, not company-level) and shapes them via buildHomeOverview.
// Injectable loadCounts for tests; default uses prisma raw counts.

export type HomeCountsLoader = (organizationId: string) => Promise<HomeRawCounts>;

type CountsRow = {
  leadsAssigned: number; meetingsBooked: number; totalLeads: number; qualified: number;
  inProgress: number; won: number; pastLeadsAssigned: number; pastMeetingsBooked: number;
  activeAccounts: number; pastActiveAccounts: number; activeProjects: number; pastActiveProjects: number;
  publishedIcps: number; pastPublishedIcps: number; totalIcpVersions: number;
  openReviewItems: number; pastOpenReviewItems: number; queuedJobs: number; failedJobs: number;
  aiRuns: number; pastAiRuns: number; activeOffers: number;
};

// All 22 dashboard counts in ONE statement (1 round-trip). V2LeadAssignment is scanned a
// single time via FILTER aggregates (CTE); the other tables — each a small org-scoped
// count — are scalar subqueries. Every count maps 1:1 to the prior per-query version, so
// the output is identical; only the round-trip count changes (22 -> 1). Org-scoped ($1).
const HOME_COUNTS_SQL = `
WITH la AS (
  SELECT
    COUNT(*) FILTER (WHERE "status"='ACTIVE' AND "deletedAt" IS NULL)::int AS "leadsAssigned",
    COUNT(*) FILTER (WHERE "workflowStatus" IN ('MEETING_BOOKED','MEETING_DONE') AND "deletedAt" IS NULL)::int AS "meetingsBooked",
    COUNT(*) FILTER (WHERE "deletedAt" IS NULL)::int AS "totalLeads",
    COUNT(*) FILTER (WHERE "workflowStatus" IN ('WORKING','CONTACTED','RESPONDED') AND "deletedAt" IS NULL)::int AS "inProgress",
    COUNT(*) FILTER (WHERE "workflowStatus"='MEETING_DONE' AND "deletedAt" IS NULL)::int AS "won",
    COUNT(*) FILTER (WHERE "status"='ACTIVE' AND "deletedAt" IS NULL AND "createdAt" <= NOW() - INTERVAL '30 days')::int AS "pastLeadsAssigned",
    COUNT(*) FILTER (WHERE "workflowStatus" IN ('MEETING_BOOKED','MEETING_DONE') AND "deletedAt" IS NULL AND "createdAt" <= NOW() - INTERVAL '30 days')::int AS "pastMeetingsBooked"
  FROM "V2LeadAssignment" WHERE "organizationId" = $1
)
SELECT
  la."leadsAssigned", la."meetingsBooked", la."totalLeads", la."inProgress", la."won",
  la."pastLeadsAssigned", la."pastMeetingsBooked",
  (SELECT COUNT(*)::int FROM "V2LeadAssignment" l JOIN "V2HardRuleAssessment" a ON a."id"=l."latestHardRuleAssessmentId" WHERE l."organizationId"=$1 AND l."deletedAt" IS NULL AND l."status"='ACTIVE' AND a."qualification"='QUALIFIED') AS "qualified",
  (SELECT COUNT(*)::int FROM "V2ClientAccount" WHERE "organizationId"=$1 AND "status"='ACTIVE') AS "activeAccounts",
  (SELECT COUNT(*)::int FROM "V2ClientAccount" WHERE "organizationId"=$1 AND "status"='ACTIVE' AND "createdAt" <= NOW() - INTERVAL '30 days') AS "pastActiveAccounts",
  (SELECT COUNT(*)::int FROM "V2Project" WHERE "organizationId"=$1 AND "status"='ACTIVE') AS "activeProjects",
  (SELECT COUNT(*)::int FROM "V2Project" WHERE "organizationId"=$1 AND "status"='ACTIVE' AND "createdAt" <= NOW() - INTERVAL '30 days') AS "pastActiveProjects",
  (SELECT COUNT(*)::int FROM "V2ICPVersion" WHERE "organizationId"=$1 AND "status"='PUBLISHED' AND "deletedAt" IS NULL) AS "publishedIcps",
  (SELECT COUNT(*)::int FROM "V2ICPVersion" WHERE "organizationId"=$1 AND "status"='PUBLISHED' AND "deletedAt" IS NULL AND "createdAt" <= NOW() - INTERVAL '30 days') AS "pastPublishedIcps",
  (SELECT COUNT(*)::int FROM "V2ICPVersion" WHERE "organizationId"=$1 AND "deletedAt" IS NULL) AS "totalIcpVersions",
  (SELECT COUNT(*)::int FROM "V2ManagerReviewItem" WHERE "organizationId"=$1 AND "status"='OPEN' AND "deletedAt" IS NULL) AS "openReviewItems",
  (SELECT COUNT(*)::int FROM "V2ManagerReviewItem" WHERE "organizationId"=$1 AND "status"='OPEN' AND "deletedAt" IS NULL AND "createdAt" <= NOW() - INTERVAL '30 days') AS "pastOpenReviewItems",
  (SELECT COUNT(*)::int FROM "V2Job" WHERE "organizationId"=$1 AND "status"='QUEUED') AS "queuedJobs",
  (SELECT COUNT(*)::int FROM "V2Job" WHERE "organizationId"=$1 AND "status"='FAILED') AS "failedJobs",
  (SELECT COUNT(*)::int FROM "V2AiRunLog" WHERE "organizationId"=$1 AND "status" <> 'SKIPPED' AND "createdAt" >= NOW() - INTERVAL '30 days') AS "aiRuns",
  (SELECT COUNT(*)::int FROM "V2AiRunLog" WHERE "organizationId"=$1 AND "status" <> 'SKIPPED' AND "createdAt" >= NOW() - INTERVAL '60 days' AND "createdAt" < NOW() - INTERVAL '30 days') AS "pastAiRuns",
  (SELECT COUNT(*)::int FROM "V2Offer" WHERE "organizationId"=$1 AND "status"='ACTIVE') AS "activeOffers"
FROM la
`;

async function defaultLoadCounts(organizationId: string): Promise<HomeRawCounts> {
  const { prisma } = await import("@/lib/server/prisma");
  // D2 perf: ONE round-trip for all 22 dashboard counts (was 22 separate COUNT queries).
  // V2LeadAssignment is scanned once via FILTER aggregates (CTE); the other tables are
  // scalar subqueries. With the 3 list fetches that is 4 round-trips total (was 25).
  const countsFetch = traceQuery("home.counts", () =>
    prisma.$queryRawUnsafe<CountsRow[]>(HOME_COUNTS_SQL, organizationId)
  );
  const projectsFetch = traceQuery("home.projects", () => prisma.v2Project.findMany({
    where: { organizationId, status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: { clientAccount: true }
  }), (r) => r.length);

  const activityFetch = traceQuery("home.activity", () => prisma.v2AuditEvent.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: { actorUser: true }
  }), (r) => r.length);

  const pendingFetch = traceQuery("home.pending", () => prisma.v2ManagerReviewItem.findMany({
    where: { organizationId, status: 'OPEN' },
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: { createdByUser: true }
  }), (r) => r.length);

  const [countsRows, rawProjects, rawActivities, rawPending] = await Promise.all([
    countsFetch,
    projectsFetch,
    activityFetch,
    pendingFetch,
  ]);
  const c = countsRows[0] ?? ({} as CountsRow);
  const num = (value: unknown): number => Number(value ?? 0);

  // D1 accuracy: real stage (V2ProjectStage enum) + real updatedAt. The old health/owner/
  // due were fabricated (health 'healthy', owner 'System', due = createdAt+30d) AND never
  // rendered — removed (Invariant 7: no fabricated display data).
  const recentProjects = rawProjects.map(p => ({
    id: p.id,
    name: p.name,
    account: p.clientAccount.name,
    stage: formatProjectStage(p.stage),
    updatedAt: p.updatedAt.toISOString(),
  }));

  const teamActivities = rawActivities.map(a => ({
    id: a.id,
    user: a.actorUser?.name || 'System',
    action: a.eventType.replace(/_/g, ' ').toLowerCase(),
    time: a.createdAt.toISOString().split('T')[0]
  }));

  const pendingApprovals = rawPending.map(r => ({
    id: r.id,
    type: r.sourceType.replace(/_/g, ' ').toLowerCase(), // e.g. "manual sdr request"
    title: r.reasonCode.replace(/_/g, ' '), 
    updatedBy: r.createdByUser?.name || 'System',
    priority: r.priority, // HIGH, NORMAL, etc
    due: r.dueAt ? r.dueAt.toISOString().split('T')[0] : 'No due date'
  }));

  return {
    activeAccounts: num(c.activeAccounts),
    activeProjects: num(c.activeProjects),
    publishedIcps: num(c.publishedIcps),
    companiesInReview: num(c.openReviewItems),
    leadsAssigned: num(c.leadsAssigned),
    meetingsBooked: num(c.meetingsBooked),
    aiRuns: num(c.aiRuns),

    // Past counts
    pastActiveAccounts: num(c.pastActiveAccounts),
    pastActiveProjects: num(c.pastActiveProjects),
    pastPublishedIcps: num(c.pastPublishedIcps),
    pastCompaniesInReview: num(c.pastOpenReviewItems),
    pastLeadsAssigned: num(c.pastLeadsAssigned),
    pastMeetingsBooked: num(c.pastMeetingsBooked),
    pastAiRuns: num(c.pastAiRuns),

    totalLeads: num(c.totalLeads),
    qualified: num(c.qualified),
    inProgress: num(c.inProgress),
    meetingSet: num(c.meetingsBooked),
    won: num(c.won),
    openReviewItems: num(c.openReviewItems),
    queuedJobs: num(c.queuedJobs),
    failedJobs: num(c.failedJobs),
    recentProjects,
    teamActivities,
    pendingApprovals,
    activeOffers: num(c.activeOffers),
    totalIcpVersions: num(c.totalIcpVersions)
  };
}

function formatProjectStage(stage: string): string {
  return stage
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

export async function queryHomeOverview(
  organizationId: string,
  loadCounts: HomeCountsLoader = defaultLoadCounts
): Promise<HomeOverview> {
  return withSpan("home.overview", async () => buildHomeOverview(await loadCounts(organizationId)));
}
