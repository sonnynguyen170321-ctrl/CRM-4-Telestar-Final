"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  Bot,
  CheckCircle2,
  Download,
  ExternalLink,
  Globe2,
  PlayCircle,
  Search,
  SlidersHorizontal,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LocalFeedbackPanel } from "@/components/uploads/LocalFeedbackPanel";
import {
  CompanyTypeBadge,
  QualificationBadge,
  ScoreBadge,
  StatusBadge,
} from "@/components/shared/statusBadges";
import { createCompanyScoreResultsForRecords } from "@/lib/client/companyScoreResults";
import {
  scoreUncertainRowsWithAi,
  type AiScoreUncertainSummary,
} from "@/lib/client/uploadJobs";
import {
  buildInitialWebsiteResearchSummary,
  getCompletedWebsiteResearchStatus,
  scoreRowsWithPersistedWebsiteResearch,
  type ScoredUploadRow,
  type WebsiteResearchSummary,
} from "@/lib/client/uploadScoring";
import type { ParsedCsvRow } from "@/lib/csv";
import {
  exportCompanyResultsToCsv,
  getCompanyResultsExportFilename,
} from "@/lib/export";
import {
  createLocalFeedback,
  getLocalFeedbackKey,
  type LocalFeedbackExample,
} from "@/lib/feedback";
import { saveUploadReviewFeedback } from "@/lib/client/feedbackExamples";
import type { CompanyScoreResult } from "@/lib/types";

type LocalScoringPreviewProps = {
  rows: ParsedCsvRow[];
  uploadJobId: string | null;
  companyRecordIdsByRowIndex: Record<number, string>;
  persistedSourceRowIndexes: number[];
};

type ScorePersistenceStatus = "idle" | "saving" | "saved" | "failed" | "skipped";
type AiAssessmentStatus = "idle" | "running" | "queued" | "skipped" | "failed";
type ReviewQueueFilter =
  | "all"
  | "needs_review"
  | "reviewed"
  | "qualified"
  | "unqualified"
  | "uncertain"
  | "ai_checked"
  | "research_failed";
type ReviewDensity = "comfortable" | "compact";
type WebsiteResearchPersistenceStatus =
  | "idle"
  | "running"
  | "saved"
  | "partial"
  | "failed"
  | "skipped";

type ReviewQueueRow = {
  result: CompanyScoreResult;
  feedbackKey: string;
  savedFeedback?: LocalFeedbackExample;
  reviewState: CompanyScoreResult["review_state"] | "reviewed";
  sourceRowIndex?: number;
  companyRecordId?: string;
  aiStatus: "scored" | "queued" | "skipped" | "failed" | "not_run";
  aiReason?: string;
  hasResearchIssue: boolean;
  brief: string;
};

