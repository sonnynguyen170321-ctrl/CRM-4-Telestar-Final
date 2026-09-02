import type { ReactNode } from "react";
import { Building2, Download } from "lucide-react";
import Link from "next/link";

import { ActionableError } from "@/components/shared/ActionableError";
import { PageHeader } from "@/components/shared/PageHeader";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { Button } from "@/components/ui/button";
import { LeadFilterSidebar } from "@/components/v2/leads/LeadFilterSidebar";
import { LeadPriorityQueue } from "@/components/v2/leads/LeadPriorityQueue";
import { LeadContextBar } from "@/components/v2/leads/LeadContextBar";
import { LeadSelectionProvider } from "@/components/v2/leads/LeadSelection";
import { LeadBulkActionBar } from "@/components/v2/leads/LeadBulkActionBar";
import { LeadDrawerProvider } from "@/components/v2/leads/LeadDrawerProvider";
import { LeadWorkspaceSplitView } from "@/components/v2/leads/LeadWorkspaceSplitView";
import { RuntimeHeaderBadge } from "@/components/v2/runtime/RuntimeHeaderBadge";
import { queryLatestRuntimeRun } from "@/lib/v2/runtime/queryRuntimeStatus";
import type { RuntimeRunStatusView } from "@/lib/v2/runtime/types";
import { queryCampaigns } from "@/lib/v2/outreach/campaigns/queryCampaigns";
import { withFacetCache, FACET_CACHE_KEYS } from "@/lib/v2/bullmq/facetCache";
import { withSpan } from "@/lib/v2/observability/trace";
import {
  listLeadWorkspaceFilterOptions,
  queryContactLeads,
  queryContactLeadMetrics,
  buildLeadWorkspaceExportHref,
  parseLeadWorkspaceFilters,
  toLeadWorkspaceQueryRecord,
} from "@/lib/v2/crm";
import {
  getTenantErrorMessage,
  requirePermission,
  V2TenantError,
} from "@/lib/v2/tenant";

type LeadsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function V2LeadsPage({ searchParams }: LeadsPageProps) {
  const rawParams = await searchParams;
  const tenantContext = await getLeadWorkspaceTenantContext();

  if (tenantContext instanceof V2TenantError) {
    return <TenantDeniedState error={tenantContext} />;
  }

  const page = parsePositiveInt(getParam(rawParams, "page"), 1);
  const pageSize = Math.min(
    parsePositiveInt(getParam(rawParams, "pageSize"), 50),
    1000
  );
  const selectedLeadId = getParam(rawParams, "selectedLeadId");
  const ownerUserId = getParam(rawParams, "ownerUserId");
  // Smart default: rank by computed priority (Hot first); "recent" = chronological fallback.
  const sort = getParam(rawParams, "sort") === "recent" ? "recent" : "priority";
  // Account / Project / ICP are now optional filters for the cross-cutting workbench.
  const filters = { ...parseLeadWorkspaceFilters(rawParams), ownerUserId };
  const query = toLeadWorkspaceQueryRecord(rawParams);
  const organizationId = tenantContext.organizationId;

  // P5: the per-lead drawer detail is no longer pre-loaded here. The drawer opens
  // client-side from the row snapshot and hydrates via /v2/api/leads/[id]/drawer, so this
  // server render only fetches the list + facets (faster TTFB, no work for a closed drawer).
  // Perf: skipCount — metrics runs the same filter builder and already returns `total`, so
  // pagination is patched from metrics below instead of paying a third full scan. The
  // filter-independent campaign options are Redis read-through cached.
  // filterOptions is independent of the list/metrics, so it joins the same parallel batch (no
  // sequential await = no request waterfall before the heavy queries).
  const [filterOptions, rawResult, metrics, campaigns, runtimeRun] = await withSpan("leads.page", () => Promise.all([
    withFacetCache(FACET_CACHE_KEYS.leadFilterOptions(organizationId), () => listLeadWorkspaceFilterOptions({ organizationId })),
    queryContactLeads({
      organizationId,
      page,
      pageSize,
      filters,
      sort,
      skipCount: true,
    }),
    queryContactLeadMetrics({ organizationId, filters }),
    withFacetCache(`v2:org:${organizationId}:options:campaigns`, () => queryCampaigns(organizationId)),
    // P6: latest scoring run for the active context (or org-wide) -> header status pill,
    // so async scoring is visible from the workbench without opening the run page.
    queryLatestRuntimeRun(organizationId, "SCORING", {
      projectId: filters.projectId,
      icpVersionId: filters.icpVersionId,
    }),
  ]));
  const total = metrics.total;
  const result = {
    ...rawResult,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
  const campaignOptions = campaigns.map((c) => ({ id: c.id, name: c.name, status: c.status }));

  // Published ICP versions (flat) for the "Score against ICP" bulk action (P2c). Derived from
  // filterOptions after the parallel batch resolves.
  const icpVersionOptions = filterOptions.context.accounts.flatMap((account) =>
    account.projects.flatMap((project) =>
      project.icpVersions
        .filter((version) => version.status === "PUBLISHED")
        .map((version) => ({
          id: version.id,
          label: `${account.name} · ${project.name} · ${version.icpProfileName} v${version.versionNumber}`,
        }))
    )
  );

  const exportHref = buildLeadWorkspaceExportHref(query);

  return (
    <LeadWorkspaceShell
      tenantContext={tenantContext}
      exportHref={exportHref}
      runtimeRun={runtimeRun}
    >
      <LeadDrawerProvider campaigns={campaignOptions} initialSelectedLeadId={selectedLeadId} orderedLeadIds={result.rows.map((r) => r.leadAssignmentId)}>
      <LeadSelectionProvider>
        <div className="mx-auto flex h-full max-w-[1600px] flex-col px-4 py-4 md:px-6 md:py-5">
          <main className="flex h-full min-h-0 flex-1 flex-col xl:flex-row overflow-hidden gap-4">
            <LeadFilterSidebar
              filters={filters}
              filterOptions={filterOptions}
              metrics={metrics}
            />
            <section className="flex min-w-0 flex-1 flex-col gap-3 px-4 py-4 overflow-hidden md:px-6">
              {/* Toolbar and Queue */}
              <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 mb-3">
                <LeadContextBar filters={filters} query={query} />
                <div className="flex items-center gap-2">
                  <SortToggle sort={sort} query={query} />
                  <Button asChild size="sm" variant="outline" className="cursor-pointer">
                    <Link href={exportHref}>
                      <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
                      Export
                    </Link>
                  </Button>
                </div>
              </div>
              <LeadWorkspaceSplitView>
                <LeadPriorityQueue result={result} query={query} />
              </LeadWorkspaceSplitView>
            </section>
          </main>
        </div>
        <LeadBulkActionBar icpVersions={icpVersionOptions} campaigns={campaignOptions} />
      </LeadSelectionProvider>
      </LeadDrawerProvider>
    </LeadWorkspaceShell>
  );
}

async function getLeadWorkspaceTenantContext() {
  try {
    return await requirePermission("crm.read");
  } catch (error) {
    if (error instanceof V2TenantError) {
      return error;
    }

    throw error;
  }
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

function LeadWorkspaceShell({
  children,
  tenantContext,
  exportHref,
  runtimeRun,
}: {
  children: ReactNode;
  tenantContext: Awaited<ReturnType<typeof requirePermission>>;
  exportHref?: string;
  runtimeRun?: RuntimeRunStatusView | null;
}) {
  return (
    <WorkspaceFrame className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden p-0 sm:p-0 lg:px-0 lg:py-0">
      <div className="shrink-0">
        <PageHeader
          title="Lead workspace"
          description="Active, non-deleted LeadAssignment view with deterministic ICP scoring."
          actions={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <RuntimeHeaderBadge view={runtimeRun ?? null} />
              {exportHref ? (
                <a
                  href={exportHref}
                  className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-white transition-colors duration-200 hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  Export CSV
                </a>
              ) : null}
              <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                {tenantContext.organizationName}
              </span>
            </div>
          }
        />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {children}
      </div>
    </WorkspaceFrame>
  );
}

function SortToggle({ sort, query }: { sort: "priority" | "recent"; query: Record<string, string> }) {
  const hrefFor = (value: "priority" | "recent") => {
    const params = new URLSearchParams(query);
    params.delete("page");
    if (value === "priority") params.delete("sort");
    else params.set("sort", value);
    const qs = params.toString();
    return qs ? `/v2/workspace/leads?${qs}` : "/v2/workspace/leads";
  };
  const cls = (active: boolean) =>
    active
      ? "rounded-md bg-primary px-2.5 py-1 text-white"
      : "px-2.5 py-1 text-muted-foreground hover:text-foreground";
  return (
    <div className="inline-flex items-center rounded-lg border border-border bg-card p-0.5 text-xs font-semibold">
      <Link href={hrefFor("priority")} className={cls(sort === "priority")}>Priority</Link>
      <Link href={hrefFor("recent")} className={cls(sort === "recent")}>Recent</Link>
    </div>
  );
}

function getParam(
  params: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = params[key];
  const first = Array.isArray(value) ? value[0] : value;

  return first && first.trim() ? first.trim() : undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

