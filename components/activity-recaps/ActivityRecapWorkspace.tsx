"use client";

import Link from "next/link";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Download,
  Eye,
  FileSpreadsheet,
  Flag,
  MoreHorizontal,
  RefreshCw,
  Search,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

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
  canonicalActivityFields,
  suggestActivityColumnMappings,
  suggestionsToMapping,
} from "@/lib/activityRecaps/mapping";
import { normalizeActivityRows } from "@/lib/activityRecaps/normalizeActivityRows";
import { parseActivityFile } from "@/lib/activityRecaps/parseActivityFile";
import { summarizeSdrActivity } from "@/lib/activityRecaps/summary";
import type {
  ActivityColumnMapping,
  CanonicalActivityField,
  CompanyMatchStatus,
  ParsedActivityFile,
  SdrActivitySummary,
  StandardizedSdrActivityRow,
} from "@/lib/activityRecaps/types";
import {
  deleteActivityRecap,
  getActivityRecap,
  listActivityRecaps,
  rerunActivityRecapCompanyMatching,
  saveActivityRecap,
  syncContactsForActivityRecap,
  syncManagerReviewForActivityRecap,
  type SavedActivityRecapDetail,
  type SavedActivityRecapListItem,
} from "@/lib/client/activityRecaps";

type ChannelFilter = "all" | "email" | "linkedin" | "call" | "whatsapp" | "other";
type OutcomeFilter = "all" | "positive" | "no_reply" | "voicemail" | "not_interested" | "other";
type ReviewFlagFilter = "all" | "yes" | "no";
type MatchFilter = "all" | CompanyMatchStatus;

const previewFields: CanonicalActivityField[] = [
  "sdrName",
  "companyName",
  "leadName",
  "activityDate",
  "emailStage",
  "linkedinStage",
  "callStage",
  "otherChannelStage",
  "meetingStatus",
  "noteCombined",
];

