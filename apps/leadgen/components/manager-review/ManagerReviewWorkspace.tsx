"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Eye,
  FileText,
  MessageSquare,
  Search,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  listManagerReviewItems,
  updateManagerReviewItem,
  type ManagerReviewItem,
  type ManagerReviewListResponse,
  type ManagerReviewPriority,
  type ManagerReviewStatus,
} from "@/lib/client/managerReview";

type StatusFilter = ManagerReviewStatus | "all";
type PriorityFilter = ManagerReviewPriority | "all";
type QueueTab = "queue" | "resolved" | "all";
type SortMode = "newest" | "priority";

type AppliedFilters = {
  status: StatusFilter;
  priority: PriorityFilter;
  sdrName: string;
  reason: string;
  search: string;
};

const defaultFilters: AppliedFilters = {
  status: "all",
  priority: "all",
  sdrName: "",
  reason: "",
  search: "",
};

const statuses: ManagerReviewStatus[] = [
  "open",
  "needs_follow_up",
  "reviewed",
  "dismissed",
];
const priorities: ManagerReviewPriority[] = ["high", "medium", "low"];

export function ManagerReviewWorkspace() {
  const [response, setResponse] = useState<ManagerReviewListResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<QueueTab>("queue");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [draftFilters, setDraftFilters] =
    useState<AppliedFilters>(defaultFilters);
  const [appliedFilters, setAppliedFilters] =
    useState<AppliedFilters>(defaultFilters);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(
    () => new Set()
  );
  const [formState, setFormState] = useState({
    status: "open" as ManagerReviewStatus,
    reviewedBy: "",
    managerNote: "",
    nextAction: "",
  });
  const [isSaving, setIsSaving] = useState(false);

  const loadItems = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      setResponse(
        await listManagerReviewItems({
          status: "all",
          priority: "all",
          pageSize: 100,
        })
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Manager review queue could not be loaded."
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadItems();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadItems]);

  const allItems = useMemo(() => response?.data ?? [], [response?.data]);
  const summary = response?.summary;

  const sdrOptions = useMemo(
    () =>
      Array.from(
        new Set(
          allItems
            .map((item) => item.sdrName)
            .filter((value): value is string => Boolean(value))
        )
      ).sort((a, b) => a.localeCompare(b)),
    [allItems]
  );
  const reasonOptions = useMemo(
    () =>
      Array.from(new Set(allItems.flatMap((item) => item.reasons))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [allItems]
  );

  const filteredItems = useMemo(() => {
    const search = appliedFilters.search.trim().toLowerCase();
    const filtered = allItems.filter((item) => {
      if (activeTab === "queue" && isTerminalStatus(item.status)) return false;
      if (activeTab === "resolved" && item.status !== "reviewed") return false;
      if (appliedFilters.status !== "all" && item.status !== appliedFilters.status) {
        return false;
      }
      if (
        appliedFilters.priority !== "all" &&
        item.priority !== appliedFilters.priority
      ) {
        return false;
      }
      if (appliedFilters.sdrName && item.sdrName !== appliedFilters.sdrName) {
        return false;
      }
      if (
        appliedFilters.reason &&
        !item.reasons.includes(appliedFilters.reason)
      ) {
        return false;
      }
      if (search && !buildSearchText(item).includes(search)) {
        return false;
      }
      return true;
    });

    return filtered.sort((a, b) => {
      if (sortMode === "priority") {
        const priorityDelta =
          priorityRank(a.priority) - priorityRank(b.priority);
        if (priorityDelta !== 0) return priorityDelta;
      }
      return (
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    });
  }, [activeTab, allItems, appliedFilters, sortMode]);

  const selectedItem = useMemo(() => {
    if (selectedId) {
      const selected = allItems.find((item) => item.id === selectedId);
      if (selected) return selected;
    }
    return filteredItems[0] ?? null;
  }, [allItems, filteredItems, selectedId]);

  useEffect(() => {
    if (!selectedItem) return;

    window.setTimeout(() => {
      setFormState({
        status: selectedItem.status,
        reviewedBy: selectedItem.reviewedBy ?? "",
        managerNote: selectedItem.managerNote ?? "",
        nextAction: selectedItem.nextAction ?? "",
      });
    }, 0);
  }, [selectedItem]);

  async function handleSave(nextStatus = formState.status, closeAfter = false) {
    if (!selectedItem) return;

    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const updated = await updateManagerReviewItem(selectedItem.id, {
        status: nextStatus,
        managerNote: formState.managerNote,
        nextAction: formState.nextAction,
        reviewedBy: formState.reviewedBy,
      });
      setResponse((current) =>
        current
          ? {
              ...current,
              data: current.data.map((item) =>
                item.id === updated.id ? updated : item
              ),
            }
          : current
      );
      setSelectedId(closeAfter ? null : updated.id);
      setSuccessMessage("Manager review saved.");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Manager review save failed."
      );
    } finally {
      setIsSaving(false);
    }
  }

  function clearFilters() {
    setDraftFilters(defaultFilters);
    setAppliedFilters(defaultFilters);
  }

  function toggleRow(id: string, checked: boolean) {
    setSelectedRows((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  return (
    <div className="space-y-4 px-5 py-5 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal text-slate-950">
            Manager Review
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Review flagged SDR activity, company/contact data issues, and next
            actions.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-9 rounded-lg border-slate-200 bg-white"
          onClick={() => void loadItems()}
          disabled={isLoading}
        >
          {isLoading ? "Refreshing..." : "Refresh"}
        </Button>
      </header>

      <MetricRow
        total={summary?.total ?? allItems.length}
        urgent={summary?.high ?? countPriority(allItems, "high")}
        resolved7d={countResolvedInLast7Days(allItems)}
        pending={countPending(allItems)}
      />

      {errorMessage ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {errorMessage}
        </div>
      ) : null}
      {successMessage ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {successMessage}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[240px_minmax(720px,1fr)_390px]">
        <FilterPanel
          draftFilters={draftFilters}
          sdrOptions={sdrOptions}
          reasonOptions={reasonOptions}
          onDraftChange={setDraftFilters}
          onApply={() => setAppliedFilters(draftFilters)}
          onClear={clearFilters}
        />

        <section className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <QueueTabButton
                label="Queue"
                count={allItems.filter((item) => !isTerminalStatus(item.status)).length}
                active={activeTab === "queue"}
                onClick={() => setActiveTab("queue")}
              />
              <QueueTabButton
                label="Resolved"
                count={allItems.filter((item) => item.status === "reviewed").length}
                active={activeTab === "resolved"}
                onClick={() => setActiveTab("resolved")}
              />
              <QueueTabButton
                label="All"
                count={allItems.length}
                active={activeTab === "all"}
                onClick={() => setActiveTab("all")}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  className="h-9 w-64 rounded-lg border-slate-200 pl-8"
                  placeholder="Search queue..."
                  value={draftFilters.search}
                  onChange={(event) =>
                    setDraftFilters((current) => ({
                      ...current,
                      search: event.target.value,
                    }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      setAppliedFilters(draftFilters);
                    }
                  }}
                />
              </div>
              <select
                className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700"
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as SortMode)}
              >
                <option value="newest">Sort: Newest first</option>
                <option value="priority">Sort: Priority</option>
              </select>
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg border-slate-200 bg-white"
                disabled
              >
                Columns
              </Button>
            </div>
          </div>

          <ManagerReviewTable
            items={filteredItems}
            selectedId={selectedItem?.id ?? null}
            selectedRows={selectedRows}
            isLoading={isLoading}
            onSelect={(item) => setSelectedId(item.id)}
            onToggleRow={toggleRow}
          />
        </section>

        <ManagerReviewPanel
          item={selectedItem}
          formState={formState}
          isSaving={isSaving}
          onFormChange={setFormState}
          onClearSelection={() => setSelectedId(null)}
          onSave={() => void handleSave()}
          onSaveAndClose={() => void handleSave(formState.status, true)}
          onResolve={() => void handleSave("reviewed")}
          onRequestMoreInfo={() => void handleSave("needs_follow_up")}
          onDismiss={() => void handleSave("dismissed")}
        />
      </div>
    </div>
  );
}

