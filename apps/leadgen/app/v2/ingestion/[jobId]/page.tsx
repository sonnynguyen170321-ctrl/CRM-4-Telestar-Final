import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Database,
  FileText,
  Filter,
  Loader2,
  Search,
  Sparkles,
  Table2,
} from "lucide-react";

import { PageHeader } from "@/components/shared/PageHeader";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { ProgressPanel } from "@/components/v2/ingestion/ProgressPanel";
import { PipelineStepper, type PipelineStep, type PipelineStepStatus } from "@/components/v2/ingestion/PipelineStepper";
import { IngestionRowDrawer } from "@/components/v2/ingestion/IngestionRowDrawer";
import { CopyJobIdButton } from "@/components/v2/ingestion/CopyJobIdButton";
import { humanizeTaskToken, TaskStatusPill } from "@/components/v2/shared/taskTransition";
import { createIngestionJob, type V2IngestionDatabase } from "@/lib/v2/ingestion";
import { processNextV2Job, type V2JobDatabase } from "@/lib/v2/jobs";
import { TELESTAR_SDR_OUTSOURCING_ICP_RULES } from "@/lib/v2/scoring/__fixtures__/sampleIcpRules";
import { upgradeV1toV2 } from "@/lib/v2/scoring/rules/upgradeV1toV2";
import {
  getTenantErrorMessage,
  requirePermission,
  V2TenantError,
} from "@/lib/v2/tenant";
import { prisma } from "@/lib/server/prisma";

