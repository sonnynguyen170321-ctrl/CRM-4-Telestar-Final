import { prisma } from "@/lib/server/prisma";
import {
  ProductTreeOverview,
  AccountListRow,
  ProjectListRow,
  OfferListRow,
  AccountDetail,
  ProjectDetail,
  OfferDetail,
  PaginatedResult,
  LeadsRollup,
  AccountWorkspaceView,
  AccountWorkspaceAccountRow,
  AccountWorkspaceProjectRow,
  AccountWorkspaceOfferRow,
  AccountWorkspaceIcpRow,
  WorkspaceHealthRollup,
  WorkspaceInsightEntity,
  WorkspaceNextAction,
  WorkspaceReadiness,
  WorkspaceRunningWorkItem,
} from "./types";
import { Prisma } from "@/app/generated/prisma/client";

const DEFAULT_PAGE_SIZE = 50;

type LeadsRollupRow = {
  total: number;
  qualified: number;
  needsReview: number;
  unqualified: number;
};

async function queryLeadsRollup(scope: Prisma.Sql): Promise<LeadsRollup> {
  const rows = await prisma.$queryRaw<LeadsRollupRow[]>(Prisma.sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE a."qualification" = 'QUALIFIED')::int AS qualified,
      COUNT(*) FILTER (WHERE a."qualification" = 'NEEDS_REVIEW')::int AS "needsReview",
      COUNT(*) FILTER (WHERE a."qualification" = 'UNQUALIFIED')::int AS unqualified
    FROM "V2LeadAssignment" la
    LEFT JOIN "V2HardRuleAssessment" a ON a."id" = la."latestHardRuleAssessmentId"
    WHERE ${scope}
      AND la."status" = 'ACTIVE'
      AND la."deletedAt" IS NULL
  `);

  const row = rows[0];

  return {
    leadsTotal: row?.total ?? 0,
    leadsQualified: row?.qualified ?? 0,
    leadsNeedsReview: row?.needsReview ?? 0,
    leadsUnqualified: row?.unqualified ?? 0,
  };
}

export async function queryProductTreeOverview({
  organizationId,
}: {
  organizationId: string;
}): Promise<ProductTreeOverview> {
  const [
    accountsCount,
    projectsCount,
    offersCount,
    icpProfilesCount,
    icpVersionsCount,
  ] = await Promise.all([
    prisma.v2ClientAccount.count({
      where: { organizationId, status: "ACTIVE" },
    }),
    prisma.v2Project.count({
      where: { organizationId, status: "ACTIVE" },
    }),
    prisma.v2Offer.count({
      where: { organizationId, status: "ACTIVE" },
    }),
    prisma.v2ICPProfile.count({
      where: { organizationId, status: "ACTIVE" },
    }),
    prisma.v2ICPVersion.count({
      where: { organizationId, deletedAt: null },
    }),
  ]);

  return {
    accountsCount,
    projectsCount,
    offersCount,
    icpProfilesCount,
    icpVersionsCount,
  };
}

export async function queryAccounts({
  organizationId,
  page = 1,
  search,
  region,
  ownerId,
  industry,
}: {
  organizationId: string;
  page?: number;
  search?: string;
  region?: string;
  ownerId?: string;
  industry?: string;
}): Promise<PaginatedResult<AccountListRow>> {
  const where: Prisma.V2ClientAccountWhereInput = {
    organizationId,
    status: "ACTIVE",
    ...(search && {
      name: { contains: search, mode: "insensitive" },
    }),
    ...(region && region !== "all" && { region }),
    ...(ownerId && ownerId !== "all" && { ownerUserId: ownerId }),
    ...(industry && industry !== "all" && { industry }),
  };

  const skip = (page - 1) * DEFAULT_PAGE_SIZE;

  const [total, rows] = await Promise.all([
    prisma.v2ClientAccount.count({ where }),
    prisma.v2ClientAccount.findMany({
      where,
      skip,
      take: DEFAULT_PAGE_SIZE,
      orderBy: { updatedAt: "desc" },
      include: {
        ownerUser: true,
        _count: {
          select: {
            projects: { where: { status: "ACTIVE" } },
          },
        },
        projects: {
          where: { status: "ACTIVE" },
          include: {
            _count: {
              select: {
                offers: { where: { status: "ACTIVE" } },
              },
            },
            offers: {
              where: { status: "ACTIVE" },
              include: {
                icpProfiles: {
                  where: { status: "ACTIVE" },
                  include: {
                    _count: {
                      select: {
                        versions: { where: { deletedAt: null } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  const mappedRows: AccountListRow[] = rows.map((row) => {
    let offerCount = 0;
    let icpVersionCount = 0;
    for (const project of row.projects) {
      offerCount += project._count.offers;
      for (const offer of project.offers) {
        for (const profile of offer.icpProfiles) {
          icpVersionCount += profile._count.versions;
        }
      }
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      ownerName: row.ownerUser?.name ?? "Unassigned",
      region: row.region ?? "Unknown",
      industry: row.industry ?? "Unknown",
      projectCount: row._count.projects,
      offerCount,
      icpVersionCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });

  return {
    rows: mappedRows,
    pagination: {
      page,
      pageSize: DEFAULT_PAGE_SIZE,
      total,
      totalPages: Math.ceil(total / DEFAULT_PAGE_SIZE),
    },
  };
}

export async function getAccountDetail({
  organizationId,
  accountId,
}: {
  organizationId: string;
  accountId: string;
}): Promise<AccountDetail | null> {
  const [account, leadsRollup] = await Promise.all([
    prisma.v2ClientAccount.findUnique({
      where: {
        id: accountId,
        organizationId,
        status: "ACTIVE",
      },
      include: {
        ownerUser: true,
        projects: {
          where: { status: "ACTIVE" },
          orderBy: { updatedAt: "desc" },
          include: {
            leadAssignments: {
              where: { deletedAt: null },
              include: {
                company: true,
                contact: true,
                latestHardRuleAssessment: true,
              },
              take: 10,
              orderBy: { createdAt: "desc" },
            },
            offers: {
              where: { status: "ACTIVE" },
              orderBy: { updatedAt: "desc" },
              include: {
                icpProfiles: {
                  where: { status: "ACTIVE" },
                  orderBy: { updatedAt: "desc" },
                  include: {
                    versions: {
                      where: { deletedAt: null },
                      orderBy: { versionNumber: "desc" },
                      take: 1,
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
    queryLeadsRollup(Prisma.sql`
      la."organizationId" = ${organizationId}
      AND la."projectId" IN (
        SELECT "id" FROM "V2Project"
        WHERE "clientAccountId" = ${accountId} AND "organizationId" = ${organizationId}
      )
    `),
  ]);

  if (!account) return null;

  return {
    ...account,
    ...leadsRollup,
  };
}

export async function queryProjects({
  organizationId,
  accountId,
  page = 1,
  search,
}: {
  organizationId: string;
  accountId?: string;
  page?: number;
  search?: string;
}): Promise<PaginatedResult<ProjectListRow>> {
  const where: Prisma.V2ProjectWhereInput = {
    organizationId,
    status: "ACTIVE",
    ...(accountId && { clientAccountId: accountId }),
    ...(search && {
      name: { contains: search, mode: "insensitive" },
    }),
  };

  const skip = (page - 1) * DEFAULT_PAGE_SIZE;

  const [total, rows] = await Promise.all([
    prisma.v2Project.count({ where }),
    prisma.v2Project.findMany({
      where,
      skip,
      take: DEFAULT_PAGE_SIZE,
      orderBy: { updatedAt: "desc" },
      include: {
        clientAccount: true,
        _count: {
          select: {
            offers: { where: { status: "ACTIVE" } },
            leadAssignments: { where: { status: "ACTIVE", deletedAt: null } },
          },
        },
        offers: {
          where: { status: "ACTIVE" },
          include: {
            icpProfiles: {
              where: { status: "ACTIVE" },
              include: {
                _count: {
                  select: {
                    versions: { where: { deletedAt: null } },
                  },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  const mappedRows: ProjectListRow[] = rows.map((row) => {
    let icpVersionCount = 0;
    for (const offer of row.offers) {
      for (const profile of offer.icpProfiles) {
        icpVersionCount += profile._count.versions;
      }
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      accountId: row.clientAccountId,
      accountName: row.clientAccount.name,
      offerCount: row._count.offers,
      icpVersionCount,
      leadAssignmentCount: row._count.leadAssignments,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });

  return {
    rows: mappedRows,
    pagination: {
      page,
      pageSize: DEFAULT_PAGE_SIZE,
      total,
      totalPages: Math.ceil(total / DEFAULT_PAGE_SIZE),
    },
  };
}

export async function getProjectDetail({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}): Promise<ProjectDetail | null> {
  const [result, leadsRollup] = await Promise.all([
    prisma.v2Project.findUnique({
      where: {
        id: projectId,
        organizationId,
        status: "ACTIVE",
      },
      include: {
        clientAccount: true,
        ownerUser: true,
        teamMembers: {
          include: { user: true },
        },
        offers: {
          where: { status: "ACTIVE" },
          orderBy: { updatedAt: "desc" },
          include: {
            icpProfiles: {
              where: { status: "ACTIVE" },
              include: {
                versions: {
                  where: { deletedAt: null },
                  orderBy: { versionNumber: "desc" },
                  take: 1,
                },
              },
            },
          },
        },
        _count: {
          select: {
            leadAssignments: { where: { status: "ACTIVE", deletedAt: null } },
          },
        },
      },
    }),
    queryLeadsRollup(Prisma.sql`
      la."organizationId" = ${organizationId}
      AND la."projectId" = ${projectId}
    `),
  ]);

  if (!result) return null;

  return {
    ...result,
    leadAssignmentCount: result._count.leadAssignments,
    ...leadsRollup,
  };
}

export async function queryOffers({
  organizationId,
  projectId,
  accountId,
  page = 1,
  search,
}: {
  organizationId: string;
  projectId?: string;
  accountId?: string;
  page?: number;
  search?: string;
}): Promise<PaginatedResult<OfferListRow>> {
  const where: Prisma.V2OfferWhereInput = {
    organizationId,
    status: "ACTIVE",
    ...(projectId && { projectId }),
    ...(accountId && { project: { clientAccountId: accountId } }),
    ...(search && {
      name: { contains: search, mode: "insensitive" },
    }),
  };

  const skip = (page - 1) * DEFAULT_PAGE_SIZE;

  const [total, rows] = await Promise.all([
    prisma.v2Offer.count({ where }),
    prisma.v2Offer.findMany({
      where,
      skip,
      take: DEFAULT_PAGE_SIZE,
      orderBy: { updatedAt: "desc" },
      include: {
        project: {
          include: { clientAccount: true },
        },
        _count: {
          select: {
            icpProfiles: { where: { status: "ACTIVE" } },
          },
        },
        icpProfiles: {
          where: { status: "ACTIVE" },
          include: {
            _count: {
              select: {
                versions: { where: { deletedAt: null } },
              },
            },
          },
        },
      },
    }),
  ]);

  const mappedRows: OfferListRow[] = rows.map((row) => {
    let icpVersionCount = 0;
    for (const profile of row.icpProfiles) {
      icpVersionCount += profile._count.versions;
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      projectId: row.projectId,
      projectName: row.project.name,
      accountId: row.project.clientAccountId,
      accountName: row.project.clientAccount.name,
      icpProfileCount: row._count.icpProfiles,
      icpVersionCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });

  return {
    rows: mappedRows,
    pagination: {
      page,
      pageSize: DEFAULT_PAGE_SIZE,
      total,
      totalPages: Math.ceil(total / DEFAULT_PAGE_SIZE),
    },
  };
}

export async function getOfferDetail({
  organizationId,
  offerId,
}: {
  organizationId: string;
  offerId: string;
}): Promise<OfferDetail | null> {
  return prisma.v2Offer.findUnique({
    where: {
      id: offerId,
      organizationId,
      status: "ACTIVE",
    },
    include: {
      project: {
        include: { clientAccount: true },
      },
      icpProfiles: {
        where: { status: "ACTIVE" },
        include: {
          versions: {
            where: { deletedAt: null },
            orderBy: { versionNumber: "desc" },
          },
        },
        orderBy: { updatedAt: "desc" },
      },
    },
  });
}
export async function queryAccountWorkspace({
  organizationId,
  accountId,
  projectId,
  offerId,
  icpVersionId,
  search,
  view = "overview",
  drawer,
}: {
  organizationId: string;
  accountId?: string;
  projectId?: string;
  offerId?: string;
  icpVersionId?: string;
  search?: string;
  view?: AccountWorkspaceView["view"];
  drawer?: AccountWorkspaceView["selectedContext"]["drawer"];
}): Promise<AccountWorkspaceView> {
  const [overviewBase, accountsBase, overviewHealth, selectedIcpByUrl, selectedOfferByUrl, selectedProjectByUrl] = await Promise.all([
    queryProductTreeOverview({ organizationId }),
    queryAccounts({ organizationId, page: 1, search }),
    queryScopeHealth(organizationId, {}),
    icpVersionId ? querySingleIcpRow(organizationId, icpVersionId) : Promise.resolve(null),
    offerId ? getOfferDetail({ organizationId, offerId }) : Promise.resolve(null),
    projectId ? getProjectDetail({ organizationId, projectId }) : Promise.resolve(null),
  ]);

  const resolvedAccountId =
    selectedIcpByUrl?.accountId ??
    selectedOfferByUrl?.project.clientAccountId ??
    selectedProjectByUrl?.clientAccountId ??
    accountId ??
    accountsBase.rows[0]?.id;
  const resolvedProjectId = selectedIcpByUrl?.projectId ?? selectedOfferByUrl?.projectId ?? selectedProjectByUrl?.id ?? projectId;
  const resolvedOfferId = selectedIcpByUrl?.offerId ?? selectedOfferByUrl?.id ?? offerId;
  const resolvedIcpVersionId = selectedIcpByUrl?.id ?? icpVersionId;

  const [selectedAccount, selectedProject, selectedOffer, projectsBase, offersBase, icpsBase] = await Promise.all([
    resolvedAccountId ? getAccountDetail({ organizationId, accountId: resolvedAccountId }) : Promise.resolve(null),
    resolvedProjectId ? getProjectDetail({ organizationId, projectId: resolvedProjectId }) : Promise.resolve(null),
    resolvedOfferId ? getOfferDetail({ organizationId, offerId: resolvedOfferId }) : Promise.resolve(null),
    queryProjects({ organizationId, accountId: resolvedAccountId, page: 1 }),
    queryOffers({ organizationId, accountId: resolvedAccountId, page: 1 }),
    queryIcpRows(organizationId, { accountId: resolvedAccountId }),
  ]);
  const icpRows = icpsBase.rows;

  const [accountHealth, projectHealth, offerHealth, icpHealth, projectOwners, selectedHealth, runningWork, contextEntities] = await Promise.all([
    queryAccountHealthRollups(organizationId, accountsBase.rows.map((row) => row.id)),
    queryProjectHealthRollups(organizationId, projectsBase.rows.map((row) => row.id)),
    queryOfferHealthRollups(organizationId, offersBase.rows.map((row) => row.id)),
    queryIcpHealthRollups(organizationId, icpRows.map((row) => row.id)),
    queryProjectOwners(organizationId, projectsBase.rows.map((row) => row.id)),
    queryScopeHealth(organizationId, { accountId: resolvedAccountId, projectId: resolvedProjectId, offerId: resolvedOfferId, icpVersionId: resolvedIcpVersionId }),
    queryRunningWork(organizationId, { accountId: resolvedAccountId, projectId: resolvedProjectId, offerId: resolvedOfferId, icpVersionId: resolvedIcpVersionId }),
    queryAccountCompaniesContactsLeads(organizationId, { accountId: resolvedAccountId, projectId: resolvedProjectId, offerId: resolvedOfferId, icpVersionId: resolvedIcpVersionId }),
  ]);

  const accounts: PaginatedResult<AccountWorkspaceAccountRow> = {
    ...accountsBase,
    rows: accountsBase.rows.map((row) => {
      const health = accountHealth.get(row.id) ?? emptyHealth();
      return { ...row, ...health, readiness: buildAccountReadiness({ ...row, ...health, publishedIcpVersionCount: row.icpVersionCount }) };
    }),
  };

  const projects: PaginatedResult<AccountWorkspaceProjectRow> = {
    ...projectsBase,
    rows: projectsBase.rows.map((row) => {
      const health = projectHealth.get(row.id) ?? emptyHealth();
      const ownerName = projectOwners.get(row.id) ?? "Unassigned";
      return { ...row, ...health, ownerName, readiness: buildProjectReadiness({ ...row, ...health, projectCount: 1, publishedIcpVersionCount: row.icpVersionCount, ownerName }) };
    }),
  };

  const offers: PaginatedResult<AccountWorkspaceOfferRow> = {
    ...offersBase,
    rows: offersBase.rows.map((row) => {
      const health = offerHealth.get(row.id) ?? emptyHealth();
      const icpVersions = icpRows.filter((icp) => icp.offerId === row.id).map((icp) => ({
        id: icp.id,
        profileId: icp.profileId,
        profileName: icp.profileName,
        versionNumber: icp.versionNumber,
        status: icp.status,
        publishedAt: icp.publishedAt,
      }));
      return { ...row, ...health, icpVersions, readiness: buildOfferReadiness({ ...row, ...health }) };
    }),
  };

  const icps: PaginatedResult<AccountWorkspaceIcpRow> = {
    rows: icpRows.map((row) => {
      const health = icpHealth.get(row.id) ?? emptyHealth();
      return { ...row, ...health, readiness: buildIcpReadiness({ ...row, ...health }) };
    }),
    pagination: { page: 1, pageSize: DEFAULT_PAGE_SIZE, total: icpRows.length, totalPages: Math.max(1, Math.ceil(icpRows.length / DEFAULT_PAGE_SIZE)) },
  };

  const selectedIcp = resolvedIcpVersionId ? icps.rows.find((row) => row.id === resolvedIcpVersionId) ?? selectedIcpByUrl : null;
  const selectedReadiness = selectedIcp
    ? buildIcpReadiness({ ...selectedIcp, ...selectedHealth })
    : selectedOffer
      ? buildOfferReadiness({ icpProfileCount: selectedOffer.icpProfiles.length, icpVersionCount: selectedOffer.icpProfiles.reduce((sum, profile) => sum + profile.versions.length, 0), ...selectedHealth })
      : selectedProject
        ? buildProjectReadiness(projectDetailToReadinessInput({ ...selectedProject, ...selectedHealth }))
        : selectedAccount
          ? buildAccountReadiness(accountDetailToReadinessInput({ ...selectedAccount, ...selectedHealth }))
          : null;

  return {
    overview: { ...overviewBase, ...overviewHealth },
    accounts,
    projects,
    offers,
    icps,
    selectedAccount,
    selectedProject,
    selectedOffer,
    selectedIcp,
    selectedContext: {
      accountId: resolvedAccountId ?? null,
      projectId: resolvedProjectId ?? null,
      offerId: resolvedOfferId ?? null,
      icpVersionId: resolvedIcpVersionId ?? null,
      drawer: drawer ?? null,
      health: selectedHealth,
      readiness: selectedReadiness,
      runningWork,
      companies: contextEntities.companies,
      contacts: contextEntities.contacts,
      leads: contextEntities.leads,
    },
    selectedAccountReadiness: selectedAccount ? buildAccountReadiness(accountDetailToReadinessInput(selectedAccount)) : null,
    selectedProjectReadiness: selectedProject ? buildProjectReadiness(projectDetailToReadinessInput(selectedProject)) : null,
    view,
  };
}

type HealthRollupRow = LeadsRollupRow & {
  id: string;
  notScored: number;
  unassigned: number;
  companiesTotal: number;
  companiesEnriched: number;
  contactsTotal: number;
  contactsWithEmail: number;
  activeEnrollments: number;
  scheduledMessages: number;
  sentMessages: number;
  repliedMessages: number;
  bouncedMessages: number;
  failedMessages: number;
  recentActivityCount: number;
};

function scopeJoins() {
  return Prisma.sql`
    LEFT JOIN "V2ICPVersion" icp ON icp."id" = la."icpVersionId" AND icp."organizationId" = la."organizationId" AND icp."deletedAt" IS NULL
    LEFT JOIN "V2ICPProfile" profile ON profile."id" = icp."icpProfileId" AND profile."organizationId" = icp."organizationId" AND profile."status" = 'ACTIVE'
    LEFT JOIN "V2Offer" offer ON offer."id" = profile."offerId" AND offer."organizationId" = profile."organizationId" AND offer."status" = 'ACTIVE'
    LEFT JOIN "V2Project" project ON project."id" = la."projectId" AND project."organizationId" = la."organizationId" AND project."status" = 'ACTIVE'
    LEFT JOIN "V2HardRuleAssessment" assessment ON assessment."id" = la."latestHardRuleAssessmentId" AND assessment."organizationId" = la."organizationId"
  `;
}

function scopeWhere(organizationId: string, scope: { accountId?: string; projectId?: string; offerId?: string; icpVersionId?: string }) {
  const clauses: Prisma.Sql[] = [
    Prisma.sql`la."organizationId" = ${organizationId}`,
    Prisma.sql`la."status" = 'ACTIVE'`,
    Prisma.sql`la."deletedAt" IS NULL`,
  ];
  if (scope.accountId) clauses.push(Prisma.sql`project."clientAccountId" = ${scope.accountId}`);
  if (scope.projectId) clauses.push(Prisma.sql`la."projectId" = ${scope.projectId}`);
  if (scope.offerId) clauses.push(Prisma.sql`offer."id" = ${scope.offerId}`);
  if (scope.icpVersionId) clauses.push(Prisma.sql`la."icpVersionId" = ${scope.icpVersionId}`);
  return Prisma.join(clauses, " AND ");
}

function healthSelect() {
  return Prisma.sql`
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE assessment."qualification" = 'QUALIFIED')::int AS qualified,
    COUNT(*) FILTER (WHERE assessment."qualification" = 'NEEDS_REVIEW')::int AS "needsReview",
    COUNT(*) FILTER (WHERE assessment."qualification" = 'UNQUALIFIED')::int AS unqualified,
    COUNT(*) FILTER (WHERE la."latestHardRuleAssessmentId" IS NULL)::int AS "notScored",
    COUNT(*) FILTER (WHERE la."ownerUserId" IS NULL)::int AS unassigned,
    COUNT(DISTINCT la."companyId")::int AS "companiesTotal",
    COUNT(DISTINCT la."companyId") FILTER (WHERE EXISTS (SELECT 1 FROM "V2CompanyIntelligenceProfile" cip WHERE cip."organizationId" = la."organizationId" AND cip."companyId" = la."companyId" AND cip."profileStatus" IN ('EXTRACTED', 'PARTIAL')))::int AS "companiesEnriched",
    COUNT(DISTINCT la."contactId") FILTER (WHERE la."contactId" IS NOT NULL)::int AS "contactsTotal",
    COUNT(DISTINCT la."contactId") FILTER (WHERE la."contactId" IS NOT NULL AND EXISTS (SELECT 1 FROM "V2ContactIdentifier" ci WHERE ci."organizationId" = la."organizationId" AND ci."contactId" = la."contactId" AND ci."type" = 'EMAIL' AND ci."isValid" = TRUE))::int AS "contactsWithEmail",
    COUNT(DISTINCT enrollment."id") FILTER (WHERE enrollment."status" IN ('ACTIVE', 'PAUSED'))::int AS "activeEnrollments",
    COUNT(DISTINCT message."id") FILTER (WHERE message."status"::text IN ('QUEUED', 'SENDING'))::int AS "scheduledMessages",
    COUNT(DISTINCT message."id") FILTER (WHERE message."status" IN ('SENT', 'REPLIED', 'BOUNCED'))::int AS "sentMessages",
    COUNT(DISTINCT message."id") FILTER (WHERE message."status" = 'REPLIED')::int AS "repliedMessages",
    COUNT(DISTINCT message."id") FILTER (WHERE message."status" = 'BOUNCED')::int AS "bouncedMessages",
    COUNT(DISTINCT message."id") FILTER (WHERE message."status" = 'FAILED')::int AS "failedMessages",
    COUNT(DISTINCT activity."id")::int AS "recentActivityCount"
  `;
}

function healthFrom() {
  return Prisma.sql`
    FROM "V2LeadAssignment" la
    ${scopeJoins()}
    LEFT JOIN "V2SequenceEnrollment" enrollment ON enrollment."organizationId" = la."organizationId" AND enrollment."leadAssignmentId" = la."id" AND enrollment."deletedAt" IS NULL
    LEFT JOIN "V2OutreachMessage" message ON message."organizationId" = la."organizationId" AND message."leadAssignmentId" = la."id" AND message."deletedAt" IS NULL
    LEFT JOIN "V2OutreachActivity" activity ON activity."organizationId" = la."organizationId" AND activity."leadAssignmentId" = la."id" AND activity."occurredAt" >= CURRENT_TIMESTAMP - INTERVAL '30 days'
  `;
}

async function queryScopeHealth(organizationId: string, scope: { accountId?: string; projectId?: string; offerId?: string; icpVersionId?: string }): Promise<WorkspaceHealthRollup> {
  const rows = await prisma.$queryRaw<Array<Omit<HealthRollupRow, "id">>>(Prisma.sql`
    SELECT ${healthSelect()}
    ${healthFrom()}
    WHERE ${scopeWhere(organizationId, scope)}
  `);
  return toHealth(rows[0]);
}

async function groupedHealth(organizationId: string, groupExpr: Prisma.Sql, ids: string[]) {
  const rows = await prisma.$queryRaw<HealthRollupRow[]>(Prisma.sql`
    SELECT ${groupExpr}::text AS id, ${healthSelect()}
    ${healthFrom()}
    WHERE la."organizationId" = ${organizationId}
      AND la."status" = 'ACTIVE'
      AND la."deletedAt" IS NULL
      AND ${groupExpr} IN (${Prisma.join(ids)})
    GROUP BY ${groupExpr}
  `);
  return new Map(rows.map((row) => [row.id, toHealth(row)]));
}

async function queryAccountHealthRollups(organizationId: string, ids: string[]) {
  return ids.length ? groupedHealth(organizationId, Prisma.sql`project."clientAccountId"`, ids) : new Map<string, WorkspaceHealthRollup>();
}

async function queryProjectHealthRollups(organizationId: string, ids: string[]) {
  return ids.length ? groupedHealth(organizationId, Prisma.sql`la."projectId"`, ids) : new Map<string, WorkspaceHealthRollup>();
}

async function queryOfferHealthRollups(organizationId: string, ids: string[]) {
  return ids.length ? groupedHealth(organizationId, Prisma.sql`offer."id"`, ids) : new Map<string, WorkspaceHealthRollup>();
}

async function queryIcpHealthRollups(organizationId: string, ids: string[]) {
  return ids.length ? groupedHealth(organizationId, Prisma.sql`la."icpVersionId"`, ids) : new Map<string, WorkspaceHealthRollup>();
}

function toHealth(row: Partial<HealthRollupRow> | undefined): WorkspaceHealthRollup {
  const contactsTotal = Number(row?.contactsTotal ?? 0);
  const contactsWithEmail = Number(row?.contactsWithEmail ?? 0);
  return {
    leadsTotal: Number(row?.total ?? 0),
    leadsQualified: Number(row?.qualified ?? 0),
    leadsNeedsReview: Number(row?.needsReview ?? 0),
    leadsUnqualified: Number(row?.unqualified ?? 0),
    leadsNotScored: Number(row?.notScored ?? 0),
    leadsUnassigned: Number(row?.unassigned ?? 0),
    companiesTotal: Number(row?.companiesTotal ?? 0),
    companiesEnriched: Number(row?.companiesEnriched ?? 0),
    contactsTotal,
    contactsWithEmail,
    contactsMissingEmail: Math.max(0, contactsTotal - contactsWithEmail),
    activeEnrollments: Number(row?.activeEnrollments ?? 0),
    scheduledMessages: Number(row?.scheduledMessages ?? 0),
    sentMessages: Number(row?.sentMessages ?? 0),
    repliedMessages: Number(row?.repliedMessages ?? 0),
    bouncedMessages: Number(row?.bouncedMessages ?? 0),
    failedMessages: Number(row?.failedMessages ?? 0),
    runningRuntimeRuns: 0,
    recentActivityCount: Number(row?.recentActivityCount ?? 0),
  };
}

function emptyHealth(): WorkspaceHealthRollup {
  return toHealth(undefined);
}


async function queryIcpRows(
  organizationId: string,
  scope: { accountId?: string; projectId?: string; offerId?: string; icpVersionId?: string },
): Promise<PaginatedResult<AccountWorkspaceIcpRow>> {
  const versions = await prisma.v2ICPVersion.findMany({
    where: {
      organizationId,
      deletedAt: null,
      ...(scope.icpVersionId ? { id: scope.icpVersionId } : {}),
      icpProfile: {
        status: "ACTIVE",
        offer: {
          status: "ACTIVE",
          ...(scope.offerId ? { id: scope.offerId } : {}),
          project: {
            status: "ACTIVE",
            ...(scope.projectId ? { id: scope.projectId } : {}),
            ...(scope.accountId ? { clientAccountId: scope.accountId } : {}),
          },
        },
      },
    },
    include: {
      icpProfile: {
        include: {
          offer: {
            include: {
              project: {
                include: { clientAccount: true },
              },
            },
          },
        },
      },
    },
    orderBy: [{ status: "desc" }, { updatedAt: "desc" }],
    take: DEFAULT_PAGE_SIZE,
  });

  const healthByIcp = await queryIcpHealthRollups(
    organizationId,
    versions.map((version) => version.id),
  );

  const rows = versions.map<AccountWorkspaceIcpRow>((version) => {
    const offer = version.icpProfile.offer;
    const project = offer.project;
    const account = project.clientAccount;
    const health = healthByIcp.get(version.id) ?? emptyHealth();
    return {
      id: version.id,
      profileId: version.icpProfile.id,
      profileName: version.icpProfile.name,
      versionNumber: version.versionNumber,
      status: version.status,
      publishedAt: version.publishedAt,
      offerId: offer.id,
      offerName: offer.name,
      projectId: project.id,
      projectName: project.name,
      accountId: account.id,
      accountName: account.name,
      ...health,
      readiness: buildIcpReadiness({ ...health, status: version.status }),
    };
  });

  return {
    rows,
    pagination: { page: 1, pageSize: DEFAULT_PAGE_SIZE, total: rows.length, totalPages: rows.length ? 1 : 0 },
  };
}

async function querySingleIcpRow(organizationId: string, icpVersionId: string | undefined) {
  if (!icpVersionId) return null;
  const rows = await queryIcpRows(organizationId, { icpVersionId });
  return rows.rows[0] ?? null;
}

type RuntimeWorkRow = {
  id: string;
  kind: WorkspaceRunningWorkItem["kind"];
  label: string;
  status: string;
  context: string | null;
  occurredAt: Date | string | null;
};

async function queryRunningWork(
  organizationId: string,
  scope: { accountId?: string; projectId?: string; offerId?: string; icpVersionId?: string },
): Promise<WorkspaceRunningWorkItem[]> {
  const runtimeScope: Prisma.Sql[] = [Prisma.sql`run."organizationId" = ${organizationId}`];
  if (scope.accountId) runtimeScope.push(Prisma.sql`project."clientAccountId" = ${scope.accountId}`);
  if (scope.projectId) runtimeScope.push(Prisma.sql`run."projectId" = ${scope.projectId}`);
  if (scope.offerId) runtimeScope.push(Prisma.sql`offer."id" = ${scope.offerId}`);
  if (scope.icpVersionId) runtimeScope.push(Prisma.sql`run."icpVersionId" = ${scope.icpVersionId}`);

  const [runtimeRows, enrollmentRows, messageRows, activityRows] = await Promise.all([
    prisma.$queryRaw<RuntimeWorkRow[]>(Prisma.sql`
      SELECT run."id", 'runtime'::text AS kind, run."runType" AS label, run."status" AS status,
        COALESCE(project."name", run."projectId", 'Workspace') AS context,
        COALESCE(run."startedAt", run."createdAt") AS "occurredAt"
      FROM "V2RuntimeRun" run
      LEFT JOIN "V2Project" project ON project."id" = run."projectId" AND project."organizationId" = run."organizationId" AND project."status" = 'ACTIVE'
      LEFT JOIN "V2ICPVersion" icp ON icp."id" = run."icpVersionId" AND icp."organizationId" = run."organizationId" AND icp."deletedAt" IS NULL
      LEFT JOIN "V2ICPProfile" profile ON profile."id" = icp."icpProfileId" AND profile."organizationId" = icp."organizationId" AND profile."status" = 'ACTIVE'
      LEFT JOIN "V2Offer" offer ON offer."id" = profile."offerId" AND offer."organizationId" = profile."organizationId" AND offer."status" = 'ACTIVE'
      WHERE ${Prisma.join(runtimeScope, " AND ")}
        AND run."status" IN ('QUEUED', 'RUNNING', 'PARTIAL')
      ORDER BY COALESCE(run."startedAt", run."createdAt") DESC
      LIMIT 8
    `),
    prisma.$queryRaw<RuntimeWorkRow[]>(Prisma.sql`
      SELECT enrollment."id", 'enrollment'::text AS kind, sequence."name" AS label, enrollment."status"::text AS status,
        COALESCE(company."name", project."name", 'Lead assignment') AS context,
        enrollment."updatedAt" AS "occurredAt"
      FROM "V2SequenceEnrollment" enrollment
      JOIN "V2LeadAssignment" la ON la."id" = enrollment."leadAssignmentId" AND la."organizationId" = enrollment."organizationId"
      ${scopeJoins()}
      LEFT JOIN "V2Company" company ON company."id" = la."companyId" AND company."organizationId" = la."organizationId"
      LEFT JOIN "V2Sequence" sequence ON sequence."id" = enrollment."sequenceId" AND sequence."organizationId" = enrollment."organizationId"
      WHERE enrollment."organizationId" = ${organizationId}
        AND enrollment."deletedAt" IS NULL
        AND enrollment."status"::text IN ('ACTIVE', 'PAUSED')
        AND ${scopeWhere(organizationId, scope)}
      ORDER BY enrollment."updatedAt" DESC
      LIMIT 8
    `),
    prisma.$queryRaw<RuntimeWorkRow[]>(Prisma.sql`
      SELECT message."id", 'message'::text AS kind, COALESCE(message."subject", 'Outreach email') AS label, message."status"::text AS status,
        COALESCE(company."name", project."name", message."toAddress") AS context,
        COALESCE(message."sendingAt", message."createdAt") AS "occurredAt"
      FROM "V2OutreachMessage" message
      JOIN "V2LeadAssignment" la ON la."id" = message."leadAssignmentId" AND la."organizationId" = message."organizationId"
      ${scopeJoins()}
      LEFT JOIN "V2Company" company ON company."id" = la."companyId" AND company."organizationId" = la."organizationId"
      WHERE message."organizationId" = ${organizationId}
        AND message."deletedAt" IS NULL
        AND message."status"::text IN ('QUEUED', 'SENDING', 'FAILED')
        AND ${scopeWhere(organizationId, scope)}
      ORDER BY COALESCE(message."sendingAt", message."createdAt") DESC
      LIMIT 8
    `),
    prisma.$queryRaw<RuntimeWorkRow[]>(Prisma.sql`
      SELECT activity."id", 'activity'::text AS kind, activity."eventKind" AS label, activity."channel" AS status,
        COALESCE(company."name", project."name", 'Lead activity') AS context,
        activity."occurredAt" AS "occurredAt"
      FROM "V2OutreachActivity" activity
      JOIN "V2LeadAssignment" la ON la."id" = activity."leadAssignmentId" AND la."organizationId" = activity."organizationId"
      ${scopeJoins()}
      LEFT JOIN "V2Company" company ON company."id" = la."companyId" AND company."organizationId" = la."organizationId"
      WHERE activity."organizationId" = ${organizationId}
        AND ${scopeWhere(organizationId, scope)}
      ORDER BY activity."occurredAt" DESC
      LIMIT 8
    `),
  ]);

  return [...runtimeRows, ...enrollmentRows, ...messageRows, ...activityRows]
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      label: row.label,
      status: row.status,
      context: row.context ?? "Workspace",
      occurredAt: row.occurredAt,
    }))
    .sort((a, b) => new Date(b.occurredAt ?? 0).getTime() - new Date(a.occurredAt ?? 0).getTime())
    .slice(0, 16);
}



type EntityContextRows = {
  companies: WorkspaceInsightEntity[];
  contacts: WorkspaceInsightEntity[];
  leads: WorkspaceInsightEntity[];
};

async function queryAccountCompaniesContactsLeads(
  organizationId: string,
  scope: { accountId?: string; projectId?: string; offerId?: string; icpVersionId?: string },
): Promise<EntityContextRows> {
  const [companies, contacts, leads] = await Promise.all([
    prisma.$queryRaw<WorkspaceInsightEntity[]>(Prisma.sql`
      SELECT DISTINCT ON (company."id")
        company."id",
        'company'::text AS kind,
        company."name" AS name,
        COALESCE(company."canonicalDomain", company."country", project."name", 'No company context') AS subtitle,
        CASE
          WHEN EXISTS (SELECT 1 FROM "V2CompanyIntelligenceProfile" cip WHERE cip."organizationId" = company."organizationId" AND cip."companyId" = company."id") THEN 'enriched'
          ELSE 'needs enrichment'
        END AS status,
        NULL::int AS score,
        CONCAT('/v2/accounts?accountId=', project."clientAccountId", '&view=companies&drawer=company') AS href
      FROM "V2LeadAssignment" la
      ${scopeJoins()}
      JOIN "V2Company" company ON company."id" = la."companyId" AND company."organizationId" = la."organizationId" AND company."status" = 'ACTIVE' AND company."deletedAt" IS NULL
      WHERE ${scopeWhere(organizationId, scope)}
      ORDER BY company."id", company."updatedAt" DESC
      LIMIT 12
    `),
    prisma.$queryRaw<WorkspaceInsightEntity[]>(Prisma.sql`
      SELECT DISTINCT ON (contact."id")
        contact."id",
        'contact'::text AS kind,
        contact."fullName" AS name,
        COALESCE(contact."title", company."name", project."name", 'No contact context') AS subtitle,
        CASE
          WHEN EXISTS (SELECT 1 FROM "V2ContactIdentifier" ci WHERE ci."organizationId" = contact."organizationId" AND ci."contactId" = contact."id" AND ci."type" = 'EMAIL' AND ci."isValid" = TRUE) THEN 'valid email'
          ELSE 'missing email'
        END AS status,
        NULL::int AS score,
        CONCAT('/v2/accounts?accountId=', project."clientAccountId", '&view=contacts&drawer=contact') AS href
      FROM "V2LeadAssignment" la
      ${scopeJoins()}
      JOIN "V2Contact" contact ON contact."id" = la."contactId" AND contact."organizationId" = la."organizationId" AND contact."status" = 'ACTIVE' AND contact."deletedAt" IS NULL
      LEFT JOIN "V2Company" company ON company."id" = la."companyId" AND company."organizationId" = la."organizationId"
      WHERE ${scopeWhere(organizationId, scope)}
      ORDER BY contact."id", contact."updatedAt" DESC
      LIMIT 12
    `),
    prisma.$queryRaw<WorkspaceInsightEntity[]>(Prisma.sql`
      SELECT
        la."id",
        'lead'::text AS kind,
        COALESCE(contact."fullName", company."name", 'Lead assignment') AS name,
        CONCAT(project."name", ' / ', profile."name", ' v', icp."versionNumber") AS subtitle,
        COALESCE(assessment."qualification"::text, 'NOT_SCORED') AS status,
        NULL::int AS score,
        CONCAT('/v2/accounts?accountId=', project."clientAccountId", '&projectId=', project."id", '&icpVersionId=', icp."id", '&view=leads&drawer=lead') AS href
      FROM "V2LeadAssignment" la
      ${scopeJoins()}
      JOIN "V2Company" company ON company."id" = la."companyId" AND company."organizationId" = la."organizationId" AND company."status" = 'ACTIVE' AND company."deletedAt" IS NULL
      LEFT JOIN "V2Contact" contact ON contact."id" = la."contactId" AND contact."organizationId" = la."organizationId" AND contact."status" = 'ACTIVE' AND contact."deletedAt" IS NULL
      WHERE ${scopeWhere(organizationId, scope)}
      ORDER BY la."updatedAt" DESC
      LIMIT 14
    `),
  ]);

  return { companies, contacts, leads };
}

async function queryProjectOwners(organizationId: string, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const projects = await prisma.v2Project.findMany({
    where: { organizationId, id: { in: ids }, status: "ACTIVE" },
    select: { id: true, ownerUser: { select: { name: true, email: true } } },
  });
  return new Map(projects.map((project) => [project.id, project.ownerUser?.name ?? project.ownerUser?.email ?? "Unassigned"]));
}

type AccountReadinessInput = {
  projectCount: number;
  offerCount: number;
  icpVersionCount: number;
  publishedIcpVersionCount: number;
  leadsTotal: number;
  leadsNeedsReview: number;
  leadsNotScored?: number;
  contactsMissingEmail?: number;
  activeEnrollments?: number;
  scheduledMessages?: number;
  failedMessages?: number;
  bouncedMessages?: number;
};

type ProjectReadinessInput = AccountReadinessInput & {
  ownerName?: string;
  ownerUserId?: string | null;
};

type OfferReadinessInput = {
  icpProfileCount?: number;
  icpVersionCount?: number;
  publishedIcpVersionCount?: number;
  leadsTotal?: number;
  leadsNeedsReview?: number;
  leadsNotScored?: number;
  contactsMissingEmail?: number;
  activeEnrollments?: number;
  scheduledMessages?: number;
  failedMessages?: number;
  bouncedMessages?: number;
};

type IcpReadinessInput = {
  status?: string;
  leadsTotal?: number;
  leadsNeedsReview?: number;
  leadsNotScored?: number;
  contactsMissingEmail?: number;
  activeEnrollments?: number;
  scheduledMessages?: number;
  failedMessages?: number;
  bouncedMessages?: number;
};

function buildAccountReadiness(input: AccountReadinessInput): WorkspaceReadiness {
  return readinessFromChecks(
    [
      { key: "projects", label: "Projects", ok: input.projectCount > 0, detail: input.projectCount ? `${input.projectCount} active project(s)` : "No project in this account" },
      { key: "offers", label: "Offers", ok: input.offerCount > 0, detail: input.offerCount ? `${input.offerCount} offer(s)` : "Add at least one offer" },
      { key: "icp", label: "Published ICP", ok: input.publishedIcpVersionCount > 0, detail: input.publishedIcpVersionCount ? `${input.publishedIcpVersionCount} published ICP version(s)` : "No published ICP" },
      { key: "leads", label: "Lead coverage", ok: input.leadsTotal > 0, detail: input.leadsTotal ? `${input.leadsTotal} lead assignment(s)` : "Upload or assign leads" },
      { key: "data", label: "Data quality", ok: (input.contactsMissingEmail ?? 0) === 0, detail: (input.contactsMissingEmail ?? 0) ? `${input.contactsMissingEmail} contact(s) missing email` : "Contact data looks usable" },
      { key: "ops", label: "Operations", ok: (input.failedMessages ?? 0) + (input.bouncedMessages ?? 0) === 0, detail: `${input.activeEnrollments ?? 0} active enrollment(s), ${input.scheduledMessages ?? 0} queued message(s)` },
    ],
    hierarchyNextAction(input),
  );
}

function buildProjectReadiness(input: ProjectReadinessInput): WorkspaceReadiness {
  return readinessFromChecks(
    [
      { key: "owner", label: "Owner", ok: Boolean(input.ownerUserId || (input.ownerName && input.ownerName !== "Unassigned")), detail: input.ownerName ?? "Unassigned" },
      { key: "offers", label: "Offers", ok: input.offerCount > 0, detail: input.offerCount ? `${input.offerCount} offer(s)` : "No offer mapped" },
      { key: "icp", label: "Published ICP", ok: input.publishedIcpVersionCount > 0, detail: input.publishedIcpVersionCount ? `${input.publishedIcpVersionCount} published ICP version(s)` : "Publish ICP before execution" },
      { key: "leads", label: "Lead queue", ok: input.leadsTotal > 0, detail: input.leadsTotal ? `${input.leadsTotal} lead assignment(s)` : "No leads attached" },
      { key: "review", label: "Review load", ok: input.leadsNeedsReview === 0 && (input.leadsNotScored ?? 0) === 0, detail: `${input.leadsNeedsReview} needs review, ${input.leadsNotScored ?? 0} not scored` },
    ],
    hierarchyNextAction(input),
  );
}

function buildOfferReadiness(input: OfferReadinessInput): WorkspaceReadiness {
  return readinessFromChecks(
    [
      { key: "profiles", label: "ICP profiles", ok: (input.icpProfileCount ?? 0) > 0 || (input.icpVersionCount ?? 0) > 0, detail: `${input.icpProfileCount ?? 0} profile(s), ${input.icpVersionCount ?? 0} version(s)` },
      { key: "published", label: "Published ICP", ok: (input.publishedIcpVersionCount ?? 0) > 0, detail: (input.publishedIcpVersionCount ?? 0) ? `${input.publishedIcpVersionCount} published` : "Publish an ICP for this offer" },
      { key: "leads", label: "Lead coverage", ok: (input.leadsTotal ?? 0) > 0, detail: `${input.leadsTotal ?? 0} lead assignment(s)` },
      { key: "data", label: "Contact quality", ok: (input.contactsMissingEmail ?? 0) === 0, detail: `${input.contactsMissingEmail ?? 0} missing email` },
    ],
    hierarchyNextAction({ projectCount: 1, offerCount: 1, ...input }),
  );
}

function buildIcpReadiness(input: IcpReadinessInput): WorkspaceReadiness {
  return readinessFromChecks(
    [
      { key: "published", label: "Published", ok: input.status === "PUBLISHED", detail: input.status === "PUBLISHED" ? "Ready for scoring and execution" : `Status: ${input.status ?? "DRAFT"}` },
      { key: "leads", label: "Lead coverage", ok: (input.leadsTotal ?? 0) > 0, detail: `${input.leadsTotal ?? 0} lead assignment(s)` },
      { key: "review", label: "Scoring review", ok: (input.leadsNeedsReview ?? 0) === 0 && (input.leadsNotScored ?? 0) === 0, detail: `${input.leadsNeedsReview ?? 0} needs review, ${input.leadsNotScored ?? 0} not scored` },
      { key: "execution", label: "Execution", ok: (input.failedMessages ?? 0) + (input.bouncedMessages ?? 0) === 0, detail: `${input.activeEnrollments ?? 0} active, ${input.scheduledMessages ?? 0} queued` },
    ],
    hierarchyNextAction({ projectCount: 1, offerCount: 1, publishedIcpVersionCount: input.status === "PUBLISHED" ? 1 : 0, leadsTotal: input.leadsTotal ?? 0, leadsNeedsReview: input.leadsNeedsReview ?? 0, leadsNotScored: input.leadsNotScored ?? 0, contactsMissingEmail: input.contactsMissingEmail ?? 0, failedMessages: input.failedMessages ?? 0, bouncedMessages: input.bouncedMessages ?? 0 }),
  );
}

function readinessFromChecks(checks: WorkspaceReadiness["checks"], nextAction: WorkspaceNextAction): WorkspaceReadiness {
  const okCount = checks.filter((check) => check.ok).length;
  const blockers = checks.filter((check) => !check.ok).map((check) => check.detail);
  const score = checks.length ? Math.round((okCount / checks.length) * 100) : 100;
  return {
    score,
    blockers,
    checks,
    nextAction,
    risk: score >= 80 ? "ready" : score >= 45 ? "attention" : "blocked",
  };
}

function hierarchyNextAction(input: Partial<AccountReadinessInput>): WorkspaceNextAction {
  if ((input.projectCount ?? 1) === 0) return "Create project";
  if ((input.offerCount ?? 1) === 0) return "Add offer";
  if ((input.publishedIcpVersionCount ?? 0) === 0) return "Publish ICP";
  if ((input.leadsTotal ?? 0) === 0) return "Upload leads";
  if ((input.contactsMissingEmail ?? 0) > 0) return "Enrich companies";
  if ((input.leadsNotScored ?? 0) > 0 || (input.leadsNeedsReview ?? 0) > 0) return "Inspect leads";
  if ((input.failedMessages ?? 0) > 0 || (input.bouncedMessages ?? 0) > 0) return "Monitor outreach";
  return "Monitor outreach";
}

function accountDetailToReadinessInput(account: AccountDetail & Partial<WorkspaceHealthRollup>): AccountReadinessInput {
  const offers = account.projects.flatMap((project) => project.offers);
  const versions = offers.flatMap((offer) => offer.icpProfiles.flatMap((profile) => profile.versions));
  return {
    projectCount: account.projects.length,
    offerCount: offers.length,
    icpVersionCount: versions.length,
    publishedIcpVersionCount: versions.filter((version) => version.status === "PUBLISHED").length,
    leadsTotal: account.leadsTotal ?? 0,
    leadsNeedsReview: account.leadsNeedsReview ?? 0,
    leadsNotScored: account.leadsNotScored ?? 0,
    contactsMissingEmail: account.contactsMissingEmail ?? 0,
    activeEnrollments: account.activeEnrollments ?? 0,
    scheduledMessages: account.scheduledMessages ?? 0,
    failedMessages: account.failedMessages ?? 0,
    bouncedMessages: account.bouncedMessages ?? 0,
  };
}

function projectDetailToReadinessInput(project: ProjectDetail & Partial<WorkspaceHealthRollup>): ProjectReadinessInput {
  const versions = project.offers.flatMap((offer) => offer.icpProfiles.flatMap((profile) => profile.versions));
  return {
    projectCount: 1,
    ownerName: project.ownerUser?.name ?? project.ownerUser?.email ?? "Unassigned",
    ownerUserId: project.ownerUserId,
    offerCount: project.offers.length,
    icpVersionCount: versions.length,
    publishedIcpVersionCount: versions.filter((version) => version.status === "PUBLISHED").length,
    leadsTotal: project.leadsTotal ?? 0,
    leadsNeedsReview: project.leadsNeedsReview ?? 0,
    leadsNotScored: project.leadsNotScored ?? 0,
    contactsMissingEmail: project.contactsMissingEmail ?? 0,
    activeEnrollments: project.activeEnrollments ?? 0,
    scheduledMessages: project.scheduledMessages ?? 0,
    failedMessages: project.failedMessages ?? 0,
    bouncedMessages: project.bouncedMessages ?? 0,
  };
}