export function LocalScoringPreview({
  rows,
  uploadJobId,
  companyRecordIdsByRowIndex,
  persistedSourceRowIndexes,
}: LocalScoringPreviewProps) {
  const [results, setResults] = useState<CompanyScoreResult[]>([]);
  const [selectedResult, setSelectedResult] =
    useState<CompanyScoreResult | null>(null);
  const [feedbackByCompany, setFeedbackByCompany] = useState<
    Record<string, LocalFeedbackExample>
  >({});
  const [scorePersistenceStatus, setScorePersistenceStatus] =
    useState<ScorePersistenceStatus>("idle");
  const [savedScoreResultCount, setSavedScoreResultCount] = useState(0);
  const [scoreResultIdsByRowIndex, setScoreResultIdsByRowIndex] = useState<
    Record<number, string>
  >({});
  const [sourceRowIndexByFeedbackKey, setSourceRowIndexByFeedbackKey] =
    useState<Record<string, number>>({});
  const [scorePersistenceError, setScorePersistenceError] = useState<
    string | null
  >(null);
  const [aiAssessmentStatus, setAiAssessmentStatus] =
    useState<AiAssessmentStatus>("idle");
  const [aiAssessmentSummary, setAiAssessmentSummary] =
    useState<AiScoreUncertainSummary | null>(null);
  const [aiAssessmentError, setAiAssessmentError] = useState<string | null>(
    null
  );
  const [websiteResearchStatus, setWebsiteResearchStatus] =
    useState<WebsiteResearchPersistenceStatus>("idle");
  const [websiteResearchSummary, setWebsiteResearchSummary] =
    useState<WebsiteResearchSummary>({
      attempted: 0,
      saved: 0,
      failed: 0,
      skipped: 0,
      processed: 0,
      errors: [],
    });
  const [reviewSearch, setReviewSearch] = useState("");
  const [reviewFilter, setReviewFilter] = useState<ReviewQueueFilter>("all");
  const [density, setDensity] = useState<ReviewDensity>("compact");

  const feedbackList = useMemo(
    () => Object.values(feedbackByCompany),
    [feedbackByCompany]
  );

  const summary = useMemo(
    () => ({
      total: results.length,
      unqualified: results.filter(
        (result) => result.qualification === "unqualified"
      ).length,
      uncertain: results.filter((result) => result.qualification === "uncertain")
        .length,
      qualified: results.filter((result) => result.qualification === "qualified")
        .length,
      needsReview: results.filter((result) => result.review_state === "needs_review")
        .length,
    }),
    [results]
  );

  const feedbackSummary = useMemo(
    () => ({
      total: feedbackList.length,
      qualified: feedbackList.filter(
        (feedback) => feedback.final_qualification === "qualified"
      ).length,
      unqualified: feedbackList.filter(
        (feedback) => feedback.final_qualification === "unqualified"
      ).length,
      uncertain: feedbackList.filter(
        (feedback) => feedback.final_qualification === "uncertain"
      ).length,
    }),
    [feedbackList]
  );

  const reviewRows = useMemo(
    () =>
      results.map((result) => {
        const feedbackKey = getLocalFeedbackKey(result);
        const sourceRowIndex = sourceRowIndexByFeedbackKey[feedbackKey];
        const companyRecordId =
          sourceRowIndex === undefined
            ? undefined
            : companyRecordIdsByRowIndex[sourceRowIndex];
        const aiResult = companyRecordId
          ? aiAssessmentSummary?.results.find(
              (item) => item.companyRecordId === companyRecordId
            )
          : undefined;
        const aiQueued =
          !aiResult &&
          aiAssessmentSummary &&
          !aiAssessmentSummary.skipped &&
          (aiAssessmentSummary.enqueued ?? 0) > 0;
        const savedFeedback = feedbackByCompany[feedbackKey];

        return {
          result,
          feedbackKey,
          savedFeedback,
          reviewState: savedFeedback ? "reviewed" : result.review_state,
          sourceRowIndex,
          companyRecordId,
          aiStatus: aiResult?.status ?? (aiQueued ? "queued" : "not_run"),
          aiReason: aiResult?.reason,
          hasResearchIssue: hasWebsiteResearchIssue(result),
          brief: getCompanyBrief(result),
        } satisfies ReviewQueueRow;
      }),
    [
      aiAssessmentSummary,
      companyRecordIdsByRowIndex,
      feedbackByCompany,
      results,
      sourceRowIndexByFeedbackKey,
    ]
  );

  const filteredReviewRows = useMemo(
    () =>
      reviewRows.filter((row) => {
        const search = reviewSearch.trim().toLowerCase();
        const result = row.result;
        const matchesSearch =
          search.length === 0 ||
          [
            result.company_name,
            result.website,
            result.company_country,
            row.brief,
          ]
            .filter(Boolean)
            .some((value) => value?.toLowerCase().includes(search));

        return matchesSearch && matchesReviewFilter(row, reviewFilter);
      }),
    [reviewFilter, reviewRows, reviewSearch]
  );

  const selectedReviewRow =
    (selectedResult &&
      reviewRows.find(
        (row) => row.feedbackKey === getLocalFeedbackKey(selectedResult)
      )) ||
    filteredReviewRows[0] ||
    reviewRows[0] ||
    null;

  async function runLocalScoring() {
    const hasCompanyRecordIds = rows.every(
      (_row, index) =>
        !persistedSourceRowIndexes.includes(index) ||
        companyRecordIdsByRowIndex[index]
    );
    const hasPersistedRows = persistedSourceRowIndexes.length > 0;
    const canPersistWebsiteResearch = hasCompanyRecordIds;
    const initialResearchSummary = buildInitialWebsiteResearchSummary(
      getPersistedRows(rows, persistedSourceRowIndexes)
    );

    setResults([]);
    setSelectedResult(null);
    setFeedbackByCompany({});
    setSavedScoreResultCount(0);
    setScoreResultIdsByRowIndex({});
    setSourceRowIndexByFeedbackKey({});
    setScorePersistenceError(null);
    setScorePersistenceStatus("idle");
    setAiAssessmentStatus("idle");
    setAiAssessmentSummary(null);
    setAiAssessmentError(null);
    setWebsiteResearchSummary(initialResearchSummary);
    setWebsiteResearchStatus(
      canPersistWebsiteResearch && initialResearchSummary.attempted > 0
        ? "running"
        : "skipped"
    );

    const { scoredRows, researchSummary } =
      await scoreRowsWithPersistedWebsiteResearch({
        rows,
        uploadJobId,
        companyRecordIdsByRowIndex,
        canPersistWebsiteResearch,
        persistedSourceRowIndexes,
        onProgress: setWebsiteResearchSummary,
      });

    setWebsiteResearchSummary(researchSummary);
    setWebsiteResearchStatus(getCompletedWebsiteResearchStatus(researchSummary));
    const scoredResults = scoredRows.map(({ result }) => result);
    setResults(scoredResults);
    setSourceRowIndexByFeedbackKey(
      Object.fromEntries(
        scoredRows.map(({ result, sourceRowIndex }) => [
          getLocalFeedbackKey(result),
          sourceRowIndex,
        ])
      ) as Record<string, number>
    );

    if (!hasCompanyRecordIds || !hasPersistedRows) {
      setScorePersistenceStatus("skipped");
      return;
    }

    setScorePersistenceStatus("saving");

    try {
      const savedScoreResults = await createCompanyScoreResultsForRecords({
        scoredRows: toScorePersistenceRows(scoredRows),
        companyRecordIdsByRowIndex,
      });

      setSavedScoreResultCount(savedScoreResults.count);
      setScoreResultIdsByRowIndex(savedScoreResults.idsBySourceRowIndex);
      setScorePersistenceStatus("saved");

      if (uploadJobId) {
        setAiAssessmentStatus("running");

        try {
          const summary = await scoreUncertainRowsWithAi(uploadJobId);

          setAiAssessmentSummary(summary);
          setAiAssessmentStatus(summary.skipped ? "skipped" : "queued");
        } catch (error) {
          setAiAssessmentError(
            error instanceof Error
              ? error.message
              : "AI assessment pass failed."
          );
          setAiAssessmentStatus("failed");
        }
      }
    } catch (error) {
      setScorePersistenceError(
        error instanceof Error
          ? error.message
          : "Score result save failed."
      );
      setScorePersistenceStatus("failed");
    }
  }

  async function saveLocalFeedback(
    company: CompanyScoreResult,
    correction: {
      final_company_score: number;
      final_company_type: CompanyScoreResult["type"];
      final_qualification: CompanyScoreResult["qualification"];
      final_note: string;
    }
  ) {
    if (!uploadJobId) {
      throw new Error("Save company rows first before saving SDR feedback.");
    }

    const feedbackKey = getLocalFeedbackKey(company);
    const sourceRowIndex = sourceRowIndexByFeedbackKey[feedbackKey];
    const companyRecordId = companyRecordIdsByRowIndex[sourceRowIndex];
    const companyScoreResultId = scoreResultIdsByRowIndex[sourceRowIndex];

    if (sourceRowIndex === undefined || !companyRecordId) {
      throw new Error("Save company rows first before saving SDR feedback.");
    }

    const savedFeedback = await saveUploadReviewFeedback({
      uploadJobId,
      companyRecordId,
      companyScoreResultId,
      sourceRowIndex,
      company,
      finalQualification: correction.final_qualification,
      finalCompanyType: correction.final_company_type,
      finalCompanyScore: correction.final_company_score,
      finalNote: correction.final_note,
    });
    const feedback = createLocalFeedback({
      company,
      ...correction,
      id: savedFeedback.id,
    });

    setFeedbackByCompany((current) => ({
      ...current,
      [feedbackKey]: feedback,
    }));
  }

  function exportScoredCsv() {
    const csv = exportCompanyResultsToCsv({
      results,
      feedbackByCompany,
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = getCompanyResultsExportFilename();
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card className="rounded-md">
      <CardHeader>
        <CardTitle className="text-base">Research and scoring run</CardTitle>
        <CardDescription>
          Runs website research, local hard rules, and optional AI assessment
          when AI is enabled. AI suggestions stay separate from local score
          results and SDR feedback.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 md:grid-cols-5">
          <SummaryMetric label="Total rows" value={summary.total} />
          <SummaryMetric label="Unqualified" value={summary.unqualified} />
          <SummaryMetric label="Uncertain" value={summary.uncertain} />
          <SummaryMetric label="Qualified" value={summary.qualified} />
          <SummaryMetric label="Needs review" value={summary.needsReview} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={runLocalScoring}
            disabled={
              websiteResearchStatus === "running" ||
              scorePersistenceStatus === "saving"
            }
          >
            <PlayCircle className="h-4 w-4" />
            {websiteResearchStatus === "running"
              ? "Researching websites"
              : "Run"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={exportScoredCsv}
            disabled={results.length === 0}
          >
            <Download className="h-4 w-4" />
            Export scored CSV
          </Button>
          <p className="text-sm text-muted-foreground">
            Saved rows are researched first, then scored with the persisted
            website evidence.
          </p>
        </div>

        <WebsiteResearchStatusMessage
          status={websiteResearchStatus}
          summary={websiteResearchSummary}
        />

        <ScorePersistenceStatusMessage
          status={scorePersistenceStatus}
          savedCount={savedScoreResultCount}
          error={scorePersistenceError}
        />

        <AiAssessmentStatusMessage
          status={aiAssessmentStatus}
          summary={aiAssessmentSummary}
          error={aiAssessmentError}
        />

        {uploadJobId && scorePersistenceStatus === "saved" && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                  <h3 className="text-sm font-semibold">
                    Research and local scoring saved
                  </h3>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <StatusBadge tone="success">
                    Research saved {websiteResearchSummary.saved}
                  </StatusBadge>
                  <StatusBadge tone="success">
                    Scores saved {savedScoreResultCount}
                  </StatusBadge>
                  <StatusBadge
                    tone={
                      aiAssessmentStatus === "failed"
                        ? "danger"
                        : aiAssessmentStatus === "queued"
                          ? "info"
                          : "neutral"
                    }
                  >
                    {formatAiRunStatus(aiAssessmentStatus)}
                  </StatusBadge>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <a href={`/companies?uploadJobId=${uploadJobId}`}>
                    Review this upload
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <a href="/companies">Open companies</a>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <a href={`/api/companies/export?uploadJobId=${uploadJobId}`}>
                    Export CSV
                    <Download className="h-4 w-4" />
                  </a>
                </Button>
              </div>
            </div>
          </div>
        )}

        {results.length > 0 && (
          <>
            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-slate-950">
                      Review Queue
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {summary.needsReview.toLocaleString()} companies need review
                    </p>
                  </div>
                  <div className="flex flex-1 flex-col gap-2 lg:max-w-2xl lg:flex-row lg:items-center lg:justify-end">
                    <div className="relative lg:min-w-72">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        value={reviewSearch}
                        onChange={(event) => setReviewSearch(event.target.value)}
                        placeholder="Search companies..."
                        className="h-9 rounded-lg border-slate-200 bg-white pl-9 text-sm"
                      />
                    </div>
                    <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
                      <SlidersHorizontal className="mx-1 h-4 w-4 text-slate-400" />
                      {(["comfortable", "compact"] as const).map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setDensity(value)}
                          className={`rounded-md px-2 py-1 text-xs font-medium transition ${
                            density === value
                              ? "bg-white text-slate-950 shadow-sm"
                              : "text-slate-500 hover:text-slate-900"
                          }`}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 border-b border-slate-200 px-4 py-3">
                  {reviewQueueFilters.map((filter) => (
                    <button
                      key={filter.value}
                      type="button"
                      onClick={() => setReviewFilter(filter.value)}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                        reviewFilter === filter.value
                          ? "border-blue-200 bg-blue-50 text-blue-700"
                          : "border-slate-200 bg-white text-slate-500 hover:text-slate-950"
                      }`}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>

                <div className="overflow-x-auto">
                  <Table className="min-w-[980px]">
                    <TableHeader className="bg-slate-50">
                      <TableRow className="border-slate-200">
                        <TableHead className="w-[220px] text-xs font-semibold text-slate-500">
                          Company
                        </TableHead>
                        <TableHead className="w-[120px] text-xs font-semibold text-slate-500">
                          Fit / Score
                        </TableHead>
                        <TableHead className="w-[150px] text-xs font-semibold text-slate-500">
                          Type
                        </TableHead>
                        <TableHead className="w-[280px] text-xs font-semibold text-slate-500">
                          Evidence
                        </TableHead>
                        <TableHead className="w-[110px] text-xs font-semibold text-slate-500">
                          AI
                        </TableHead>
                        <TableHead className="w-[130px] text-xs font-semibold text-slate-500">
                          Review state
                        </TableHead>
                        <TableHead className="w-[100px] text-xs font-semibold text-slate-500">
                          Actions
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredReviewRows.map((row) => {
                        const result = row.result;
                        const evidenceChips = getWebsiteEvidenceChips(result);
                        const isSelected =
                          selectedReviewRow?.feedbackKey === row.feedbackKey;

                        return (
                          <TableRow
                            key={row.feedbackKey}
                            onClick={() => setSelectedResult(result)}
                            className={`cursor-pointer border-slate-100 transition hover:bg-slate-50 ${
                              isSelected ? "bg-blue-50/70 hover:bg-blue-50" : ""
                            } ${density === "compact" ? "[&>td]:py-2.5" : "[&>td]:py-3"}`}
                          >
                            <TableCell>
                              <div className="min-w-0">
                                <div className="flex min-w-0 items-center gap-2">
                                  <span className="truncate text-sm font-semibold text-slate-950">
                                    {result.company_name}
                                  </span>
                                  {row.savedFeedback && (
                                    <StatusBadge tone="info">Saved</StatusBadge>
                                  )}
                                </div>
                                <p className="mt-1 truncate text-xs text-slate-500">
                                  {result.website || "No website"}
                                </p>
                                <p className="truncate text-xs text-slate-500">
                                  {result.company_country || "No country"}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1">
                                <ScoreBadge
                                  score={
                                    row.savedFeedback?.final_company_score ??
                                    result.company_score
                                  }
                                />
                                <QualificationBadge
                                  qualification={
                                    row.savedFeedback?.final_qualification ??
                                    result.qualification
                                  }
                                />
                                <p className="text-xs text-slate-500">
                                  {Math.round(result.confidence * 100)}%
                                  confidence
                                </p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1">
                                <CompanyTypeBadge
                                  companyType={
                                    row.savedFeedback?.final_company_type ??
                                    result.type
                                  }
                                />
                                <p className="text-xs text-slate-500">
                                  {row.savedFeedback ? "Final SDR" : "Rule"}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <p className="line-clamp-2 text-sm leading-5 text-slate-600">
                                {row.brief}
                              </p>
                              <div className="mt-2 flex flex-wrap gap-1">
                                {evidenceChips.slice(0, 3).map((chip) => (
                                  <StatusBadge
                                    key={chip}
                                    tone={
                                      row.hasResearchIssue ? "danger" : "success"
                                    }
                                  >
                                    {chip}
                                  </StatusBadge>
                                ))}
                                {evidenceChips.length === 0 && (
                                  <StatusBadge tone="neutral">
                                    No research signal
                                  </StatusBadge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <AiQueueBadge row={row} />
                            </TableCell>
                            <TableCell>
                              <StatusBadge tone={getReviewStateTone(row.reviewState)}>
                                {formatReviewState(row.reviewState)}
                              </StatusBadge>
                            </TableCell>
                            <TableCell>
                              <Button
                                type="button"
                                size="sm"
                                variant={isSelected ? "default" : "outline"}
                                className={
                                  isSelected
                                    ? "h-8 rounded-lg bg-blue-600 px-3 text-white hover:bg-blue-700"
                                    : "h-8 rounded-lg bg-white px-3"
                                }
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedResult(result);
                                }}
                              >
                                Review
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  {filteredReviewRows.length === 0 && (
                    <div className="p-8 text-center text-sm text-slate-500">
                      No companies match the current review filters.
                    </div>
                  )}
                </div>
              </div>

                <ReviewSidePanel
                  row={selectedReviewRow}
                  uploadJobId={uploadJobId}
                  companyRecordIdsByRowIndex={companyRecordIdsByRowIndex}
                  scoreResultIdsByRowIndex={scoreResultIdsByRowIndex}
                  sourceRowIndexByFeedbackKey={sourceRowIndexByFeedbackKey}
                  onSaveFeedback={saveLocalFeedback}
                />
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <SummaryMetric
                label="Local corrections"
                value={feedbackSummary.total}
              />
              <SummaryMetric
                label="Final qualified"
                value={feedbackSummary.qualified}
              />
              <SummaryMetric
                label="Final unqualified"
                value={feedbackSummary.unqualified}
              />
              <SummaryMetric
                label="Final uncertain"
                value={feedbackSummary.uncertain}
              />
            </div>

            {feedbackList.length > 0 && (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Company Name</TableHead>
                      <TableHead>Predicted Qualification</TableHead>
                      <TableHead>Final Qualification</TableHead>
                      <TableHead>Predicted Type</TableHead>
                      <TableHead>Final Type</TableHead>
                      <TableHead>Final Score</TableHead>
                      <TableHead>Note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {feedbackList.map((feedback) => (
                      <TableRow key={feedback.id}>
                        <TableCell className="min-w-44 font-medium">
                          {feedback.company_name}
                        </TableCell>
                        <TableCell>{feedback.predicted_qualification}</TableCell>
                        <TableCell>{feedback.final_qualification}</TableCell>
                        <TableCell>{feedback.predicted_company_type}</TableCell>
                        <TableCell>{feedback.final_company_type}</TableCell>
                        <TableCell>{feedback.final_company_score}</TableCell>
                        <TableCell className="min-w-72 text-muted-foreground">
                          {feedback.final_note || "No note"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}

        <div className="rounded-md border bg-muted/30 p-3">
          <p className="text-sm leading-6 text-muted-foreground">
            Local hard-rule scoring remains the official predicted result.
            When company rows are persisted, website research is saved first and
            the local score uses that evidence. If AI is enabled, rows selected
            by the current AI mode can receive a separate persisted AI
            assessment after local scores are saved. SDR corrections are saved
            as FeedbackExample rows when
            persisted company and score IDs are available. No AI retraining
            happens here. Export downloads are generated in the browser only.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

const reviewQueueFilters: Array<{ label: string; value: ReviewQueueFilter }> = [
  { label: "All", value: "all" },
  { label: "Needs review", value: "needs_review" },
  { label: "Reviewed", value: "reviewed" },
  { label: "Qualified", value: "qualified" },
  { label: "Unqualified", value: "unqualified" },
  { label: "Uncertain", value: "uncertain" },
  { label: "AI checked", value: "ai_checked" },
  { label: "Research failed", value: "research_failed" },
];

function ReviewSidePanel({
  row,
  uploadJobId,
  companyRecordIdsByRowIndex,
  scoreResultIdsByRowIndex,
  sourceRowIndexByFeedbackKey,
  onSaveFeedback,
}: {
  row: ReviewQueueRow | null;
  uploadJobId: string | null;
  companyRecordIdsByRowIndex: Record<number, string>;
  scoreResultIdsByRowIndex: Record<number, string>;
  sourceRowIndexByFeedbackKey: Record<string, number>;
  onSaveFeedback: (
    company: CompanyScoreResult,
    correction: {
      final_company_score: number;
      final_company_type: CompanyScoreResult["type"];
      final_qualification: CompanyScoreResult["qualification"];
      final_note: string;
    }
  ) => void | Promise<void>;
}) {
  if (!row) {
    return (
      <aside className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500 xl:sticky xl:top-4">
        <div>
          Select a company from the review queue to inspect rule baseline,
          website evidence, AI suggestion, and final SDR decision.
        </div>
      </aside>
    );
  }

  const result = row.result;
  const evidenceChips = getWebsiteEvidenceChips(result);

  return (
    <aside className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
      <div className="border-b border-slate-200 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold text-slate-950">
              {result.company_name}
            </h3>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
              {result.website ? (
                <a
                  href={formatWebsiteHref(result.website)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-w-0 items-center gap-1 truncate font-medium text-blue-600 hover:text-blue-700"
                >
                  <Globe2 className="h-4 w-4 shrink-0" />
                  <span className="truncate">{result.website}</span>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                </a>
              ) : (
                <span>No website</span>
              )}
              <span>{result.company_country || "No country"}</span>
            </div>
          </div>
          <StatusBadge tone={getReviewStateTone(row.reviewState)}>
            {formatReviewState(row.reviewState)}
          </StatusBadge>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <section className="decision-panel [&>div]:rounded-xl [&>div]:border-slate-200 [&>div]:p-0 [&>div>div:first-child]:hidden [&_input]:rounded-lg [&_textarea]:min-h-20 [&_textarea]:rounded-lg">
          <div className="mb-3">
            <h4 className="text-sm font-semibold text-slate-950">
              Final SDR decision
            </h4>
            <p className="mt-1 text-xs text-slate-500">
              SDR final review remains the source of truth.
            </p>
          </div>
          <LocalFeedbackPanel
            key={`${row.feedbackKey}-${row.savedFeedback?.id ?? "new"}`}
            company={result}
            savedFeedback={row.savedFeedback}
            onSave={(correction) => onSaveFeedback(result, correction)}
            canPersistFeedback={canPersistFeedbackForResult({
              company: result,
              uploadJobId,
              companyRecordIdsByRowIndex,
              scoreResultIdsByRowIndex,
              sourceRowIndexByFeedbackKey,
            })}
          />
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h4 className="text-sm font-semibold text-slate-950">Company brief</h4>
          <p className="mt-2 text-sm leading-6 text-slate-600">{row.brief}</p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h4 className="text-sm font-semibold text-slate-950">
            Rule baseline summary
          </h4>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <CompactSignal label="Industry match">
              <QualificationBadge qualification={result.qualification} />
            </CompactSignal>
            <CompactSignal label="Company type">
              <CompanyTypeBadge companyType={result.type} />
            </CompactSignal>
            <CompactSignal label="Score">
              <ScoreBadge score={result.company_score} />
            </CompactSignal>
            <CompactSignal label="Confidence">
              <StatusBadge tone="neutral">
                {Math.round(result.confidence * 100)}%
              </StatusBadge>
            </CompactSignal>
          </div>
          <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">
            {result.reason}
          </p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <Globe2 className="h-4 w-4 text-slate-500" />
            <h4 className="text-sm font-semibold text-slate-950">
              Website evidence
            </h4>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {evidenceChips.length > 0 ? (
              evidenceChips.map((chip) => (
                <StatusBadge
                  key={chip}
                  tone={row.hasResearchIssue ? "danger" : "success"}
                >
                  {chip}
                </StatusBadge>
              ))
            ) : (
              <StatusBadge tone="neutral">No website evidence</StatusBadge>
            )}
          </div>
          <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">
            {result.one_sentence_company_summary ||
              "No compact website summary is available in this upload preview."}
          </p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-slate-500" />
            <h4 className="text-sm font-semibold text-slate-950">
              AI suggestion
            </h4>
          </div>
          <div className="mt-3">
            <AiQueueBadge row={row} />
          </div>
          <p className="mt-3 line-clamp-4 text-sm leading-6 text-slate-600">
            {row.aiStatus === "scored"
              ? row.aiReason ||
                "AI assessment was created. Open the company detail page for the full persisted second opinion."
              : row.aiStatus === "failed"
                ? row.aiReason || "AI assessment failed for this row."
                : row.aiStatus === "queued"
                  ? "This company is waiting for AI assessment. Local scoring and SDR review are available now."
                  : "No AI assessment yet. AI only runs when enabled by the current upload AI mode."}
          </p>
          <p className="mt-2 text-xs font-medium text-slate-500">
            AI is a second opinion only.
          </p>
        </section>
      </div>
    </aside>
  );
}

function getPersistedRows(
  rows: ParsedCsvRow[],
  persistedSourceRowIndexes: number[]
) {
  if (persistedSourceRowIndexes.length === 0) {
    return rows;
  }

  return persistedSourceRowIndexes.map((index) => rows[index]);
}

function toScorePersistenceRows(scoredRows: ScoredUploadRow[]) {
  return scoredRows.map(({ sourceRowIndex, result }) => ({
    sourceRowIndex,
    result,
  }));
}

function canPersistFeedbackForResult({
  company,
  uploadJobId,
  companyRecordIdsByRowIndex,
  scoreResultIdsByRowIndex,
  sourceRowIndexByFeedbackKey,
}: {
  company: CompanyScoreResult;
  uploadJobId: string | null;
  companyRecordIdsByRowIndex: Record<number, string>;
  scoreResultIdsByRowIndex: Record<number, string>;
  sourceRowIndexByFeedbackKey: Record<string, number>;
}) {
  if (!uploadJobId) {
    return false;
  }

  const sourceRowIndex = sourceRowIndexByFeedbackKey[getLocalFeedbackKey(company)];

  return Boolean(
    sourceRowIndex !== undefined &&
      companyRecordIdsByRowIndex[sourceRowIndex] &&
      scoreResultIdsByRowIndex[sourceRowIndex]
  );
}

function CompactSignal({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
      <p className="mb-1 text-xs font-medium text-slate-500">{label}</p>
      {children}
    </div>
  );
}

function matchesReviewFilter(row: ReviewQueueRow, filter: ReviewQueueFilter) {
  const qualification =
    row.savedFeedback?.final_qualification ?? row.result.qualification;

  if (filter === "all") {
    return true;
  }

  if (filter === "needs_review") {
    return row.reviewState === "needs_review";
  }

  if (filter === "reviewed") {
    return row.reviewState === "reviewed";
  }

  if (
    filter === "qualified" ||
    filter === "unqualified" ||
    filter === "uncertain"
  ) {
    return qualification === filter;
  }

  if (filter === "ai_checked") {
    return row.aiStatus === "scored" || row.aiStatus === "queued";
  }

  if (filter === "research_failed") {
    return row.hasResearchIssue;
  }

  return true;
}

function getCompanyBrief(result: CompanyScoreResult) {
  return (
    result.one_sentence_company_summary?.trim() ||
    result.reason?.trim() ||
    "No company brief available yet."
  );
}

function hasWebsiteResearchIssue(result: CompanyScoreResult) {
  const flags = result.hard_rule_flags ?? {};

  return Boolean(
    flags.websiteUnreachable ||
      flags.websiteBlocked ||
      flags.websiteWeakOrParked ||
      flags.websiteOffline ||
      result.reason.toLowerCase().includes("unreachable") ||
      result.reason.toLowerCase().includes("offline")
  );
}

function getWebsiteEvidenceChips(result: CompanyScoreResult) {
  const flags = result.hard_rule_flags ?? {};
  const chips: string[] = [];

  if (flags.websiteUnreachable || flags.websiteOffline) {
    chips.push("Unreachable");
  }
  if (flags.websiteBlocked) {
    chips.push("Blocked");
  }
  if (flags.websiteWeakOrParked) {
    chips.push("Weak website");
  }
  if (flags.websiteProductLed) {
    chips.push("Product-led");
  }
  if (flags.websiteServiceLed) {
    chips.push("Service-led");
  }
  if (flags.websiteHasApi) {
    chips.push("API");
  }
  if (flags.websiteHasAi) {
    chips.push("AI");
  }
  if (flags.websiteHasData) {
    chips.push("Data");
  }
  if (flags.websiteHasCloud) {
    chips.push("Cloud");
  }
  if (flags.websiteHasSecurity) {
    chips.push("Security");
  }

  return chips;
}

function formatReviewState(reviewState: ReviewQueueRow["reviewState"]) {
  return reviewState.replace("_", " ");
}

function getReviewStateTone(
  reviewState: ReviewQueueRow["reviewState"]
): "success" | "warning" | "danger" | "neutral" | "info" {
  if (reviewState === "reviewed") return "info";
  if (reviewState === "needs_review") return "warning";

  return "neutral";
}

function formatWebsiteHref(website: string) {
  if (/^https?:\/\//i.test(website)) {
    return website;
  }

  return `https://${website}`;
}

function AiQueueBadge({ row }: { row: ReviewQueueRow }) {
  if (row.aiStatus === "scored") {
    return <StatusBadge tone="info">AI checked</StatusBadge>;
  }

  if (row.aiStatus === "failed") {
    return <StatusBadge tone="danger">AI failed</StatusBadge>;
  }

  if (row.aiStatus === "queued") {
    return <StatusBadge tone="info">AI queued</StatusBadge>;
  }

  if (row.aiStatus === "skipped") {
    return <StatusBadge tone="neutral">AI skipped</StatusBadge>;
  }

  return <StatusBadge tone="neutral">No AI yet</StatusBadge>;
}

function WebsiteResearchStatusMessage({
  status,
  summary,
}: {
  status: WebsiteResearchPersistenceStatus;
  summary: WebsiteResearchSummary;
}) {
  if (status === "idle") {
    return null;
  }

  const content = {
    running: {
      label: `Researching websites ${summary.processed.toLocaleString()} / ${summary.attempted.toLocaleString()}...`,
      tone: "text-muted-foreground",
      badge: "Researching",
    },
    saved: {
      label: "Website research saved",
      tone: "text-foreground",
      badge: "Saved",
    },
    partial: {
      label: "Website research partially saved",
      tone: "text-foreground",
      badge: "Partial",
    },
    failed: {
      label: "Website research failed for all attempted rows",
      tone: "text-destructive",
      badge: "Failed",
    },
    skipped: {
      label:
        "Website research skipped because saved company rows or websites were not available.",
      tone: "text-muted-foreground",
      badge: "Skipped",
    },
    idle: {
      label: "",
      tone: "text-muted-foreground",
      badge: "",
    },
  }[status];

  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={status === "failed" ? "destructive" : "secondary"}>
          {content.badge}
        </Badge>
        <p className={`text-sm font-medium ${content.tone}`}>
          {content.label}
        </p>
      </div>
      {status !== "skipped" && (
        <p className="mt-2 text-xs text-muted-foreground">
          Saved {summary.saved.toLocaleString()} research result
          {summary.saved === 1 ? "" : "s"}; failed{" "}
          {summary.failed.toLocaleString()}; skipped{" "}
          {summary.skipped.toLocaleString()}.
        </p>
      )}
      {summary.errors.length > 0 && (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {summary.errors.slice(0, 3).join(" ")}
          {summary.errors.length > 3
            ? ` +${summary.errors.length - 3} more.`
            : ""}
        </p>
      )}
    </div>
  );
}

function ScorePersistenceStatusMessage({
  status,
  savedCount,
  error,
}: {
  status: ScorePersistenceStatus;
  savedCount: number;
  error: string | null;
}) {
  if (status === "idle") {
    return null;
  }

  const content = {
    saving: {
      label: "Saving score results...",
      tone: "text-muted-foreground",
      badge: "Saving",
    },
    saved: {
      label: "Score results saved",
      tone: "text-foreground",
      badge: "Saved",
    },
    failed: {
      label: "Score result save failed - local scoring still works",
      tone: "text-destructive",
      badge: "Failed",
    },
    skipped: {
      label: "Score results not saved because company rows were not persisted.",
      tone: "text-muted-foreground",
      badge: "Skipped",
    },
  }[status];

  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={status === "failed" ? "destructive" : "secondary"}>
          {content.badge}
        </Badge>
        <p className={`text-sm font-medium ${content.tone}`}>
          {content.label}
        </p>
      </div>
      {status === "saved" && (
        <p className="mt-2 text-xs text-muted-foreground">
          Saved score results: {savedCount.toLocaleString()}
        </p>
      )}
      {status === "failed" && error && (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{error}</p>
      )}
    </div>
  );
}

function AiAssessmentStatusMessage({
  status,
  summary,
  error,
}: {
  status: AiAssessmentStatus;
  summary: AiScoreUncertainSummary | null;
  error: string | null;
}) {
  if (status === "idle") {
    return null;
  }

  if (status === "running") {
    return (
      <div className="rounded-md border bg-background p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">AI</Badge>
          <p className="text-sm font-medium text-muted-foreground">
            Running optional AI assessment...
          </p>
        </div>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="rounded-md border bg-background p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="destructive">AI failed</Badge>
          <p className="text-sm font-medium text-destructive">
            {getFriendlyAiStatusMessage(
              error ?? "AI assessment failed. Local scoring was saved."
            )}
          </p>
        </div>
        {error && (
          <details className="mt-2 text-xs leading-5 text-muted-foreground">
            <summary className="cursor-pointer">Technical error details</summary>
            <p className="mt-2 whitespace-pre-wrap">{error}</p>
          </details>
        )}
      </div>
    );
  }

  if (!summary) {
    return null;
  }

  const enqueued = summary.enqueued ?? 0;
  const label = summary.skipped
    ? `AI skipped: ${summary.reason ?? "AI is not usable."}`
    : `AI queued ${enqueued.toLocaleString()} job${
        enqueued === 1 ? "" : "s"
      } in ${formatAiMode(summary.scope ?? summary.mode)} mode.`;

  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">
          {summary.skipped ? "AI skipped" : "AI assessment"}
        </Badge>
        <p className="text-sm font-medium text-foreground">{label}</p>
      </div>
      {!summary.skipped && (
        <p className="mt-2 text-xs text-muted-foreground">
          Candidates: {summary.candidateCount.toLocaleString()}; already
          assessed:{" "}
          {(
            summary.skippedAlreadyAssessed ?? summary.alreadyAssessedCount
          ).toLocaleString()}
          ; duplicate jobs skipped:{" "}
          {(summary.skippedDuplicateJob ?? 0).toLocaleString()}; cache hits:{" "}
          {(summary.cacheHits ?? 0).toLocaleString()}.
        </p>
      )}
    </div>
  );
}

function formatAiRunStatus(status: AiAssessmentStatus) {
  if (status === "queued") {
    return "AI queued";
  }

  if (status === "running") {
    return "AI queueing";
  }

  return `AI ${status}`;
}

function formatAiMode(mode: string) {
  if (mode === "all_companies") {
    return "all companies";
  }

  if (mode === "all_active") {
    return "all active companies";
  }

  if (mode === "qualified_and_uncertain") {
    return "qualified + uncertain";
  }

  if (mode === "uncertain_only") {
    return "uncertain only";
  }

  return mode;
}

function getFriendlyAiStatusMessage(message: string) {
  const lower = message.toLowerCase();

  if (
    lower.includes("429") ||
    lower.includes("quota") ||
    lower.includes("rate limit")
  ) {
    return "AI was enabled, but this assessment could not complete because the provider quota/rate limit was reached. Local scoring and SDR review still work.";
  }

  if (lower.includes("disabled")) {
    return "AI is disabled. Local scoring and SDR review still work.";
  }

  return "AI assessment failed. Local scoring was saved.";
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold text-foreground">
        {value.toLocaleString()}
      </p>
    </div>
  );
}
