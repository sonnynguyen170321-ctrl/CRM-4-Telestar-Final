// W1: the single source of truth for the LeadAssignment-centered route language. Every
// surface (leads, contacts, companies, outreach) builds these links here instead of
// string-concatenating, so the cross-page SDR flow stays consistent and refactorable.
// Pure — usable from server and client components.

export type CampaignLeadFilter = {
  projectId?: string;
  icpVersionId?: string;
  clientAccountId?: string;
  ownerUserId?: string;
  qualification?: string;
};

function qs(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) sp.set(key, value);
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Open a lead's drawer in the workspace. */
export function leadDrawerHref(leadAssignmentId: string): string {
  return `/v2/workspace/leads${qs({ selectedLeadId: leadAssignmentId })}`;
}

/** The workspace filtered to one company's leads. */
export function companyLeadsHref(companyId: string): string {
  return `/v2/workspace/leads${qs({ companyId })}`;
}

/** Open a company's drawer in the company directory. */
export function companyDrawerHref(companyId: string): string {
  return `/v2/crm/companies${qs({ companyId })}`;
}

/** A one-off, suppression-gated compose for a lead. */
export function composeHref(leadAssignmentId: string): string {
  return `/v2/outreach/compose${qs({ leadAssignmentId })}`;
}

/** The Unibox thread for a lead. */
export function inboxThreadHref(leadAssignmentId: string): string {
  return `/v2/outreach/inbox/${encodeURIComponent(leadAssignmentId)}`;
}

/** A contact's drawer. */
export function contactDrawerHref(contactId: string): string {
  return `/v2/crm/contacts${qs({ contactId })}`;
}

/** New campaign seeded from an explicit lead SELECTION. */
export function newCampaignFromSelectionHref(leadAssignmentIds: string[]): string {
  const ids = leadAssignmentIds.filter(Boolean);
  return `/v2/outreach/campaigns/new${qs({ source: "selected", leadIds: ids.join(",") })}`;
}

/** New campaign seeded from the current FILTER (project / ICP / owner / qualification). */
export function newCampaignFromFilterHref(filter: CampaignLeadFilter): string {
  return `/v2/outreach/campaigns/new${qs({ source: "filter", ...filter })}`;
}

/** An EXISTING campaign's review stage, scoped to a lead SELECTION. */
export function campaignWithSelectionHref(campaignId: string, leadAssignmentIds: string[]): string {
  const ids = leadAssignmentIds.filter(Boolean);
  return `/v2/outreach/campaigns/${encodeURIComponent(campaignId)}${qs({ source: "selected", leadIds: ids.join(",") })}`;
}

/** Parse the `leadIds` query value back into an id array (consumed by the campaign source). */
export function parseLeadIdsParam(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}