type IngestionPageProps = {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type IngestionJobView = {
  id: string;
  status: string;
  jobType: string;
  originalFileName: string;
  rowCountsJson: unknown;
  errorSummaryJson: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type IngestionRowView = {
  id: string;
  sourceRowNumber: number;
  rawRowJson: Record<string, unknown>;
  normalizedRowJson: unknown;
  rowStatus: string;
  matchedCompanyId: string | null;
  matchedContactId: string | null;
  errorMessage: string | null;
  matchedCompanyName: string | null;
  matchedContactName: string | null;
};

type JobView = {
  id: string;
  jobType: string;
  status: string;
  progressCurrent: number;
  progressTotal: number | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};


export default async function V2IngestionPage({ params, searchParams }: IngestionPageProps) {
  const { jobId } = await params;
  const rawSearchParams = await searchParams;
  const tenantContext = await getTenantContext();

  if (tenantContext instanceof V2TenantError) {
    return <TenantDeniedState error={tenantContext} />;
  }

  if (jobId === "dev") {
    return (
      <IngestionShell title="Seeded ingestion dev runner">
        <div className="rounded-lg border border-border bg-surface p-6">
          <div className="text-sm font-semibold text-foreground">
            Run seeded ingestion
          </div>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Creates tenant-scoped fixture rows and runs parse, normalize, then
            identity match, lead upsert, and scoring. This button is disabled
            in production.
          </p>
          <form action={runSeededIngestion} className="mt-4">
            <button
              type="submit"
              disabled={process.env.NODE_ENV === "production"}
              className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg bg-foreground px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-foreground disabled:cursor-not-allowed disabled:bg-foreground"
            >
              Run seeded ingestion
            </button>
          </form>
        </div>
      </IngestionShell>
    );
  }

  const [job, rows, jobs] = await Promise.all([
    loadIngestionJob(tenantContext.organizationId, jobId),
    loadIngestionRows(tenantContext.organizationId, jobId),
    loadV2Jobs(tenantContext.organizationId, jobId),
  ]);

  if (!job) {
    return (
      <IngestionShell title="Ingestion job not found">
        <div className="rounded-lg border border-dashed border-border bg-surface p-8 text-center text-sm text-muted-foreground">
          No ingestion job exists for this tenant and job id.
        </div>
      </IngestionShell>
    );
  }

  const counts = rows.reduce(
    (accumulator, row) => {
      const state = deriveMatchState(row);
      accumulator[state] += 1;
      return accumulator;
    },
    { matched: 0, ambiguous: 0, none: 0, error: 0, raw: 0 }
  );

  const steps = buildPipelineSteps(jobs, job, rows.length, counts);
  const rowStatusFilter = parseRowStatusFilter(pickParam(rawSearchParams, "rowStatus"));
  const matchFilter = parseMatchFilter(pickParam(rawSearchParams, "match"));
  const searchQuery = pickParam(rawSearchParams, "q") ?? "";
  const currentPage = parsePageParam(pickParam(rawSearchParams, "page"));
  const filteredRows = filterRows(rows, {
    match: matchFilter,
    query: searchQuery,
    rowStatus: rowStatusFilter,
  });
  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const visibleRows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const filterCounts = buildRowStatusFilterCounts(rows);
  const health = derivePipelineHealth(job, jobs, counts);
  const nextAction = deriveNextAction(jobId, rawSearchParams, job, jobs, counts, health);
  const stageAttention = deriveStageAttention(jobs);
  const qualityGroups = buildQualityGroups(rows.length, counts, jobs);
  const selectedRowId = pickParam(rawSearchParams, "rowId");
  const selectedRow = selectedRowId ? rows.find((row) => row.id === selectedRowId) ?? null : null;
  const baseQueryString = buildBaseQueryString(rawSearchParams);
  const closeHref = `/v2/ingestion/${jobId}${baseQueryString ? `?${baseQueryString}` : ""}`;
  return (
    <IngestionShell title="Ingestion job detail">
      <CommandHeader
        job={job}
        totalRows={rows.length}
        errorRows={counts.error}
        health={health}
        nextAction={nextAction}
        stageAttention={stageAttention}
      />

      <HealthStrip health={health} nextAction={nextAction} stageAttention={stageAttention} />

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <PipelineCockpit steps={steps} jobs={jobs} job={job} counts={counts} />
        <div id="live-progress" className="min-w-0">
          <ProgressPanel ingestionJobId={jobId} />
        </div>
      </section>

      <QualityDashboard groups={qualityGroups} />

      <UploadedRowsWorkbench
        jobId={jobId}
        params={rawSearchParams}
        rows={visibleRows}
        totalRows={rows.length}
        filteredRows={filteredRows.length}
        filterCounts={filterCounts}
        rowStatusFilter={rowStatusFilter}
        matchFilter={matchFilter}
        searchQuery={searchQuery}
        page={safePage}
        totalPages={totalPages}
        selectedRowId={selectedRowId}
      />

      {selectedRow ? (
        <IngestionRowDrawer
          row={{
            id: selectedRow.id,
            sourceRowNumber: selectedRow.sourceRowNumber,
            rowStatus: selectedRow.rowStatus,
            rawRowJson: selectedRow.rawRowJson,
            normalizedRowJson: selectedRow.normalizedRowJson,
            matchedCompanyName: selectedRow.matchedCompanyName,
            matchedContactName: selectedRow.matchedContactName,
            matchedCompanyId: selectedRow.matchedCompanyId,
            matchedContactId: selectedRow.matchedContactId,
            errorMessage: selectedRow.errorMessage,
          }}
          closeHref={closeHref}
        />
      ) : null}
    </IngestionShell>
  );
}

type FunnelStatData = {
  label: string;
  value: number;
  tone: "blue" | "emerald" | "amber" | "violet" | "red" | "slate" | "teal";
  detail?: string;
};

type RowStatusFilter = "all" | "RAW" | "NORMALIZED" | "MATCHED" | "APPLIED" | "ERROR";
type MatchFilter = "all" | "matched" | "ambiguous" | "none" | "error" | "raw";
type PipelineHealthTone = "blue" | "emerald" | "amber" | "red" | "slate";

type PipelineHealth = {
  label: string;
  detail: string;
  tone: PipelineHealthTone;
  activeJobs: number;
  failedJobs: number;
  reviewRows: number;
};

type NextAction = {
  label: string;
  detail: string;
  href: string;
  tone: PipelineHealthTone;
};

type StageAttention = {
  label: string;
  detail: string;
  tone: PipelineHealthTone;
};

type QualityGroup = {
  title: string;
  detail: string;
  items: Array<{ label: string; value: number; tone: FunnelStatData["tone"] }>;
};

const ACTIVE_JOB_STATUSES = new Set(["QUEUED", "RUNNING", "RETRY_SCHEDULED"]);
const FAILED_JOB_STATUSES = new Set(["FAILED", "CANCELLED"]);
const ROW_STATUS_FILTERS: Array<{ value: RowStatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "RAW", label: "Raw" },
  { value: "NORMALIZED", label: "Normalized" },
  { value: "MATCHED", label: "Matched" },
  { value: "APPLIED", label: "Applied" },
  { value: "ERROR", label: "Errors" },
];
const MATCH_FILTERS: Array<{ value: MatchFilter; label: string }> = [
  { value: "all", label: "All matches" },
  { value: "matched", label: "Matched" },
  { value: "ambiguous", label: "Ambiguous" },
  { value: "none", label: "No match" },
  { value: "error", label: "Error" },
  { value: "raw", label: "Raw" },
];

function CommandHeader({ errorRows, health, job, nextAction, stageAttention, totalRows }: {
  errorRows: number;
  health: PipelineHealth;
  job: IngestionJobView;
  nextAction: NextAction;
  stageAttention: StageAttention;
  totalRows: number;
}) {
  return (
    <section className="overflow-hidden rounded-md border border-border bg-surface shadow-sm">
      <div className="border-b border-border bg-muted/40 px-4 py-3">
        <Link href="/v2/ingestion/uploads" className="inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-primary transition-colors hover:text-primary">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to uploads
        </Link>
      </div>
      <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <JobStatusBadge status={job.status} />
            <TonePill tone={health.tone}>{health.label}</TonePill>
            <TonePill tone={stageAttention.tone}>{stageAttention.label}</TonePill>
          </div>
          <div className="mt-4 flex items-start gap-3">
            <div className="rounded-md border border-primary/20 bg-accent p-2 text-primary">
              <FileText className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase text-muted-foreground">Source file</div>
              <h2 className="mt-1 truncate text-2xl font-semibold tracking-normal text-foreground">{job.originalFileName}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded-md bg-muted px-2 py-1 font-mono text-foreground">{job.id}</span>
                <CopyJobIdButton jobId={job.id} />
              </div>
            </div>
          </div>
          <dl className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <HeaderMetric label="Job type" value={humanizeStatus(job.jobType)} />
            <HeaderMetric label="Rows" value={`${totalRows}${errorRows ? ` / ${errorRows} errors` : ""}`} />
            <HeaderMetric label="Updated" value={formatDateTime(job.updatedAt)} />
            <HeaderMetric label="Attention" value={stageAttention.detail} />
          </dl>
        </div>
        <div className="rounded-md border border-primary/20 bg-accent p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Smart next action
          </div>
          <p className="mt-2 text-sm leading-6 text-primary/80">{nextAction.detail}</p>
          <Link href={nextAction.href} className="mt-4 inline-flex min-h-10 w-full cursor-pointer items-center justify-center rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary">
            {nextAction.label}
          </Link>
        </div>
      </div>
    </section>
  );
}

function HealthStrip({ health, nextAction, stageAttention }: { health: PipelineHealth; nextAction: NextAction; stageAttention: StageAttention }) {
  const Icon = health.tone === "red" ? AlertTriangle : health.tone === "emerald" ? CheckCircle2 : health.tone === "blue" ? Loader2 : Clock3;
  return (
    <section className={`rounded-md border px-4 py-3 ${toneSurface(health.tone)}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${health.tone === "blue" ? "animate-spin" : ""}`} aria-hidden="true" />
          <div className="min-w-0">
            <div className="text-sm font-semibold">{health.label}</div>
            <p className="mt-0.5 text-xs leading-5 opacity-85">{health.detail}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
          <span>{health.activeJobs} active jobs</span>
          <span>{health.failedJobs} failed jobs</span>
          <span>{health.reviewRows} review rows</span>
          <span>{stageAttention.label}</span>
          <Link href={nextAction.href} className="rounded-md bg-surface-raised/70 px-2 py-1 text-inherit transition-colors hover:bg-surface-raised">
            {nextAction.label}
          </Link>
        </div>
      </div>
    </section>
  );
}

function PipelineCockpit({ counts, job, jobs, steps }: {
  counts: { matched: number; ambiguous: number; none: number; error: number; raw: number };
  job: IngestionJobView;
  jobs: JobView[];
  steps: PipelineStep[];
}) {
  const completion = derivePipelineCompletion(jobs, counts, job);
  const stageRows = buildStageRows(jobs);
  return (
    <section className="rounded-md border border-border bg-surface shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">Pipeline cockpit</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Each middle step maps to a real V2Job row; no fabricated runtime state.</p>
        </div>
        <TonePill tone={completion >= 100 ? "emerald" : "blue"}>{completion}% complete</TonePill>
      </div>
      <div className="space-y-5 p-4">
        <PipelineStepper steps={steps} />
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${completion}%` }} />
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {stageRows.map((stage) => <StageCard key={stage.jobType} stage={stage} />)}
        </div>
      </div>
    </section>
  );
}

function StageCard({ stage }: { stage: ReturnType<typeof buildStageRows>[number] }) {
  const tone = stage.status === "SUCCEEDED" ? "emerald" : FAILED_JOB_STATUSES.has(stage.status) ? "red" : ACTIVE_JOB_STATUSES.has(stage.status) ? "blue" : "slate";
  return (
    <div className="rounded-md border border-border bg-muted/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">{stage.label}</div>
          <div className="mt-1 text-xs text-muted-foreground">{stage.detail}</div>
        </div>
        <TonePill tone={tone}>{humanizeStatus(stage.status)}</TonePill>
      </div>
      {stage.errorMessage ? <div className="mt-2 line-clamp-2 text-xs leading-5 text-red-700">{stage.errorMessage}</div> : null}
    </div>
  );
}

function QualityDashboard({ groups }: { groups: QualityGroup[] }) {
  return (
    <section className="grid gap-3 xl:grid-cols-4">
      {groups.map((group) => (
        <div key={group.title} className="rounded-md border border-border bg-surface p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">{group.title}</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{group.detail}</p>
            </div>
            <Database className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {group.items.map((item) => <FunnelStat key={`${group.title}-${item.label}`} stat={item} />)}
          </div>
        </div>
      ))}
    </section>
  );
}

function HeaderMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
      <dt className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-sm font-semibold text-foreground">{value}</dd>
    </div>
  );
}

function TonePill({ children, tone }: { children: ReactNode; tone: PipelineHealthTone | FunnelStatData["tone"] }) {
  return <span className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs font-semibold ${tonePillClass(tone)}`}>{children}</span>;
}

function UploadedRowsWorkbench({
  filterCounts,
  filteredRows,
  jobId,
  matchFilter,
  page,
  params,
  rowStatusFilter,
  rows,
  searchQuery,
  selectedRowId,
  totalPages,
  totalRows,
}: {
  filterCounts: Record<RowStatusFilter, number>;
  filteredRows: number;
  jobId: string;
  matchFilter: MatchFilter;
  page: number;
  params: Record<string, string | string[] | undefined>;
  rowStatusFilter: RowStatusFilter;
  rows: IngestionRowView[];
  searchQuery: string;
  selectedRowId?: string;
  totalPages: number;
  totalRows: number;
}) {
  const rowHref = (rowId: string) => `/v2/ingestion/${jobId}?${withRowId(params, rowId)}`;

  const columns: DataTableColumn<IngestionRowView>[] = [
    {
      key: "row",
      header: "Row",
      width: "w-16 font-mono text-xs text-muted-foreground",
      cell: (row) => (
        <Link href={rowHref(row.id)} className="block">
          #{row.sourceRowNumber}
        </Link>
      ),
    },
    {
      key: "company_contact",
      header: "Company / contact",
      cell: (row) => {
        const company = pickString(row.rawRowJson, ["company", "company_name", "account", "account_name"]) ?? "-";
        const contact = pickString(row.rawRowJson, ["name", "full_name", "contact", "contact_name"]) ?? null;
        return (
          <Link href={rowHref(row.id)} className="block">
            <div className="font-semibold text-foreground group-hover:text-primary transition-colors">{company}</div>
            {contact ? <div className="mt-0.5 text-xs text-muted-foreground">{contact}</div> : null}
          </Link>
        );
      },
    },
    {
      key: "email",
      header: "Email",
      cell: (row) => {
        const email = pickString(row.rawRowJson, ["email", "contact_email", "work_email"]) ?? "-";
        return <span className="text-muted-foreground">{email}</span>;
      },
    },
    {
      key: "state",
      header: "State",
      cell: (row) => {
        const state = deriveMatchState(row);
        return <MatchStateBadge state={state} />;
      },
    },
    {
      key: "linked",
      header: "Linked records",
      cell: (row) => {
        const identityMatch = getIdentityMatch(row.normalizedRowJson);
        return (
          <div>
            <div>
              {row.matchedCompanyId ? (
                <Link href={`/v2/crm/companies?companyId=${row.matchedCompanyId}`} className="font-medium text-primary hover:underline">
                  {row.matchedCompanyName ?? row.matchedCompanyId}
                </Link>
              ) : (
                row.matchedCompanyName ?? identityMatch?.companyId ?? "-"
              )}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {row.matchedContactId ? (
                <Link href={`/v2/crm/contacts?contactId=${row.matchedContactId}`} className="text-primary hover:underline">
                  {row.matchedContactName ?? row.matchedContactId}
                </Link>
              ) : (
                row.matchedContactName ?? identityMatch?.contactId ?? ""
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: "signal",
      header: "Signal",
      cell: (row) => {
        const identityMatch = getIdentityMatch(row.normalizedRowJson);
        const reasons = identityMatch?.reasons.length ? identityMatch.reasons.join(", ") : row.errorMessage ?? "No signal recorded";
        return (
          <div className="max-w-md text-xs leading-5 text-muted-foreground">
            {identityMatch ? `${identityMatch.kind} / ${identityMatch.confidence} / ${reasons}` : reasons}
          </div>
        );
      },
    },
  ];

  const empty = (
    <div className="px-4 py-10 text-center text-sm text-muted-foreground">
      No rows match the current filters.
    </div>
  );

  const footer = (
    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
      <span>Page {page} of {totalPages}</span>
      <div className="flex items-center gap-1.5">
        {page <= 1 ? (
          <span className="cursor-not-allowed rounded-md border border-hairline px-2.5 py-1 text-xs font-medium text-muted-foreground opacity-50">
            Previous
          </span>
        ) : (
          <Link
            href={buildTableHref(jobId, params, { page: String(page - 1), rowId: null })}
            className="rounded-md border border-hairline px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted/50"
          >
            Previous
          </Link>
        )}
        {page >= totalPages ? (
          <span className="cursor-not-allowed rounded-md border border-hairline px-2.5 py-1 text-xs font-medium text-muted-foreground opacity-50">
            Next
          </span>
        ) : (
          <Link
            href={buildTableHref(jobId, params, { page: String(page + 1), rowId: null })}
            className="rounded-md border border-hairline px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted/50"
          >
            Next
          </Link>
        )}
      </div>
    </div>
  );

  return (
    <section className="overflow-hidden rounded-md border border-border bg-surface shadow-sm flex flex-col">
      <div className="shrink-0 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Table2 className="h-4 w-4 text-primary" aria-hidden="true" />
              Uploaded rows workbench
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{filteredRows} of {totalRows} rows shown. Filters are URL-driven and keep row inspector links shareable.</p>
          </div>
          <form action={`/v2/ingestion/${jobId}`} className="flex min-w-[260px] flex-1 items-center justify-end gap-2 sm:max-w-md">
            <input type="hidden" name="rowStatus" value={rowStatusFilter} />
            <input type="hidden" name="match" value={matchFilter} />
            <label className="relative block min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input name="q" defaultValue={searchQuery} placeholder="Search company, email, reason" className="h-9 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/20 focus:ring-2 focus:ring-primary/20" />
            </label>
            <button type="submit" className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-foreground px-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-foreground">
              <Filter className="h-4 w-4" aria-hidden="true" />
              Filter
            </button>
          </form>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {ROW_STATUS_FILTERS.map((item) => (
            <Link key={item.value} href={buildTableHref(jobId, params, { rowStatus: item.value, page: "1", rowId: null })} className={`inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold transition-colors ${rowStatusFilter === item.value ? "border-primary/20 bg-accent text-primary" : "border-border bg-surface text-muted-foreground hover:bg-muted/40"}`}>
              {item.label}
              <span className="rounded bg-surface-raised/70 px-1.5 py-0.5 tabular-nums">{filterCounts[item.value]}</span>
            </Link>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {MATCH_FILTERS.map((item) => (
            <Link key={item.value} href={buildTableHref(jobId, params, { match: item.value, page: "1", rowId: null })} className={`inline-flex min-h-7 items-center rounded-md border px-2 text-xs font-medium transition-colors ${matchFilter === item.value ? "border-border bg-muted text-foreground" : "border-border bg-surface text-muted-foreground hover:bg-muted/40"}`}>
              {item.label}
            </Link>
          ))}
        </div>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        selectedId={selectedRowId}
        minWidth="min-w-[980px]"
        empty={empty}
        footer={footer}
        className="border-none shadow-none rounded-none flex-1 min-h-0"
      />
    </section>
  );
}

const PIPELINE_ORDER: Array<{ jobType: string; label: string }> = [
  { jobType: "INGESTION_PARSE", label: "Parse" },
  { jobType: "INGESTION_NORMALIZE", label: "Normalize" },
  { jobType: "IDENTITY_MATCH", label: "Identity" },
  { jobType: "LEAD_ASSIGNMENT_UPSERT", label: "Create ICP assignments" },
  { jobType: "COMPANY_ENRICHMENT", label: "Enrichment" },
  { jobType: "ICP_SCORE", label: "Score against ICP" },
];

function buildPipelineSteps(
  jobs: JobView[],
  job: IngestionJobView,
  totalRows: number,
  counts: { matched: number; ambiguous: number; none: number; error: number; raw: number }
): PipelineStep[] {
  const byType = new Map<string, JobView>();
  for (const queued of jobs) {
    // Keep the latest job per type.
    const existing = byType.get(queued.jobType);
    if (!existing || queued.updatedAt > existing.updatedAt) {
      byType.set(queued.jobType, queued);
    }
  }

  const steps: PipelineStep[] = [
    { key: "upload", label: "Upload", status: "done", detail: `${totalRows} rows` },
  ];

  for (const stage of PIPELINE_ORDER) {
    const queued = byType.get(stage.jobType);
    steps.push({
      key: stage.jobType,
      label: stage.label,
      status: jobStepStatus(queued),
      detail: queued ? jobProgressDetail(queued) : undefined,
    });
  }

  const needsReview = counts.ambiguous + counts.none + counts.error;
  steps.push({
    key: "review",
    label: "Review queue",
    status: needsReview > 0 ? "active" : "done",
    detail: needsReview > 0 ? `${needsReview} to review` : "Clear",
  });

  steps.push({
    key: "done",
    label: "Done",
    status:
      job.status === "COMPLETED"
        ? "done"
        : job.status === "FAILED" || job.status === "ABANDONED"
          ? "error"
          : job.status === "PARTIAL"
            ? "active"
            : "pending",
    detail: humanizeStatus(job.status),
  });

  return steps;
}

function buildFunnelStats(
  totalRows: number,
  counts: { matched: number; ambiguous: number; none: number; error: number; raw: number },
  jobs: JobView[]
): FunnelStatData[] {
  const progress = (jobType: string) => {
    const job = jobs.filter((j) => j.jobType === jobType).sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1))[0];
    return job ? { value: job.progressCurrent, detail: humanizeStatus(job.status) } : { value: 0, detail: "Pending" };
  };
  const lead = progress("LEAD_ASSIGNMENT_UPSERT");
  const enrich = progress("COMPANY_ENRICHMENT");
  const score = progress("ICP_SCORE");

  return [
    { label: "Rows", value: totalRows, tone: "blue" },
    { label: "Matched", value: counts.matched, tone: "emerald" },
    { label: "Ambiguous", value: counts.ambiguous, tone: "amber" },
    { label: "No match", value: counts.none, tone: "slate" },
    { label: "Errors", value: counts.error, tone: "red" },
    { label: "ICP assignments", value: lead.value, tone: "violet", detail: lead.detail },
    { label: "Enriched", value: enrich.value, tone: "teal", detail: enrich.detail },
    { label: "Scored against ICP", value: score.value, tone: "emerald", detail: score.detail },
  ];
}

function jobStepStatus(job: JobView | undefined): PipelineStepStatus {
  if (!job) return "pending";
  switch (job.status) {
    case "SUCCEEDED":
      return "done";
    case "RUNNING":
      return "active";
    case "FAILED":
    case "CANCELLED":
      return "error";
    default:
      return "pending";
  }
}

function jobProgressDetail(job: JobView) {
  if (job.progressTotal && job.progressTotal > 0) {
    return `${job.progressCurrent}/${job.progressTotal}`;
  }
  return humanizeStatus(job.status);
}

function humanizeStatus(value: string) {
  return humanizeTaskToken(value);
}

function pickParam(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.trim() ? first.trim() : undefined;
}

function buildBaseQueryString(params: Record<string, string | string[] | undefined>) {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "rowId") continue;
    const first = Array.isArray(value) ? value[0] : value;
    if (first && first.trim()) out.set(key, first.trim());
  }
  return out.toString();
}

function withRowId(params: Record<string, string | string[] | undefined>, rowId: string) {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "rowId") continue;
    const first = Array.isArray(value) ? value[0] : value;
    if (first && first.trim()) out.set(key, first.trim());
  }
  out.set("rowId", rowId);
  return out.toString();
}

function JobHeaderCard({
  job,
  totalRows,
  errorRows,
}: {
  job: IngestionJobView;
  totalRows: number;
  errorRows: number;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Source file</div>
          <h2 className="mt-0.5 truncate text-lg font-semibold text-foreground">{job.originalFileName}</h2>
        </div>
        <JobStatusBadge status={job.status} />
      </div>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <HeaderField label="Job type" value={humanizeStatus(job.jobType)} />
        <HeaderField label="Rows" value={`${totalRows}${errorRows ? ` (${errorRows} errors)` : ""}`} />
        <HeaderField label="Created" value={job.createdAt.toISOString().replace("T", " ").slice(0, 16)} />
        <HeaderField label="Updated" value={job.updatedAt.toISOString().replace("T", " ").slice(0, 16)} />
      </dl>
    </section>
  );
}

function HeaderField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-sm font-semibold text-foreground">{value}</dd>
    </div>
  );
}

