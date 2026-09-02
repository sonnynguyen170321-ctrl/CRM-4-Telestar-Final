"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  Archive,
  Download,
  ExternalLink,
  Eye,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/EmptyState";
import { EntityAvatar } from "@/components/shared/EntityAvatar";
import { FilterBar } from "@/components/shared/FilterBar";
import { PanelCard } from "@/components/shared/PanelCard";
import { StatusBadge } from "@/components/shared/statusBadges";
import { UploadJobDetailPanel } from "@/components/uploads/UploadJobDetailPanel";
import {
  archiveUploadJob,
  getUploadJob,
  hardDeleteUploadJob,
  listUploadJobs,
  restoreUploadJob,
  softDeleteUploadJob,
  type UploadJobDetail,
  type UploadJobListFilter,
  type UploadJobListItem,
} from "@/lib/client/uploadJobs";

const filters: Array<{ label: string; value: UploadJobListFilter }> = [
  { label: "Active", value: "active" },
  { label: "Archived", value: "archived" },
  { label: "Deleted", value: "deleted" },
  { label: "All", value: "all" },
];

type ActivityItem = {
  id: string;
  timestamp: string;
  message: string;
  tone: "success" | "error";
};

export function UploadJobsManager() {
  return <UploadJobsManagerClient initialJobs={[]} />;
}

