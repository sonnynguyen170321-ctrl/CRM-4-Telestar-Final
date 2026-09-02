"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ExternalLink,
  ChevronRight,
  MoreHorizontal,
  RotateCcw,
  Trash2,
} from "lucide-react";

import { CompanyRowDetailDialog } from "@/components/companies/CompanyRowDetailDialog";
import { CompanyReviewDrawer } from "@/components/companies/CompanyReviewDrawer";
import {
  formatAiAgreementLabel,
  formatAiConfidence,
  getCompanyBrief,
  getAiDisplayState,
  getRuleAiComparisonForCompany,
  getSignalLabels,
  type CompanyReviewRow,
} from "@/components/companies/companyReviewUtils";
import {
  CompanyTypeBadge,
  QualificationBadge,
  StatusBadge,
} from "@/components/shared/statusBadges";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  archiveCompanyRecord,
  getCompanyRecordDetail,
  hardDeleteCompanyRecord,
  rerunCompanyLocalScoring,
  rerunCompanyWebsiteResearch,
  restoreCompanyRecord,
  softDeleteCompanyRecord,
  type CompanyRecordDetail,
} from "@/lib/client/companyRecords";

export function CompanyReviewTable({
  companies,
}: {
  companies: CompanyReviewRow[];
}) {
  const router = useRouter();
  const [selectedCompany, setSelectedCompany] =
    useState<CompanyReviewRow | null>(null);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(
    () => new Set()
  );
  const [selectionAmount, setSelectionAmount] = useState("25");
  const [reviewQueue, setReviewQueue] = useState<CompanyReviewRow[]>([]);
  const [detail, setDetail] = useState<CompanyRecordDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rerunStatus, setRerunStatus] = useState<string | null>(null);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const currentReviewIndex = selectedCompany
    ? reviewQueue.findIndex(
        (company) => company.companyRecordId === selectedCompany.companyRecordId
      )
    : -1;
  const selectedCount = selectedRowIds.size;
  const visibleCount = companies.length;

  async function handleViewDetails(company: CompanyReviewRow) {
    setActionStatus(`Loading details for ${company.companyName}...`);
    setActionError(null);

    try {
      const rowDetail = await getCompanyRecordDetail(company.companyRecordId);
      setDetail(rowDetail);
      setDetailOpen(true);
      setRerunStatus(null);
      setRerunError(null);
      setActionStatus(null);
    } catch (error) {
      setActionStatus(null);
      setActionError(
        error instanceof Error ? error.message : "Company row details failed."
      );
    }
  }

  async function runRowAction({
    actionLabel,
    successLabel,
    action,
  }: {
    actionLabel: string;
    successLabel: string;
    action: () => Promise<unknown>;
  }) {
    setActionStatus(actionLabel);
    setActionError(null);

    try {
      await action();
      setActionStatus(successLabel);
      router.refresh();
    } catch (error) {
      setActionStatus(null);
      setActionError(
        error instanceof Error ? error.message : "Company row action failed."
      );
    }
  }

  function handleArchive(company: CompanyReviewRow) {
    if (!window.confirm(`Archive ${company.companyName}?`)) {
      return;
    }

    void runRowAction({
      actionLabel: `Archiving ${company.companyName}...`,
      successLabel: `${company.companyName} archived.`,
      action: () => archiveCompanyRecord(company.companyRecordId),
    });
  }

  function handleRestore(company: CompanyReviewRow) {
    void runRowAction({
      actionLabel: `Restoring ${company.companyName}...`,
      successLabel: `${company.companyName} restored.`,
      action: () => restoreCompanyRecord(company.companyRecordId),
    });
  }

  function handleSoftDelete(company: CompanyReviewRow) {
    if (
      !window.confirm(
        "This hides the company row from active review but keeps audit history."
      )
    ) {
      return;
    }

    void runRowAction({
      actionLabel: `Soft deleting ${company.companyName}...`,
      successLabel: `${company.companyName} hidden from active review.`,
      action: () => softDeleteCompanyRecord(company.companyRecordId),
    });
  }

  function handleHardDelete(company: CompanyReviewRow) {
    const typed = window.prompt(
      "This permanently removes this company record and linked score results, website research results, and feedback examples. This cannot be undone. Type DELETE to continue."
    );

    if (typed !== "DELETE") {
      return;
    }

    void runRowAction({
      actionLabel: `Hard deleting ${company.companyName}...`,
      successLabel: `${company.companyName} permanently deleted.`,
      action: () => hardDeleteCompanyRecord(company.companyRecordId),
    });
  }

  function handleReview(company: CompanyReviewRow) {
    const clickedSelected = selectedRowIds.has(company.companyRecordId);
    const selectedCompanies = companies.filter((row) =>
      selectedRowIds.has(row.companyRecordId)
    );
    const nextQueue =
      clickedSelected && selectedCompanies.length > 0
        ? selectedCompanies
        : companies;

    setReviewQueue(nextQueue);
    setSelectedCompany(company);
  }

  function handleToggleSelected(companyRecordId: string, checked: boolean) {
    setSelectedRowIds((current) => {
      const next = new Set(current);

      if (checked) {
        next.add(companyRecordId);
      } else {
        next.delete(companyRecordId);
      }

      return next;
    });
  }

  function handleSelectAmount() {
    const parsedAmount = Number(selectionAmount);
    const requestedAmount = Number.isFinite(parsedAmount)
      ? Math.max(25, Math.floor(parsedAmount))
      : 25;
    const cappedAmount = Math.min(requestedAmount, companies.length);

    setSelectionAmount(String(requestedAmount));
    setSelectedRowIds(
      new Set(
        companies
          .slice(0, cappedAmount)
          .map((company) => company.companyRecordId)
      )
    );
  }

  function handleSelectAllVisible() {
    setSelectedRowIds(
      new Set(companies.map((company) => company.companyRecordId))
    );
  }

  function handleClearSelection() {
    setSelectedRowIds(new Set());
  }

  function handlePreviousReview() {
    if (currentReviewIndex <= 0) {
      return;
    }

    setSelectedCompany(reviewQueue[currentReviewIndex - 1] ?? null);
  }

  function handleNextReview() {
    if (
      currentReviewIndex < 0 ||
      currentReviewIndex >= reviewQueue.length - 1
    ) {
      return;
    }

    setSelectedCompany(reviewQueue[currentReviewIndex + 1] ?? null);
  }

  async function handleRerunWebsiteResearch() {
    if (!detail) {
      return;
    }

    setRerunStatus("Re-running website research...");
    setRerunError(null);

    try {
      await rerunCompanyWebsiteResearch(detail.companyRecord.id);
      const rowDetail = await getCompanyRecordDetail(detail.companyRecord.id);
      setDetail(rowDetail);
      setRerunStatus("Website research rerun saved.");
      router.refresh();
    } catch (error) {
      setRerunStatus(null);
      setRerunError(
        error instanceof Error ? error.message : "Website research failed."
      );
    }
  }

  async function handleRerunLocalScoring() {
    if (!detail) {
      return;
    }

    if (
      !window.confirm(
        "This creates a new predicted score result. Existing SDR feedback will remain unchanged."
      )
    ) {
      return;
    }

    setRerunStatus("Re-running local scoring...");
    setRerunError(null);

    try {
      await rerunCompanyLocalScoring(detail.companyRecord.id);
      const rowDetail = await getCompanyRecordDetail(detail.companyRecord.id);
      setDetail(rowDetail);
      setRerunStatus("Local scoring rerun saved.");
      router.refresh();
    } catch (error) {
      setRerunStatus(null);
      setRerunError(
        error instanceof Error ? error.message : "Local scoring failed."
      );
    }
  }

  return (
    <>
      {(actionStatus || actionError) && (
        <div
          className={`rounded-md border p-3 text-sm ${
            actionError
              ? "border-destructive/40 bg-destructive/5 text-destructive"
              : "bg-muted/30 text-muted-foreground"
          }`}
        >
          {actionError ?? actionStatus}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-900">
            Review queue
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
            {selectedCount} selected
          </span>
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
            {visibleCount} visible
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs font-medium text-slate-500">
            Select first
            <input
              type="number"
              min={25}
              max={visibleCount || 25}
              value={selectionAmount}
              onChange={(event) => setSelectionAmount(event.target.value)}
              className="h-8 w-20 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 shadow-sm"
            />
          </label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleSelectAmount}
            disabled={visibleCount === 0}
            className="h-8 rounded-lg border-slate-200 bg-white px-3"
          >
            Select amount
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleSelectAllVisible}
            disabled={visibleCount === 0}
            className="h-8 rounded-lg border-slate-200 bg-white px-3"
          >
            Select all visible
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={handleClearSelection}
            disabled={selectedCount === 0}
            className="h-8 rounded-lg px-3"
          >
            Clear
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
      <Table className="min-w-[940px]">
        <TableHeader className="bg-slate-50">
          <TableRow className="border-slate-200">
            <TableHead className="w-10">
              <span className="sr-only">Select</span>
            </TableHead>
            <TableHead className="min-w-[280px] text-xs font-semibold text-slate-500">
              Company
            </TableHead>
            <TableHead className="min-w-[150px] text-xs font-semibold text-slate-500">
              Fit
            </TableHead>
            <TableHead className="min-w-[150px] text-xs font-semibold text-slate-500">
              Type
            </TableHead>
            <TableHead className="min-w-[280px] text-xs font-semibold text-slate-500">
              Research / AI
            </TableHead>
            <TableHead className="min-w-[130px] text-xs font-semibold text-slate-500">
              Review
            </TableHead>
            <TableHead className="min-w-[120px] text-right text-xs font-semibold text-slate-500">
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {companies.map((company) => (
            <CompanyRow
              key={company.companyRecordId}
              company={company}
              selected={selectedRowIds.has(company.companyRecordId)}
              onSelectedChange={(checked) =>
                handleToggleSelected(company.companyRecordId, checked)
              }
              onReview={() => handleReview(company)}
              onViewDetails={() => void handleViewDetails(company)}
              onArchive={() => handleArchive(company)}
              onRestore={() => handleRestore(company)}
              onSoftDelete={() => handleSoftDelete(company)}
              onHardDelete={() => handleHardDelete(company)}
            />
          ))}
        </TableBody>
      </Table>
      </div>

      <CompanyReviewDrawer
        company={selectedCompany}
        open={selectedCompany !== null}
        queuePosition={
          currentReviewIndex >= 0
            ? {
                current: currentReviewIndex + 1,
                total: reviewQueue.length,
              }
            : null
        }
        canGoPrevious={currentReviewIndex > 0}
        canGoNext={
          currentReviewIndex >= 0 && currentReviewIndex < reviewQueue.length - 1
        }
        onPrevious={handlePreviousReview}
        onNext={handleNextReview}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedCompany(null);
            setReviewQueue([]);
          }
        }}
      />

      <CompanyRowDetailDialog
        detail={detail}
        open={detailOpen}
        rerunStatus={rerunStatus}
        rerunError={rerunError}
        onRerunWebsiteResearch={() => void handleRerunWebsiteResearch()}
        onRerunLocalScoring={() => void handleRerunLocalScoring()}
        onOpenChange={(open) => {
          setDetailOpen(open);

          if (!open) {
            setDetail(null);
            setRerunStatus(null);
            setRerunError(null);
          }
        }}
      />
    </>
  );
}

function CompanyAvatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-violet-600 text-xs font-semibold text-white shadow-sm">
      {initials || "CO"}
    </div>
  );
}

function ScoreRing({ score }: { score: number | null }) {
  const tone =
    score === null
      ? "border-slate-200 text-slate-500"
      : score >= 70
        ? "border-emerald-400 text-emerald-700"
        : score >= 50
          ? "border-amber-400 text-amber-700"
          : "border-rose-400 text-rose-700";

  return (
    <div
      className={`flex h-8 w-8 items-center justify-center rounded-full border-2 bg-white text-xs font-semibold ${tone}`}
    >
      {score ?? "-"}
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number | null }) {
  if (confidence === null) {
    return <StatusBadge tone="neutral">No score</StatusBadge>;
  }

  const percent = Math.round(confidence * 100);
  const label = percent >= 80 ? "High" : percent >= 55 ? "Medium" : "Low";
  const tone = percent >= 80 ? "success" : percent >= 55 ? "warning" : "danger";

  return (
    <div className="space-y-1">
      <StatusBadge tone={tone}>{label}</StatusBadge>
      <p className="text-xs text-slate-500">{percent}%</p>
    </div>
  );
}

function WebsiteResearchBadge({ company }: { company: CompanyReviewRow }) {
  const research = company.websiteResearch;

  if (!research) {
    return <StatusBadge tone="neutral">No research</StatusBadge>;
  }

  if (!research.reachable || research.status === "failed") {
    return <StatusBadge tone="danger">Offline</StatusBadge>;
  }

  const quality = research.quality?.toLowerCase();

  if (quality === "strong" || quality === "high") {
    return <StatusBadge tone="success">Strong</StatusBadge>;
  }

  if (quality === "weak" || quality === "low") {
    return <StatusBadge tone="warning">Weak</StatusBadge>;
  }

  return <StatusBadge tone="info">{research.status || "Researched"}</StatusBadge>;
}