function JobStatusBadge({ status }: { status: string }) {
  return <TaskStatusPill status={status} />;
}

const FUNNEL_TONE: Record<FunnelStatData["tone"], string> = {
  blue: "text-primary",
  emerald: "text-emerald-700",
  amber: "text-amber-700",
  violet: "text-violet-700",
  red: "text-red-700",
  slate: "text-foreground",
  teal: "text-teal-700",
};

function FunnelStat({ stat }: { stat: FunnelStatData }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="truncate text-xs font-medium text-muted-foreground">{stat.label}</div>
      <div className={`mt-1 text-xl font-bold tracking-tight ${FUNNEL_TONE[stat.tone]}`}>
        {new Intl.NumberFormat("en-US").format(stat.value)}
      </div>
      {stat.detail ? <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{stat.detail}</div> : null}
    </div>
  );
}

function parseRowStatusFilter(value: string | undefined): RowStatusFilter {
  return ROW_STATUS_FILTERS.some((item) => item.value === value) ? (value as RowStatusFilter) : "all";
}

function parseMatchFilter(value: string | undefined): MatchFilter {
  return MATCH_FILTERS.some((item) => item.value === value) ? (value as MatchFilter) : "all";
}

function parsePageParam(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function filterRows(rows: IngestionRowView[], filters: { match: MatchFilter; query: string; rowStatus: RowStatusFilter }) {
  const query = filters.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.rowStatus !== "all" && row.rowStatus !== filters.rowStatus) return false;
    if (filters.match !== "all" && deriveMatchState(row) !== filters.match) return false;
    if (!query) return true;
    return rowMatchesQuery(row, query);
  });
}

