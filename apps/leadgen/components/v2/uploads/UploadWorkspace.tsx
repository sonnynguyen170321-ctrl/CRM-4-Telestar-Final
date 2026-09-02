"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { formatDate, formatDateTime, formatCount } from "@/lib/v2/format/datetime";

type MetricCardProps = {
  title: string;
  value: string | number;
  subValue?: string;
  icon: LucideIcon;
  colorClass: string;
  trendText?: number;
  trendUp?: boolean;
};

function MetricCard({ title, value, subValue, icon: Icon, colorClass, trendText, trendUp }: MetricCardProps) {
  return (
    <div className="rounded-xl border border-hairline bg-surface p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${colorClass}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-sm font-medium text-muted-foreground">{title}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-foreground">{value}</span>
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between text-xs">
        {trendText ? (
          <div className="flex items-center gap-1">
            <span className={`font-semibold ${trendUp ? "text-emerald-600" : "text-red-600"}`}>
              {trendUp ? "up" : "down"} {Math.abs(trendText)}%
            </span>
            <span className="text-muted-foreground">vs last 30 days</span>
          </div>
        ) : subValue ? (
          <span className="text-muted-foreground">{subValue}</span>
        ) : (
          <span className="text-muted-foreground">All time</span>
        )}
      </div>
    </div>
  );
}
import { 
  CheckCircle2, 
  FileUp, 
  Loader2, 
  UploadCloud, 
  XCircle, 
  Archive, 
  Database,
  Search,
  Download,
  Play,
  Users,
  Building2,
  ArrowRight
} from "lucide-react";

import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileDropzone, type CsvPreview } from "./FileDropzone";
import { MappingTable, type CanonicalMappingFields } from "./MappingTable";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import type { UploadsDashboardMetrics, UploadJobInfo } from "@/lib/v2/ingestion/queryUploadsDashboard";

type UploadWorkspaceProps = {
  context: {
    clientAccountId?: string;
    projectId?: string;
    offerId?: string;
    icpVersionId?: string;
  };
  dashboardData: {
    metrics: UploadsDashboardMetrics;
    jobs: UploadJobInfo[];
  };
};

type UploadResult = {
  ingestionJobId: string;
  headers: string[];
  previewRows: Array<Record<string, string>>;
};

type RunState =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "mapping"; upload: UploadResult }
  | { kind: "submitting_mapping"; upload: UploadResult }
  | { kind: "queued"; ingestionJobId: string }
  | { kind: "error"; message: string };

// Preflight: warn (not block) when the uploaded headers are missing the columns the
// pipeline needs for identity matching / outreach usability.
function computePreflightWarnings(headers: string[], jobType: "COMPANY_UPLOAD" | "CONTACT_UPLOAD"): string[] {
  const folded = headers.map((h) => h.toLowerCase());
  const has = (...needles: string[]) => folded.some((h) => needles.some((n) => h.includes(n)));
  const warnings: string[] = [];
  if (jobType === "COMPANY_UPLOAD") {
    if (!has("domain", "website", "url")) warnings.push("No company domain/website column detected - identity matching will rely on name only (more duplicates, weaker enrichment).");
    if (!has("country", "location")) warnings.push("No country/location column - geography scoring will depend on enrichment.");
  } else {
    if (!has("email") && !has("linkedin")) warnings.push("No email or LinkedIn column detected - contacts without an identifier can't be matched or contacted.");
    if (!has("title", "role", "position")) warnings.push("No title/role column - persona scoring will mark these contacts as missing evidence.");
    if (!has("company", "domain", "website")) warnings.push("No company column - contacts can't be linked to accounts.");
  }
  return warnings;
}

function buildTemplateCsv(jobType: "COMPANY_UPLOAD" | "CONTACT_UPLOAD"): string {
  return jobType === "COMPANY_UPLOAD"
    ? "company name,website,industry,country,employee count\nAcme Corp,https://acme.example,Software,Vietnam,120\n"
    : "full name,title,email,linkedin url,company name,company website\nAnna Tran,VP Sales,anna@acme.example,https://linkedin.com/in/anna,Acme Corp,https://acme.example\n";
}

const STEPS = ["Upload", "Map columns", "Process", "Review"] as const;

