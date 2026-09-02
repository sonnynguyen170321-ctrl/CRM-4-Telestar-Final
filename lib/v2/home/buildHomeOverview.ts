// R1: home / executive command-center overview. Pure shaping of tenant-scoped
// counts into the metrics + funnel + next-actions the /v2/home UI renders. The
// thin query (queryHomeOverview) gathers the counts; this computes the derived
// values. No fabricated data — every number maps to a real count.

export type HomeRecentProject = {
  id: string;
  name: string;
  account: string;
  stage: string; // real V2ProjectStage, formatted (was status-derived)
  updatedAt: string; // ISO — drives an honest "updated X ago" (was hardcoded "2h ago")
};

export type HomeTeamActivity = {
  id: string;
  user: string;
  action: string;
  time: string;
};

export type HomePendingApproval = {
  id: string;
  type: string;
  title: string;
  updatedBy: string;
  priority: string;
  due: string;
};

export type HomeRawCounts = {
  activeAccounts: number;
  activeProjects: number;
  publishedIcps: number;
  companiesInReview: number;
  leadsAssigned: number;
  meetingsBooked: number;
  aiRuns: number;

  // Past counts
  pastActiveAccounts: number;
  pastActiveProjects: number;
  pastPublishedIcps: number;
  pastCompaniesInReview: number;
  pastLeadsAssigned: number;
  pastMeetingsBooked: number;
  pastAiRuns: number;

  // funnel inputs (LeadAssignment-level, not company-level)
  totalLeads: number;
  qualified: number;
  inProgress: number;
  meetingSet: number;
  won: number;
  // next-action inputs
  openReviewItems: number;
  queuedJobs: number;
  failedJobs: number;
  
  // product tree real data
  activeOffers: number;
  totalIcpVersions: number;

  recentProjects: HomeRecentProject[];
  teamActivities: HomeTeamActivity[];
  pendingApprovals: HomePendingApproval[];
};

export type MetricWithTrend = {
  value: number;
  trendPct: number; // e.g. 8 for +8%, -5 for -5%
};

export type HomeOverview = {
  metrics: {
    activeAccounts: MetricWithTrend;
    activeProjects: MetricWithTrend;
    publishedIcps: MetricWithTrend;
    companiesInReview: MetricWithTrend;
    leadsAssigned: MetricWithTrend;
    meetingsBooked: MetricWithTrend;
    managerReviewItems: MetricWithTrend; // Note: using companiesInReview/openReviewItems for this
    aiRuns: MetricWithTrend;
  };
  productTree: {
    activeOffers: number;
    totalIcpVersions: number;
  };
  funnel: {
    totalLeads: number;
    qualified: number;
    inProgress: number;
    meetingSet: number;
    won: number;
    qualifiedRate: number;
    winRate: number;
  };
  nextActions: Array<{ id: string; label: string; count: number; href: string }>;
  dataHealth: { queuedJobs: number; failedJobs: number };
  recentProjects: HomeRecentProject[];
  teamActivities: HomeTeamActivity[];
  pendingApprovals: HomePendingApproval[];
};

function rate(n: number, d: number): number {
  return d > 0 ? Number((n / d).toFixed(4)) : 0;
}

function trend(current: number, past: number): number {
  if (past === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - past) / past) * 100);
}

export function buildHomeOverview(counts: HomeRawCounts): HomeOverview {
  const nextActions: HomeOverview["nextActions"] = [];
  if (counts.openReviewItems > 0) {
    nextActions.push({ id: "review", label: `Review ${counts.openReviewItems} manager items`, count: counts.openReviewItems, href: "/v2/reviews" });
  }
  if (counts.failedJobs > 0) {
    nextActions.push({ id: "failed_jobs", label: `Resolve ${counts.failedJobs} failed jobs`, count: counts.failedJobs, href: "/v2/ingestion/jobs" });
  }
  if (counts.companiesInReview > 0) {
    nextActions.push({ id: "leads", label: `Work ${counts.leadsAssigned} assigned leads`, count: counts.leadsAssigned, href: "/v2/workspace/leads" });
  }

  return {
    metrics: {
      activeAccounts: { value: counts.activeAccounts, trendPct: trend(counts.activeAccounts, counts.pastActiveAccounts) },
      activeProjects: { value: counts.activeProjects, trendPct: trend(counts.activeProjects, counts.pastActiveProjects) },
      publishedIcps: { value: counts.publishedIcps, trendPct: trend(counts.publishedIcps, counts.pastPublishedIcps) },
      companiesInReview: { value: counts.companiesInReview, trendPct: trend(counts.companiesInReview, counts.pastCompaniesInReview) },
      leadsAssigned: { value: counts.leadsAssigned, trendPct: trend(counts.leadsAssigned, counts.pastLeadsAssigned) },
      meetingsBooked: { value: counts.meetingsBooked, trendPct: trend(counts.meetingsBooked, counts.pastMeetingsBooked) },
      managerReviewItems: { value: counts.openReviewItems, trendPct: trend(counts.openReviewItems, counts.pastCompaniesInReview) },
      aiRuns: { value: counts.aiRuns, trendPct: trend(counts.aiRuns, counts.pastAiRuns) },
    },
    productTree: {
      activeOffers: counts.activeOffers,
      totalIcpVersions: counts.totalIcpVersions,
    },
    funnel: {
      totalLeads: counts.totalLeads,
      qualified: counts.qualified,
      inProgress: counts.inProgress,
      meetingSet: counts.meetingSet,
      won: counts.won,
      qualifiedRate: rate(counts.qualified, counts.totalLeads),
      winRate: rate(counts.won, counts.totalLeads),
    },
    nextActions,
    dataHealth: { queuedJobs: counts.queuedJobs, failedJobs: counts.failedJobs },
    recentProjects: counts.recentProjects,
    teamActivities: counts.teamActivities,
    pendingApprovals: counts.pendingApprovals,
  };
}