function rowMatchesQuery(row: IngestionRowView, query: string) {
  const identityMatch = getIdentityMatch(row.normalizedRowJson);
  const haystack = [
    String(row.sourceRowNumber),
    row.matchedCompanyName,
    row.matchedContactName,
    row.errorMessage,
    identityMatch?.kind,
    identityMatch?.companyId,
    identityMatch?.contactId,
    ...(identityMatch?.reasons ?? []),
    pickString(row.rawRowJson, ["company", "company_name", "account", "account_name"]),
    pickString(row.rawRowJson, ["name", "full_name", "contact", "contact_name"]),
    pickString(row.rawRowJson, ["email", "contact_email", "work_email"]),
  ]
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function buildRowStatusFilterCounts(rows: IngestionRowView[]): Record<RowStatusFilter, number> {
  const counts: Record<RowStatusFilter, number> = { all: rows.length, RAW: 0, NORMALIZED: 0, MATCHED: 0, APPLIED: 0, ERROR: 0 };
  for (const row of rows) {
    if (row.rowStatus in counts) counts[row.rowStatus as RowStatusFilter] += 1;
  }
  return counts;
}

function derivePipelineHealth(
  job: IngestionJobView,
  jobs: JobView[],
  counts: { matched: number; ambiguous: number; none: number; error: number; raw: number }
): PipelineHealth {
  const activeJobs = jobs.filter((item) => ACTIVE_JOB_STATUSES.has(item.status)).length;
  const failedJobs = jobs.filter((item) => FAILED_JOB_STATUSES.has(item.status)).length;
  const reviewRows = counts.ambiguous + counts.none + counts.error;
  if (job.status === "FAILED" || job.status === "ABANDONED" || failedJobs > 0) {
    return { label: "Blocked", detail: "A job stage failed or the ingestion job reached a failed terminal state.", tone: "red", activeJobs, failedJobs, reviewRows };
  }
  if (activeJobs > 0 || ["PENDING", "VALIDATING", "PROCESSING"].includes(job.status)) {
    return { label: "Running", detail: "The pipeline still has active or pending work. Use live controls to drain safely.", tone: "blue", activeJobs, failedJobs, reviewRows };
  }
  if (reviewRows > 0 || job.status === "PARTIAL" || job.status === "VALIDATED_WITH_ERRORS") {
    return { label: "Needs review", detail: "The pipeline completed enough to inspect rows, but some rows need operator attention.", tone: "amber", activeJobs, failedJobs, reviewRows };
  }
  if (job.status === "COMPLETED") {
    return { label: "Completed", detail: "All visible pipeline checks are clear for this ingestion job.", tone: "emerald", activeJobs, failedJobs, reviewRows };
  }
  return { label: "Waiting", detail: "The ingestion job is waiting for the next worker pass or operator action.", tone: "slate", activeJobs, failedJobs, reviewRows };
}

function deriveNextAction(
  jobId: string,
  params: Record<string, string | string[] | undefined>,
  job: IngestionJobView,
  jobs: JobView[],
  counts: { matched: number; ambiguous: number; none: number; error: number; raw: number },
  health: PipelineHealth
): NextAction {
  const failedJobs = jobs.filter((item) => FAILED_JOB_STATUSES.has(item.status)).length;
  if (health.tone === "red" || failedJobs > 0 || job.status === "FAILED" || job.status === "ABANDONED") {
    return { label: "Review blockers", detail: "Open the failed rows or stage errors first; retries should stay intentional.", href: buildTableHref(jobId, params, { rowStatus: "ERROR", page: "1", rowId: null }), tone: "red" };
  }
  if (health.activeJobs > 0 || health.tone === "blue") {
    return { label: "Open progress panel", detail: "Advanced runtime controls live in the progress panel, with polling and stall detection.", href: "#live-progress", tone: "blue" };
  }
  if (counts.error > 0) {
    return { label: "Review failed rows", detail: "Start with rows that persisted ERROR so bad input does not hide in the table.", href: buildTableHref(jobId, params, { rowStatus: "ERROR", page: "1", rowId: null }), tone: "red" };
  }
  if (counts.ambiguous > 0) {
    return { label: "Inspect ambiguous", detail: "Ambiguous identity matches need a human check before trusting the downstream record.", href: buildTableHref(jobId, params, { match: "ambiguous", page: "1", rowId: null }), tone: "amber" };
  }
  if (counts.none > 0) {
    return { label: "Inspect no-match rows", detail: "No-match rows are usually missing domain, email, or company identifiers.", href: buildTableHref(jobId, params, { match: "none", page: "1", rowId: null }), tone: "amber" };
  }
  return { label: "Open leads", detail: "The ingestion surface is clean; continue from the lead workspace.", href: "/v2/workspace/leads", tone: "emerald" };
}

function deriveStageAttention(jobs: JobView[]): StageAttention {
  const failed = [...jobs].reverse().find((job) => FAILED_JOB_STATUSES.has(job.status));
  if (failed) return { label: "Stage failed", detail: humanizeStatus(failed.jobType), tone: "red" };
  const running = [...jobs].reverse().find((job) => ACTIVE_JOB_STATUSES.has(job.status));
  if (running) return { label: "Stage active", detail: humanizeStatus(running.jobType), tone: "blue" };
  const latest = [...jobs].sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1))[0];
  if (latest) return { label: "Last stage", detail: humanizeStatus(latest.jobType), tone: latest.status === "SUCCEEDED" ? "emerald" : "slate" };
  return { label: "No child jobs", detail: "Upload only", tone: "slate" };
}

