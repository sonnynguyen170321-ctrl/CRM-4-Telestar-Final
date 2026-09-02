import { Suspense, type ReactNode } from "react";
import { Building2, Eye } from "lucide-react";

import { PageHeader } from "@/components/shared/PageHeader";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { CrmNav } from "@/components/v2/shell/WorkspaceClusterNav";
import { ActionableError } from "@/components/shared/ActionableError";
import { CompanyDrawerProvider } from "@/components/v2/companies/CompanyDrawerProvider";
import { CompanyDrawerHost } from "@/components/v2/companies/CompanyDrawerHost";
import { CompanyRowLink } from "@/components/v2/companies/CompanyRowLink";
import { formatDateTime } from "@/components/v2/leads/AssessmentSummaryCard";
import { Badge } from "@/components/ui/badge";
import {
  queryCompanyDirectoryFilterOptions,
  queryCompanyDirectory,
  type CompanyDirectoryResult,
  type CompanyDirectoryRow,
  type CompanyResearchStatus,
} from "@/lib/v2/company-intelligence/readModel";
import { queryCompanyDirectoryAggregates } from "@/lib/v2/company-intelligence/companyDirectoryAggregates";
import { withFacetCache, FACET_CACHE_KEYS } from "@/lib/v2/bullmq/facetCache";
import { CompanyDirectorySidebar } from "@/components/v2/companies/CompanyDirectorySidebar";
import { getLeadContextOptions } from "@/lib/v2/crm";
import { withSpan } from "@/lib/v2/observability/trace";
import { CompanyFilterSidebar } from "@/components/v2/companies/CompanyFilterSidebar";
import { CompanyBulkBar } from "@/components/v2/companies/CompanyBulkBar";
import {
  CompanyRowCheckbox,
  CompanySelectAllCheckbox,
  CompanySelectionProvider,
} from "@/components/v2/companies/CompanySelection";
import { DataTable, type DataTableColumn, DataTablePagination } from "@/components/shared/DataTable";
import {
  getTenantErrorMessage,
  hasPermission,
  requirePermission,
  V2TenantError,
} from "@/lib/v2/tenant";

type CompaniesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";

const RESEARCH_STATUS_FILTERS: CompanyResearchStatus[] = [
  "SUCCESS",
  "PARTIAL",
  "PARKED",
  "BLOCKED",
  "NO_WEBSITE",
  "NOT_RUN",
  "JS_RENDER_REQUIRED",
  "TIMEOUT",
  "OFFLINE",
  "INVALID_URL",
];

const QUALIFICATION_FILTERS = [
  "QUALIFIED",
  "COMPANY_QUALIFIED_NEEDS_CONTACT",
  "NEEDS_REVIEW",
  "UNQUALIFIED",
  "NOT_SCORED",
];

const WORKFLOW_STATUS_FILTERS = [
  "NEW",
  "ASSIGNED",
  "WORKING",
  "CONTACTED",
  "RESPONDED",
  "MEETING_BOOKED",
  "MEETING_DONE",
  "NURTURE",
  "NOT_INTERESTED",
  "BOUNCED",
  "SUPPRESSED",
  "DISQUALIFIED",
  "ARCHIVED",
];