export function ActivityRecapWorkspace() {
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const standardizedTableRef = useRef<HTMLDivElement>(null);
  const [parsedFile, setParsedFile] = useState<ParsedActivityFile | null>(null);
  const [mapping, setMapping] = useState<ActivityColumnMapping>({});
  const [savedRecaps, setSavedRecaps] = useState<SavedActivityRecapListItem[]>([]);
  const [selectedSavedRecap, setSelectedSavedRecap] =
    useState<SavedActivityRecapDetail | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isOpeningSaved, setIsOpeningSaved] = useState(false);
  const [isMatchingCompanies, setIsMatchingCompanies] = useState(false);
  const [isSyncingContacts, setIsSyncingContacts] = useState(false);
  const [isSyncingManagerReview, setIsSyncingManagerReview] = useState(false);
  const [search, setSearch] = useState("");
  const [sdrFilter, setSdrFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("all");
  const [reviewFlagFilter, setReviewFlagFilter] =
    useState<ReviewFlagFilter>("all");
  const [matchFilter, setMatchFilter] = useState<MatchFilter>("all");
  const [selectedRows, setSelectedRows] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refreshSavedRecaps();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  const localStandardizedRows = useMemo(() => {
    if (!parsedFile) return [];
    return normalizeActivityRows(parsedFile.rows, mapping);
  }, [mapping, parsedFile]);
  const activeRows = selectedSavedRecap?.rows ?? localStandardizedRows;
  const activeSummary: SdrActivitySummary[] =
    selectedSavedRecap?.summary ?? summarizeSdrActivity(activeRows);
  const isSavedMode = selectedSavedRecap !== null;
  const latestRecap = selectedSavedRecap ?? savedRecaps[0] ?? null;
  const mappedCount = useMemo(
    () => Object.values(mapping).filter((columns) => (columns?.length ?? 0) > 0).length,
    [mapping]
  );
  const unmappedCount = Math.max(canonicalActivityFields.length - mappedCount, 0);
  const ruleCounts = useMemo(() => buildRuleCounts(activeRows), [activeRows]);
  const sdrOptions = useMemo(
    () =>
      Array.from(new Set(activeRows.map((row) => row.sdrName).filter(Boolean))).sort(
        (a, b) => a.localeCompare(b)
      ),
    [activeRows]
  );
  const channelOptions = useMemo(() => {
    const options = new Set<ChannelFilter>();
    activeRows.forEach((row) => options.add(getPrimaryChannel(row)));
    return Array.from(options).sort();
  }, [activeRows]);
  const filteredRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return activeRows.filter((row) => {
      const matchesSearch =
        !normalizedSearch ||
        [
          row.sdrName,
          row.companyName,
          row.leadName,
          row.title,
          row.noteCombined,
          row.website,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearch);
      const matchesSdr = sdrFilter === "all" || row.sdrName === sdrFilter;
      const matchesChannel =
        channelFilter === "all" || getPrimaryChannel(row) === channelFilter;
      const matchesOutcome =
        outcomeFilter === "all" || getOutcomeGroup(row) === outcomeFilter;
      const matchesReview =
        reviewFlagFilter === "all" ||
        (reviewFlagFilter === "yes" && row.managerReviewFlag) ||
        (reviewFlagFilter === "no" && !row.managerReviewFlag);
      const matchesCompany =
        matchFilter === "all" || (row.companyMatchStatus ?? "no_match") === matchFilter;

      return (
        matchesSearch &&
        matchesSdr &&
        matchesChannel &&
        matchesOutcome &&
        matchesReview &&
        matchesCompany
      );
    });
  }, [
    activeRows,
    channelFilter,
    matchFilter,
    outcomeFilter,
    reviewFlagFilter,
    sdrFilter,
    search,
  ]);

  async function refreshSavedRecaps() {
    setIsLoadingHistory(true);
    try {
      setSavedRecaps(await listActivityRecaps());
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Saved activity recaps could not be loaded."
      );
    } finally {
      setIsLoadingHistory(false);
    }
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;

    setIsParsing(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const parsed = await parseActivityFile(file);
      const nextSuggestions = suggestActivityColumnMappings(parsed.headers, parsed.rows);

      setParsedFile(parsed);
      setMapping(suggestionsToMapping(nextSuggestions));
      setSelectedSavedRecap(null);
      resetFilters();
      setSuccessMessage(`${parsed.fileName} parsed successfully.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "File parsing failed.");
    } finally {
      setIsParsing(false);
      if (uploadInputRef.current) {
        uploadInputRef.current.value = "";
      }
    }
  }

  async function handleSaveActivityRecap() {
    if (!parsedFile || localStandardizedRows.length === 0) {
      setErrorMessage("Upload and standardize rows before saving a recap.");
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const result = await saveActivityRecap({
        fileName: parsedFile.fileName,
        fileType: parsedFile.fileType,
        fileSize: parsedFile.fileSize,
        sheetName: parsedFile.sheetName,
        detectedHeaders: parsedFile.headers,
        mappingProfile: mapping,
        rows: localStandardizedRows,
      });

      setSuccessMessage(
        `Saved ${result.totalRows.toLocaleString()} activity rows from ${result.fileName}.`
      );
      await refreshSavedRecaps();
      await openSavedRecap(result.id);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Activity recap save failed."
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function openSavedRecap(id: string) {
    setIsOpeningSaved(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const detail = await getActivityRecap(id);
      setSelectedSavedRecap(detail);
      resetFilters();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Saved activity recap not found."
      );
    } finally {
      setIsOpeningSaved(false);
    }
  }

  async function handleDeleteSavedRecap(id: string) {
    if (!window.confirm("Delete this saved activity recap and all rows?")) return;

    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await deleteActivityRecap(id);
      if (selectedSavedRecap?.id === id) setSelectedSavedRecap(null);
      setSuccessMessage("Saved activity recap deleted.");
      await refreshSavedRecaps();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Activity recap delete failed."
      );
    }
  }

  async function handleRerunCompanyMatching(id: string) {
    setIsMatchingCompanies(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const result = await rerunActivityRecapCompanyMatching(id);
      setSelectedSavedRecap(await getActivityRecap(id));
      setSuccessMessage(
        `Company matching complete: ${result.matched} matched, ${result.suggested} suggested, ${result.noMatch} no match, ${result.ambiguous} ambiguous.`
      );
      await refreshSavedRecaps();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Company matching rerun failed."
      );
    } finally {
      setIsMatchingCompanies(false);
    }
  }

  async function handleSyncContacts(id: string) {
    setIsSyncingContacts(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const result = await syncContactsForActivityRecap(id);
      setSelectedSavedRecap(await getActivityRecap(id));
      setSuccessMessage(
        `Contact sync complete: ${result.contactsCreated} created, ${result.contactsUpdated} updated, ${result.rowsLinked} rows linked, ${result.rowsSkipped} skipped.`
      );
      await refreshSavedRecaps();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Contact sync failed.");
    } finally {
      setIsSyncingContacts(false);
    }
  }

  async function handleSyncManagerReview(id: string) {
    setIsSyncingManagerReview(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const result = await syncManagerReviewForActivityRecap(id);
      setSelectedSavedRecap(await getActivityRecap(id));
      setSuccessMessage(
        `Manager review sync complete: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped from ${result.totalFlaggedRows} flagged rows.`
      );
      await refreshSavedRecaps();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Manager review sync failed."
      );
    } finally {
      setIsSyncingManagerReview(false);
    }
  }

  function resetFilters() {
    setSearch("");
    setSdrFilter("all");
    setChannelFilter("all");
    setOutcomeFilter("all");
    setReviewFlagFilter("all");
    setMatchFilter("all");
    setSelectedRows(new Set());
  }

  function setSingleField(field: CanonicalActivityField, column: string) {
    setMapping((current) => ({
      ...current,
      [field]: column ? [column] : [],
    }));
  }

  function toggleRow(rowIndex: number, checked: boolean) {
    setSelectedRows((current) => {
      const next = new Set(current);
      if (checked) next.add(rowIndex);
      else next.delete(rowIndex);
      return next;
    });
  }

  const stepState = getStepState({
    parsedFile,
    mappedCount,
    activeRows,
    latestRecap,
  });

  return (
    <div className="space-y-4 px-5 py-5 sm:px-6">
      <input
        ref={uploadInputRef}
        className="hidden"
        type="file"
        accept=".csv,.xlsx"
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />

      <header className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-950">
              Activity Recaps
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Import SDR activity recaps, map fields, review data, and create a
              manager review queue.
            </p>
          </div>
          <div className="flex flex-1 flex-col gap-3 xl:max-w-3xl xl:flex-row xl:items-center">
            <Stepper steps={stepState} />
          </div>
        </div>
      </header>

      <WorkflowActionBar
        parsedFile={parsedFile}
        selectedSavedRecap={selectedSavedRecap}
        rowCount={localStandardizedRows.length}
        mappedCount={mappedCount}
        activeRowsCount={activeRows.length}
        isParsing={isParsing}
        isSaving={isSaving}
        isSyncingManagerReview={isSyncingManagerReview}
        onUpload={() => uploadInputRef.current?.click()}
        onSave={() => void handleSaveActivityRecap()}
        onCreateQueue={() =>
          selectedSavedRecap
            ? void handleSyncManagerReview(selectedSavedRecap.id)
            : undefined
        }
      />

      {errorMessage ? (
        <StatusMessage tone="danger" message={errorMessage} />
      ) : null}
      {successMessage ? (
        <StatusMessage tone="success" message={successMessage} />
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-[1.05fr_1fr_1.2fr_1.55fr]">
        <UploadStatusCard
          parsedFile={parsedFile}
          selectedSavedRecap={selectedSavedRecap}
          isParsing={isParsing}
          onUpload={() => uploadInputRef.current?.click()}
        />
        <HeaderStatusCard parsedFile={parsedFile} selectedSavedRecap={selectedSavedRecap} />
        <FieldMappingCard
          parsedFile={parsedFile}
          mapping={mapping}
          mappedCount={mappedCount}
          unmappedCount={unmappedCount}
          onSetField={setSingleField}
        />
        <PreviewRowsCard
          rows={activeRows}
          onViewAll={() =>
            standardizedTableRef.current?.scrollIntoView({ behavior: "smooth" })
          }
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.85fr)]">
        <SdrSummaryCard summaries={activeSummary} />
        <ManagerReviewRulesCard
          rows={activeRows}
          ruleCounts={ruleCounts}
          latestRecap={latestRecap}
          selectedSavedRecap={selectedSavedRecap}
          isSyncingManagerReview={isSyncingManagerReview}
          onSyncManagerReview={(id) => void handleSyncManagerReview(id)}
        />
      </section>

      <DownstreamSyncCard
        recap={selectedSavedRecap}
        activeRows={activeRows}
        isMatchingCompanies={isMatchingCompanies}
        isSyncingContacts={isSyncingContacts}
        isSyncingManagerReview={isSyncingManagerReview}
        onRerunCompanyMatching={(id) => void handleRerunCompanyMatching(id)}
        onSyncContacts={(id) => void handleSyncContacts(id)}
        onSyncManagerReview={(id) => void handleSyncManagerReview(id)}
      />

      <section ref={standardizedTableRef}>
        <StandardizedActivityCommandTable
          rows={filteredRows}
          totalRows={activeRows.length}
          selectedRows={selectedRows}
          search={search}
          sdrFilter={sdrFilter}
          channelFilter={channelFilter}
          outcomeFilter={outcomeFilter}
          reviewFlagFilter={reviewFlagFilter}
          matchFilter={matchFilter}
          sdrOptions={sdrOptions}
          channelOptions={channelOptions}
          isSavedMode={isSavedMode}
          onSearchChange={setSearch}
          onSdrFilterChange={setSdrFilter}
          onChannelFilterChange={setChannelFilter}
          onOutcomeFilterChange={setOutcomeFilter}
          onReviewFlagFilterChange={setReviewFlagFilter}
          onMatchFilterChange={setMatchFilter}
          onClearFilters={resetFilters}
          onToggleRow={toggleRow}
        />
      </section>

      <SavedRecapHistory
        recaps={savedRecaps}
        isLoading={isLoadingHistory}
        isOpening={isOpeningSaved}
        selectedId={selectedSavedRecap?.id}
        onRefresh={() => void refreshSavedRecaps()}
        onOpen={(id) => void openSavedRecap(id)}
        onDelete={(id) => void handleDeleteSavedRecap(id)}
        onMatchCompanies={(id) => void handleRerunCompanyMatching(id)}
        onSyncContacts={(id) => void handleSyncContacts(id)}
        onSyncManagerReview={(id) => void handleSyncManagerReview(id)}
      />

      {!parsedFile && !selectedSavedRecap && savedRecaps.length === 0 ? (
        <EmptyWorkspaceState message="Upload an SDR activity file to start." />
      ) : null}
    </div>
  );
}

function Stepper({
  steps,
}: {
  steps: Array<{ label: string; helper: string; state: "complete" | "active" | "idle" }>;
}) {
  return (
    <div className="grid flex-1 gap-2 md:grid-cols-3">
      {steps.map((step, index) => (
        <div key={step.label} className="flex items-center gap-2">
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
              step.state === "complete"
                ? "bg-emerald-100 text-emerald-700"
                : step.state === "active"
                  ? "bg-blue-600 text-white"
                  : "bg-slate-100 text-slate-500"
            }`}
          >
            {step.state === "complete" ? <Check className="h-4 w-4" /> : index + 1}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-900">
              {step.label}
            </div>
            <div className="truncate text-xs text-slate-500">{step.helper}</div>
          </div>
          {index < steps.length - 1 ? (
            <div className="hidden h-px flex-1 bg-slate-200 xl:block" />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function WorkflowActionBar({
  parsedFile,
  selectedSavedRecap,
  rowCount,
  mappedCount,
  activeRowsCount,
  isParsing,
  isSaving,
  isSyncingManagerReview,
  onUpload,
  onSave,
  onCreateQueue,
}: {
  parsedFile: ParsedActivityFile | null;
  selectedSavedRecap: SavedActivityRecapDetail | null;
  rowCount: number;
  mappedCount: number;
  activeRowsCount: number;
  isParsing: boolean;
  isSaving: boolean;
  isSyncingManagerReview: boolean;
  onUpload: () => void;
  onSave: () => void;
  onCreateQueue: () => void;
}) {
  const canSave = Boolean(parsedFile) && rowCount > 0;
  const canCreateQueue = Boolean(selectedSavedRecap);
  const reviewItemCount = selectedSavedRecap?.managerReviewItemCount ?? 0;
  const workflowState = selectedSavedRecap
    ? reviewItemCount > 0
      ? "Queue ready"
      : "Saved"
    : parsedFile
      ? "Unsaved recap"
      : "No file";

  return (
    <div className="sticky top-0 z-30 rounded-xl border border-slate-200 bg-slate-50/95 px-4 py-3 shadow-sm backdrop-blur">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <StateBadge
            label={workflowState}
            tone={
              workflowState === "Queue ready"
                ? "success"
                : workflowState === "Saved"
                  ? "info"
                  : workflowState === "Unsaved recap"
                    ? "warning"
                    : "neutral"
            }
          />
          {activeRowsCount > 0 ? (
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-600">
              {activeRowsCount.toLocaleString()} rows parsed
            </span>
          ) : null}
          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-600">
            {mappedCount.toLocaleString()} mapped
          </span>
          {selectedSavedRecap ? (
            <span className="max-w-72 truncate rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-600">
              Saved: {selectedSavedRecap.fileName}
            </span>
          ) : null}
          {reviewItemCount > 0 ? (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">
              {reviewItemCount.toLocaleString()} review items
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-lg border-slate-200 bg-white px-3"
            onClick={onUpload}
            disabled={isParsing}
          >
            <UploadCloud className="mr-2 h-4 w-4" />
            {parsedFile || selectedSavedRecap ? "Replace File" : "Upload Activity File"}
          </Button>
          <Button
            type="button"
            className="h-9 rounded-lg bg-blue-600 px-3 text-white hover:bg-blue-700"
            disabled={!canSave || isSaving}
            onClick={onSave}
          >
            {isSaving ? "Saving..." : "Save Recap"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-lg border-slate-200 bg-white px-3"
            disabled={!canCreateQueue || isSyncingManagerReview}
            onClick={onCreateQueue}
          >
            <Flag className="mr-2 h-4 w-4" />
            {isSyncingManagerReview ? "Creating..." : "Create Review Queue"}
          </Button>
          {reviewItemCount > 0 || selectedSavedRecap ? (
            <Button asChild type="button" variant="outline" className="h-9 rounded-lg border-slate-200 bg-white px-3">
              <Link href="/manager-review">Open Manager Review Queue</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function UploadStatusCard({
  parsedFile,
  selectedSavedRecap,
  isParsing,
  onUpload,
}: {
  parsedFile: ParsedActivityFile | null;
  selectedSavedRecap: SavedActivityRecapDetail | null;
  isParsing: boolean;
  onUpload: () => void;
}) {
  const fileName = selectedSavedRecap?.fileName ?? parsedFile?.fileName;
  const fileType = selectedSavedRecap?.fileType ?? parsedFile?.fileType;
  const rowCount = selectedSavedRecap?.totalRows ?? parsedFile?.rowCount ?? 0;
  const headerCount = selectedSavedRecap?.detectedHeaders.length ?? parsedFile?.headers.length ?? 0;
  const status = fileName ? "Completed" : isParsing ? "Parsing" : "Waiting";

  return (
    <CommandCard
      step="1"
      title="Upload Activity File"
      badge={<StateBadge label={status} tone={fileName ? "success" : "neutral"} />}
    >
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
            <FileSpreadsheet className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-900">
              {fileName ?? "No file uploaded"}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {fileType ? fileType.toUpperCase() : "CSV or Excel"} · {rowCount.toLocaleString()} rows · {headerCount.toLocaleString()} headers
            </div>
          </div>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        className="h-9 w-full rounded-lg border-slate-200 bg-white"
        onClick={onUpload}
        disabled={isParsing}
      >
        {fileName ? "Replace file" : "Choose file"}
      </Button>
      <div
        className={`rounded-lg border px-3 py-2 text-xs ${
          fileName
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-slate-200 bg-slate-50 text-slate-500"
        }`}
      >
        {fileName
          ? `File validated successfully. ${rowCount.toLocaleString()} rows detected.`
          : "Upload an SDR activity file to start."}
      </div>
    </CommandCard>
  );
}

function HeaderStatusCard({
  parsedFile,
  selectedSavedRecap,
}: {
  parsedFile: ParsedActivityFile | null;
  selectedSavedRecap: SavedActivityRecapDetail | null;
}) {
  const headers = selectedSavedRecap?.detectedHeaders ?? parsedFile?.headers ?? [];
  const sheetName = selectedSavedRecap?.sheetName ?? parsedFile?.sheetName ?? "Default sheet";

  return (
    <CommandCard
      step="2"
      title="Auto-Detected Sheet & Headers"
      badge={<StateBadge label={headers.length ? "Detected" : "Waiting"} tone={headers.length ? "info" : "neutral"} />}
    >
      <InfoSelect label="Detected sheet" value={sheetName} />
      <InfoSelect label="Header row" value="Detected by parser" />
      <div className="max-h-[180px] overflow-auto rounded-xl border border-slate-200 bg-white">
        {headers.length > 0 ? (
          headers.map((header, index) => (
            <div
              key={`${header}-${index}`}
              className="grid grid-cols-[36px_1fr] border-b border-slate-100 px-3 py-1.5 text-xs last:border-b-0"
            >
              <span className="text-slate-400">{index + 1}</span>
              <span className="truncate text-slate-700">{header}</span>
            </div>
          ))
        ) : (
          <div className="p-4 text-sm text-slate-500">No detected headers.</div>
        )}
      </div>
    </CommandCard>
  );
}

function FieldMappingCard({
  parsedFile,
  mapping,
  mappedCount,
  unmappedCount,
  onSetField,
}: {
  parsedFile: ParsedActivityFile | null;
  mapping: ActivityColumnMapping;
  mappedCount: number;
  unmappedCount: number;
  onSetField: (field: CanonicalActivityField, column: string) => void;
}) {
  const headers = parsedFile?.headers ?? [];
  const sampleRow = parsedFile?.rows[0] ?? {};

  return (
    <CommandCard
      step="3"
      title="Field Mapping"
      badge={<StateBadge label={`${mappedCount} mapped`} tone={mappedCount ? "success" : "neutral"} />}
    >
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <div className="grid grid-cols-[1fr_1fr_1fr] bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">
          <span>Telestar Field</span>
          <span>Your Column</span>
          <span>Sample Value</span>
        </div>
        <div className="max-h-[220px] overflow-auto">
          {previewFields.map((field) => {
            const column = mapping[field]?.[0] ?? "";
            return (
              <div
                key={field}
                className="grid grid-cols-[1fr_1fr_1fr] items-center gap-2 border-t border-slate-100 px-3 py-2 text-xs"
              >
                <span className="flex min-w-0 items-center gap-2 font-medium text-slate-700">
                  <span
                    className={`h-2 w-2 rounded-full ${column ? "bg-emerald-500" : "bg-slate-300"}`}
                  />
                  {formatFieldLabel(field)}
                </span>
                <select
                  className="h-8 min-w-0 rounded-md border border-slate-200 bg-white px-2 text-xs"
                  value={column}
                  onChange={(event) => onSetField(field, event.target.value)}
                  disabled={headers.length === 0}
                >
                  <option value="">Do not map</option>
                  {headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
                <span className="truncate text-slate-500">
                  {column ? sampleRow[column] || "-" : "-"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>Mapped: {mappedCount}</span>
        <span>Unmapped: {unmappedCount}</span>
      </div>
      <Button
        type="button"
        className="h-9 w-full rounded-lg bg-blue-600 text-white hover:bg-blue-700"
        disabled={!parsedFile}
      >
        Edit Mapping
      </Button>
    </CommandCard>
  );
}

function PreviewRowsCard({
  rows,
  onViewAll,
}: {
  rows: StandardizedSdrActivityRow[];
  onViewAll: () => void;
}) {
  return (
    <CommandCard
      step="4"
      title="Preview Standardized Rows"
      badge={<StateBadge label={rows.length ? "Ready" : "Waiting"} tone={rows.length ? "info" : "neutral"} />}
    >
      <p className="text-xs text-slate-500">Showing first 5 rows</p>
      <div className="max-h-[220px] overflow-auto rounded-xl border border-slate-200">
        <table className="min-w-[680px] text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              {["SDR", "Company", "Contact", "Channel", "Activity Date", "Outcome", "Notes"].map((header) => (
                <th key={header} className="px-3 py-2 text-left font-semibold">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 5).map((row) => (
              <tr key={`preview-${row.rowIndex}`} className="border-t border-slate-100">
                <td className="px-3 py-2">{row.sdrName || "-"}</td>
                <td className="px-3 py-2">{row.companyName || "-"}</td>
                <td className="px-3 py-2">{row.leadName || "-"}</td>
                <td className="px-3 py-2">{formatChannel(getPrimaryChannel(row))}</td>
                <td className="px-3 py-2">{row.activityDate || row.weekLabel || "-"}</td>
                <td className="px-3 py-2">{formatOutcome(row)}</td>
                <td className="max-w-44 truncate px-3 py-2">{row.noteCombined || "-"}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-center text-slate-500" colSpan={7}>
                  No standardized rows yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{rows.length.toLocaleString()} total rows ready for review</span>
        <Button type="button" variant="outline" size="sm" onClick={onViewAll}>
          View all rows
        </Button>
      </div>
    </CommandCard>
  );
}

function SdrSummaryCard({ summaries }: { summaries: SdrActivitySummary[] }) {
  const total = summaries.reduce(
    (acc, summary) => ({
      emailCount: acc.emailCount + summary.emailCount,
      linkedinCount: acc.linkedinCount + summary.linkedinCount,
      callCount: acc.callCount + summary.callCount,
      otherChannelCount: acc.otherChannelCount + summary.otherChannelCount,
      managerReviewCount: acc.managerReviewCount + summary.managerReviewCount,
      totalActivityCount: acc.totalActivityCount + summary.totalActivityCount,
    }),
    {
      emailCount: 0,
      linkedinCount: 0,
      callCount: 0,
      otherChannelCount: 0,
      managerReviewCount: 0,
      totalActivityCount: 0,
    }
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3">
        <h2 className="text-base font-semibold text-slate-950">Recap Summary by SDR</h2>
        <p className="mt-1 text-xs text-slate-500">Based on mapped activity data.</p>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow>
              <TableHead>SDR</TableHead>
              <TableHead className="text-center">Emails</TableHead>
              <TableHead className="text-center">LinkedIn Messages</TableHead>
              <TableHead className="text-center">Calls</TableHead>
              <TableHead className="text-center">WhatsApp</TableHead>
              <TableHead className="text-center">Meetings Booked</TableHead>
              <TableHead className="text-center">Flagged Rows</TableHead>
              <TableHead className="text-center">Total Activities</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summaries.map((summary) => (
              <TableRow key={summary.sdrName}>
                <TableCell className="font-semibold text-slate-900">{summary.sdrName}</TableCell>
                <PillCount value={summary.emailCount} />
                <PillCount value={summary.linkedinCount} />
                <PillCount value={summary.callCount} />
                <PillCount value={summary.otherChannelCount} />
                <PillCount value={0} />
                <PillCount value={summary.managerReviewCount} tone="warning" />
                <TableCell className="text-center font-semibold">{summary.totalActivityCount.toLocaleString()}</TableCell>
              </TableRow>
            ))}
            {summaries.length > 0 ? (
              <TableRow className="bg-slate-50 font-semibold">
                <TableCell>Total</TableCell>
                <PillCount value={total.emailCount} />
                <PillCount value={total.linkedinCount} />
                <PillCount value={total.callCount} />
                <PillCount value={total.otherChannelCount} />
                <PillCount value={0} />
                <PillCount value={total.managerReviewCount} tone="warning" />
                <TableCell className="text-center">{total.totalActivityCount.toLocaleString()}</TableCell>
              </TableRow>
            ) : (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-slate-500">
                  No SDR activity summary yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function ManagerReviewRulesCard({
  rows,
  ruleCounts,
  latestRecap,
  selectedSavedRecap,
  isSyncingManagerReview,
  onSyncManagerReview,
}: {
  rows: StandardizedSdrActivityRow[];
  ruleCounts: Array<{ reason: string; count: number; priority: string }>;
  latestRecap: SavedActivityRecapDetail | SavedActivityRecapListItem | null;
  selectedSavedRecap: SavedActivityRecapDetail | null;
  isSyncingManagerReview: boolean;
  onSyncManagerReview: (id: string) => void;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Manager Review Rules & Flags</h2>
          <p className="mt-1 text-xs text-slate-500">
            Triggered by real manager review reasons from standardized rows.
          </p>
        </div>
        {latestRecap?.managerReviewCount ? (
          <Button asChild size="sm" variant="outline">
            <Link href="/manager-review">Open Manager Review Queue</Link>
          </Button>
        ) : null}
      </div>
      {ruleCounts.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {ruleCounts.map((rule) => (
            <div key={rule.reason} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-900">
                    {rule.reason}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Manager review rule reason
                  </div>
                </div>
                <StateBadge
                  label={`${rule.count.toLocaleString()} rows`}
                  tone={rule.priority === "high" ? "danger" : rule.priority === "medium" ? "warning" : "success"}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
          No manager review flags detected.
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {selectedSavedRecap ? (
          <Button
            type="button"
            size="sm"
            className="bg-blue-600 text-white hover:bg-blue-700"
            disabled={isSyncingManagerReview}
            onClick={() => onSyncManagerReview(selectedSavedRecap.id)}
          >
            {isSyncingManagerReview ? "Syncing..." : "Sync Manager Review"}
          </Button>
        ) : (
          <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
            Save or open a recap to sync review items
          </Badge>
        )}
        <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
          {rows.filter((row) => row.managerReviewFlag).length.toLocaleString()} flagged rows
        </Badge>
      </div>
    </section>
  );
}

function DownstreamSyncCard({
  recap,
  activeRows,
  isMatchingCompanies,
  isSyncingContacts,
  isSyncingManagerReview,
  onRerunCompanyMatching,
  onSyncContacts,
  onSyncManagerReview,
}: {
  recap: SavedActivityRecapDetail | null;
  activeRows: StandardizedSdrActivityRow[];
  isMatchingCompanies: boolean;
  isSyncingContacts: boolean;
  isSyncingManagerReview: boolean;
  onRerunCompanyMatching: (id: string) => void;
  onSyncContacts: (id: string) => void;
  onSyncManagerReview: (id: string) => void;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Downstream sync</h2>
          <p className="mt-1 text-xs text-slate-500">
            Existing actions backed by activity recap server helpers.
          </p>
        </div>
        {recap ? (
          <Button asChild variant="outline" size="sm">
            <Link href="/manager-review">Open manager review</Link>
          </Button>
        ) : null}
      </div>
      <div className="grid gap-3 md:grid-cols-5">
        <SyncStatus label="Parsed rows" count={activeRows.length} state={activeRows.length ? "Done" : "Not run"} />
        <SyncStatus label="Standardized activities" count={activeRows.length} state={activeRows.length ? "Done" : "Not run"} />
        <SyncStatus
          label="Contacts"
          count={activeRows.filter((row) => row.contactRecordId).length}
          state={recap ? "Done" : "Unknown"}
          action={
            recap ? (
              <button type="button" disabled={isSyncingContacts} onClick={() => onSyncContacts(recap.id)}>
                {isSyncingContacts ? "Syncing" : "Sync"}
              </button>
            ) : null
          }
        />
        <SyncStatus
          label="Company matches"
          count={recap?.companyMatchSummary.matchedRows ?? 0}
          state={recap ? "Done" : "Unknown"}
          action={
            recap ? (
              <button type="button" disabled={isMatchingCompanies} onClick={() => onRerunCompanyMatching(recap.id)}>
                {isMatchingCompanies ? "Matching" : "Match"}
              </button>
            ) : null
          }
        />
        <SyncStatus
          label="Manager review queue"
          count={recap?.managerReviewItemCount ?? 0}
          state={recap?.managerReviewItemCount ? "Done" : recap ? "Needs attention" : "Unknown"}
          action={
            recap ? (
              <button type="button" disabled={isSyncingManagerReview} onClick={() => onSyncManagerReview(recap.id)}>
                {isSyncingManagerReview ? "Syncing" : "Sync"}
              </button>
            ) : null
          }
        />
      </div>
    </section>
  );
}

function StandardizedActivityCommandTable({
  rows,
  totalRows,
  selectedRows,
  search,
  sdrFilter,
  channelFilter,
  outcomeFilter,
  reviewFlagFilter,
  matchFilter,
  sdrOptions,
  channelOptions,
  isSavedMode,
  onSearchChange,
  onSdrFilterChange,
  onChannelFilterChange,
  onOutcomeFilterChange,
  onReviewFlagFilterChange,
  onMatchFilterChange,
  onClearFilters,
  onToggleRow,
}: {
  rows: StandardizedSdrActivityRow[];
  totalRows: number;
  selectedRows: Set<number>;
  search: string;
  sdrFilter: string;
  channelFilter: ChannelFilter;
  outcomeFilter: OutcomeFilter;
  reviewFlagFilter: ReviewFlagFilter;
  matchFilter: MatchFilter;
  sdrOptions: string[];
  channelOptions: ChannelFilter[];
  isSavedMode: boolean;
  onSearchChange: (value: string) => void;
  onSdrFilterChange: (value: string) => void;
  onChannelFilterChange: (value: ChannelFilter) => void;
  onOutcomeFilterChange: (value: OutcomeFilter) => void;
  onReviewFlagFilterChange: (value: ReviewFlagFilter) => void;
  onMatchFilterChange: (value: MatchFilter) => void;
  onClearFilters: () => void;
  onToggleRow: (rowIndex: number, checked: boolean) => void;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">
              Standardized Activity
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              All mapped activity rows ready for review.
            </p>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled>
              Column Visibility
            </Button>
            <Button type="button" variant="outline" size="icon" disabled>
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="grid gap-2 xl:grid-cols-[minmax(220px,1fr)_130px_140px_140px_140px_160px_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              className="h-9 rounded-lg border-slate-200 pl-8"
              placeholder="Search activities..."
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
            />
          </div>
          <FilterSelect value={sdrFilter} onChange={onSdrFilterChange}>
            <option value="all">SDR: All</option>
            {sdrOptions.map((sdr) => (
              <option key={sdr} value={sdr}>{sdr}</option>
            ))}
          </FilterSelect>
          <FilterSelect
            value={channelFilter}
            onChange={(value) => onChannelFilterChange(value as ChannelFilter)}
          >
            <option value="all">Channel: All</option>
            {channelOptions.map((channel) => (
              <option key={channel} value={channel}>{formatChannel(channel)}</option>
            ))}
          </FilterSelect>
          <FilterSelect
            value={outcomeFilter}
            onChange={(value) => onOutcomeFilterChange(value as OutcomeFilter)}
          >
            <option value="all">Outcome: All</option>
            <option value="positive">Positive</option>
            <option value="no_reply">No Reply</option>
            <option value="voicemail">Voicemail</option>
            <option value="not_interested">Not Interested</option>
            <option value="other">Other</option>
          </FilterSelect>
          <FilterSelect
            value={reviewFlagFilter}
            onChange={(value) => onReviewFlagFilterChange(value as ReviewFlagFilter)}
          >
            <option value="all">Review Flag: All</option>
            <option value="yes">Review Flag: Yes</option>
            <option value="no">Review Flag: No</option>
          </FilterSelect>
          <FilterSelect
            value={matchFilter}
            onChange={(value) => onMatchFilterChange(value as MatchFilter)}
          >
            <option value="all">Matched Status: All</option>
            <option value="matched">Matched</option>
            <option value="suggested">Suggested</option>
            <option value="no_match">Unmatched</option>
            <option value="ambiguous">Ambiguous</option>
          </FilterSelect>
          <Button type="button" variant="ghost" size="sm" onClick={onClearFilters}>
            Clear
          </Button>
        </div>
      </div>
      <div className="h-[min(58vh,640px)] overflow-auto">
        <Table className="min-w-[1220px]">
          <TableHeader className="sticky top-0 z-10 bg-slate-50">
            <TableRow>
              <TableHead className="w-10">
                <span className="sr-only">Select</span>
              </TableHead>
              <TableHead>SDR</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Activity Date</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead>Manager Review Flag</TableHead>
              <TableHead>Matched Company</TableHead>
              <TableHead>Matched Contact</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, 250).map((row) => (
              <TableRow key={`row-${row.rowIndex}`} className="h-14">
                <TableCell>
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300"
                    checked={selectedRows.has(row.rowIndex)}
                    onChange={(event) => onToggleRow(row.rowIndex, event.target.checked)}
                    aria-label={`Select row ${row.rowIndex}`}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <AvatarInitials name={row.sdrName} />
                    <span className="font-medium text-slate-900">{row.sdrName || "-"}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="max-w-44 truncate font-medium text-slate-900">{row.companyName || "-"}</div>
                  <div className="max-w-44 truncate text-xs text-slate-500">{row.website || ""}</div>
                </TableCell>
                <TableCell>
                  <div className="max-w-40 truncate text-slate-700">{row.leadName || "-"}</div>
                  <div className="max-w-40 truncate text-xs text-slate-500">{row.title || ""}</div>
                </TableCell>
                <TableCell>
                  <ChannelBadge channel={getPrimaryChannel(row)} />
                </TableCell>
                <TableCell className="text-xs text-slate-600">{row.activityDate || row.weekLabel || "-"}</TableCell>
                <TableCell>
                  <OutcomeBadge row={row} />
                </TableCell>
                <TableCell>
                  <div className="line-clamp-2 max-w-64 text-xs leading-5 text-slate-600">{row.noteCombined || "-"}</div>
                </TableCell>
                <TableCell>
                  <StateBadge label={row.managerReviewFlag ? "Yes" : "No"} tone={row.managerReviewFlag ? "danger" : "success"} />
                </TableCell>
                <TableCell>
                  <CompanyMatchBadge row={row} isSavedMode={isSavedMode} />
                </TableCell>
                <TableCell>
                  <StateBadge
                    label={row.contactRecordId ? "Matched" : isSavedMode ? "Unmatched" : "Unknown"}
                    tone={row.contactRecordId ? "success" : isSavedMode ? "danger" : "neutral"}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    {row.managerReviewItemId ? (
                      <Button asChild size="icon" variant="outline" className="h-8 w-8">
                        <Link href={`/manager-review/${row.managerReviewItemId}`}>
                          <Eye className="h-4 w-4" />
                        </Link>
                      </Button>
                    ) : (
                      <Button size="icon" variant="outline" className="h-8 w-8" disabled>
                        <Eye className="h-4 w-4" />
                      </Button>
                    )}
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8" disabled>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="py-8 text-center text-sm text-slate-500">
                  No rows match the current filters.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
        {rows.length > 250 ? (
          <div className="border-t bg-slate-50 px-4 py-3 text-xs text-slate-500">
            Showing first 250 rows of {rows.length.toLocaleString()} matching rows.
          </div>
        ) : null}
      </div>
      <div className="border-t border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
        Showing {rows.length.toLocaleString()} of {totalRows.toLocaleString()} rows.
      </div>
    </section>
  );
}

function SavedRecapHistory({
  recaps,
  isLoading,
  isOpening,
  selectedId,
  onRefresh,
  onOpen,
  onDelete,
  onMatchCompanies,
  onSyncContacts,
  onSyncManagerReview,
}: {
  recaps: SavedActivityRecapListItem[];
  isLoading: boolean;
  isOpening: boolean;
  selectedId?: string;
  onRefresh: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onMatchCompanies: (id: string) => void;
  onSyncContacts: (id: string) => void;
  onSyncManagerReview: (id: string) => void;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Saved recap history</h2>
          <p className="mt-1 text-xs text-slate-500">
            Persisted SDR activity uploads and downstream sync actions.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={isLoading}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {isLoading ? "Loading" : "Refresh"}
        </Button>
      </div>
      {recaps.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
          No saved recaps yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <Table className="min-w-[1080px]">
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>Rows</TableHead>
                <TableHead>SDRs</TableHead>
                <TableHead>Activities</TableHead>
                <TableHead>Manager Review</TableHead>
                <TableHead>Company Matches</TableHead>
                <TableHead>Contacts</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recaps.map((recap) => (
                <TableRow key={recap.id} className={selectedId === recap.id ? "bg-blue-50" : ""}>
                  <TableCell>
                    <div className="max-w-64 truncate font-semibold text-slate-900">{recap.fileName}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {formatDateTime(recap.createdAt)} · {recap.fileType?.toUpperCase() ?? "File"}
                    </div>
                  </TableCell>
                  <TableCell>{recap.totalRows.toLocaleString()}</TableCell>
                  <TableCell>{recap.sdrCount.toLocaleString()}</TableCell>
                  <TableCell>{recap.totalActivityCount.toLocaleString()}</TableCell>
                  <TableCell>
                    <div className="font-medium text-slate-900">{recap.managerReviewCount.toLocaleString()}</div>
                    <div className="text-xs text-slate-500">{recap.managerReviewItemCount.toLocaleString()} queue items</div>
                  </TableCell>
                  <TableCell className="text-xs text-slate-600">
                    {recap.companyMatchSummary.matchedRows.toLocaleString()} matched / {recap.companyMatchSummary.suggestedRows.toLocaleString()} suggested / {recap.companyMatchSummary.noMatchRows.toLocaleString()} none
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-slate-500">Open recap for contact counts</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button type="button" size="sm" variant={selectedId === recap.id ? "default" : "outline"} disabled={isOpening} onClick={() => onOpen(recap.id)}>
                        Open
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => onMatchCompanies(recap.id)}>
                        Match companies
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => onSyncContacts(recap.id)}>
                        Sync contacts
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => onSyncManagerReview(recap.id)}>
                        Sync review
                      </Button>
                      {recap.managerReviewCount > 0 ? (
                        <Button asChild size="sm" variant="outline">
                          <Link href="/manager-review">Open queue</Link>
                        </Button>
                      ) : null}
                      <Button type="button" size="icon" variant="ghost" onClick={() => onDelete(recap.id)}>
                        <Trash2 className="h-4 w-4 text-rose-600" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

function CommandCard({
  step,
  title,
  badge,
  children,
}: {
  step: string;
  title: string;
  badge: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700">
            {step}
          </span>
          <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
        </div>
        {badge}
      </div>
      {children}
    </section>
  );
}

function StatusMessage({ tone, message }: { tone: "success" | "danger"; message: string }) {
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border p-3 text-sm ${
        tone === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-rose-200 bg-rose-50 text-rose-700"
      }`}
    >
      {tone === "danger" ? <AlertTriangle className="mt-0.5 h-4 w-4" /> : <Check className="mt-0.5 h-4 w-4" />}
      <span>{message}</span>
    </div>
  );
}

function InfoSelect({ label, value }: { label: string; value: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <div className="mt-1 flex h-9 items-center justify-between rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700">
        <span className="truncate">{value}</span>
        <ChevronDown className="h-4 w-4 text-slate-400" />
      </div>
    </label>
  );
}

function SyncStatus({
  label,
  count,
  state,
  action,
}: {
  label: string;
  count: number;
  state: "Done" | "Not run" | "Needs attention" | "Unknown";
  action?: React.ReactNode;
}) {
  const tone = state === "Done" ? "success" : state === "Needs attention" ? "warning" : "neutral";
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-slate-500">{label}</div>
        <StateBadge label={state} tone={tone} />
      </div>
      <div className="mt-2 text-lg font-semibold text-slate-950">{count.toLocaleString()}</div>
      {action ? (
        <div className="mt-2 text-xs font-medium text-blue-700 [&_button]:text-blue-700">
          {action}
        </div>
      ) : null}
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {children}
    </select>
  );
}

function StateBadge({
  label,
  tone,
}: {
  label: string;
  tone: "success" | "warning" | "danger" | "info" | "neutral";
}) {
  const className =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : tone === "danger"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : tone === "info"
            ? "border-blue-200 bg-blue-50 text-blue-700"
            : "border-slate-200 bg-slate-100 text-slate-600";

  return (
    <Badge variant="outline" className={className}>
      {label}
    </Badge>
  );
}

function PillCount({ value, tone = "info" }: { value: number; tone?: "info" | "warning" }) {
  return (
    <TableCell className="text-center">
      <span
        className={`inline-flex min-w-10 justify-center rounded-full border px-2 py-0.5 text-xs font-semibold ${
          tone === "warning"
            ? "border-amber-200 bg-amber-50 text-amber-700"
            : "border-blue-200 bg-blue-50 text-blue-700"
        }`}
      >
        {value.toLocaleString()}
      </span>
    </TableCell>
  );
}

function ChannelBadge({ channel }: { channel: ChannelFilter }) {
  const tone =
    channel === "email"
      ? "info"
      : channel === "linkedin"
        ? "warning"
        : channel === "call" || channel === "whatsapp"
          ? "success"
          : "neutral";
  return <StateBadge label={formatChannel(channel)} tone={tone} />;
}

function OutcomeBadge({ row }: { row: StandardizedSdrActivityRow }) {
  const outcome = getOutcomeGroup(row);
  const label = formatOutcome(row);
  const tone =
    outcome === "positive"
      ? "success"
      : outcome === "voicemail"
        ? "warning"
        : outcome === "not_interested"
          ? "danger"
          : "neutral";
  return <StateBadge label={label} tone={tone} />;
}

function CompanyMatchBadge({
  row,
  isSavedMode,
}: {
  row: StandardizedSdrActivityRow;
  isSavedMode: boolean;
}) {
  if (!isSavedMode) {
    return <StateBadge label="Unknown" tone="neutral" />;
  }
  const status = row.companyMatchStatus ?? "no_match";
  return (
    <StateBadge
      label={status === "no_match" ? "Unmatched" : formatStatus(status)}
      tone={status === "matched" ? "success" : status === "suggested" || status === "ambiguous" ? "warning" : "danger"}
    />
  );
}

function AvatarInitials({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
      {initials || "SD"}
    </span>
  );
}

function EmptyWorkspaceState({ message }: { message: string }) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <FileSpreadsheet className="h-8 w-8 text-slate-400" />
      <div className="mt-3 text-sm font-medium text-slate-900">{message}</div>
    </div>
  );
}

function getStepState({
  parsedFile,
  mappedCount,
  activeRows,
  latestRecap,
}: {
  parsedFile: ParsedActivityFile | null;
  mappedCount: number;
  activeRows: StandardizedSdrActivityRow[];
  latestRecap: SavedActivityRecapDetail | SavedActivityRecapListItem | null;
}) {
  return [
    {
      label: "Upload Activity File",
      helper: "Upload CSV or Excel",
      state: parsedFile || latestRecap ? "complete" : "active",
    },
    {
      label: "Confirm Mapping",
      helper: "Map columns to Telestar",
      state: mappedCount > 0 || latestRecap ? "complete" : parsedFile ? "active" : "idle",
    },
    {
      label: "Create Review Queue",
      helper: "Review & approve activities",
      state: latestRecap?.managerReviewItemCount
        ? "complete"
        : activeRows.length
          ? "active"
          : "idle",
    },
  ] as Array<{ label: string; helper: string; state: "complete" | "active" | "idle" }>;
}

function buildRuleCounts(rows: StandardizedSdrActivityRow[]) {
  const counts = new Map<string, { reason: string; count: number; priority: string }>();
  rows.forEach((row) => {
    row.managerReviewReasons.forEach((reason) => {
      const current = counts.get(reason) ?? { reason, count: 0, priority: row.managerReviewPriority };
      current.count += 1;
      if (row.managerReviewPriority === "high") current.priority = "high";
      else if (row.managerReviewPriority === "medium" && current.priority !== "high") current.priority = "medium";
      counts.set(reason, current);
    });
  });
  return Array.from(counts.values()).sort((a, b) => b.count - a.count);
}

function getPrimaryChannel(row: StandardizedSdrActivityRow): ChannelFilter {
  if (row.emailCount > 0 || row.emailStageNormalized !== "none") return "email";
  if (row.linkedinCount > 0 || row.linkedinStageNormalized !== "none") return "linkedin";
  if (row.callCount > 0 || row.callStageNormalized !== "none") return "call";
  if (row.otherChannelNormalized === "whatsapp") return "whatsapp";
  return "other";
}

function getOutcomeGroup(row: StandardizedSdrActivityRow): OutcomeFilter {
  const text = [
    row.linkedinStageNormalized,
    row.emailStageNormalized,
    row.callStageNormalized,
    row.otherChannelNormalized,
    row.meetingStatus,
    row.channelResponded,
    row.noteCombined,
  ]
    .join(" ")
    .toLowerCase();
  if (/\b(replied|reply|positive|meeting|pickup|callback|connected)\b/.test(text)) return "positive";
  if (/\b(no reply|sent|message|none)\b/.test(text)) return "no_reply";
  if (/\b(voicemail|no_pick_up|no pick up)\b/.test(text)) return "voicemail";
  if (/\b(not_interested|not interested|bad)\b/.test(text)) return "not_interested";
  return "other";
}

function formatOutcome(row: StandardizedSdrActivityRow) {
  const outcome = getOutcomeGroup(row);
  if (outcome === "positive") return "Positive Reply";
  if (outcome === "no_reply") return "No Reply";
  if (outcome === "voicemail") return "Left Voicemail";
  if (outcome === "not_interested") return "Not Interested";
  return "Other";
}

function formatChannel(channel: ChannelFilter) {
  if (channel === "linkedin") return "LinkedIn Message";
  if (channel === "whatsapp") return "WhatsApp";
  return channel.charAt(0).toUpperCase() + channel.slice(1);
}

function formatFieldLabel(field: CanonicalActivityField) {
  return (
    canonicalActivityFields.find((item) => item.field === field)?.label ??
    field.replace(/([A-Z])/g, " $1")
  );
}

function formatStatus(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
