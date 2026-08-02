export interface ReportUser {
  id: string;
  role: string;
  tenantId: string;
  managedCampaignIds?: string[];
  podSdrIds?: string[];
}

export function canCreateClientReport(user: { role: string }): boolean {
  return ['director', 'floor_manager', 'team_lead'].includes(user.role);
}

export function canApproveClientReport(user: { role: string }): boolean {
  return ['director', 'floor_manager'].includes(user.role);
}

export function canShareClientReport(user: { role: string }): boolean {
  return ['director', 'floor_manager'].includes(user.role);
}

export function canArchiveClientReport(user: { role: string }): boolean {
  return ['director', 'floor_manager'].includes(user.role);
}

export function canEditClientReport(user: { id: string; role: string }, report: { generatedById: string; status: string }): boolean {
  // If report is approved/archived, only director or floor_manager can edit / re-open
  if (['approved', 'shared', 'archived'].includes(report.status)) {
    return ['director', 'floor_manager'].includes(user.role);
  }
  // Drafts can be edited by director, floor_manager, or the authoring team_lead
  if (['director', 'floor_manager'].includes(user.role)) return true;
  if (user.role === 'team_lead' && report.generatedById === user.id) return true;
  return false;
}

export function canViewClientReport(
  user: { id: string; role: string },
  report: { generatedById?: string; campaignId?: string | null }
): boolean {
  if (['director', 'floor_manager', 'leadgen_manager'].includes(user.role)) return true;
  if (user.role === 'team_lead') return true;
  if (user.role === 'sdr') return true;
  return false;
}