function UploadStepper({ state }: { state: RunState }) {
  const activeIndex =
    state.kind === "idle" || state.kind === "uploading" || state.kind === "error"
      ? 0
      : state.kind === "mapping" || state.kind === "submitting_mapping"
        ? 1
        : 2; // queued -> processing (step 3+ live on the ingestion detail page)
  return (
    <ol className="flex flex-wrap items-center gap-2">
      {STEPS.map((label, i) => {
        const done = i < activeIndex;
        const active = i === activeIndex;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
                done ? "bg-emerald-500 text-primary-foreground" : active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {done ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : i + 1}
            </span>
            <span className={`text-xs font-semibold ${active ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
            {i < STEPS.length - 1 ? <span className="h-px w-8 bg-muted" aria-hidden="true" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

export function UploadWorkspace({ context, dashboardData }: UploadWorkspaceProps) {
  const [state, setState] = useState<RunState>({ kind: "idle" });
  const [jobType, setJobType] = useState<"COMPANY_UPLOAD" | "CONTACT_UPLOAD">("COMPANY_UPLOAD");
  const [jobSearch, setJobSearch] = useState("");
  const [preflight, setPreflight] = useState<string[]>([]);

  const visibleJobs = useMemo(() => {
    const needle = jobSearch.trim().toLowerCase();
    if (!needle) return dashboardData.jobs;
    return dashboardData.jobs.filter(
      (job) =>
        job.originalFileName.toLowerCase().includes(needle) ||
        (job.uploadedBy ?? "").toLowerCase().includes(needle)
    );
  }, [dashboardData.jobs, jobSearch]);

  function downloadTemplate() {
    const blob = new Blob([buildTemplateCsv(jobType)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = jobType === "COMPANY_UPLOAD" ? "company-upload-template.csv" : "contact-upload-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const hasFullContext = Boolean(
    context.clientAccountId && context.projectId && context.icpVersionId
  );

  async function handleUpload(preview: CsvPreview) {
    if (!hasFullContext) {
      setState({ kind: "error", message: "Choose Account, Project, and ICP before uploading." });
      return;
    }

    setState({ kind: "uploading" });

    const formData = new FormData();
    formData.set("file", preview.file);
    formData.set("clientRequestId", preview.clientRequestId);
    formData.set("clientAccountId", context.clientAccountId ?? "");
    formData.set("projectId", context.projectId ?? "");
    formData.set("icpVersionId", context.icpVersionId ?? "");
    formData.set("jobType", jobType);

    try {
      const response = await fetch("/v2/ingestion", {
        method: "POST",
        body: formData,
      });
      const body = await response.json();

      if (!response.ok || body.ok === false) {
        setState({
          kind: "error",
          message: typeof body.message === "string" ? body.message : "Upload failed.",
        });
        return;
      }

      const headers = Array.isArray(body.headers) ? body.headers : preview.headers;
      setPreflight(computePreflightWarnings(headers, jobType));
      setState({
        kind: "mapping",
        upload: {
          ingestionJobId: body.ingestionJobId,
          headers,
          previewRows: Array.isArray(body.previewRows) ? body.previewRows : preview.previewRows,
        },
      });
    } catch {
      setState({ kind: "error", message: "An error occurred during upload." });
    }
  }

  async function handleMappingSubmit(
    ingestionJobId: string,
    fields: CanonicalMappingFields
  ) {
    if (state.kind !== "mapping") return;

    setState({ kind: "submitting_mapping", upload: state.upload });

    try {
      const response = await fetch(`/v2/ingestion/${ingestionJobId}/mapping`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      const body = await response.json();

      if (!response.ok || body.ok === false) {
        setState({
          kind: "error",
          message: typeof body.message === "string" ? body.message : "Mapping failed.",
        });
        return;
      }

      setState({ kind: "queued", ingestionJobId });
    } catch {
      setState({ kind: "error", message: "An error occurred during mapping submission." });
    }
  }

  const m = dashboardData.metrics;
  const jobColumns: DataTableColumn<UploadJobInfo>[] = [
    {
      key: "file",
      header: "File Name",
      cell: (job) => (
        <div className="flex items-center gap-3 font-semibold text-foreground">
          <div className="rounded bg-primary/10 p-2 border border-primary/20"><FileUp className="h-4 w-4 text-primary" /></div>
          <span className="min-w-0 truncate">{job.originalFileName}</span>
        </div>
      ),
    },
    {
      key: "uploadedBy",
      header: "Uploaded By",
      hideBelow: "lg",
      cell: (job) => (
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary border border-hairline text-[10px] font-semibold text-muted-foreground">
            {job.uploadedByInitials}
          </div>
          {job.uploadedBy || "Unknown"}
        </div>
      ),
    },
    { key: "rows", header: "Rows", align: "right", cell: (job) => formatCount(job.rowsCount) },
    {
      key: "created",
      header: "Created At",
      hideBelow: "md",
      cell: (job) => (
        <div>
          <div className="font-medium text-foreground">{formatDate(job.createdAt)}</div>
          <div className="text-xs text-muted-foreground">{formatDateTime(job.createdAt)}</div>
        </div>
      ),
    },
    { key: "status", header: "Status", cell: (job) => <UploadJobStatusBadge status={job.status} /> },
    { key: "research", header: "Research", align: "right", hideBelow: "lg", cell: (job) => formatCount(job.websiteResearchReady) },
    { key: "scoring", header: "Scoring", align: "right", hideBelow: "lg", cell: (job) => formatCount(job.localScoringReady) },
    {
      key: "reviewed",
      header: "Reviewed",
      align: "right",
      cell: (job) => (
        <span>
          {formatCount(job.reviewed)}
          {job.rowsCount > 0 ? <span className="ml-1 text-muted-foreground">({Math.round((job.reviewed / job.rowsCount) * 100)}%)</span> : null}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (job) => (
        <Button variant="ghost" size="sm" className="text-primary hover:text-primary/80 font-semibold" asChild>
          <Link href={`/v2/ingestion/${job.id}`}>Open pipeline <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
        </Button>
      ),
    },
  ];
  return (
    <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0 bg-muted/40">
      <PageHeader
        eyebrow="Data Uploads"
        title="Uploads"
        description="Upload company and contact lists, track processing, and manage your data."
        actions={
          <div className="flex items-center gap-3">
            <Button variant="outline" className="gap-2" asChild>
              <Link href="/v2/ingestion/jobs">
                <Play className="h-4 w-4" /> Runtime jobs
              </Link>
            </Button>
            <Button variant="outline" className="gap-2" asChild>
              <Link href="/v2/reviews">
                <CheckCircle2 className="h-4 w-4" /> Review queue
              </Link>
            </Button>
          </div>
        }
      />

      {/* Guided flow: where this upload sits in the pipeline. Steps 3+ live on the
          ingestion detail page (real stage V2Jobs); this stepper orients the user. */}
      <div className="mx-auto max-w-[1600px] px-6 pt-5">
        <UploadStepper state={state} />
      </div>

      <div className="px-6 py-6 max-w-[1600px] mx-auto space-y-8">
        {/* Top Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <MetricCard 
            title="Total Uploads" 
            value={m.totalUploads.value} 
            icon={UploadCloud} 
            colorClass="bg-accent text-primary" 
            trendText={m.totalUploads.trendPct}
            trendUp={m.totalUploads.trendPct >= 0}
          />
          <MetricCard 
            title="Processing" 
            value={m.processing.value} 
            icon={Loader2} 
            colorClass="bg-amber-50 text-amber-600" 
            subValue={`${m.processing.queued} queued / ${m.processing.value - m.processing.queued} processing`}
          />
          <MetricCard 
            title="Completed" 
            value={m.completed.value} 
            icon={CheckCircle2} 
            colorClass="bg-emerald-50 text-emerald-600" 
            trendText={m.completed.trendPct}
            trendUp={m.completed.trendPct >= 0}
          />
          <MetricCard 
            title="Failed" 
            value={m.failed.value} 
            icon={XCircle} 
            colorClass="bg-red-50 text-red-600" 
            trendText={m.failed.trendPct}
            trendUp={false}
          />
          <MetricCard 
            title="Archived" 
            value={m.archived.value} 
            icon={Archive} 
            colorClass="bg-muted text-muted-foreground" 
          />
          <MetricCard 
            title="Rows Processed" 
            value={formatCount(m.rowsProcessed.value)} 
            icon={Database} 
            colorClass="bg-purple-50 text-purple-600" 
            trendText={m.rowsProcessed.trendPct}
            trendUp={m.rowsProcessed.trendPct >= 0}
          />
        </div>

        {/* Upload Section */}
        {state.kind === "mapping" || state.kind === "submitting_mapping" ? (
          <div className="rounded-xl border border-hairline bg-surface shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-hairline bg-surface-raised/30 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Map Columns</h2>
              <Button variant="ghost" size="sm" onClick={() => setState({ kind: "idle" })}>Cancel</Button>
            </div>
            {preflight.length > 0 ? (
              <div className="border-b border-amber-500/20 bg-amber-500/10 px-6 py-3">
                <div className="text-xs font-semibold  text-amber-800">Preflight warnings</div>
                <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm text-amber-800">
                  {preflight.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            ) : null}
            <MappingTable
              headers={state.upload.headers}
              previewRows={state.upload.previewRows}
              disabled={state.kind === "submitting_mapping"}
              onSubmit={(fields) => handleMappingSubmit(state.upload.ingestionJobId, fields)}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Drag and Drop Area */}
            <div className="lg:col-span-2 rounded-xl border border-hairline bg-surface p-6 shadow-sm flex flex-col md:flex-row gap-6">
              <div className="flex-1 space-y-4">
                <div className="mb-2">
                  <h3 className="text-sm font-medium text-foreground mb-3">What are you uploading?</h3>
                  <RadioGroup defaultValue={jobType} onValueChange={(v: string) => setJobType(v as typeof jobType)} className="flex gap-4">
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="COMPANY_UPLOAD" id="r1" />
                      <Label htmlFor="r1" className="cursor-pointer flex items-center gap-1">
                        <Building2 className="h-4 w-4 text-muted-foreground"/> Companies
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="CONTACT_UPLOAD" id="r2" />
                      <Label htmlFor="r2" className="cursor-pointer flex items-center gap-1">
                        <Users className="h-4 w-4 text-muted-foreground"/> Contacts
                      </Label>
                    </div>
                  </RadioGroup>
                </div>
                
                {!hasFullContext ? (
                  <div className="rounded-lg border border-dashed border-border bg-muted/40 p-6 text-center">
                    <div className="text-sm font-semibold text-foreground">
                      Context Required
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground max-w-sm mx-auto">
                      Use the context bar above to select the Account, Project, and ICP before uploading data.
                    </p>
                  </div>
                ) : (
                  <FileDropzone
                    disabled={state.kind === "uploading"}
                    onUpload={handleUpload}
                  />
                )}
                {state.kind === "error" && (
                  <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg border border-red-100">{state.message}</div>
                )}
              </div>

              <div className="w-full md:w-64 border-t md:border-t-0 md:border-l border-border pt-6 md:pt-0 md:pl-6 space-y-4">
                <h3 className="text-sm font-semibold text-foreground">CSV requirements</h3>
                <ul className="text-sm text-muted-foreground space-y-3">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                    <span>Must contain {jobType === "COMPANY_UPLOAD" ? "company domain or website" : "email or LinkedIn URL"}.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                    <span>{jobType === "COMPANY_UPLOAD" ? "Optional columns: name, industry, country, etc." : "Recommended columns: company name or website, title, location."}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                    <span>First row should be headers.</span>
                  </li>
                </ul>
                <Button variant="link" className="px-0 h-auto text-primary cursor-pointer" onClick={downloadTemplate}>
                  <Download className="h-4 w-4 mr-2" />
                  Download template CSV
                </Button>
              </div>
            </div>

            {/* Right Status Panel */}
            <div className="rounded-xl border border-hairline bg-surface p-6 shadow-sm flex flex-col justify-center">
              {state.kind === "queued" ? (
                <div className="text-center space-y-4">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20">
                    <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-foreground">Upload queued successfully!</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      The mapping was saved; identity match, enrichment, and scoring are running.
                    </p>
                  </div>
                  <Button variant="outline" size="sm" asChild className="w-full">
                    <Link href={`/v2/ingestion/${state.ingestionJobId}`}>
                      View upload details <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              ) : state.kind === "uploading" ? (
                <div className="text-center space-y-4 py-8">
                  <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                  <div className="text-sm font-medium text-foreground">Uploading file...</div>
                </div>
              ) : (
                <div className="text-center space-y-4 text-muted-foreground/60">
                  <FileUp className="mx-auto h-12 w-12 opacity-20" />
                  <div className="text-sm font-medium text-muted-foreground">Ready for upload</div>
                  <p className="text-xs">Drag and drop your file to get started.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Jobs Table Section */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <h2 className="text-lg font-semibold text-foreground">Upload Jobs</h2>
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search uploads..."
                  className="pl-9 bg-surface border-hairline focus-visible:ring-primary/20"
                  value={jobSearch}
                  onChange={(e) => setJobSearch(e.target.value)}
                />
              </div>
            </div>
          </div>

          <DataTable
            columns={jobColumns}
            rows={visibleJobs}
            getRowId={(job) => job.id}
            minWidth="min-w-[1080px]"
            empty={<div className="px-6 py-8 text-center text-sm text-muted-foreground">{jobSearch ? "No uploads match your search." : "No upload jobs found."}</div>}
          />
        </div>
      </div>
    </WorkspaceFrame>
  );
}
function UploadJobStatusBadge({ status }: { status: string }) {
  if (status === "COMPLETED") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 text-xs font-semibold text-emerald-700">
        <CheckCircle2 className="h-3 w-3" /> Completed
      </span>
    );
  }
  if (status === "PENDING" || status === "PROCESSING") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-1 text-xs font-semibold text-amber-700">
        <Loader2 className="h-3 w-3 animate-spin" /> Processing
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 border border-red-500/20 px-2 py-1 text-xs font-semibold text-red-700">
      <XCircle className="h-3 w-3" /> Failed
    </span>
  );
}
