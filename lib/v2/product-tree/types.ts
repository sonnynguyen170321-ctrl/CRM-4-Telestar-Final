import {
  V2ClientAccount,
  V2Project,
  V2Offer,
  V2ICPProfile,
  V2ICPVersion,
  V2ICPVersionStatus,
  V2User,
} from "@/app/generated/prisma/client";

export type {
  V2ClientAccount,
  V2Project,
  V2Offer,
  V2ICPProfile,
  V2ICPVersion,
};

export type ProductTreeOverview = {
  accountsCount: number;
  projectsCount: number;
  offersCount: number;
  icpProfilesCount: number;
  icpVersionsCount: number;
};

export type AccountListRow = {
  id: string;
  name: string;
  description: string | null;
  ownerName: string;
  region: string;
  industry: string;
  projectCount: number;
  offerCount: number;
  icpVersionCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ProjectListRow = {
  id: string;
  name: string;
  description: string | null;
  accountId: string;
  accountName: string;
  offerCount: number;
  icpVersionCount: number;
  leadAssignmentCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type OfferListRow = {
  id: string;
  name: string;
  description: string | null;
  projectId: string;
  projectName: string;
  accountId: string;
  accountName: string;
  icpProfileCount: number;
  icpVersionCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type IcpVersionListRow = {
  id: string;
  versionNumber: number;
  status: V2ICPVersionStatus;
  publishedAt: Date | null;
  publishedByUserId: string | null;
  rulesJson: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export type IcpProfileDetail = V2ICPProfile & {
  versions: IcpVersionListRow[];
};

export type OfferDetail = V2Offer & {
  project: V2Project & {
    clientAccount: V2ClientAccount;
  };
  icpProfiles: IcpProfileDetail[];
};

export type LeadsRollup = {
  leadsTotal: number;
  leadsQualified: number;
  leadsNeedsReview: number;
  leadsUnqualified: number;
};

export type ProjectDetail = V2Project & {
  clientAccount: V2ClientAccount;
  ownerUser: V2User | null;
  teamMembers: (import("@/app/generated/prisma/client").Prisma.V2ProjectTeamMemberGetPayload<{
    include: { user: true }
  }>)[];
  offers: (V2Offer & {
    icpProfiles: (V2ICPProfile & {
      versions: V2ICPVersion[];
    })[];
  })[];
  leadAssignmentCount: number;
} & LeadsRollup;

export type AccountDetail = V2ClientAccount & {
  ownerUser: V2User | null;
  projects: (V2Project & {
    leadAssignments: (import("@/app/generated/prisma/client").Prisma.V2LeadAssignmentGetPayload<{
      include: { company: true; contact: true; latestHardRuleAssessment: true }
    }>)[];
    offers: (V2Offer & {
      icpProfiles: (V2ICPProfile & {
        versions: V2ICPVersion[];
      })[];
    })[];
  })[];
} & LeadsRollup;

export type PaginatedResult<T> = {
  rows: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};
export type WorkspaceNextAction =
  | "Create project"
  | "Add offer"
  | "Publish ICP"
  | "Upload leads"
  | "Enrich companies"
  | "Assign owners"
  | "Inspect leads"
  | "Monitor outreach";

export type WorkspaceReadiness = {
  score: number;
  blockers: string[];
  checks: Array<{ key: string; label: string; ok: boolean; detail: string }>;
  nextAction: WorkspaceNextAction;
  risk: "ready" | "attention" | "blocked";
};

export type WorkspaceHealthRollup = LeadsRollup & {
  leadsNotScored: number;
  leadsUnassigned: number;
  companiesTotal: number;
  companiesEnriched: number;
  contactsTotal: number;
  contactsWithEmail: number;
  contactsMissingEmail: number;
  activeEnrollments: number;
  scheduledMessages: number;
  sentMessages: number;
  repliedMessages: number;
  bouncedMessages: number;
  failedMessages: number;
  runningRuntimeRuns: number;
  recentActivityCount: number;
};

export type WorkspaceRunningWorkItem = {
  id: string;
  kind: "runtime" | "enrollment" | "message" | "activity";
  label: string;
  status: string;
  context: string;
  occurredAt: Date | string | null;
};

export type WorkspaceInsightEntity = {
  id: string;
  kind: "company" | "contact" | "lead";
  name: string;
  subtitle: string;
  status: string;
  score: number | null;
  href: string;
};

export type AccountWorkspaceAccountRow = AccountListRow &
  WorkspaceHealthRollup & {
    readiness: WorkspaceReadiness;
  };

export type AccountWorkspaceProjectRow = ProjectListRow &
  WorkspaceHealthRollup & {
    ownerName: string;
    readiness: WorkspaceReadiness;
  };

export type AccountWorkspaceOfferRow = OfferListRow &
  WorkspaceHealthRollup & {
    readiness: WorkspaceReadiness;
    icpVersions: Array<{
      id: string;
      profileId: string;
      profileName: string;
      versionNumber: number;
      status: string;
      publishedAt: Date | string | null;
    }>;
  };

export type AccountWorkspaceIcpRow = WorkspaceHealthRollup & {
  id: string;
  profileId: string;
  profileName: string;
  versionNumber: number;
  status: string;
  publishedAt: Date | string | null;
  offerId: string;
  offerName: string;
  projectId: string;
  projectName: string;
  accountId: string;
  accountName: string;
  readiness: WorkspaceReadiness;
};

export type AccountWorkspaceSelectedContext = {
  accountId: string | null;
  projectId: string | null;
  offerId: string | null;
  icpVersionId: string | null;
  drawer: "account" | "project" | "offer" | "icp" | "company" | "contact" | "lead" | null;
  health: WorkspaceHealthRollup;
  readiness: WorkspaceReadiness | null;
  runningWork: WorkspaceRunningWorkItem[];
  companies: WorkspaceInsightEntity[];
  contacts: WorkspaceInsightEntity[];
  leads: WorkspaceInsightEntity[];
};

export type AccountWorkspaceView = {
  overview: ProductTreeOverview & WorkspaceHealthRollup;
  accounts: PaginatedResult<AccountWorkspaceAccountRow>;
  projects: PaginatedResult<AccountWorkspaceProjectRow>;
  offers: PaginatedResult<AccountWorkspaceOfferRow>;
  icps: PaginatedResult<AccountWorkspaceIcpRow>;
  selectedAccount: AccountDetail | null;
  selectedProject: ProjectDetail | null;
  selectedOffer: OfferDetail | null;
  selectedIcp: AccountWorkspaceIcpRow | null;
  selectedContext: AccountWorkspaceSelectedContext;
  selectedAccountReadiness: WorkspaceReadiness | null;
  selectedProjectReadiness: WorkspaceReadiness | null;
  view: "overview" | "projects" | "offers" | "icps" | "companies" | "contacts" | "leads" | "activity";
};
