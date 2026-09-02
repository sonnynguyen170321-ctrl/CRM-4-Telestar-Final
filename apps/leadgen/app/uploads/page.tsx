import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  HelpCircle,
  Info,
  Play,
  ShieldCheck,
  TrendingUp,
  UploadCloud,
  Users,
} from "lucide-react";

import { FilterBar } from "@/components/shared/FilterBar";
import { StatusBadge } from "@/components/shared/statusBadges";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { WorkspaceMetricGrid } from "@/components/shared/WorkspaceMetricGrid";
import { Button } from "@/components/ui/button";
import { CsvUploadPanel } from "@/components/uploads/CsvUploadPanel";
import { UploadJobsManagerClient } from "@/components/uploads/UploadJobsManager";
import { listManagedUploadJobs } from "@/lib/server/uploadJobs/management";

export const dynamic = "force-dynamic";

export default async function UploadsPage() {
  const initialUploadJobs = await listManagedUploadJobs({
    where: {
      archivedAt: null,
      deletedAt: null,
    },
    page: 1,
    pageSize: 100,
    skip: 0,
  });
  const uploadMetrics = buildUploadMetrics(initialUploadJobs.items);
  const latestUpload = initialUploadJobs.items[0] ?? null;
  const latestUploadHref = latestUpload
    ? `/companies?uploadJobId=${latestUpload.id}`
    : "/companies";
  const latestExportHref = latestUpload
    ? `/api/companies/export?uploadJobId=${latestUpload.id}`
    : "/api/companies/export";

  return (
    <WorkspaceFrame className="space-y-4 bg-[#f8fafc]">
      <header className="flex flex-col gap-4 px-1 py-1 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-normal text-slate-950">
            Upload Command Center
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Upload, validate, research, and review company data end-to-end.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            asChild
            className="h-10 rounded-lg bg-blue-600 px-4 font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            <a href="#research-scoring">
              <Play className="h-4 w-4" />
              Run Research & Scoring
            </a>
          </Button>
          <Button asChild variant="outline" className="h-10 rounded-lg bg-white">
            <a href={latestUploadHref}>
              <Users className="h-4 w-4" />
              Review Companies
            </a>
          </Button>
          <Button asChild variant="outline" className="h-10 rounded-lg bg-white">
            <a href={latestExportHref}>
              <Download className="h-4 w-4" />
              Export Scored CSV
            </a>
          </Button>
        </div>
      </header>

      <LatestUploadSummary upload={latestUpload} />

      <WorkspaceMetricGrid className="xl:grid-cols-5">
        <CommandMetric
          label="Total rows"
          value={(latestUpload?.totalRows ?? uploadMetrics.processedRows).toLocaleString()}
          description={latestUpload ? "Latest upload" : "Across active uploads"}
          icon={FileSpreadsheet}
          tone="blue"
        />
        <CommandMetric
          label="Qualified"
          value={(latestUpload?.qualifiedRows ?? 0).toLocaleString()}
          description="Company-level results"
          icon={CheckCircle2}
          tone="green"
        />
        <CommandMetric
          label="Uncertain"
          value={(latestUpload?.uncertainRows ?? 0).toLocaleString()}
          description="Review candidates"
          icon={HelpCircle}
          tone="amber"
        />
        <CommandMetric
          label="Unqualified"
          value={(latestUpload?.rejectedRows ?? 0).toLocaleString()}
          description="Rejected by rules"
          icon={ShieldCheck}
          tone="red"
        />
        <CommandMetric
          label="Needs review"
          value={(latestUpload?.uncertainRows ?? uploadMetrics.needsReview).toLocaleString()}
          description="Open company review"
          icon={TrendingUp}
          tone="violet"
        />
      </WorkspaceMetricGrid>

      <CsvUploadPanel />

      <section className="space-y-3 pt-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-950">
            Upload jobs management
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Secondary operational view for previous upload jobs and guarded cleanup.
          </p>
        </div>
        <UploadJobsManagerClient
          initialJobs={toClientUploadJobs(initialUploadJobs.items)}
        />
      </section>

      <FilterBar className="items-start">
        <div className="flex gap-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-sm leading-6 text-muted-foreground">
            Upload management is for internal testing cleanup only. Re-run
            website research, re-run scoring, persistent audit logs, and failed
            batch recovery are intentionally reserved for later prompts.
          </p>
        </div>
      </FilterBar>
    </WorkspaceFrame>
  );
}

function CommandMetric({
  label,
  value,
  description,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  description: string;
  icon: typeof UploadCloud;
  tone: "blue" | "green" | "amber" | "red" | "violet";
}) {
  const toneClass = {
    blue: "bg-blue-50 text-blue-700",
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-rose-50 text-rose-700",
    violet: "bg-violet-50 text-violet-700",
  }[tone];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className={`rounded-xl p-2.5 ${toneClass}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-slate-950">{value}</p>
          <p className="mt-1 text-xs text-slate-500">{description}</p>
        </div>
      </div>
    </div>
  );
}

function LatestUploadSummary({
  upload,
}: {
  upload: Awaited<ReturnType<typeof listManagedUploadJobs>>["items"][number] | null;
}) {
  if (!upload) {
    return (
      <section className="rounded-xl border border-dashed border-slate-300 bg-white p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-950">
              No upload selected
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Upload a company CSV to start validation, scoring, review, and export.
            </p>
          </div>
          <StatusBadge tone="neutral">Waiting for CSV</StatusBadge>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-emerald-300 bg-gradient-to-r from-emerald-50 via-white to-emerald-50 p-4 shadow-sm">
      <div className="grid gap-4 lg:grid-cols-[minmax(240px,1.2fr)_repeat(5,minmax(120px,1fr))] lg:items-center">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-emerald-900">
                Upload successful
              </h2>
              <StatusBadge
                tone={upload.status === "FAILED" ? "danger" : "success"}
              >
                {upload.status.toLowerCase()}
              </StatusBadge>
            </div>
            <p className="mt-1 truncate text-sm font-medium text-slate-950">
              File: {upload.fileName}
            </p>
          </div>
        </div>
        <SummaryValue label="Rows detected" value={upload.totalRows} />
        <SummaryValue label="Processed" value={upload.processedRows} />
        <SummaryValue label="Company rows" value={upload.companyRecordCount} />
        <SummaryValue label="Scores saved" value={upload.scoreResultCount} />
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">Upload ID</p>
          <p className="mt-1 truncate text-sm font-semibold text-slate-950">
            {upload.id}
          </p>
        </div>
      </div>
    </section>
  );
}

function SummaryValue({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-950">
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function buildUploadMetrics(
  items: Awaited<ReturnType<typeof listManagedUploadJobs>>["items"]
) {
  return {
    active: items.length,
    processedRows: items.reduce((total, item) => total + item.processedRows, 0),
    scoredRows: items.reduce((total, item) => total + item.scoreResultCount, 0),
    completed: items.filter((item) => item.status === "COMPLETED").length,
    needsReview: items.filter(
      (item) => item.uncertainRows > 0 || item.status === "FAILED"
    ).length,
  };
}

function toClientUploadJobs(
  items: Awaited<ReturnType<typeof listManagedUploadJobs>>["items"]
) {
  return items.map((item) => ({
    ...item,
    archivedAt: item.archivedAt?.toISOString() ?? null,
    deletedAt: item.deletedAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    latestCreatedAt: item.latestCreatedAt.toISOString(),
    latestUpdatedAt: item.latestUpdatedAt.toISOString(),
  }));
}
