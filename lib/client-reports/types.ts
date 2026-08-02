export type ReportStatus = 'draft' | 'internal_review' | 'approved' | 'shared' | 'archived';
export type ReportPeriodType = 'weekly' | 'monthly' | 'custom';
export type ReportAudience = 'internal' | 'client';
export type ReportExportType = 'pdf' | 'csv' | 'share_link';

export type SdrDisplayMode = 'full_name' | 'first_last_initial' | 'anonymized';

export interface ClientReportSnapshot {
  meta: {
    clientId: string;
    clientName: string;
    campaignId?: string;
    campaignName?: string;
    periodType: ReportPeriodType;
    periodStart: string; // ISO date
    periodEnd: string; // ISO date
    generatedAt: string; // ISO date
    generatedById: string;
    generatedByName: string;
    approvedAt?: string;
    approvedByName?: string;
    audience: ReportAudience;
    sdrDisplayMode?: SdrDisplayMode;
    version: 'v1';
  };
  kpis: {
    totalLeadsAssigned: number;
    newLeadsAdded: number;
    leadsTouched: number;
    touchpointsCompleted: number;
    replies: number;
    positiveReplies: number;
    replyRate: number; // e.g. 0.15 = 15%
    positiveReplyRate: number;
    meetingsBooked: number;
    meetingsCompleted: number;
    noShows: number;
    noShowRate: number;
    qualifiedMeetings: number;
    opportunitiesSubmitted: number;
    clientAcceptedOpportunities: number;
    clientRejectedOpportunities: number;
    clientAcceptanceRate: number;
    activePipelineValue: number;
    wonValue: number;
    opportunityWinRate: number;
  };
  funnel: Array<{
    stage: string;
    label: string;
    count: number;
    conversionRate?: number;
  }>;
  channels: Array<{
    channel: 'email' | 'call' | 'linkedin' | 'whatsapp';
    label: string;
    touchpoints: number;
    replies: number;
    meetingsBooked: number;
    conversionRate: number;
  }>;
  emailChannelHealth?: {
    overall: 'Good' | 'Watch' | 'Risk';
    emailsSent: number;
    replyRate: number;
    bounceRate: number;
    correctiveActions: string[];
  };
  leadQuality: {
    imported?: number;
    validated?: number;
    qualified?: number;
    rejected?: number;
    duplicateRate?: number;
    averageEmailScore?: number;
    topSources?: Array<{ source: string; qualified: number; meetings: number }>;
  };
  meetings: Array<{
    id: string;
    company: string;
    contactName?: string;
    contactTitle?: string;
    scheduledAt: string;
    status: string;
    outcome?: string;
    summaryNotes?: string;
    nextStep?: string;
    sdrDisplayName?: string;
  }>;
  opportunities: Array<{
    id: string;
    company: string;
    title: string;
    stage: string;
    handoffStatus: string;
    value?: number;
    probability?: number;
    expectedCloseDate?: string;
    nextStep?: string;
    rejectedReason?: string;
  }>;
  reps: Array<{
    repId: string;
    displayName: string;
    leadsTouched: number;
    touchpoints: number;
    replies: number;
    meetingsBooked: number;
    qualifiedMeetings: number;
    acceptedOpportunities: number;
  }>;
  insights: {
    summary?: string;
    keyWins: string[];
    blockers: string[];
    recommendations: string[];
    clientActions: string[];
  };
}

export interface ClientReportListItem {
  id: string;
  clientId: string;
  clientName: string;
  campaignId?: string | null;
  campaignName?: string | null;
  title: string;
  periodType: ReportPeriodType;
  periodStart: string;
  periodEnd: string;
  status: ReportStatus;
  audience: ReportAudience;
  generatedById: string;
  generatedByName: string;
  approvedById?: string | null;
  approvedByName?: string | null;
  approvedAt?: string | null;
  sharedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  shareLinksCount: number;
  exportsCount: number;
}

export interface CreateReportInput {
  clientId: string;
  campaignId?: string | null;
  title: string;
  periodType: ReportPeriodType;
  periodStart: string;
  periodEnd: string;
  audience?: ReportAudience;
  sdrDisplayMode?: SdrDisplayMode;
  summary?: string | null;
  keyWins?: string[];
  blockers?: string[];
  recommendations?: string[];
  clientActions?: string[];
}

export interface UpdateReportInput {
  title?: string;
  audience?: ReportAudience;
  summary?: string | null;
  keyWins?: string[];
  blockers?: string[];
  recommendations?: string[];
  clientActions?: string[];
  status?: ReportStatus;
}
