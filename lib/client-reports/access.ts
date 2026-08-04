export interface ReportUser {
  id: string;
  role: string;
  tenantId?: string;
  managedCampaignIds?: string[];
  podSdrIds?: string[];
}

export function canCreateClientReport(user: { role: string }): boolean {
  return ['director', 'floor_manager', 'team_lead', 'sdr'].includes(user.role);
}

export function canApproveClientReport(user: { role: string }): boolean {
  return ['director', 'floor_manager'].includes(user.role);
}

export function canShareClientReport(user: { role: string }): boolean {
  return ['director', 'floor_manager', 'team_lead'].includes(user.role);
}

export function canArchiveClientReport(user: { role: string }): boolean {
  return ['director', 'floor_manager'].includes(user.role);
}

export function canEditClientReport(
  user: { id: string; role: string; tenantId?: string },
  report: { generatedById: string; status: string; tenantId?: string }
): boolean {
  if (report.tenantId && user.tenantId && report.tenantId !== user.tenantId) {
    return false;
  }
  // If report is approved/shared/archived, it is frozen and cannot be edited
  if (['approved', 'shared', 'archived'].includes(report.status)) {
    return false;
  }
  // Drafts can be edited by director, floor_manager, team_lead, or authoring SDR
  if (['director', 'floor_manager', 'team_lead'].includes(user.role)) return true;
  if (user.role === 'sdr' && report.generatedById === user.id) return true;
  return false;
}

/** Roles that legitimately see every client report in their tenant. */
const REPORT_WIDE_SCOPE_ROLES = ['director', 'floor_manager'];

export interface ClientReportScope {
  seeAll: boolean;
  campaignIds: Set<string>;
}

/**
 * Resolve a caller's report visibility once per request.
 *
 * Kept separate from `canViewClientReport` on purpose: the list route filters
 * reports synchronously (`app/api/client-reports/route.ts`), and an async
 * predicate there would hand `.filter()` a Promise — always truthy — quietly
 * admitting every row. Resolving the scope up front also avoids one query per
 * report.
 */
export async function getClientReportScope(
  user: { id: string; role: string; tenantId?: string }
): Promise<ClientReportScope> {
  if (REPORT_WIDE_SCOPE_ROLES.includes(user.role)) {
    return { seeAll: true, campaignIds: new Set() };
  }

  // Imported lazily so this module stays usable from unit tests that do not
  // stand up the auth/prisma stack.
  const { getVisibleCampaignIds } = await import('@/lib/auth');
  const ids = await getVisibleCampaignIds(user as never);

  return ids === null
    ? { seeAll: true, campaignIds: new Set() }
    : { seeAll: false, campaignIds: new Set(ids) };
}

/**
 * Can this user read this report?
 *
 * Previously returned `true` for every role, so the one call site that used it
 * was a no-op and both export routes had no check at all — any SDR could pull
 * any client's pipeline values, named accounts and contact titles. In a BPO that
 * is a client-confidentiality breach, not just a permissions bug.
 *
 * Rule: managers see everything; everyone else sees a report only for a campaign
 * in their scope, or one they authored themselves. A client-wide report
 * (`campaignId: null`) spans campaigns the caller may not be on, so it stays
 * manager-or-author only.
 */
export function canViewClientReport(
  user: { id: string; role: string; tenantId?: string },
  report: { generatedById?: string; campaignId?: string | null; tenantId?: string; status?: string; audience?: string },
  scope: ClientReportScope
): boolean {
  if (report.tenantId && user.tenantId && report.tenantId !== user.tenantId) {
    return false;
  }
  if (scope.seeAll) return true;
  if (report.generatedById && report.generatedById === user.id) return true;
  if (report.campaignId && scope.campaignIds.has(report.campaignId)) return true;
  return false;
}