export function UploadJobsManagerClient({
  initialJobs,
}: {
  initialJobs: UploadJobListItem[];
}) {
  const [filter, setFilter] = useState<UploadJobListFilter>("active");
  const [search, setSearch] = useState("");
  const [jobs, setJobs] = useState<UploadJobListItem[]>(initialJobs);
  const [selectedDetail, setSelectedDetail] = useState<UploadJobDetail | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);

  const selectedJobId = selectedDetail?.uploadJob.id ?? null;
  const visibleJobs = useMemo(() => jobs, [jobs]);

  async function loadJobs({
    nextFilter = filter,
    nextSearch = search,
  }: {
    nextFilter?: UploadJobListFilter;
    nextSearch?: string;
  } = {}) {
    setLoading(true);
    setError(null);

    try {
      const result = await listUploadJobs({
        filter: nextFilter,
        search: nextSearch,
      });
      setJobs(result.items);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Upload jobs could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(job: UploadJobListItem) {
    setDetailLoadingId(job.id);
    setError(null);

    try {
      setSelectedDetail(await getUploadJob(job.id));
    } catch (detailError) {
      setError(
        detailError instanceof Error
          ? detailError.message
          : "Upload job details could not be loaded."
      );
    } finally {
      setDetailLoadingId(null);
    }
  }

  async function runAction({
    job,
    label,
    action,
  }: {
    job: UploadJobListItem;
    label: string;
    action: () => Promise<unknown>;
  }) {
    setActionId(job.id);
    setError(null);

    try {
      await action();
      addActivity(`${label}: ${job.fileName}`, "success");
      await loadJobs();

      if (selectedJobId === job.id) {
        setSelectedDetail(await getUploadJob(job.id).catch(() => null));
      }
    } catch (actionError) {
      const message =
        actionError instanceof Error
          ? actionError.message
          : `${label} failed.`;
      setError(message);
      addActivity(`${label} failed for ${job.fileName}: ${message}`, "error");
    } finally {
      setActionId(null);
    }
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadJobs({ nextSearch: search });
  }

  function handleFilterChange(nextFilter: UploadJobListFilter) {
    setFilter(nextFilter);
    setSelectedDetail(null);
    void loadJobs({ nextFilter, nextSearch: search });
  }

  function confirmSoftDelete(job: UploadJobListItem) {
    const confirmed = window.confirm(
      `Soft delete ${job.fileName}? This hides the upload from active lists but keeps audit history.`
    );

    if (!confirmed) {
      return;
    }

    void runAction({
      job,
      label: "Soft deleted",
      action: () => softDeleteUploadJob(job.id),
    });
  }

  function confirmHardDelete(job: UploadJobListItem) {
    const typed = window.prompt(
      `This permanently removes linked company records, score results, website research results, feedback examples, and export jobs for ${job.fileName}. This cannot be undone.\n\nType DELETE to continue.`
    );

    if (typed !== "DELETE") {
      addActivity(`Hard delete cancelled for ${job.fileName}`, "error");
      return;
    }

    void runAction({
      job,
      label: "Hard deleted",
      action: () => hardDeleteUploadJob(job.id),
    });
  }

  function addActivity(message: string, tone: ActivityItem["tone"]) {
    setActivities((current) => [
      {
        id: `${Date.now()}-${current.length}`,
        timestamp: new Date().toISOString(),
        message,
        tone,
      },
      ...current.slice(0, 4),
    ]);
  }

  return (
    <PanelCard
      title="Upload jobs"
      description="Review persisted upload jobs, inspect linked data counts, archive test runs, and safely delete disposable uploads."
      actions={
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void loadJobs()}
            disabled={loading}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      }
      contentClassName="space-y-4 p-4"
    >
        <FilterBar className="justify-between">
          <div className="flex flex-wrap items-center gap-2">
          {filters.map((item) => (
            <Button
              key={item.value}
              type="button"
              size="sm"
              variant={filter === item.value ? "secondary" : "outline"}
              onClick={() => handleFilterChange(item.value)}
            >
              {item.label}
            </Button>
          ))}
          </div>

        <form
          className="grid w-full gap-2 md:w-auto md:grid-cols-[minmax(240px,320px)_auto]"
          onSubmit={handleSearchSubmit}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search by file name"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <Button type="submit" variant="secondary" size="sm">
            Search
          </Button>
        </form>
        </FilterBar>

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded-md border bg-muted/30 p-6 text-sm text-muted-foreground">
            Loading upload jobs...
          </div>
        ) : visibleJobs.length === 0 ? (
          <EmptyState
            title="No upload jobs found"
            description="Upload a CSV first, or adjust the current filter/search."
          />
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="overflow-x-auto rounded-xl border bg-white">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="min-w-[280px]">File</TableHead>
                  <TableHead className="min-w-[120px]">Rows</TableHead>
                  <TableHead className="min-w-[130px]">Processing</TableHead>
                  <TableHead className="min-w-[130px]">Research</TableHead>
                  <TableHead className="min-w-[130px]">Local scoring</TableHead>
                  <TableHead className="min-w-[120px]">AI</TableHead>
                  <TableHead className="min-w-[120px]">Reviewed</TableHead>
                  <TableHead className="min-w-[150px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleJobs.map((job) => (
                  <TableRow
                    key={job.id}
                    className={
                      selectedJobId === job.id
                        ? "bg-blue-50/60 hover:bg-blue-50/80"
                        : "hover:bg-slate-50"
                    }
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <EntityAvatar
                          name={job.fileName}
                          size="sm"
                          tone={job.status === "FAILED" ? "amber" : "blue"}
                        />
                        <div className="min-w-0 space-y-1">
                          <p className="truncate font-medium text-slate-950">
                            {job.fileName}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {formatDateTime(job.createdAt)} / {job.id}
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {!job.archivedAt && !job.deletedAt && (
                              <StatusBadge tone="success">Active</StatusBadge>
                            )}
                            {job.archivedAt && (
                              <StatusBadge tone="warning">Archived</StatusBadge>
                            )}
                            {job.deletedAt && (
                              <StatusBadge tone="danger">Deleted</StatusBadge>
                            )}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium text-slate-900">
                        {job.processedRows.toLocaleString()} /{" "}
                        {job.totalRows.toLocaleString()}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Companies {job.companyRecordCount.toLocaleString()}
                      </p>
                    </TableCell>
                    <TableCell>
                      <PipelineStatus
                        label={job.status.toLowerCase()}
                        count={job.processedRows}
                        tone={job.status === "FAILED" ? "danger" : "success"}
                        detail={
                          job.status === "FAILED"
                            ? job.errorMessage ||
                              "Inspect details or delete this failed test upload."
                            : undefined
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <PipelineStatus
                        label={
                          job.websiteResearchResultCount > 0
                            ? "Completed"
                            : "Queued"
                        }
                        count={job.websiteResearchResultCount}
                        tone={
                          job.websiteResearchResultCount > 0
                            ? "success"
                            : "neutral"
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <PipelineStatus
                        label={
                          job.scoreResultCount > 0 ? "Completed" : "Queued"
                        }
                        count={job.scoreResultCount}
                        tone={
                          job.scoreResultCount > 0 ? "success" : "neutral"
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <PipelineStatus
                        label="Details only"
                        count={0}
                        tone="neutral"
                        hideCount
                      />
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium text-slate-900">
                        {job.feedbackExampleCount.toLocaleString()}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Q {job.qualifiedRows.toLocaleString()} / U{" "}
                        {job.uncertainRows.toLocaleString()} / R{" "}
                        {job.rejectedRows.toLocaleString()}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button size="sm" asChild variant="outline">
                          <a href={`/companies?uploadJobId=${job.id}`}>
                            <Eye className="h-3.5 w-3.5" />
                            Review
                          </a>
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                              <span className="sr-only">More upload actions</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => void loadDetail(job)}
                              disabled={detailLoadingId === job.id}
                            >
                              <Eye className="mr-2 h-4 w-4" />
                              {detailLoadingId === job.id
                                ? "Loading details"
                                : "Details"}
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <a href={`/companies?uploadJobId=${job.id}`}>
                                <ExternalLink className="mr-2 h-4 w-4" />
                                Open companies
                              </a>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <a href={`/api/companies/export?uploadJobId=${job.id}`}>
                                <Download className="mr-2 h-4 w-4" />
                                Export CSV
                              </a>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {!job.archivedAt && !job.deletedAt ? (
                              <DropdownMenuItem
                                onClick={() =>
                                  void runAction({
                                    job,
                                    label: "Archived",
                                    action: () => archiveUploadJob(job.id),
                                  })
                                }
                                disabled={actionId === job.id}
                              >
                                <Archive className="mr-2 h-4 w-4" />
                                Archive
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={() =>
                                  void runAction({
                                    job,
                                    label: "Restored",
                                    action: () => restoreUploadJob(job.id),
                                  })
                                }
                                disabled={actionId === job.id}
                              >
                                <RotateCcw className="mr-2 h-4 w-4" />
                                Restore
                              </DropdownMenuItem>
                            )}
                            {!job.deletedAt && (
                              <DropdownMenuItem
                                onClick={() => confirmSoftDelete(job)}
                                disabled={actionId === job.id}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Soft delete
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => confirmHardDelete(job)}
                              disabled={actionId === job.id}
                              className="text-destructive"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Hard delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
            <UploadJobDetailPanel detail={selectedDetail} />
          </div>
        )}

        {activities.length > 0 && (
          <div className="rounded-md border bg-background p-4">
            <h3 className="text-sm font-medium">Current session activity</h3>
            <div className="mt-3 grid gap-2">
              {activities.map((activity) => (
                <div
                  key={activity.id}
                  className="flex flex-wrap justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                >
                  <span
                    className={
                      activity.tone === "error"
                        ? "text-destructive"
                        : "text-foreground"
                    }
                  >
                    {activity.message}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(activity.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
    </PanelCard>
  );
}

function PipelineStatus({
  label,
  count,
  tone,
  detail,
  hideCount,
}: {
  label: string;
  count: number;
  tone: "success" | "warning" | "danger" | "neutral" | "info";
  detail?: string;
  hideCount?: boolean;
}) {
  return (
    <div className="space-y-1">
      <StatusBadge tone={tone}>{label}</StatusBadge>
      {!hideCount && (
        <p className="text-xs text-muted-foreground">
          {count.toLocaleString()}
        </p>
      )}
      {detail && (
        <p className="line-clamp-2 max-w-44 text-xs leading-5 text-muted-foreground">
          {detail}
        </p>
      )}
    </div>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
