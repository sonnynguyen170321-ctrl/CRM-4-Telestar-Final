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

export function canViewClientReport(
  user: { id: string; role: string; tenantId?: string },
  report: { generatedById?: string; campaignId?: string | null; tenantId?: string; status?: string; audience?: string }
): boolean {
  if (report.tenantId && user.tenantId && report.tenantId !== user.tenantId) {
    return false;
  }
  if (['director', 'floor_manager', 'leadgen_manager'].includes(user.role)) return true;
  if (user.role === 'team_lead') return true;
  if (user.role === 'sdr') return true;
  return false;
}