export default async function V2CompaniesPage({
  searchParams,
}: CompaniesPageProps) {
  const rawParams = await searchParams;
  const tenantContext = await getCompaniesTenantContext();

  if (tenantContext instanceof V2TenantError) {
    return <TenantDeniedState error={tenantContext} />;
  }

  const query = toQueryRecord(rawParams);
  const page = parsePositiveInt(getParam(rawParams, "page"), 1);
  const selectedCompanyId = getParam(rawParams, "companyId");
  const search = getParam(rawParams, "search");
  const researchStatus = getArrayParam(rawParams, "researchStatus");
  const companyFilters = parseCompanyFilters(rawParams);
  const organizationId = tenantContext.organizationId;

  const aggregatesPromise = withFacetCache(
    FACET_CACHE_KEYS.companyAggregates(organizationId),
    () => queryCompanyDirectoryAggregates(organizationId)
  );

  const [
    directory,
    filterOptions,
    contextOptions,
  ] = await withSpan("companies.page", () => Promise.all([
    queryCompanyDirectory({
      organizationId,
      page,
      search,
      researchStatus,
      ...companyFilters,
    }),
    withFacetCache(FACET_CACHE_KEYS.companyFilterOptions(organizationId), () => queryCompanyDirectoryFilterOptions(organizationId)),
    withFacetCache(FACET_CACHE_KEYS.contextOptions(organizationId), () => getLeadContextOptions({ organizationId })),
  ]));
  const canOverride = hasPermission(tenantContext.role, "workflow.update");

  return (
    <CompaniesShell tenantContext={tenantContext}>
      <CompanyDrawerProvider
        initialSelectedCompanyId={selectedCompanyId}
        orderedCompanyIds={directory.rows.map((row) => row.id)}
        canOverride={canOverride}
      >
        <div className="flex h-full min-h-0 flex-1 flex-col xl:flex-row overflow-hidden">
          <CompanyFilterSidebar
            filterOptions={filterOptions}
            contextOptions={contextOptions}
            query={query}
          />
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <CompanySelectionProvider>
              <div className="min-h-0 flex-1 overflow-auto bg-surface">
                <CompanyTable
                  result={directory}
                  query={query}
                  selectedCompanyId={selectedCompanyId}
                />
              </div>
              <CompanyBulkBar
                icpVersions={contextOptions.accounts.flatMap((account) =>
                  account.projects.flatMap((project) =>
                    project.icpVersions
                      .filter((version) => version.status === "PUBLISHED")
                      .map((version) => ({
                        id: version.id,
                        label: `${account.name} · ${project.name} · ${version.icpProfileName} v${version.versionNumber}`,
                      }))
                  )
                )}
              />
            </CompanySelectionProvider>
          </main>
          <aside className="w-full xl:w-[320px] shrink-0 overflow-y-auto pr-2 pb-6 px-6 py-5 border-l border-hairline bg-surface">
            <Suspense fallback={<DirectorySidebarSkeleton />}>
              <DirectorySidebarSection aggregatesPromise={aggregatesPromise} query={query} />
            </Suspense>
          </aside>
        </div>
        <CompanyDrawerHost />
      </CompanyDrawerProvider>
    </CompaniesShell>
  );
}

async function getCompaniesTenantContext() {
  try {
    return await requirePermission("crm.read");
  } catch (error) {
    if (error instanceof V2TenantError) {
      return error;
    }

    throw error;
  }
}

function CompaniesShell({
  children,
  tenantContext,
}: {
  children: ReactNode;
  tenantContext: Awaited<ReturnType<typeof requirePermission>>;
}) {
  return (
    <WorkspaceFrame className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden bg-background/20 p-0 sm:p-0 lg:px-0 lg:py-0">
      <PageHeader
        title="Companies"
        description="Company intelligence and per-ICP assignment context. Companies do not have a global score."
        actions={
          <span className="inline-flex items-center gap-2 rounded-lg border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            {tenantContext.organizationName}
          </span>
        }
      />
      <div className="shrink-0 border-b border-hairline px-4 py-2.5"><CrmNav /></div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {children}
      </div>
    </WorkspaceFrame>
  );
}

// Filter components have been moved to components/v2/companies/CompanyFilterSidebar.tsx

// Streamed sidebar: awaits the in-flight aggregates promise under its own <Suspense>
// boundary so the heavy org-wide rollups never block the directory table's first paint.
async function DirectorySidebarSection({
  aggregatesPromise,
  query,
}: {
  aggregatesPromise: ReturnType<typeof queryCompanyDirectoryAggregates>;
  query: Record<string, string>;
}) {
  const aggregates = await aggregatesPromise;

  return <CompanyDirectorySidebar aggregates={aggregates} query={query} />;
}

function DirectorySidebarSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="h-44 animate-pulse rounded-2xl border border-hairline bg-surface-raised/50" />
      <div className="h-40 animate-pulse rounded-2xl border border-hairline bg-surface-raised/50" />
      <div className="h-40 animate-pulse rounded-2xl border border-hairline bg-surface-raised/50" />
      <div className="h-48 animate-pulse rounded-2xl border border-hairline bg-surface-raised/50" />
    </div>
  );
}
function CompanyTable({
  query,
  result,
  selectedCompanyId,
}: {
  query: Record<string, string>;
  result: CompanyDirectoryResult;
  selectedCompanyId?: string;
}) {
  const empty = (
    <div className="rounded-xl border border-dashed border-hairline bg-surface/50 p-12 text-center shadow-premium">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <Building2 className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="mt-4 text-base font-bold text-foreground">
        No companies yet
      </div>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
        Import a list to start building your account directory — companies show up here once they&apos;re processed.
      </p>
    </div>
  );

  const columns: DataTableColumn<CompanyDirectoryRow>[] = [
    {
      key: "sel",
      header: <CompanySelectAllCheckbox ids={result.rows.map((row) => row.id)} />,
      width: "w-10 pl-4",
      cell: (company) => <CompanyRowCheckbox companyId={company.id} />,
    },
    {
      key: "company",
      header: "Company",
      cell: (company) => (
        <CompanyRowLink
          companyId={company.id}
          name={company.name}
          domain={company.canonicalDomain ?? company.websiteUrl}
          href={buildHref(query, { companyId: company.id, leadPage: "" })}
          className="group flex items-center gap-3"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-hairline bg-surface shadow-sm">
            <span className="text-sm font-bold text-muted-foreground">{company.name.substring(0, 2).toUpperCase()}</span>
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-foreground group-hover:text-primary transition-colors">{company.name}</div>
            <div className="text-xs text-muted-foreground mt-0.5 font-medium">
              {company.canonicalDomain ?? company.websiteUrl ?? "No domain"}
            </div>
            {company.companySummary ? (
              <p className="mt-0.5 max-w-md truncate text-xs text-muted-foreground">{company.companySummary}</p>
            ) : null}
          </div>
        </CompanyRowLink>
      ),
    },
    {
      key: "industry",
      header: "Industry",
      cell: (company) =>
        company.industryCategory ? (
          <span className="inline-flex items-center rounded bg-secondary px-2 py-0.5 text-[10px] font-semibold text-foreground border border-hairline">
            {formatEnumLabel(company.industryCategory)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "research",
      header: "Research",
      cell: (company) => <StatusBadge status={company.latestResearchStatus ?? "NOT_RUN"} />,
    },
    {
      key: "assignments",
      header: "Assignments",
      align: "center",
      cell: (company) => (
        <CompanyQualificationSummary
          activeQualificationFilter={query.qualification}
          summary={company.qualificationSummary}
          total={company.leadAssignmentCount}
        />
      ),
    },
    {
      key: "country",
      header: "Country",
      cell: (company) => (
        <span className="text-xs font-medium text-foreground/80">
          {company.country ?? "—"}
        </span>
      ),
    },
    {
      key: "freshness",
      header: "Freshness",
      cell: (company) => (
        <div className="flex flex-col gap-0.5 text-[11px]">
          <span className="text-foreground/80 font-medium">{company.lastEnrichedAt ? formatDateTime(company.lastEnrichedAt) : "Never"}</span>
          <span className="text-muted-foreground">Stale: {company.staleAt ? formatDateTime(company.staleAt) : "Not set"}</span>
        </div>
      ),
    },
    {
      key: "action",
      header: "",
      align: "right",
      cell: (company) => (
        <CompanyRowLink
          companyId={company.id}
          name={company.name}
          domain={company.canonicalDomain ?? company.websiteUrl}
          href={buildHref(query, { companyId: company.id, leadPage: "" })}
          className="inline-flex h-8 items-center rounded-md border border-hairline bg-surface px-3 text-sm font-semibold text-primary transition-all duration-300 hover:bg-surface-raised hover:text-primary/80"
        >
          <Eye className="mr-2 h-4 w-4" aria-hidden="true" />
          Inspect
        </CompanyRowLink>
      ),
    },
  ];

  const footer = (
    <DataTablePagination
      label={`${result.pagination.total.toLocaleString()} companies`}
      page={result.pagination.page}
      totalPages={result.pagination.totalPages}
      previousHref={buildHref(query, {
        page: String(Math.max(1, result.pagination.page - 1)),
        companyId: "",
        leadPage: "",
      })}
      nextHref={buildHref(query, {
        page: String(Math.min(result.pagination.totalPages, result.pagination.page + 1)),
        companyId: "",
        leadPage: "",
      })}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <DataTable
        columns={columns}
        rows={result.rows}
        getRowId={(company) => company.id}
        selectedId={selectedCompanyId}
        footer={footer}
        empty={empty}
        className="h-full border-none shadow-none rounded-none"
      />
    </div>
  );
}


function CompanyQualificationSummary({
  activeQualificationFilter,
  summary,
  total,
}: {
  activeQualificationFilter?: string;
  summary: CompanyDirectoryRow["qualificationSummary"];
  total: number;
}) {
  const matched = qualificationFilterCount(summary, activeQualificationFilter);
  const buckets = [
    { key: "qualified", label: "Q", value: summary.qualified, className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700" },
    { key: "needsReview", label: "R", value: summary.needsReview, className: "border-amber-500/20 bg-amber-500/10 text-amber-700" },
    { key: "needsContact", label: "C", value: summary.needsContact, className: "border-blue-500/20 bg-blue-500/10 text-blue-700" },
    { key: "unqualified", label: "U", value: summary.unqualified, className: "border-red-500/20 bg-red-500/10 text-red-700" },
    { key: "notScored", label: "N/S", value: summary.notScored, className: "border-hairline bg-secondary text-muted-foreground" },
  ].filter((bucket) => bucket.value > 0);

  if (total === 0) {
    return <span className="text-xs text-muted-foreground">No assignments</span>;
  }

  return (
    <div className="flex min-w-[180px] flex-col items-center gap-1.5">
      <div className="text-xs font-semibold text-foreground">{total.toLocaleString()} ICP assignment{total === 1 ? "" : "s"}</div>
      {matched ? <div className="text-[10px] font-medium text-primary">{matched.count.toLocaleString()} match {matched.label}</div> : null}
      <div className="flex flex-wrap justify-center gap-1" aria-label="ICP assignment qualification summary">
        {buckets.map((bucket) => (
          <span key={bucket.key} className={`inline-flex h-5 items-center gap-1 rounded-full border px-1.5 text-[10px] font-semibold tabular-nums ${bucket.className}`}>
            <span>{bucket.label}</span>
            <span>{bucket.value.toLocaleString()}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function qualificationFilterCount(
  summary: CompanyDirectoryRow["qualificationSummary"],
  activeQualificationFilter?: string
): { count: number; label: string } | null {
  if (!activeQualificationFilter) return null;
  const values = activeQualificationFilter.split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length === 0) return null;
  const counts: Record<string, { count: number; label: string }> = {
    QUALIFIED: { count: summary.qualified, label: "Qualified" },
    NEEDS_REVIEW: { count: summary.needsReview, label: "Needs review" },
    COMPANY_QUALIFIED_NEEDS_CONTACT: { count: summary.needsContact, label: "Needs contact" },
    UNQUALIFIED: { count: summary.unqualified, label: "Unqualified" },
    NOT_SCORED: { count: summary.notScored, label: "Not scored" },
  };
  const count = values.reduce((sum, value) => sum + (counts[value]?.count ?? 0), 0);
  if (count === 0) return null;
  return { count, label: values.length === 1 ? counts[values[0]]?.label ?? "filter" : "filters" };
}
function StatusBadge({ status }: { status: string }) {
  const className =
    status === "SUCCESS" || status === "EXTRACTED"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : status === "PARTIAL" || status === "JS_RENDER_REQUIRED"
        ? "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : status === "BLOCKED" || status === "TIMEOUT" || status === "INVALID_URL"
          ? "border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400"
          : "border-hairline bg-secondary text-foreground";

  return (
    <Badge variant="outline" className={`rounded-md px-2 py-0.5 text-[11px] font-medium tracking-wide ${className}`}>
      {formatEnumLabel(status)}
    </Badge>
  );
}

function TenantDeniedState({ error }: { error: V2TenantError }) {
  const message = getTenantErrorMessage(error);

  return (
    <WorkspaceFrame className="flex items-center justify-center">
      <ActionableError
        title={message.title}
        reason={message.message}
        actionLabel={message.actionLabel}
        actionHref={message.actionHref}
        technicalCode={message.technicalCode}
      />
    </WorkspaceFrame>
  );
}

type CompanyDirectoryPageFilters = {
  clientAccountId?: string;
  projectId?: string;
  icpVersionId?: string;
  qualification?: string[];
  excludeQualification?: string[];
  workflowStatus?: string[];
  excludeWorkflowStatus?: string[];
  country?: string[];
  excludeCountry?: string[];
  industry?: string[];
  excludeIndustry?: string[];
  servedVertical?: string[];
  factToken?: string[];
  excludeFactToken?: string[];
  researchStatus?: string[];
  excludeResearchStatus?: string[];
};

function parseCompanyFilters(
  params: Record<string, string | string[] | undefined>
): CompanyDirectoryPageFilters {
  return {
    clientAccountId: getParam(params, "clientAccountId"),
    projectId: getParam(params, "projectId"),
    icpVersionId: getParam(params, "icpVersionId"),
    qualification: getArrayParam(params, "qualification", QUALIFICATION_FILTERS),
    excludeQualification: getArrayParam(params, "excludeQualification", QUALIFICATION_FILTERS),
    workflowStatus: getArrayParam(params, "workflowStatus", WORKFLOW_STATUS_FILTERS),
    excludeWorkflowStatus: getArrayParam(params, "excludeWorkflowStatus", WORKFLOW_STATUS_FILTERS),
    country: getArrayParam(params, "country"),
    excludeCountry: getArrayParam(params, "excludeCountry"),
    industry: getArrayParam(params, "industry"),
    excludeIndustry: getArrayParam(params, "excludeIndustry"),
    servedVertical: getArrayParam(params, "servedVertical"),
    factToken: getArrayParam(params, "factToken"),
    excludeFactToken: getArrayParam(params, "excludeFactToken"),
    researchStatus: getArrayParam(params, "researchStatus", RESEARCH_STATUS_FILTERS),
    excludeResearchStatus: getArrayParam(params, "excludeResearchStatus", RESEARCH_STATUS_FILTERS),
  };
}

function buildHref(query: Record<string, string>, updates: Record<string, string>) {
  const params = new URLSearchParams(query);

  for (const [key, value] of Object.entries(updates)) {
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
  }

  return `/v2/crm/companies?${params.toString()}`;
}

function getParam(
  params: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = params[key];
  const first = Array.isArray(value) ? value[0] : value;

  return first?.trim() || undefined;
}

function getArrayParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
  validSet?: string[]
): string[] | undefined {
  const value = params[key];
  if (!value) return undefined;

  const rawArray = Array.isArray(value) ? value : value.split(",");

  const parsed = rawArray
    .map(v => v.trim())
    .filter(Boolean)
    .filter(v => (validSet ? validSet.includes(v) : true));

  return parsed.length > 0 ? parsed : undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function toQueryRecord(params: Record<string, string | string[] | undefined>) {
  const query: Record<string, string> = {};

  for (const [key, value] of Object.entries(params)) {
    if (key === "organizationId") {
      continue;
    }

    const val = value;

    if (Array.isArray(val)) {
      query[key] = val.join(",");
    } else if (val && val.trim()) {
      query[key] = val.trim();
    }
  }

  return query;
}

function formatEnumLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}