function MetricRow({
  total,
  urgent,
  resolved7d,
  pending,
}: {
  total: number;
  urgent: number;
  resolved7d: number;
  pending: number;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-4">
      <Metric label="Total Flagged" value={total} helper="Currently loaded" />
      <Metric
        label="Urgent"
        value={urgent}
        helper="High priority"
        tone="danger"
      />
      <Metric
        label="Resolved (7d)"
        value={resolved7d}
        helper="Reviewed in last 7 days"
        tone="success"
      />
      <Metric label="Pending" value={pending} helper="Open or follow-up" tone="info" />
    </div>
  );
}

function Metric({
  label,
  value,
  helper,
  tone = "default",
}: {
  label: string;
  value: number;
  helper: string;
  tone?: "default" | "danger" | "success" | "info";
}) {
  const toneClass =
    tone === "danger"
      ? "text-rose-600"
      : tone === "success"
        ? "text-emerald-600"
        : tone === "info"
          ? "text-blue-600"
          : "text-slate-950";

  return (
    <div className="min-h-24 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-2 text-3xl font-semibold ${toneClass}`}>
        {value.toLocaleString()}
      </div>
      <div className="mt-1 text-xs text-slate-500">{helper}</div>
    </div>
  );
}

function FilterPanel({
  draftFilters,
  sdrOptions,
  reasonOptions,
  onDraftChange,
  onApply,
  onClear,
}: {
  draftFilters: AppliedFilters;
  sdrOptions: string[];
  reasonOptions: string[];
  onDraftChange: (filters: AppliedFilters) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  return (
    <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-950">Filters</h2>
        <button
          type="button"
          className="text-xs font-medium text-blue-700"
          onClick={onClear}
        >
          Reset
        </button>
      </div>
      <div className="space-y-4">
        <FilterSelect
          label="Status"
          value={draftFilters.status}
          onChange={(value) =>
            onDraftChange({ ...draftFilters, status: value as StatusFilter })
          }
          options={[
            ["all", "All Statuses"],
            ...statuses.map((status) => [status, formatStatus(status)] as const),
          ]}
        />
        <FilterSelect
          label="Severity"
          value={draftFilters.priority}
          onChange={(value) =>
            onDraftChange({
              ...draftFilters,
              priority: value as PriorityFilter,
            })
          }
          options={[
            ["all", "All Severities"],
            ...priorities.map((priority) => [priority, formatPriority(priority)] as const),
          ]}
        />
        <FilterSelect
          label="SDR"
          value={draftFilters.sdrName}
          onChange={(value) =>
            onDraftChange({ ...draftFilters, sdrName: value })
          }
          options={[
            ["", "All SDRs"],
            ...sdrOptions.map((option) => [option, option] as const),
          ]}
        />
        <FilterSelect
          label="Flag Reason"
          value={draftFilters.reason}
          onChange={(value) =>
            onDraftChange({ ...draftFilters, reason: value })
          }
          options={[
            ["", "All Reasons"],
            ...reasonOptions.map((option) => [option, option] as const),
          ]}
        />
      </div>
      <div className="mt-8 flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-9 flex-1 rounded-lg border-slate-200 bg-white"
          onClick={onClear}
        >
          Clear all
        </Button>
        <Button
          type="button"
          className="h-9 flex-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
          onClick={onApply}
        >
          Apply filters
        </Button>
      </div>
    </aside>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <select
        className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue || "all"} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function QueueTabButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`inline-flex h-9 items-center gap-2 border-b-2 px-3 text-sm font-medium ${
        active
          ? "border-blue-600 text-blue-700"
          : "border-transparent text-slate-500 hover:text-slate-900"
      }`}
      onClick={onClick}
    >
      {label}
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
        {count.toLocaleString()}
      </span>
    </button>
  );
}