function buildQualityGroups(
  totalRows: number,
  counts: { matched: number; ambiguous: number; none: number; error: number; raw: number },
  jobs: JobView[]
): QualityGroup[] {
  const progress = (jobType: string) => {
    const job = jobs.filter((item) => item.jobType === jobType).sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1))[0];
    return job?.progressCurrent ?? 0;
  };
  return [
    {
      title: "Row quality",
      detail: "Persisted ingestion-row states",
      items: [
        { label: "Rows", value: totalRows, tone: "blue" },
        { label: "Errors", value: counts.error, tone: "red" },
        { label: "Raw", value: counts.raw, tone: "slate" },
        { label: "Matched", value: counts.matched, tone: "emerald" },
      ],
    },
    {
      title: "Identity",
      detail: "Derived from normalized row identityMatch",
      items: [
        { label: "Matched", value: counts.matched, tone: "emerald" },
        { label: "Ambiguous", value: counts.ambiguous, tone: "amber" },
        { label: "No match", value: counts.none, tone: "slate" },
        { label: "Errors", value: counts.error, tone: "red" },
      ],
    },
    {
      title: "Records",
      detail: "Progress from real V2Job rows",
      items: [
        { label: "ICP assignments", value: progress("LEAD_ASSIGNMENT_UPSERT"), tone: "violet" },
        { label: "Enriched", value: progress("COMPANY_ENRICHMENT"), tone: "teal" },
        { label: "Scored against ICP", value: progress("ICP_SCORE"), tone: "emerald" },
        { label: "Jobs", value: jobs.length, tone: "blue" },
      ],
    },
    {
      title: "Operations",
      detail: "Current worker pressure",
      items: [
        { label: "Active", value: jobs.filter((job) => ACTIVE_JOB_STATUSES.has(job.status)).length, tone: "blue" },
        { label: "Failed", value: jobs.filter((job) => FAILED_JOB_STATUSES.has(job.status)).length, tone: "red" },
        { label: "Review", value: counts.ambiguous + counts.none + counts.error, tone: "amber" },
        { label: "Done", value: jobs.filter((job) => job.status === "SUCCEEDED").length, tone: "emerald" },
      ],
    },
  ];
}

