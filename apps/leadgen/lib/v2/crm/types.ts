import type { CompanyIntelligenceProfileSummary } from "@/lib/v2/company-intelligence/readModel";

export type LeadWorkspaceQualification =
  | "QUALIFIED"
  | "NEEDS_REVIEW"
  | "UNQUALIFIED"
  | "COMPANY_QUALIFIED_NEEDS_CONTACT"
  | "NOT_SCORED";

export type LeadWorkspaceAccountPreRank =
  | "STRONG_ACCOUNT_FIT"
  | "POSSIBLE_ACCOUNT_FIT"
  | "WEAK_FIT"
  | "CLEAR_MISMATCH";

export const V2_LEAD_WORKFLOW_STATUSES = [
  "NEW",
  "ASSIGNED",
  "WORKING",
  "CONTACTED",
  "RESPONDED",
  "MEETING_BOOKED",
  "MEETING_DONE",
  "NURTURE",
  "PAUSED",
  "NOT_INTERESTED",
  "BOUNCED",
  "SUPPRESSED",
  "DISQUALIFIED",
  "ARCHIVED",
] as const;

export type V2LeadWorkflowStatusValue =
  (typeof V2_LEAD_WORKFLOW_STATUSES)[number];

export type LeadWorkspaceAssignmentLevel = "COMPANY" | "CONTACT";

export type LeadWorkspaceScoredFilter = "scored" | "unscored";

export type LeadWorkspaceConfidenceBand = "HIGH" | "MEDIUM" | "LOW";

export type LeadWorkspaceFilters = {
  clientAccountId?: string;
  projectId?: string;
  icpVersionId?: string;
  companyId?: string;
  workflowStatus?: string[];
  excludeWorkflowStatus?: string[];
  qualification?: LeadWorkspaceQualification[];
  excludeQualification?: LeadWorkspaceQualification[];
  assignmentLevel?: LeadWorkspaceAssignmentLevel;
  scored?: LeadWorkspaceScoredFilter;
  confidenceBand?: LeadWorkspaceConfidenceBand[];
  country?: string[];
  excludeCountry?: string[];
  domain?: string;
  /** Lead-created date range (LeadAssignment.createdAt). ISO date strings (YYYY-MM-DD); createdTo
   *  is inclusive of its whole day. Lets an SDR slice the pipeline by recency/cohort. */
  createdFrom?: string;
  createdTo?: string;
  search?: string;
  contactReadiness?: "has_email" | "missing_email" | "ready" | "review" | "linkedin_only" | "company_phone" | "missing";
  enrollment?: "enrolled" | "not_enrolled";
  intelligenceStatus?: Array<"EXTRACTED" | "PARTIAL" | "FAILED" | "PLACEHOLDER" | "MISSING">;
  excludeIntelligenceStatus?: Array<"EXTRACTED" | "PARTIAL" | "FAILED" | "PLACEHOLDER" | "MISSING">;
  factToken?: string[];
  excludeFactToken?: string[];
  /** W5: hierarchical served-vertical keys (e.g. "IND_TEXTILES", "FIN_PAYMENTS"). */
  servedVertical?: string[];
};

export type LeadContextIcpVersionOption = {
  id: string;
  label: string;
  versionNumber: number;
  icpProfileName: string;
  status: string;
  offerId: string;
};

export type LeadContextOfferOption = {
  id: string;
  name: string;
  icpVersions: LeadContextIcpVersionOption[];
};

export type LeadContextProjectOption = {
  id: string;
  name: string;
  icpVersions: LeadContextIcpVersionOption[];
  offers: LeadContextOfferOption[];
};

export type LeadContextAccountOption = {
  id: string;
  name: string;
  projects: LeadContextProjectOption[];
};

export type LeadContextOptions = {
  accounts: LeadContextAccountOption[];
};

export type LeadWorkspaceQueryInput = {
  organizationId: string;
  page?: number;
  pageSize?: number;
  filters?: LeadWorkspaceFilters;
};

export type LeadWorkspaceAssessment = {
  id: string;
  fitScore: number;
  confidence: number;
  confidenceScore: number | null;
  confidenceBand: LeadWorkspaceConfidenceBand | null;
  qualification: LeadWorkspaceQualification;
  accountPreRank: LeadWorkspaceAccountPreRank | null;
  companyType: string | null;
  reason: string;
  oneSentenceCompanySummary: string | null;
  evidenceSnapshotJson: unknown;
  hardGateResultsJson: unknown;
  confidenceBreakdownJson: unknown;
  dataQualityJson: unknown;
  scoringSource: string;
  scoringVersion: string;
  inputFingerprint: string;
  icpRulesHash: string | null;
  previousAssessmentId: string | null;
  createdAt: string;
};

// The lead drawer surfaces the SAME full intelligence profile the Company drawer
// does, fed through the one shared presenter (CINT5). Previously this was a
// narrowed shape that dropped classification/confidence/sourceCoverage — the exact
// fields presentCompanyIntelligence needs — so the shared panel couldn't be used
// here. getLeadWorkspaceDetail already returns the full summary at runtime.
export type LeadWorkspaceRow = {
  leadAssignmentId: string;
  organizationId: string;
  projectId: string;
  projectName: string;
  icpVersionId: string;
  icpVersionNumber: number;
  icpProfileName: string;
  companyId: string;
  companyName: string;
  companyDomain: string | null;
  companyWebsiteUrl: string | null;
  companyCountry: string | null;
  contactId: string | null;
  contactName: string | null;
  contactDisplayName: string | null;
  contactTitle: string | null;
  contactEmail: string | null;
  hasVerifiedEmail: boolean;
  assignmentLevel: LeadWorkspaceAssignmentLevel;
  workflowStatus: string;
  qualification: LeadWorkspaceQualification;
  accountPreRank: LeadWorkspaceAccountPreRank | null;
  companyIntelligenceStatus: string | null;
  companyFactTokens: string[];
  activeEnrollmentCount: number;
  sourceIngestionJobId: string | null;
  sourceIngestionRowId: string | null;
  // Contacts & Leads people layer (mock parity) — all from real DB joins.
  ownerUserId: string | null;
  ownerName: string | null;
  assignedAt: string | null;
  lastTouchAt: string | null;
  lastTouchChannel: string | null;
  meetingStatus: "BOOKED" | "DONE" | "NONE";
  reviewStatus: "REVIEWED" | "NOT_REVIEWED";
  linkedProjectCount: number;
  linkedIcpCount: number;
  createdAt: string;
  updatedAt: string;
  latestAssessment: LeadWorkspaceAssessment | null;
};

export type LeadWorkspaceDetail = LeadWorkspaceRow & {
  assessmentHistory: LeadWorkspaceAssessment[];
  companyIntelligence: CompanyIntelligenceProfileSummary | null;
};

export type LeadWorkspaceFilterOptions = {
  context: LeadContextOptions;
  projects: Array<{ id: string; name: string }>;
  icpVersions: Array<{
    id: string;
    label: string;
    versionNumber: number;
    icpProfileName: string;
  }>;
  factTokens: string[];
  factFacets: LeadWorkspaceFactFacetGroup[];
};

export type LeadWorkspaceFactFacetGroup = {
  key: string;
  label: string;
  options: Array<{ token: string; label: string; count: number }>;
};

export type LeadWorkspaceQueryResult = {
  rows: LeadWorkspaceRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};