function CompanyRow({
  company,
  selected,
  onSelectedChange,
  onReview,
  onViewDetails,
  onArchive,
  onRestore,
  onSoftDelete,
  onHardDelete,
}: {
  company: CompanyReviewRow;
  selected: boolean;
  onSelectedChange: (checked: boolean) => void;
  onReview: () => void;
  onViewDetails: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onSoftDelete: () => void;
  onHardDelete: () => void;
}) {
  const feedback = company.latestFeedbackExample;
  const isArchived = Boolean(company.archivedAt);
  const isDeleted = Boolean(company.deletedAt);
  const score = feedback?.finalCompanyScore ?? company.scoreResult?.companyScore;
  const qualification =
    feedback?.finalQualification ?? company.scoreResult?.qualification;
  const companyType = feedback?.finalCompanyType ?? company.scoreResult?.companyType;
  const confidence = company.scoreResult?.confidence ?? null;
  const brief = getCompanyBrief(company);
  const signalLabels = getSignalLabels(company.websiteResearch?.signalsJson);

  return (
    <TableRow className="h-[72px] border-b border-slate-100 bg-white hover:bg-blue-50/40">
      <TableCell className="align-middle">
        <input
          type="checkbox"
          aria-label={`Select ${company.companyName}`}
          checked={selected}
          onChange={(event) => onSelectedChange(event.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
      </TableCell>
      <TableCell className="align-middle">
        <div className="flex items-center gap-3">
          <CompanyAvatar name={company.companyName} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-semibold text-slate-950">
                {company.companyName}
              </span>
              {isDeleted ? (
                <StatusBadge tone="danger">deleted</StatusBadge>
              ) : isArchived ? (
                <StatusBadge tone="warning">archived</StatusBadge>
              ) : null}
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
              {company.website ? (
                <a
                  href={normalizeExternalHref(company.website)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex max-w-36 items-center gap-1 truncate font-medium text-blue-700 hover:underline"
                >
                  <span className="truncate">{company.website}</span>
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              ) : (
                <span>No website</span>
              )}
              <span>{company.companyCountry || "No country"}</span>
            </div>
            <p className="mt-1 truncate text-xs text-slate-500">
              {company.companyIndustry || "Industry not provided"}
            </p>
          </div>
        </div>
      </TableCell>
      <TableCell className="align-middle">
        <div className="flex items-center gap-2">
          <ScoreRing score={score ?? null} />
          <div className="space-y-1">
            <QualificationBadge qualification={qualification ?? "unscored"} />
            <ConfidenceBadge confidence={confidence} />
          </div>
        </div>
      </TableCell>
      <TableCell className="align-middle">
        <div className="space-y-1">
          {companyType ? (
            <CompanyTypeBadge companyType={companyType} />
          ) : (
            <span className="text-xs text-slate-500">No type</span>
          )}
          <p className="text-xs text-slate-500">
            {feedback ? "SDR final" : company.scoreResult?.scoringSource ?? "Local"}
          </p>
        </div>
      </TableCell>
      <TableCell className="align-middle">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            <WebsiteResearchBadge company={company} />
            <CompanyAiQueueBadge company={company} />
          </div>
          <p className="line-clamp-1 max-w-72 text-xs leading-5 text-slate-500">
            {brief}
          </p>
          {signalLabels.length > 0 && (
            <p className="truncate text-xs text-slate-400">
              Signals: {signalLabels.slice(0, 4).join(", ")}
            </p>
          )}
        </div>
      </TableCell>
      <TableCell className="align-middle">
        {feedback ? (
          <div className="space-y-1">
            <StatusBadge tone="info">Reviewed</StatusBadge>
          </div>
        ) : company.scoreResult ? (
          <StatusBadge
            tone={
              company.scoreResult.reviewState === "reviewed" ? "info" : "neutral"
            }
          >
            {company.scoreResult.reviewState}
          </StatusBadge>
        ) : (
          <span className="text-sm text-muted-foreground">Unscored</span>
        )}
      </TableCell>
      <TableCell className="align-middle">
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            size="sm"
            onClick={onReview}
            className="h-8 rounded-lg bg-white px-3 text-slate-700 shadow-sm hover:bg-slate-50"
            variant="outline"
          >
            Review
            <ChevronRight className="ml-1 h-3 w-3" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="icon" variant="ghost" className="h-8 w-8 rounded-lg text-slate-500 hover:bg-slate-100">
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Open row actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onViewDetails}>
                View full details
              </DropdownMenuItem>
              {isArchived || isDeleted ? (
                <DropdownMenuItem onClick={onRestore}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Restore row
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={onArchive}>
                  <Archive className="mr-2 h-4 w-4" />
                  Archive row
                </DropdownMenuItem>
              )}
              {!isDeleted && (
                <DropdownMenuItem onClick={onSoftDelete}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Soft delete
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onHardDelete}
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
  );
}

function normalizeExternalHref(value: string) {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function CompanyAiQueueBadge({ company }: { company: CompanyReviewRow }) {
  const assessment = company.latestAiAssessment;
  const job = company.latestAiJob;
  const displayState = getAiDisplayState({
    latestAiAssessment: assessment,
    latestAiJob: job,
  });

  if (assessment) {
    const comparison = getRuleAiComparisonForCompany(company);

    return (
      <div className="max-w-48 space-y-1">
        <StatusBadge tone="success">{displayState.label}</StatusBadge>
        <p className="truncate text-xs font-medium text-slate-700">
          {formatQualificationForDisplay(assessment.qualification)} /{" "}
          {formatAiConfidence(assessment.confidence)}
        </p>
        <p className="truncate text-xs text-slate-500">
          {formatAiAgreementLabel(comparison)}
        </p>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="max-w-48 space-y-1">
        <StatusBadge tone="neutral">{displayState.label}</StatusBadge>
        <p className="truncate text-xs text-slate-500">
          {displayState.shortSummary}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-48 space-y-1">
      <StatusBadge tone={getAiDisplayTone(displayState.tone)}>
        {displayState.label}
      </StatusBadge>
      <p
        className={`truncate text-xs ${
          displayState.tone === "rose" ? "text-rose-600" : "text-slate-500"
        }`}
      >
        {displayState.shortSummary}
      </p>
      {job.attemptCount !== undefined && job.maxAttempts !== undefined ? (
        <p className="truncate text-xs text-slate-400">
          Attempt {job.attemptCount}/{job.maxAttempts}
        </p>
      ) : null}
    </div>
  );
}

function getAiDisplayTone(tone: "slate" | "blue" | "amber" | "rose" | "green") {
  if (tone === "green") return "success";
  if (tone === "rose") return "danger";
  if (tone === "amber") return "warning";
  if (tone === "blue") return "info";

  return "neutral";
}

function formatQualificationForDisplay(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