function derivePipelineCompletion(
  jobs: JobView[],
  counts: { matched: number; ambiguous: number; none: number; error: number; raw: number },
  job: IngestionJobView
) {
  const weightedJobs = jobs.filter((item) => item.progressTotal && item.progressTotal > 0);
  const total = weightedJobs.reduce((sum, item) => sum + (item.progressTotal ?? 0), 0);
  const current = weightedJobs.reduce((sum, item) => sum + item.progressCurrent, 0);
  if (total > 0) return Math.min(100, Math.round((current / total) * 100));
  if (job.status === "COMPLETED") return 100;
  const rowTotal = counts.matched + counts.ambiguous + counts.none + counts.error + counts.raw;
  return rowTotal > 0 ? Math.round(((counts.matched + counts.error) / rowTotal) * 100) : 0;
}

function buildStageRows(jobs: JobView[]) {
  return PIPELINE_ORDER.map((stage) => {
    const latest = jobs.filter((job) => job.jobType === stage.jobType).sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1))[0];
    return {
      jobType: stage.jobType,
      label: stage.label,
      status: latest?.status ?? "NOT_QUEUED",
      detail: latest ? jobProgressDetail(latest) : "Not queued",
      errorMessage: latest?.errorMessage ?? null,
    };
  });
}

function buildTableHref(jobId: string, params: Record<string, string | string[] | undefined>, patch: Record<string, string | null | undefined>) {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first && first.trim()) out.set(key, first.trim());
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === "") out.delete(key);
    else out.set(key, value);
  }
  const query = out.toString();
  return `/v2/ingestion/${jobId}${query ? `?${query}` : ""}`;
}

