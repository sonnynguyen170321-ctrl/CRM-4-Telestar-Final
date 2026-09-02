// V2 route constants — single source of truth for all V2 route strings.
// Every surface builds links from these helpers instead of string-concatenating,
// so cross-page navigation stays consistent and refactorable.
// Pure functions — usable from server and client components.

function qs(params: Record<string, string | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null) sp.set(key, value);
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

// ── Workspace ──
export const ROUTES = {
  HOME: "/v2/home",
  AI: "/v2/ai",
  SETTINGS: "/v2/settings",
  ADMIN: "/v2/admin",

  // Workspace
  WORKSPACE_ACCOUNTS: "/v2/workspace/accounts",
  WORKSPACE_LEADS: "/v2/workspace/leads",
  WORKSPACE_PROJECTS: "/v2/workspace/projects",

  // CRM
  CRM_CONTACTS: "/v2/crm/contacts",
  CRM_CONTACTS_NEW: "/v2/crm/contacts/new",
  CRM_COMPANIES: "/v2/crm/companies",

  // Ingestion
  INGESTION_JOBS: "/v2/ingestion/jobs",
  INGESTION_UPLOADS: "/v2/ingestion/uploads",

  // Outreach
  OUTREACH: "/v2/outreach",
  OUTREACH_CAMPAIGNS: "/v2/outreach/campaigns",
  OUTREACH_COMPOSE: "/v2/outreach/compose",
  OUTREACH_TEMPLATES: "/v2/outreach/templates",
  OUTREACH_SENDERS: "/v2/outreach/senders",
  OUTREACH_SUPPRESSION: "/v2/outreach/suppression",
  OUTREACH_PERFORMANCE: "/v2/outreach/performance",

  // ICP
  ICP_LIBRARY: "/v2/icp-library",

  // Research
  RESEARCH: "/v2/research",

  // Reviews
  REVIEWS: "/v2/reviews",

  // Reports
  REPORTS: "/v2/reports",

  // Activity recaps
  ACTIVITY_RECAPS: "/v2/activity-recaps",

  // Offers
  OFFERS: "/v2/offers",
} as const;

// ── Workspace helpers ──
export function projectHref(projectId: string): string {
  return `${ROUTES.WORKSPACE_PROJECTS}/${encodeURIComponent(projectId)}`;
}

export function projectTabHref(projectId: string, tab: string): string {
  return `${projectHref(projectId)}/${tab}`;
}

export function accountProjectHref(accountId: string, projectId: string): string {
  return `${ROUTES.WORKSPACE_ACCOUNTS}${qs({ view: "projects", accountId, projectId })}`;
}

// ── CRM helpers ──
export function leadWorkspaceHref(params?: Record<string, string | undefined | null>): string {
  return params ? `${ROUTES.WORKSPACE_LEADS}${qs(params)}` : ROUTES.WORKSPACE_LEADS;
}

export function companyDirectoryHref(companyId?: string): string {
  return companyId
    ? `${ROUTES.CRM_COMPANIES}${qs({ companyId })}`
    : ROUTES.CRM_COMPANIES;
}

export function contactHref(contactId: string): string {
  return `${ROUTES.CRM_CONTACTS}${qs({ contactId })}`;
}

export function newContactHref(companyId?: string): string {
  return companyId
    ? `${ROUTES.CRM_CONTACTS_NEW}${qs({ companyId })}`
    : ROUTES.CRM_CONTACTS_NEW;
}

// ── ICP helpers ──
export function icpLibraryHref(icpVersionId?: string): string {
  return icpVersionId
    ? `${ROUTES.ICP_LIBRARY}${qs({ icpVersionId })}`
    : ROUTES.ICP_LIBRARY;
}

// ── Ingestion helpers ──
export function ingestionJobHref(jobId: string): string {
  return `/v2/ingestion/${encodeURIComponent(jobId)}`;
}

// ── Outreach helpers ──
export function campaignHref(campaignId: string, tab?: string): string {
  const base = `/v2/outreach/campaigns/${encodeURIComponent(campaignId)}`;
  return tab ? `${base}${qs({ tab })}` : base;
}

export function composeHref(leadAssignmentId?: string): string {
  return leadAssignmentId
    ? `${ROUTES.OUTREACH_COMPOSE}${qs({ leadAssignmentId })}`
    : ROUTES.OUTREACH_COMPOSE;
}

export function inboxThreadHref(leadAssignmentId: string): string {
  return `/v2/outreach/inbox/${encodeURIComponent(leadAssignmentId)}`;
}

// ── Review helpers ──
export function reviewHref(reviewItemId?: string): string {
  return reviewItemId
    ? `${ROUTES.REVIEWS}${qs({ reviewItemId })}`
    : ROUTES.REVIEWS;
}

// ── Research helpers ──
export function researchHref(runId?: string): string {
  return runId
    ? `${ROUTES.RESEARCH}${qs({ runId })}`
    : ROUTES.RESEARCH;
}

// ── Activity recap helpers ──
export function activityRecapHref(jobId: string): string {
  return `/v2/activity-recaps/${encodeURIComponent(jobId)}`;
}
