import {
  Download,
  Filter,
  Search,
  Upload,
  SlidersHorizontal,
} from "lucide-react";

import { CompanyReviewTable } from "@/components/companies/CompanyReviewTable";
import type { CompanyReviewRow } from "@/components/companies/companyReviewUtils";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  companyTypeValues,
  qualificationValues,
} from "@/lib/server/api/enums";
import {
  getEnrichedCompanies,
  type CompanyViewMode,
  type EnrichedCompanyRow,
} from "@/lib/server/companies/enrichedCompanies";
import {
  getUploadJobDetail,
  listManagedUploadJobs,
  type UploadJobListItem,
} from "@/lib/server/uploadJobs/management";

// DB-backed page — render per request, never prerender at build (no DB in CI/Docker build).
export const dynamic = "force-dynamic";

type CompaniesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type UploadSelectorItem = Pick<
  UploadJobListItem,
  "id" | "fileName" | "createdAt"
>;

export default async function CompaniesPage({
  searchParams,
}: CompaniesPageProps) {
  const params = await searchParams;
  const page = parsePositiveInt(getParam(params, "page"), 1);
  const pageSize = parsePositiveInt(getParam(params, "pageSize"), 50);
  const cappedPageSize = Math.min(pageSize, 100);
  const search = getParam(params, "search");
  const uploadJobId = getParam(params, "uploadJobId");
  const qualification = getParam(params, "qualification");
  const companyType = getParam(params, "companyType");
  const country = getParam(params, "country");
  const reviewedParam = getParam(params, "reviewed");
  const rowState = parseRowState(getParam(params, "rowState"));
  const requestedCompanyView = parseCompanyView(getParam(params, "companyView"));
  const companyView: CompanyViewMode = uploadJobId
    ? "records"
    : requestedCompanyView ?? "unique";
  const validQualification = isAllowedValue(qualificationValues, qualification)
    ? qualification
    : undefined;
  const validCompanyType = isAllowedValue(companyTypeValues, companyType)
    ? companyType
    : undefined;
  const reviewed = parseReviewedFilter(reviewedParam);

  const [uploadJobsResult, selectedUploadDetail, result] = await Promise.all([
    listManagedUploadJobs({
      where: { archivedAt: null, deletedAt: null },
      page: 1,
      pageSize: 100,
      skip: 0,
    }),
    uploadJobId ? getUploadJobDetail(uploadJobId) : Promise.resolve(null),
    getEnrichedCompanies({
      page,
      pageSize: cappedPageSize,
      skip: (page - 1) * cappedPageSize,
      search,
      uploadJobId,
      qualification: validQualification,
      companyType: validCompanyType,
      country,
      reviewed: reviewed ?? undefined,
      includeArchived: rowState === "archived" || rowState === "all",
      includeDeleted: rowState === "deleted" || rowState === "all",
      rowState,
      companyView,
    }),
  ]);
  const companies = result.data.map(toCompanyReviewRow);
  const uploadSelectorItems = buildUploadSelectorItems(
    uploadJobsResult.items,
    selectedUploadDetail?.uploadJob
      ? {
          id: selectedUploadDetail.uploadJob.id,
          fileName: selectedUploadDetail.uploadJob.fileName,
          createdAt: selectedUploadDetail.uploadJob.createdAt,
        }
      : null
  );
  const filterValues = {
    uploadJobId,
    search,
    qualification: validQualification,
    companyType: validCompanyType,
    country,
    reviewed: reviewedToQueryValue(reviewed),
    rowState: rowState === "active" ? undefined : rowState,
    companyView: uploadJobId || companyView === "unique" ? undefined : companyView,
  };
  const filterQuery = buildQueryString(filterValues);
  const exportHref = `/api/companies/export${filterQuery ? `?${filterQuery}` : ""}`;
  const exportScopeLabel = selectedUploadDetail
    ? selectedUploadDetail.uploadJob.fileName
    : companyView === "unique"
      ? "Unique companies across uploads"
      : "All company records";
  const filterChips = buildFilterChips({
    selectedUploadDetail,
    search,
    qualification: validQualification,
    companyType: validCompanyType,
    country,
    reviewed,
    rowState,
    companyView,
  });
  const clearFiltersHref = uploadJobId
    ? `/companies?uploadJobId=${encodeURIComponent(uploadJobId)}`
    : "/companies";
  const totalPages = Math.max(
    1,
    Math.ceil(result.pagination.total / cappedPageSize)
  );
  const metrics = buildWorkspaceMetrics(companies, result.pagination.total);
  const savedTabs = buildSavedTabs(metrics);

  return (
    <div className="-m-6 min-h-[calc(100vh-4rem)] bg-[#f8fafc] font-sans">
      <div className="grid min-h-[calc(100vh-4rem)] lg:grid-cols-[268px_minmax(0,1fr)]">
        <aside className="border-r border-slate-200 bg-white">
          <form className="sticky top-0 flex h-[calc(100vh-4rem)] flex-col">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-950">Filters</h2>
              <Button type="button" variant="outline" className="h-9 rounded-lg border-slate-200 bg-white px-3 text-xs">
                Saved views
              </Button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <FilterSelect
                label="Upload Source"
                name="uploadJobId"
                defaultValue={uploadJobId ?? ""}
                options={[
                  { label: "All sources", value: "" },
                  ...uploadSelectorItems.map((uploadJob) => ({
                    label: `${uploadJob.fileName} - ${formatDate(uploadJob.createdAt)}`,
                    value: uploadJob.id,
                  })),
                ]}
              />
              <FilterSelect
                label="Qualification"
                name="qualification"
                defaultValue={validQualification ?? "all"}
                options={[
                  { label: "All", value: "all" },
                  ...qualificationValues.map((value) => ({
                    label: value,
                    value,
                  })),
                ]}
              />
              <FilterSelect
                label="Company Type"
                name="companyType"
                defaultValue={validCompanyType ?? "all"}
                options={[
                  { label: "All", value: "all" },
                  ...companyTypeValues.map((value) => ({
                    label: value,
                    value,
                  })),
                ]}
              />
              <FilterSelect
                label="Reviewed"
                name="reviewed"
                defaultValue={reviewedToQueryValue(reviewed) ?? "all"}
                options={[
                  { label: "All", value: "all" },
                  { label: "Reviewed", value: "true" },
                  { label: "Unreviewed", value: "false" },
                ]}
              />
              <FilterSelect
                label="Rows"
                name="rowState"
                defaultValue={rowState}
                options={[
                  { label: "Active rows", value: "active" },
                  { label: "Archived rows", value: "archived" },
                  { label: "Deleted rows", value: "deleted" },
                  { label: "All rows", value: "all" },
                ]}
              />
              {!uploadJobId && (
                <FilterSelect
                  label="View Mode"
                  name="companyView"
                  defaultValue={companyView}
                  options={[
                    { label: "Unique companies", value: "unique" },
                    { label: "All records", value: "records" },
                  ]}
                />
              )}
              <FilterText
                label="Country"
                name="country"
                defaultValue={country ?? ""}
                placeholder="All"
              />
              <FilterText
                label="Search"
                name="search"
                defaultValue={search ?? ""}
                placeholder="Company, website, industry"
              />
              <input type="hidden" name="pageSize" value={cappedPageSize} />
            </div>
            <div className="grid grid-cols-2 gap-2 border-t border-slate-200 bg-white p-5">
              <Button asChild variant="outline" className="h-10 rounded-lg border-slate-200">
                <a href={clearFiltersHref}>Clear all</a>
              </Button>
              <Button type="submit" className="h-10 rounded-lg bg-blue-600 font-semibold text-white hover:bg-blue-700">
                Apply filters
              </Button>
            </div>
          </form>
        </aside>

        <main className="min-w-0 space-y-4 p-5">
          <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold text-slate-950">
                Companies
              </h1>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-medium text-slate-600">
                {result.pagination.total.toLocaleString()} companies
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild className="h-10 rounded-lg border-blue-200 bg-white px-4 font-semibold text-blue-700 shadow-sm hover:bg-blue-50" variant="outline">
                <a href="/uploads">
                  <Upload className="mr-2 h-4 w-4" />
                  Review Upload
                </a>
              </Button>
              <Button asChild variant="outline" className="h-10 rounded-lg border-slate-200 bg-white px-4 font-semibold text-slate-700 shadow-sm">
                <a href={exportHref}>
                  <Download className="mr-2 h-4 w-4" />
                  Export
                </a>
              </Button>
            </div>
          </header>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <nav className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
              {savedTabs.map((tab) => (
                <a
                  key={tab.label}
                  href={tab.href}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                    tab.active
                      ? "bg-blue-50 text-blue-700"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                  }`}
                >
                  {tab.label}
                </a>
              ))}
            </nav>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="h-9 rounded-lg border-slate-200 bg-white text-slate-700">
                <SlidersHorizontal className="mr-2 h-4 w-4" />
                Density: Compact
              </Button>
              <Button type="button" variant="outline" className="h-9 rounded-lg border-slate-200 bg-white text-slate-700">
                <Filter className="mr-2 h-4 w-4" />
                Columns
              </Button>
            </div>
          </div>

          <section className="grid overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:grid-cols-5">
            {metrics.map((metric) => (
              <WorkspaceMetricCard key={metric.label} {...metric} />
            ))}
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative max-w-xl flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <form>
                  <Input
                    className="h-10 rounded-lg border-slate-200 bg-white pl-9"
                    name="search"
                    placeholder="Search companies..."
                    defaultValue={search ?? ""}
                  />
                  <input type="hidden" name="uploadJobId" value={uploadJobId ?? ""} />
                  <input type="hidden" name="qualification" value={validQualification ?? ""} />
                  <input type="hidden" name="companyType" value={validCompanyType ?? ""} />
                  <input type="hidden" name="country" value={country ?? ""} />
                  <input type="hidden" name="reviewed" value={reviewedToQueryValue(reviewed) ?? ""} />
                  <input type="hidden" name="rowState" value={rowState} />
                  <input type="hidden" name="pageSize" value={cappedPageSize} />
                  {!uploadJobId && <input type="hidden" name="companyView" value={companyView} />}
                </form>
              </div>
              <div className="text-xs text-slate-500">
                <span>{exportScopeLabel}</span>
                {filterChips.length > 0 && (
                  <span className="ml-2">
                    {filterChips.slice(0, 4).join(" / ")}
                    {filterChips.length > 4 ? " / ..." : ""}
                  </span>
                )}
              </div>
            </div>

            {companies.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title={
                    uploadJobId
                      ? "No companies found for this upload"
                      : "No company records found"
                  }
                  description={
                    uploadJobId
                      ? "This upload has no companies matching the current filters. Clear filters or return to uploads to choose another job."
                      : "Upload a CSV first, or select a specific upload from /uploads for scoped review."
                  }
                />
              </div>
            ) : (
              <CompanyReviewTable companies={companies} />
            )}
          </section>

          {result.pagination.total > cappedPageSize && (
            <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-500">
                Page {page} of {totalPages} -{" "}
                {result.pagination.total.toLocaleString()} matching companies
              </p>
              <div className="flex gap-2">
                {page > 1 ? (
                  <Button asChild variant="outline" size="sm">
                    <a
                      href={`/companies?${buildQueryString({
                        ...filterValues,
                        page: String(page - 1),
                        pageSize: String(cappedPageSize),
                      })}`}
                    >
                      Previous
                    </a>
                  </Button>
                ) : (
                  <Button type="button" variant="outline" size="sm" disabled>
                    Previous
                  </Button>
                )}
                {page < totalPages ? (
                  <Button asChild variant="outline" size="sm">
                    <a
                      href={`/companies?${buildQueryString({
                        ...filterValues,
                        page: String(page + 1),
                        pageSize: String(cappedPageSize),
                      })}`}
                    >
                      Next
                    </a>
                  </Button>
                ) : (
                  <Button type="button" variant="outline" size="sm" disabled>
                    Next
                  </Button>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function getParam(
  params: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = params[key];

  if (Array.isArray(value)) {
    return normalizeParamValue(value[0]);
  }

  return normalizeParamValue(value);
}

function WorkspaceMetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "blue" | "green" | "amber" | "red" | "violet";
}) {
  const color = {
    blue: "bg-blue-600",
    green: "bg-emerald-600",
    amber: "bg-amber-500",
    red: "bg-rose-600",
    violet: "bg-violet-600",
  }[tone];

  return (
    <div className="border-b border-slate-200 p-4 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${color}`} />
        <p className="text-xs font-medium text-slate-500">{label}</p>
      </div>
      <p className="mt-2 text-lg font-semibold text-slate-950">
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function buildWorkspaceMetrics(companies: CompanyReviewRow[], total: number) {
  const qualified = companies.filter(
    (company) =>
      (company.latestFeedbackExample?.finalQualification ??
        company.scoreResult?.qualification) === "qualified"
  ).length;
  const reviewed = companies.filter(
    (company) => company.latestFeedbackExample
  ).length;
  const uncertain = companies.filter(
    (company) =>
      (company.latestFeedbackExample?.finalQualification ??
        company.scoreResult?.qualification) === "uncertain"
  ).length;
  const unqualified = companies.filter(
    (company) =>
      (company.latestFeedbackExample?.finalQualification ??
        company.scoreResult?.qualification) === "unqualified"
  ).length;

  return [
    {
      label: "Total",
      value: total,
      tone: "blue" as const,
    },
    {
      label: "Qualified",
      value: qualified,
      tone: "green" as const,
    },
    {
      label: "Uncertain",
      value: uncertain,
      tone: "amber" as const,
    },
    {
      label: "Unqualified",
      value: unqualified,
      tone: "red" as const,
    },
    {
      label: "Reviewed",
      value: reviewed,
      tone: "violet" as const,
    },
  ];
}

function buildSavedTabs(
  metrics: ReturnType<typeof buildWorkspaceMetrics>
) {
  return [
    { label: "All companies", count: metrics[0].value, href: "/companies", active: true },
    {
      label: "Qualified",
      count: metrics[1].value,
      href: "/companies?qualification=qualified",
      active: false,
    },
    {
      label: "Uncertain",
      count: metrics[2].value,
      href: "/companies?qualification=uncertain",
      active: false,
    },
    {
      label: "Reviewed",
      count: metrics[4].value,
      href: "/companies?reviewed=true",
      active: false,
    },
  ];
}

function FilterSelect({
  label,
  name,
  defaultValue,
  options,
}: {
  label: string;
  name: string;
  defaultValue: string;
  options: Array<{ label: string; value: string }>;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-xs font-semibold text-slate-700">{label}</span>
      <select
        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-xs"
        name={name}
        defaultValue={defaultValue}
      >
        {options.map((option) => (
          <option key={`${name}-${option.value}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FilterText({
  label,
  name,
  defaultValue,
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue: string;
  placeholder: string;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-xs font-semibold text-slate-700">{label}</span>
      <Input
        className="h-10 rounded-lg border-slate-200 bg-white text-sm shadow-xs"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
      />
    </label>
  );
}

function normalizeParamValue(value: string | undefined) {
  const trimmed = value?.trim();

  return trimmed && trimmed !== "all" ? trimmed : undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseReviewedFilter(value: string | undefined) {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return undefined;
}

function parseRowState(value: string | undefined) {
  if (
    value === "archived" ||
    value === "deleted" ||
    value === "all"
  ) {
    return value;
  }

  return "active";
}

function parseCompanyView(value: string | undefined): CompanyViewMode | undefined {
  if (value === "unique" || value === "records") {
    return value;
  }

  return undefined;
}

function reviewedToQueryValue(value: boolean | undefined) {
  if (value === true) {
    return "true";
  }

  if (value === false) {
    return "false";
  }

  return undefined;
}

function isAllowedValue<T extends readonly string[]>(
  values: T,
  value: string | undefined
): value is T[number] {
  return value ? (values as readonly string[]).includes(value) : false;
}

function buildQueryString(values: Record<string, string | undefined>) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    if (value) {
      query.set(key, value);
    }
  }

  return query.toString();
}

function buildUploadSelectorItems(
  activeUploadJobs: UploadSelectorItem[],
  selectedUploadJob: UploadSelectorItem | null
) {
  const uploadJobs = selectedUploadJob
    ? [selectedUploadJob, ...activeUploadJobs]
    : activeUploadJobs;
  const seen = new Set<string>();

  return uploadJobs.filter((uploadJob) => {
    if (seen.has(uploadJob.id)) {
      return false;
    }

    seen.add(uploadJob.id);
    return true;
  });
}

function buildFilterChips({
  selectedUploadDetail,
  search,
  qualification,
  companyType,
  country,
  reviewed,
  rowState,
  companyView,
}: {
  selectedUploadDetail: Awaited<ReturnType<typeof getUploadJobDetail>> | null;
  search?: string;
  qualification?: string;
  companyType?: string;
  country?: string;
  reviewed?: boolean;
  rowState: "active" | "archived" | "deleted" | "all";
  companyView: CompanyViewMode;
}) {
  const chips: string[] = [];

  chips.push(
    selectedUploadDetail
      ? `Upload: ${selectedUploadDetail.uploadJob.fileName}`
      : companyView === "unique"
        ? "View: unique companies"
        : "View: all records"
  );

  if (rowState !== "active") {
    chips.push(`Rows: ${rowState}`);
  }

  if (search) {
    chips.push(`Search: ${search}`);
  }

  if (qualification) {
    chips.push(`Qualification: ${qualification}`);
  }

  if (companyType) {
    chips.push(`Type: ${companyType}`);
  }

  if (country) {
    chips.push(`Country: ${country}`);
  }

  if (reviewed === true) {
    chips.push("Reviewed");
  }

  if (reviewed === false) {
    chips.push("Unreviewed");
  }

  return chips;
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

function toCompanyReviewRow(company: EnrichedCompanyRow): CompanyReviewRow {
  return {
    ...company,
    archivedAt: company.archivedAt?.toISOString() ?? null,
    deletedAt: company.deletedAt?.toISOString() ?? null,
    scoreResult: company.scoreResult
      ? {
          ...company.scoreResult,
          createdAt: company.scoreResult.createdAt.toISOString(),
        }
      : null,
    websiteResearch: company.websiteResearch
      ? {
          ...company.websiteResearch,
          researchedAt: company.websiteResearch.researchedAt.toISOString(),
          createdAt: company.websiteResearch.createdAt.toISOString(),
        }
      : null,
    latestFeedbackExample: company.latestFeedbackExample
      ? {
          ...company.latestFeedbackExample,
          createdAt: company.latestFeedbackExample.createdAt.toISOString(),
          updatedAt: company.latestFeedbackExample.updatedAt.toISOString(),
        }
      : null,
    latestAiJob: company.latestAiJob
      ? {
          ...company.latestAiJob,
          nextAttemptAt: company.latestAiJob.nextAttemptAt?.toISOString() ?? null,
          lockedAt: company.latestAiJob.lockedAt?.toISOString() ?? null,
          startedAt: company.latestAiJob.startedAt?.toISOString() ?? null,
          completedAt: company.latestAiJob.completedAt?.toISOString() ?? null,
          createdAt: company.latestAiJob.createdAt.toISOString(),
          updatedAt: company.latestAiJob.updatedAt.toISOString(),
        }
      : null,
    latestAiAssessment: company.latestAiAssessment
      ? toCompanyAiAssessmentReviewRow(company.latestAiAssessment)
      : null,
    latestIcpInsight: company.latestIcpInsight
      ? {
          ...company.latestIcpInsight,
          createdAt: company.latestIcpInsight.createdAt.toISOString(),
        }
      : null,
  };
}

function toCompanyAiAssessmentReviewRow(
  assessment: NonNullable<EnrichedCompanyRow["latestAiAssessment"]>
) {
  return {
    id: assessment.id,
    provider: assessment.provider,
    modelName: assessment.modelName,
    promptVersion: assessment.promptVersion,
    mode: assessment.mode,
    qualification: assessment.qualification,
    companyType: assessment.companyType,
    companyScore: assessment.companyScore,
    confidence: assessment.confidence,
    reason: assessment.reason,
    oneSentenceCompanySummary: assessment.oneSentenceCompanySummary,
    brief: assessment.brief,
    cacheHit: assessment.cacheHit,
    createdAt: assessment.createdAt.toISOString(),
  };
}