function toneSurface(tone: PipelineHealthTone) {
  return {
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    blue: "border-primary/20 bg-accent text-primary",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
    red: "border-red-200 bg-red-50 text-red-900",
    slate: "border-border bg-muted/40 text-foreground",
  }[tone];
}

function tonePillClass(tone: PipelineHealthTone | FunnelStatData["tone"]) {
  return {
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    blue: "border-primary/20 bg-accent text-primary",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    red: "border-red-200 bg-red-50 text-red-700",
    slate: "border-border bg-muted/40 text-muted-foreground",
    teal: "border-teal-200 bg-teal-50 text-teal-700",
    violet: "border-violet-200 bg-violet-50 text-violet-700",
  }[tone];
}

function formatDateTime(value: Date) {
  return value.toISOString().replace("T", " ").slice(0, 16);
}
async function runSeededIngestion() {
  "use server";

  if (process.env.NODE_ENV === "production") {
    throw new Error("Seeded ingestion trigger is disabled in production.");
  }

  const tenantContext = await requirePermission("crm.read");
  const seedContext = await ensureSeedContext(tenantContext.organizationId);
  const companyId = await ensureSeedCompany(tenantContext.organizationId);
  const jobDb = prisma as unknown as V2JobDatabase;
  const ingestionDb = prisma as unknown as V2IngestionDatabase;
  const csvText = [
    "company,website,email,notes",
    "Alpha S2B,https://alpha-s2b.example,ada@alpha-s2b.example,exact domain",
    "Alpha S2B Platform,,,fuzzy candidate only",
    "Gamma Unknown,,,no existing company",
    ",,,invalid empty row",
  ].join("\n");
  const { ingestionJobId } = await createIngestionJob(ingestionDb, {
    organizationId: tenantContext.organizationId,
    projectId: seedContext.projectId,
    icpVersionId: seedContext.icpVersionId,
    uploadedByUserId: tenantContext.userId,
    originalFileName: `s2b-seeded-${companyId}.csv`,
    csvText,
    importProfileSuggestion: "company_upload",
  });

  await processNextV2Job(jobDb, {
    organizationId: tenantContext.organizationId,
    jobType: "INGESTION_PARSE",
  });
  await processNextV2Job(jobDb, {
    organizationId: tenantContext.organizationId,
    jobType: "INGESTION_NORMALIZE",
  });
  await processNextV2Job(jobDb, {
    organizationId: tenantContext.organizationId,
    jobType: "IDENTITY_MATCH",
  });
  await processNextV2Job(jobDb, {
    organizationId: tenantContext.organizationId,
    jobType: "LEAD_ASSIGNMENT_UPSERT",
  });
  await processNextV2Job(jobDb, {
    organizationId: tenantContext.organizationId,
    jobType: "ICP_SCORE",
  });

  redirect(`/v2/ingestion/${ingestionJobId}`);
}

async function ensureSeedContext(organizationId: string) {
  const clientAccountId = `client_s3_seed_${organizationId}`;
  const projectId = `project_s3_seed_${organizationId}`;
  const offerId = `offer_s3_seed_${organizationId}`;
  const icpProfileId = `icp_profile_s3_seed_${organizationId}`;
  const icpVersionId = `icp_version_s3_seed_${organizationId}`;
  // Default to schema-v2 so the seeded ingestion path scores via the rules-v2
  // engine (and shows the rules-v2 drawer), consistent with Create-from-preset.
  const rulesJson = {
    ...upgradeV1toV2(TELESTAR_SDR_OUTSOURCING_ICP_RULES),
    ruleSetId: "s3-seeded-ingestion",
    displayName: "S3 Seeded Ingestion ICP",
  };

  await prisma.$queryRaw`
    INSERT INTO "V2ClientAccount" ("id", "organizationId", "name", "status", "createdAt", "updatedAt")
    VALUES (${clientAccountId}, ${organizationId}, 'S3 Seed Account', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("id")
    DO UPDATE SET "status" = 'ACTIVE', "updatedAt" = CURRENT_TIMESTAMP
  `;
  await prisma.$queryRaw`
    INSERT INTO "V2Project" ("id", "organizationId", "clientAccountId", "name", "status", "createdAt", "updatedAt")
    VALUES (${projectId}, ${organizationId}, ${clientAccountId}, 'S3 Seed Project', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("id")
    DO UPDATE SET "clientAccountId" = EXCLUDED."clientAccountId", "status" = 'ACTIVE', "updatedAt" = CURRENT_TIMESTAMP
  `;
  await prisma.$queryRaw`
    INSERT INTO "V2Offer" ("id", "organizationId", "projectId", "name", "status", "createdAt", "updatedAt")
    VALUES (${offerId}, ${organizationId}, ${projectId}, 'S3 Seed Offer', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("id")
    DO UPDATE SET "projectId" = EXCLUDED."projectId", "status" = 'ACTIVE', "updatedAt" = CURRENT_TIMESTAMP
  `;
  await prisma.$queryRaw`
    INSERT INTO "V2ICPProfile" ("id", "organizationId", "offerId", "name", "status", "createdAt", "updatedAt")
    VALUES (${icpProfileId}, ${organizationId}, ${offerId}, 'S3 Seed ICP', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("id")
    DO UPDATE SET "offerId" = EXCLUDED."offerId", "status" = 'ACTIVE', "updatedAt" = CURRENT_TIMESTAMP
  `;
  await prisma.$queryRaw`
    INSERT INTO "V2ICPVersion" (
      "id",
      "organizationId",
      "icpProfileId",
      "versionNumber",
      "status",
      "rulesJson",
      "publishedAt",
      "version",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${icpVersionId},
      ${organizationId},
      ${icpProfileId},
      1,
      'PUBLISHED',
      ${JSON.stringify(rulesJson)}::jsonb,
      CURRENT_TIMESTAMP,
      1,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("id")
    DO UPDATE SET
      "icpProfileId" = EXCLUDED."icpProfileId",
      "status" = 'PUBLISHED',
      "rulesJson" = EXCLUDED."rulesJson",
      "deletedAt" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP
  `;

  return { projectId, icpVersionId };
}