function ManagerReviewTable({
  items,
  selectedId,
  selectedRows,
  isLoading,
  onSelect,
  onToggleRow,
}: {
  items: ManagerReviewItem[];
  selectedId: string | null;
  selectedRows: Set<string>;
  isLoading: boolean;
  onSelect: (item: ManagerReviewItem) => void;
  onToggleRow: (id: string, checked: boolean) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="m-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
        {isLoading ? "Loading review items..." : "No items match the current filters."}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[980px]">
        <TableHeader className="bg-slate-50">
          <TableRow className="border-slate-200">
            <TableHead className="w-10">
              <span className="sr-only">Select</span>
            </TableHead>
            <TableHead className="min-w-[120px]">Item</TableHead>
            <TableHead className="min-w-[120px]">Type</TableHead>
            <TableHead className="min-w-[130px]">SDR</TableHead>
            <TableHead className="min-w-[170px]">Company</TableHead>
            <TableHead className="min-w-[150px]">Contact</TableHead>
            <TableHead className="min-w-[190px]">Flag Reason</TableHead>
            <TableHead className="min-w-[210px]">Suggested Next Action</TableHead>
            <TableHead className="min-w-[120px]">Status</TableHead>
            <TableHead className="min-w-[120px]">Created</TableHead>
            <TableHead className="w-20 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow
              key={item.id}
              className={`h-14 cursor-pointer border-b border-slate-100 ${
                selectedId === item.id
                  ? "bg-blue-50 ring-1 ring-inset ring-blue-200"
                  : "bg-white hover:bg-slate-50"
              }`}
              onClick={() => onSelect(item)}
            >
              <TableCell onClick={(event) => event.stopPropagation()}>
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300"
                  checked={selectedRows.has(item.id)}
                  onChange={(event) => onToggleRow(item.id, event.target.checked)}
                  aria-label={`Select manager review ${shortId(item.id)}`}
                />
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${priorityDot(item.priority)}`}
                  />
                  <span className="font-medium text-slate-900">
                    #{shortId(item.id)}
                  </span>
                </div>
              </TableCell>
              <TableCell className="text-sm text-slate-600">
                {formatSource(item.source)}
              </TableCell>
              <TableCell className="text-sm text-slate-700">
                {item.sdrName || "-"}
              </TableCell>
              <TableCell>
                <div className="max-w-40 truncate font-medium text-slate-900">
                  {item.company?.companyName || item.companyName || "-"}
                </div>
                <div className="max-w-40 truncate text-xs text-slate-500">
                  {item.company?.companyCountry || item.company?.website || ""}
                </div>
              </TableCell>
              <TableCell>
                <div className="max-w-36 truncate text-sm text-slate-700">
                  {item.contact?.fullName || item.leadName || "-"}
                </div>
                <div className="max-w-36 truncate text-xs text-slate-500">
                  {item.contact?.title || item.contact?.email || ""}
                </div>
              </TableCell>
              <TableCell>
                <div className="line-clamp-2 max-w-48 text-xs leading-5 text-slate-600">
                  {item.reasons.length > 0 ? item.reasons.join("; ") : "-"}
                </div>
              </TableCell>
              <TableCell>
                <div className="line-clamp-2 max-w-52 text-xs leading-5 text-slate-600">
                  {item.nextAction || "-"}
                </div>
              </TableCell>
              <TableCell>
                <StatusBadge status={item.status} />
              </TableCell>
              <TableCell className="text-xs text-slate-500">
                {formatDate(item.createdAt)}
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="h-8 w-8 rounded-lg border-slate-200 bg-white"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(item);
                    }}
                  >
                    <Eye className="h-4 w-4" />
                    <span className="sr-only">Open details</span>
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ManagerReviewPanel({
  item,
  formState,
  isSaving,
  onFormChange,
  onClearSelection,
  onSave,
  onSaveAndClose,
  onResolve,
  onRequestMoreInfo,
  onDismiss,
}: {
  item: ManagerReviewItem | null;
  formState: {
    status: ManagerReviewStatus;
    reviewedBy: string;
    managerNote: string;
    nextAction: string;
  };
  isSaving: boolean;
  onFormChange: (state: {
    status: ManagerReviewStatus;
    reviewedBy: string;
    managerNote: string;
    nextAction: string;
  }) => void;
  onClearSelection: () => void;
  onSave: () => void;
  onSaveAndClose: () => void;
  onResolve: () => void;
  onRequestMoreInfo: () => void;
  onDismiss: () => void;
}) {
  if (!item) {
    return (
      <aside className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
        Select a review item to see details.
      </aside>
    );
  }

  return (
    <aside className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <PriorityBadge priority={item.priority} />
            <span className="text-xs font-medium text-slate-500">
              #{shortId(item.id)}
            </span>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 rounded-lg text-slate-500"
            onClick={onClearSelection}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <h2 className="mt-3 text-lg font-semibold text-slate-950">
          {item.reasons[0] ?? "Manager review item"}
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Flagged {formatDateTime(item.createdAt)} from {formatSource(item.source)}
        </p>
        <div className="mt-3 border-b border-slate-200">
          <button
            type="button"
            className="border-b-2 border-blue-600 px-1 pb-2 text-sm font-medium text-blue-700"
          >
            Details
          </button>
        </div>
      </div>

      <div className="space-y-4 px-4 py-4">
        <PanelSection title="Original Notes">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">
            {item.sourceNote || "No original note available."}
          </div>
        </PanelSection>

        <PanelSection title="Normalized Activity Data">
          {item.activityRow ? (
            <div className="space-y-2 rounded-lg border border-slate-200 p-3">
              <CompareRow label="LinkedIn" value={item.activityRow.linkedinStageNormalized} />
              <CompareRow label="Email" value={item.activityRow.emailStageNormalized} />
              <CompareRow label="Call" value={item.activityRow.callStageNormalized} />
              <CompareRow label="Other" value={item.activityRow.otherChannelNormalized} />
              <CompareRow
                label="Total activity"
                value={String(item.activityRow.totalActivityCount)}
              />
            </div>
          ) : (
            <EmptyPanelText>No normalization changes available.</EmptyPanelText>
          )}
        </PanelSection>

        <PanelSection title="Linked Records">
          <div className="grid gap-2">
            {item.company || item.companyName ? (
              <LinkedRecordCard
                icon={<FileText className="h-4 w-4" />}
                title={item.company?.companyName || item.companyName || "Company"}
                subtitle={[
                  item.company?.companyCountry,
                  item.company?.website,
                ].filter(Boolean).join(" · ")}
                href={
                  item.company?.companyName
                    ? `/companies?search=${encodeURIComponent(item.company.companyName)}`
                    : undefined
                }
              />
            ) : null}
            {item.contact || item.leadName ? (
              <LinkedRecordCard
                icon={<MessageSquare className="h-4 w-4" />}
                title={item.contact?.fullName || item.leadName || "Contact"}
                subtitle={[item.contact?.title, item.contact?.email]
                  .filter(Boolean)
                  .join(" · ")}
                href={
                  item.contactRecordId
                    ? `/contacts/${item.contactRecordId}`
                    : undefined
                }
              />
            ) : null}
            {item.activityUploadId ? (
              <LinkedRecordCard
                icon={<CheckCircle2 className="h-4 w-4" />}
                title="Activity recap"
                subtitle={item.activityRow?.activityUpload.fileName ?? "Linked activity upload"}
                href="/activity-recaps"
              />
            ) : null}
          </div>
        </PanelSection>

        <PanelSection title="Suggested Next Action">
          {item.nextAction ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">
              {item.nextAction}
            </div>
          ) : (
            <EmptyPanelText>No saved next action available.</EmptyPanelText>
          )}
        </PanelSection>

        <PanelSection title="Manager Review">
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Status</span>
              <select
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                value={formState.status}
                onChange={(event) =>
                  onFormChange({
                    ...formState,
                    status: event.target.value as ManagerReviewStatus,
                  })
                }
              >
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {formatStatus(status)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">
                Reviewed by
              </span>
              <Input
                className="mt-1 h-10 rounded-lg border-slate-200"
                value={formState.reviewedBy}
                onChange={(event) =>
                  onFormChange({ ...formState, reviewedBy: event.target.value })
                }
                placeholder="Manager name"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">
                Manager note
              </span>
              <textarea
                className="mt-1 min-h-24 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                value={formState.managerNote}
                onChange={(event) =>
                  onFormChange({ ...formState, managerNote: event.target.value })
                }
                placeholder="Add a note for the SDR..."
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">
                Next action
              </span>
              <textarea
                className="mt-1 min-h-20 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                value={formState.nextAction}
                onChange={(event) =>
                  onFormChange({ ...formState, nextAction: event.target.value })
                }
                placeholder="What should happen next?"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg border-blue-200 text-blue-700"
                onClick={onResolve}
                disabled={isSaving}
              >
                Resolve Review
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg border-amber-200 text-amber-700"
                onClick={onRequestMoreInfo}
                disabled={isSaving}
              >
                Request More Info
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg border-slate-200"
                onClick={onDismiss}
                disabled={isSaving}
              >
                Dismiss
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg border-slate-200"
                onClick={onSaveAndClose}
                disabled={isSaving}
              >
                Save & Close
              </Button>
            </div>
            <Button
              type="button"
              className="h-10 w-full rounded-lg bg-blue-600 text-white hover:bg-blue-700"
              onClick={onSave}
              disabled={isSaving}
            >
              {isSaving ? "Saving..." : "Save Review"}
            </Button>
          </div>
        </PanelSection>
      </div>
    </aside>
  );
}

function PanelSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-slate-950">{title}</h3>
      {children}
    </section>
  );
}

function CompareRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="max-w-44 truncate font-medium text-slate-900">
        {value || "-"}
      </span>
    </div>
  );
}

function LinkedRecordCard({
  icon,
  title,
  subtitle,
  href,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  href?: string;
}) {
  const content = (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-left hover:bg-slate-50">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-slate-900">
          {title}
        </div>
        <div className="truncate text-xs text-slate-500">{subtitle || "-"}</div>
      </div>
    </div>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}

function EmptyPanelText({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-500">
      {children}
    </div>
  );
}

export function PriorityBadge({ priority }: { priority: ManagerReviewPriority }) {
  const className =
    priority === "high"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : priority === "medium"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-blue-200 bg-blue-50 text-blue-700";

  return (
    <Badge variant="outline" className={className}>
      {formatPriority(priority)}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: ManagerReviewStatus }) {
  const className =
    status === "open"
      ? "border-blue-200 bg-blue-50 text-blue-700"
      : status === "needs_follow_up"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : status === "reviewed"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-slate-100 text-slate-600";

  return (
    <Badge variant="outline" className={className}>
      {formatStatus(status)}
    </Badge>
  );
}

function buildSearchText(item: ManagerReviewItem) {
  return [
    item.id,
    item.sdrName,
    item.leadName,
    item.companyName,
    item.company?.companyName,
    item.company?.website,
    item.contact?.fullName,
    item.contact?.email,
    item.sourceNote,
    item.managerNote,
    item.nextAction,
    ...item.reasons,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function countPriority(items: ManagerReviewItem[], priority: ManagerReviewPriority) {
  return items.filter((item) => item.priority === priority).length;
}

function countPending(items: ManagerReviewItem[]) {
  return items.filter((item) => !isTerminalStatus(item.status)).length;
}

function countResolvedInLast7Days(items: ManagerReviewItem[]) {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return items.filter((item) => {
    if (item.status !== "reviewed") return false;
    const resolvedTime = new Date(item.reviewedAt ?? item.updatedAt).getTime();
    return Number.isFinite(resolvedTime) && resolvedTime >= sevenDaysAgo;
  }).length;
}

function isTerminalStatus(status: ManagerReviewStatus) {
  return status === "reviewed" || status === "dismissed";
}

function priorityRank(priority: ManagerReviewPriority) {
  if (priority === "high") return 0;
  if (priority === "medium") return 1;
  return 2;
}

function priorityDot(priority: ManagerReviewPriority) {
  if (priority === "high") return "bg-rose-500";
  if (priority === "medium") return "bg-amber-500";
  return "bg-blue-500";
}

function formatStatus(status: ManagerReviewStatus) {
  if (status === "needs_follow_up") return "Needs follow-up";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatPriority(priority: ManagerReviewPriority) {
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

function formatSource(source: string) {
  return source.replaceAll("_", " ");
}

function shortId(id: string) {
  return id.slice(-5);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