async function ensureSeedCompany(organizationId: string) {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO "V2Company" (
      "id",
      "organizationId",
      "name",
      "nameNormalized",
      "canonicalDomain",
      "websiteUrl",
      "status",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${`company_s2b_seed_${organizationId}`},
      ${organizationId},
      'Alpha S2B',
      'alpha s2b',
      'alpha-s2b.example',
      'https://alpha-s2b.example',
      'ACTIVE',
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("organizationId", "canonicalDomain")
    DO UPDATE SET
      "name" = EXCLUDED."name",
      "nameNormalized" = EXCLUDED."nameNormalized",
      "websiteUrl" = EXCLUDED."websiteUrl",
      "status" = 'ACTIVE',
      "deletedAt" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "id"
  `;

  return rows[0].id;
}

async function getTenantContext() {
  try {
    return await requirePermission("crm.read");
  } catch (error) {
    if (error instanceof V2TenantError) {
      return error;
    }

    throw error;
  }
}

async function loadIngestionJob(organizationId: string, jobId: string) {
  const rows = await prisma.$queryRaw<IngestionJobView[]>`
    SELECT "id", "status", "jobType", "originalFileName", "rowCountsJson", "errorSummaryJson", "createdAt", "updatedAt"
    FROM "V2IngestionJob"
    WHERE "organizationId" = ${organizationId}
      AND "id" = ${jobId}
    LIMIT 1
  `;

  return rows[0] ?? null;
}

async function loadIngestionRows(organizationId: string, jobId: string) {
  return prisma.$queryRaw<IngestionRowView[]>`
    SELECT
      r."id",
      r."sourceRowNumber",
      r."rawRowJson",
      r."normalizedRowJson",
      r."rowStatus",
      r."matchedCompanyId",
      r."matchedContactId",
      r."errorMessage",
      c."name" AS "matchedCompanyName",
      ct."fullName" AS "matchedContactName"
    FROM "V2IngestionRow" r
    LEFT JOIN "V2Company" c
      ON c."id" = r."matchedCompanyId"
      AND c."organizationId" = r."organizationId"
    LEFT JOIN "V2Contact" ct
      ON ct."id" = r."matchedContactId"
      AND ct."organizationId" = r."organizationId"
    WHERE r."organizationId" = ${organizationId}
      AND r."jobId" = ${jobId}
    ORDER BY r."sourceRowNumber" ASC
  `;
}

async function loadV2Jobs(organizationId: string, ingestionJobId: string) {
  return prisma.$queryRaw<JobView[]>`
    SELECT "id", "jobType", "status", "progressCurrent", "progressTotal", "errorMessage", "createdAt", "updatedAt"
    FROM "V2Job"
    WHERE "organizationId" = ${organizationId}
      AND "sourceType" = 'INGESTION_JOB'
      AND "sourceId" = ${ingestionJobId}
    ORDER BY "createdAt" ASC
  `;
}

function IngestionShell({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0">
      <PageHeader
        title={title}
        description="Identity matching, lead upsert, and scoring are observable here."
      />
      <main className="space-y-5 px-6 py-5">{children}</main>
    </WorkspaceFrame>
  );
}

function TenantDeniedState({ error }: { error: V2TenantError }) {
  const message = getTenantErrorMessage(error);

  return (
    <WorkspaceFrame className="flex items-center justify-center">
      <div className="max-w-xl rounded-lg border border-border bg-surface p-6 text-center">
        <div className="text-sm font-semibold text-foreground">{message.title}</div>
        <p className="mt-2 text-sm text-muted-foreground">{message.message}</p>
        <p className="mt-3 text-xs text-muted-foreground">Code: {message.technicalCode}</p>
      </div>
    </WorkspaceFrame>
  );
}

function MatchStateBadge({
  state,
}: {
  state: "ambiguous" | "error" | "matched" | "none" | "raw";
}) {
  const className = {
    ambiguous: "border-amber-200 bg-amber-50 text-amber-800",
    error: "border-red-200 bg-red-50 text-red-800",
    matched: "border-emerald-200 bg-emerald-50 text-emerald-800",
    none: "border-border bg-muted/40 text-muted-foreground",
    raw: "border-border bg-surface text-muted-foreground",
  }[state];

  return (
    <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${className}`}>
      {state.toUpperCase()}
    </span>
  );
}

function deriveMatchState(
  row: IngestionRowView
): "ambiguous" | "error" | "matched" | "none" | "raw" {
  if (row.rowStatus === "ERROR") {
    return "error";
  }

  if (row.rowStatus === "MATCHED") {
    return "matched";
  }

  const identityMatch = getIdentityMatch(row.normalizedRowJson);

  if (identityMatch?.kind === "candidate") {
    return "ambiguous";
  }

  if (identityMatch?.kind === "none") {
    return "none";
  }

  return "raw";
}

function getIdentityMatch(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const identityMatch = (value as { identityMatch?: unknown }).identityMatch;

  if (!identityMatch || typeof identityMatch !== "object" || Array.isArray(identityMatch)) {
    return null;
  }

  const parsed = identityMatch as {
    kind?: unknown;
    confidence?: unknown;
    reasons?: unknown;
    companyId?: unknown;
    contactId?: unknown;
  };

  return {
    kind: typeof parsed.kind === "string" ? parsed.kind : "unknown",
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
    reasons: Array.isArray(parsed.reasons)
      ? parsed.reasons.filter((reason): reason is string => typeof reason === "string")
      : [],
    companyId: typeof parsed.companyId === "string" ? parsed.companyId : null,
    contactId: typeof parsed.contactId === "string" ? parsed.contactId : null,
  };
}

function pickString(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];

    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }

  return null;
}
