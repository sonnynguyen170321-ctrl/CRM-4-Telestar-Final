"use client";

import { useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CompanyTypeBadge,
  QualificationBadge,
  ScoreBadge,
  StatusBadge,
} from "@/components/shared/statusBadges";
import { CompanyIcpInsightCard } from "@/components/companies/CompanyIcpInsightCard";
import {
  buildCompanyBrief,
  formatAiConfidence,
  type CompanyReviewRow,
  type StructuredCompanyBrief,
} from "@/components/companies/companyReviewUtils";
import {
  enqueueCompanyAiAssessment,
  getCompanyRecordDetail,
  type CompanyRecordDetail,
} from "@/lib/client/companyRecords";

export function CompanyRowDetailDialog({
  detail: inputDetail,
  open,
  onOpenChange,
  rerunStatus,
  rerunError,
  onRerunWebsiteResearch,
  onRerunLocalScoring,
}: {
  detail: CompanyRecordDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rerunStatus: string | null;
  rerunError: string | null;
  onRerunWebsiteResearch: () => void;
  onRerunLocalScoring: () => void;
}) {
  const [displayDetail, setDisplayDetail] =
    useState<CompanyRecordDetail | null>(null);
  const detail =
    displayDetail?.companyRecord.id === inputDetail?.companyRecord.id
      ? displayDetail
      : inputDetail;
  const activeDetail = detail;
  const isDeleted = Boolean(activeDetail?.companyRecord.deletedAt);
  const hasWebsite = Boolean(activeDetail?.companyRecord.website?.trim());
  const normalizedSnapshot = activeDetail
    ? {
        companyName: activeDetail.companyRecord.companyName,
        website: activeDetail.companyRecord.website,
        companyCountry: activeDetail.companyRecord.companyCountry,
        companyIndustry: activeDetail.companyRecord.companyIndustry,
        companyStaffCountRange: activeDetail.companyRecord.companyStaffCountRange,
        companyLinkedInUrl: activeDetail.companyRecord.companyLinkedInUrl,
        companyPhone1: activeDetail.companyRecord.companyPhone1,
        sourceType: activeDetail.companyRecord.type,
        sourceRowIndex: activeDetail.companyRecord.sourceRowIndex,
        uploadJobId: activeDetail.companyRecord.uploadJobId,
        note: activeDetail.companyRecord.note,
      }
    : null;
  const companyBrief = activeDetail
    ? buildCompanyBrief(toCompanyReviewRowFromDetail(activeDetail))
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {activeDetail?.companyRecord.companyName ?? "Company row details"}
          </DialogTitle>
          <DialogDescription>
            Inspect source row data, normalized company fields, and linked
            score/research/feedback summaries.
          </DialogDescription>
        </DialogHeader>

        {activeDetail && (
          <div className="space-y-5">
            <CompanyProfileCard detail={activeDetail} />

            <section className="space-y-3">
              <SectionTitle title="Company brief" />
              {companyBrief ? (
                <CompanyBriefCard detail={activeDetail} companyBrief={companyBrief} />
              ) : null}
            </section>

            <CompanyIcpInsightCard companyRecordId={activeDetail.companyRecord.id} />

            <CompanyAiQueueActionCard
              detail={activeDetail}
              onDetailRefresh={setDisplayDetail}
            />

            <section className="space-y-3">
              <SectionTitle title="Single-row rerun actions" />
              <div className="rounded-md border p-3">
                <p className="text-sm leading-6 text-muted-foreground">
                  These actions append new website research or predicted score
                  rows. Existing score history and SDR feedback remain
                  unchanged.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onRerunWebsiteResearch}
                    disabled={isDeleted || !hasWebsite || Boolean(rerunStatus)}
                  >
                    Re-run website research
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onRerunLocalScoring}
                    disabled={isDeleted || Boolean(rerunStatus)}
                  >
                    Re-run local scoring
                  </Button>
                </div>
                {!hasWebsite && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    This row has no website.
                  </p>
                )}
                {isDeleted && (
                  <p className="mt-2 text-xs text-destructive">
                    Deleted company rows cannot be rerun.
                  </p>
                )}
                {rerunStatus && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {rerunStatus}
                  </p>
                )}
                {rerunError && (
                  <p className="mt-2 text-xs text-destructive">{rerunError}</p>
                )}
              </div>
            </section>

            <section className="space-y-3">
              <SectionTitle title="Row snapshot" />
              <div className="space-y-3 rounded-md border p-3">
                <div className="flex flex-wrap gap-2">
                  {detail.companyRecord.deletedAt ? (
                    <Badge variant="destructive">deleted</Badge>
                  ) : detail.companyRecord.archivedAt ? (
                    <Badge variant="secondary">archived</Badge>
                  ) : (
                    <Badge variant="outline">active</Badge>
                  )}
                  <Badge variant="outline">
                    {detail.counts.scoreResults} score results
                  </Badge>
                  <Badge variant="outline">
                    {detail.counts.websiteResearchResults} research results
                  </Badge>
                  <Badge variant="outline">
                    {detail.counts.feedbackExamples} feedback examples
                  </Badge>
                  <Badge variant="outline">
                    {detail.counts.aiAssessments} AI assessments
                  </Badge>
                </div>
                <div className="grid gap-2 text-sm md:grid-cols-2">
                  <SnapshotRow
                    label="Company"
                    value={detail.companyRecord.companyName}
                  />
                  <SnapshotRow
                    label="Website"
                    value={detail.companyRecord.website}
                  />
                  <SnapshotRow
                    label="Country"
                    value={detail.companyRecord.companyCountry}
                  />
                  <SnapshotRow
                    label="Industry"
                    value={detail.companyRecord.companyIndustry}
                  />
                  <SnapshotRow
                    label="Staff count"
                    value={detail.companyRecord.companyStaffCountRange}
                  />
                  <SnapshotRow
                    label="Source type"
                    value={detail.companyRecord.type}
                  />
                  <SnapshotRow
                    label="Source row"
                    value={formatNullableNumber(detail.companyRecord.sourceRowIndex)}
                  />
                  <SnapshotRow
                    label="Upload job"
                    value={detail.companyRecord.uploadJobId}
                  />
                  <SnapshotRow
                    label="LinkedIn"
                    value={detail.companyRecord.companyLinkedInUrl}
                  />
                  <SnapshotRow
                    label="Phone"
                    value={detail.companyRecord.companyPhone1}
                  />
                  <SnapshotRow label="Note" value={detail.companyRecord.note} />
                  <SnapshotRow
                    label="Created"
                    value={formatDateTime(detail.companyRecord.createdAt)}
                  />
                </div>
                {detail.uploadJob && (
                  <div className="rounded-md border bg-muted/20 p-3 text-sm">
                    <SnapshotRow
                      label="Upload file"
                      value={detail.uploadJob.fileName}
                    />
                    <SnapshotRow
                      label="Uploaded at"
                      value={formatDateTime(detail.uploadJob.createdAt)}
                    />
                  </div>
                )}
              </div>
            </section>

            <section className="space-y-3">
              <SectionTitle title="Current predicted result" />
              {detail.latestScoreResult ? (
                <div className="space-y-3 rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">Predicted</Badge>
                    <CompanyTypeBadge
                      companyType={detail.latestScoreResult.companyType}
                    />
                    <QualificationBadge
                      qualification={detail.latestScoreResult.qualification}
                    />
                    <ScoreBadge score={detail.latestScoreResult.companyScore} />
                    <Badge variant="outline">
                      Confidence{" "}
                      {Math.round(detail.latestScoreResult.confidence * 100)}%
                    </Badge>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <SnapshotRow
                      label="Scoring source"
                      value={detail.latestScoreResult.scoringSource}
                    />
                    <SnapshotRow
                      label="Scoring version"
                      value={detail.latestScoreResult.scoringVersion}
                    />
                    <SnapshotRow
                      label="Review state"
                      value={detail.latestScoreResult.reviewState}
                    />
                    <SnapshotRow
                      label="Created at"
                      value={formatDateTime(detail.latestScoreResult.createdAt)}
                    />
                  </div>
                  <DetailBlock
                    label="Reason"
                    value={detail.latestScoreResult.reason}
                  />
                  <DetailBlock
                    label="Summary"
                    value={
                      detail.latestScoreResult.oneSentenceCompanySummary ||
                      "No summary saved."
                    }
                  />
                  <JsonDetails
                    title="Hard rule flags"
                    value={detail.latestScoreResult.hardRuleFlagsJson}
                    emptyMessage="No hard rule flags saved."
                  />
                </div>
              ) : (
                <EmptyPanel message="No predicted score result linked to this row." />
              )}
            </section>

            <section className="space-y-3">
              <SectionTitle title="Current website evidence" />
              {detail.latestWebsiteResearchResult ? (
                <div className="space-y-3 rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">
                      {detail.latestWebsiteResearchResult.status}
                    </Badge>
                    <Badge variant="secondary">
                      {detail.latestWebsiteResearchResult.quality}
                    </Badge>
                    <Badge variant="outline">
                      {detail.latestWebsiteResearchResult.reachable
                        ? "reachable"
                        : "unreachable"}
                    </Badge>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <SnapshotRow
                      label="Domain"
                      value={detail.latestWebsiteResearchResult.normalizedDomain}
                    />
                    <SnapshotRow
                      label="Final URL"
                      value={detail.latestWebsiteResearchResult.finalUrl}
                    />
                    <SnapshotRow
                      label="HTTP status"
                      value={formatNullableNumber(
                        detail.latestWebsiteResearchResult.httpStatus
                      )}
                    />
                    <SnapshotRow
                      label="Researched at"
                      value={formatDateTime(
                        detail.latestWebsiteResearchResult.researchedAt
                      )}
                    />
                  </div>
                  <DetailBlock
                    label="Summary"
                    value={detail.latestWebsiteResearchResult.summary}
                  />
                  <JsonDetails
                    title="Signals JSON"
                    value={detail.latestWebsiteResearchResult.signalsJson}
                    emptyMessage="No website signals saved."
                  />
                  <JsonDetails
                    title="Classification hints"
                    value={
                      detail.latestWebsiteResearchResult.classificationHintsJson
                    }
                    emptyMessage="No classification hints saved."
                  />
                </div>
              ) : (
                <EmptyPanel message="No website research linked to this row." />
              )}
            </section>

            <section className="space-y-3">
              <SectionTitle title="AI second opinion" />
              {detail.latestAiAssessment ? (
                <div className="space-y-3 rounded-md border p-3 text-sm">
                  {detail.latestAiAssessment.errorMessage ? (
                    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                      <StatusBadge tone="danger">AI failed</StatusBadge>
                      <p className="mt-2 text-sm text-destructive">
                        {getFriendlyAiStatusMessage(
                          detail.latestAiAssessment.errorMessage
                        )}
                      </p>
                      <details className="mt-2 text-xs text-muted-foreground">
                        <summary className="cursor-pointer">
                          Technical error details
                        </summary>
                        <p className="mt-2 whitespace-pre-wrap">
                          {detail.latestAiAssessment.errorMessage}
                        </p>
                      </details>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge
                      tone={
                        detail.latestAiAssessment.errorMessage
                          ? "danger"
                          : "info"
                      }
                    >
                      {detail.latestAiAssessment.errorMessage
                        ? "AI failed"
                        : "AI completed"}
                    </StatusBadge>
                    <CompanyTypeBadge
                      companyType={detail.latestAiAssessment.companyType}
                    />
                    <QualificationBadge
                      qualification={detail.latestAiAssessment.qualification}
                    />
                    <ScoreBadge score={detail.latestAiAssessment.companyScore} />
                    <Badge variant="outline">
                      Confidence{" "}
                      {Math.round(detail.latestAiAssessment.confidence * 100)}%
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    AI is a second opinion only. SDR final review remains the
                    source of truth.
                  </p>
                  <div className="grid gap-2 md:grid-cols-2">
                    <SnapshotRow
                      label="Provider"
                      value={detail.latestAiAssessment.provider}
                    />
                    <SnapshotRow
                      label="Model"
                      value={detail.latestAiAssessment.modelName}
                    />
                    <SnapshotRow
                      label="Prompt version"
                      value={detail.latestAiAssessment.promptVersion}
                    />
                    <SnapshotRow
                      label="Mode"
                      value={detail.latestAiAssessment.mode}
                    />
                    <SnapshotRow
                      label="Local score result"
                      value={detail.latestAiAssessment.localScoreResultId}
                    />
                    <SnapshotRow
                      label="Latency ms"
                      value={formatNullableNumber(
                        detail.latestAiAssessment.latencyMs
                      )}
                    />
                    <SnapshotRow
                      label="Input tokens"
                      value={formatNullableNumber(
                        detail.latestAiAssessment.inputTokens
                      )}
                    />
                    <SnapshotRow
                      label="Output tokens"
                      value={formatNullableNumber(
                        detail.latestAiAssessment.outputTokens
                      )}
                    />
                    <SnapshotRow
                      label="Created at"
                      value={formatDateTime(detail.latestAiAssessment.createdAt)}
                    />
                    <SnapshotRow
                      label="Cache hit"
                      value={detail.latestAiAssessment.cacheHit ? "yes" : "no"}
                    />
                  </div>
                  <DetailBlock
                    label="Reason"
                    value={detail.latestAiAssessment.reason}
                  />
                  <DetailBlock
                    label="Summary"
                    value={
                      detail.latestAiAssessment.oneSentenceCompanySummary ||
                      "No AI summary saved."
                    }
                  />
                  <JsonDetails
                    title="AI input snapshot"
                    value={detail.latestAiAssessment.inputSnapshotJson}
                    emptyMessage="No AI input snapshot saved."
                  />
                  <JsonDetails
                    title="Website signals snapshot"
                    value={
                      detail.latestAiAssessment.websiteSignalsSnapshotJson
                    }
                    emptyMessage="No website signals snapshot saved."
                  />
                </div>
              ) : (
                <AiJobEmptyState detail={detail} />
              )}
            </section>

            <section className="space-y-3">
              <SectionTitle title="Rule vs AI comparison" />
              {detail.latestAiAssessment ? (
                <div className="space-y-3 rounded-md border p-3 text-sm">
                  <p className="text-sm text-muted-foreground">
                    This comparison is diagnostic only. AI is a second opinion;
                    SDR final review remains the source of truth.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={getDisagreementBadgeVariant(detail.aiRuleComparison.disagreementLevel)}>
                      {detail.aiRuleComparison.disagreementLevel}
                    </Badge>
                    <AgreementBadge
                      label="Qualification"
                      value={detail.aiRuleComparison.qualificationAgreement}
                    />
                    <AgreementBadge
                      label="Company type"
                      value={detail.aiRuleComparison.companyTypeAgreement}
                    />
                    <AgreementBadge
                      label="Score band"
                      value={detail.aiRuleComparison.scoreBandAgreement}
                    />
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <SnapshotRow
                      label="Local score"
                      value={formatNullableNumber(detail.aiRuleComparison.localScore)}
                    />
                    <SnapshotRow
                      label="AI score"
                      value={formatNullableNumber(detail.aiRuleComparison.aiScore)}
                    />
                    <SnapshotRow
                      label="Score delta"
                      value={formatNullableNumber(detail.aiRuleComparison.scoreDelta)}
                    />
                    <SnapshotRow
                      label="Local qualification"
                      value={detail.aiRuleComparison.localQualification}
                    />
                    <SnapshotRow
                      label="AI qualification"
                      value={detail.aiRuleComparison.aiQualification}
                    />
                    <SnapshotRow
                      label="Local type"
                      value={detail.aiRuleComparison.localCompanyType}
                    />
                    <SnapshotRow
                      label="AI type"
                      value={detail.aiRuleComparison.aiCompanyType}
                    />
                  </div>
                  <DetailBlock
                    label="Summary"
                    value={detail.aiRuleComparison.summary}
                  />
                </div>
              ) : (
                <EmptyPanel message="Rule-vs-AI comparison will appear after AI assessment completes." />
              )}
            </section>

            <section className="space-y-3">
              <SectionTitle title="SDR feedback overlay" />
              {detail.latestFeedbackExample ? (
                <div className="space-y-3 rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge tone="info">Final SDR feedback</StatusBadge>
                    <CompanyTypeBadge
                      companyType={detail.latestFeedbackExample.finalCompanyType}
                    />
                    <QualificationBadge
                      qualification={
                        detail.latestFeedbackExample.finalQualification
                      }
                    />
                    <ScoreBadge
                      score={detail.latestFeedbackExample.finalCompanyScore}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    SDR final values are kept separate from predicted scoring
                    history.
                  </p>
                  <div className="grid gap-2 md:grid-cols-2">
                    <SnapshotRow
                      label="Source"
                      value={detail.latestFeedbackExample.source}
                    />
                    <SnapshotRow
                      label="Saved at"
                      value={formatDateTime(detail.latestFeedbackExample.createdAt)}
                    />
                  </div>
                  <DetailBlock
                    label="Final note"
                    value={
                      detail.latestFeedbackExample.finalNote ||
                      "No reviewer note saved."
                    }
                  />
                </div>
              ) : (
                <EmptyPanel message="No SDR feedback linked to this row." />
              )}
            </section>

            <section className="space-y-3">
              <SectionTitle title="Score history" />
              {detail.scoreResultHistory.length > 0 ? (
                <div className="space-y-3">
                  {detail.scoreResultHistory.map((entry, index) => (
                    <HistoryCard
                      key={entry.id}
                      title={`${entry.companyType} / ${entry.companyScore}`}
                      subtitle={`${entry.qualification} / ${Math.round(
                        entry.confidence * 100
                      )}% confidence`}
                      meta={`${entry.scoringSource} / ${entry.scoringVersion} / ${formatDateTime(
                        entry.createdAt
                      )}`}
                      latest={index === 0}
                    >
                      <p className="text-sm leading-6">{entry.reason}</p>
                      {entry.oneSentenceCompanySummary && (
                        <p className="text-sm text-muted-foreground">
                          {entry.oneSentenceCompanySummary}
                        </p>
                      )}
                    </HistoryCard>
                  ))}
                </div>
              ) : (
                <EmptyPanel message="No score history saved for this row." />
              )}
            </section>

            <section className="space-y-3">
              <SectionTitle title="Website research history" />
              {detail.websiteResearchHistory.length > 0 ? (
                <div className="space-y-3">
                  {detail.websiteResearchHistory.map((entry, index) => (
                    <HistoryCard
                      key={entry.id}
                      title={`${entry.status} / ${entry.quality}`}
                      subtitle={`${entry.reachable ? "reachable" : "unreachable"} / ${
                        entry.normalizedDomain || "domain unavailable"
                      }`}
                      meta={`${formatDateTime(entry.researchedAt)}${
                        entry.httpStatus ? ` / HTTP ${entry.httpStatus}` : ""
                      }`}
                      latest={index === 0}
                    >
                      <p className="text-sm leading-6">{entry.summary}</p>
                    </HistoryCard>
                  ))}
                </div>
              ) : (
                <EmptyPanel message="No website research history saved for this row." />
              )}
            </section>

            <section className="space-y-3">
              <SectionTitle title="Feedback history" />
              {detail.feedbackHistory.length > 0 ? (
                <div className="space-y-3">
                  {detail.feedbackHistory.map((entry, index) => (
                    <HistoryCard
                      key={entry.id}
                      title={`${entry.finalCompanyType} / ${entry.finalCompanyScore}`}
                      subtitle={`${entry.finalQualification} / source ${entry.source}`}
                      meta={formatDateTime(entry.createdAt)}
                      latest={index === 0}
                    >
                      <p className="text-sm">
                        Predicted:{" "}
                        {entry.predictedCompanyType && entry.predictedCompanyScore !== null
                          ? `${entry.predictedCompanyType} / ${entry.predictedCompanyScore} / ${entry.predictedQualification || "unknown"}`
                          : "No predicted values saved."}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {entry.finalNote || "No reviewer note saved."}
                      </p>
                    </HistoryCard>
                  ))}
                </div>
              ) : (
                <EmptyPanel message="No feedback history saved for this row." />
              )}
            </section>

            <section className="space-y-3">
              <SectionTitle title="AI assessment history" />
              {detail.aiAssessmentHistory.length > 0 ? (
                <div className="space-y-3">
                  {detail.aiAssessmentHistory.map((entry, index) => (
                    <HistoryCard
                      key={entry.id}
                      title={`${entry.companyType} / ${entry.companyScore}`}
                      subtitle={`${entry.qualification} / ${Math.round(
                        entry.confidence * 100
                      )}% confidence`}
                      meta={`${entry.provider} / ${entry.modelName} / ${entry.promptVersion} / ${formatDateTime(
                        entry.createdAt
                      )}`}
                      latest={index === 0}
                    >
                      <p className="text-sm leading-6">{entry.reason}</p>
                      {entry.oneSentenceCompanySummary && (
                        <p className="text-sm text-muted-foreground">
                          {entry.oneSentenceCompanySummary}
                        </p>
                      )}
                    </HistoryCard>
                  ))}
                </div>
              ) : (
                <EmptyPanel message="No AI assessment history yet. AI runs only when enabled and only for rows selected by the current AI mode." />
              )}
            </section>

            <section className="space-y-3">
              <SectionTitle title="Raw/debug" />
              <div className="space-y-3 rounded-md border p-3">
                <div className="grid gap-2 text-sm md:grid-cols-2">
                  <SnapshotRow
                    label="Company record ID"
                    value={detail.companyRecord.id}
                  />
                  <SnapshotRow
                    label="Upload job ID"
                    value={detail.companyRecord.uploadJobId}
                  />
                  <SnapshotRow
                    label="Latest score ID"
                    value={detail.latestScoreResult?.id}
                  />
                  <SnapshotRow
                    label="Latest research ID"
                    value={detail.latestWebsiteResearchResult?.id}
                  />
                  <SnapshotRow
                    label="Latest feedback ID"
                    value={detail.latestFeedbackExample?.id}
                  />
                  <SnapshotRow
                    label="Latest AI assessment ID"
                    value={detail.latestAiAssessment?.id}
                  />
                </div>
                <JsonDetails
                  title="Raw source row JSON"
                  value={detail.companyRecord.rawRowJson}
                  emptyMessage="No raw row JSON saved."
                />
                <JsonDetails
                  title="Normalized row snapshot"
                  value={normalizedSnapshot}
                  emptyMessage="No normalized row snapshot available."
                />
              </div>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <h3 className="text-sm font-medium text-foreground">{title}</h3>;
}

function CompanyProfileCard({ detail }: { detail: CompanyRecordDetail }) {
  const finalFeedback = detail.latestFeedbackExample;
  const predicted = detail.latestScoreResult;
  const companyType = finalFeedback?.finalCompanyType ?? predicted?.companyType;
  const qualification =
    finalFeedback?.finalQualification ?? predicted?.qualification;
  const score = finalFeedback?.finalCompanyScore ?? predicted?.companyScore;
  const reviewState = finalFeedback
    ? "reviewed"
    : predicted?.reviewState ?? "unreviewed";

  return (
    <section className="space-y-3">
      <SectionTitle title="Company profile" />
      <div className="rounded-md border bg-slate-50 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              {detail.companyRecord.companyName}
            </h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {companyType ? (
                <CompanyTypeBadge companyType={companyType} />
              ) : (
                <StatusBadge tone="neutral">No type</StatusBadge>
              )}
              {qualification ? (
                <QualificationBadge qualification={qualification} />
              ) : (
                <StatusBadge tone="neutral">No qualification</StatusBadge>
              )}
              <ScoreBadge score={score ?? null} />
              <StatusBadge
                tone={reviewState === "reviewed" ? "info" : "neutral"}
              >
                {reviewState}
              </StatusBadge>
            </div>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              SDR final feedback remains the source of truth. Local scoring,
              AI assessment, and Company ICP stay as separate evidence layers.
            </p>
          </div>
          <StatusBadge
            tone={
              detail.latestAiAssessment
                ? detail.aiRuleComparison.disagreementLevel === "major"
                  ? "danger"
                  : detail.aiRuleComparison.disagreementLevel === "minor"
                    ? "warning"
                    : detail.aiRuleComparison.disagreementLevel === "none"
                      ? "success"
                      : "neutral"
                : "neutral"
            }
          >
            {detail.latestAiAssessment
              ? `AI comparison: ${detail.aiRuleComparison.disagreementLevel}`
              : "AI comparison pending"}
          </StatusBadge>
        </div>

        <div className="mt-4 grid gap-2 text-sm md:grid-cols-2">
          <ProfileLinkRow label="Website" value={detail.companyRecord.website} />
          <ProfileLinkRow
            label="LinkedIn"
            value={detail.companyRecord.companyLinkedInUrl}
          />
          <SnapshotRow label="Country" value={detail.companyRecord.companyCountry} />
          <SnapshotRow label="Industry" value={detail.companyRecord.companyIndustry} />
          <SnapshotRow
            label="Staff count"
            value={detail.companyRecord.companyStaffCountRange}
          />
          <SnapshotRow label="Source row" value={formatNullableNumber(detail.companyRecord.sourceRowIndex)} />
        </div>
      </div>
    </section>
  );
}

function CompanyBriefCard({
  detail,
  companyBrief,
}: {
  detail: CompanyRecordDetail;
  companyBrief: StructuredCompanyBrief;
}) {
  const websiteBrief = buildWebsiteBrief(detail);
  const evidenceQuality = normalizeEvidenceQuality(
    detail.latestWebsiteResearchResult?.quality
  );
  const contextRows = ([
    ["Industry", companyBrief.industry],
    ["Product/service", companyBrief.productOrService],
    ["ICP segment", companyBrief.icpSegment],
    ["Target customers", companyBrief.targetCustomers],
    ["Niche", companyBrief.niche],
    [
      "Confidence/source date",
      companyBrief.confidence !== undefined
        ? `${formatAiConfidence(companyBrief.confidence)} / ${
            formatDateTime(companyBrief.generatedAt) ?? "date unavailable"
          }`
        : formatDateTime(companyBrief.generatedAt),
    ],
  ] as Array<[string, string | null | undefined]>).filter(([, value]) =>
    Boolean(value)
  );

  return (
    <div className="space-y-3 rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={getBriefSourceTone(companyBrief.source)}>
          {companyBrief.sourceLabel}
        </StatusBadge>
        <span className="text-xs text-muted-foreground">
          {companyBrief.sourceCopy}
        </span>
      </div>
      <BriefSection
        title="One-line summary"
        body={companyBrief.oneLineSummary}
        empty="No strong brief available yet."
      />
      {contextRows.length > 0 ? (
        <div className="grid gap-2 rounded-md border bg-muted/20 p-3 text-sm md:grid-cols-2">
          {contextRows.map(([label, value]) => (
            <SnapshotRow key={label} label={label} value={value} />
          ))}
        </div>
      ) : null}
      {companyBrief.outreachAngle ||
      companyBrief.recommendedNextAction ||
      companyBrief.keyPainPoints.length > 0 ? (
        <div className="rounded-md border bg-blue-50/40 p-3">
          <p className="text-xs font-medium text-blue-700">SDR angle</p>
          {companyBrief.outreachAngle ? (
            <p className="mt-2 text-sm leading-6">
              {companyBrief.outreachAngle}
            </p>
          ) : null}
          {companyBrief.keyPainPoints.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {companyBrief.keyPainPoints.map((painPoint) => (
                <StatusBadge key={painPoint} tone="neutral">
                  {painPoint}
                </StatusBadge>
              ))}
            </div>
          ) : null}
          {companyBrief.recommendedNextAction ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Next action: {companyBrief.recommendedNextAction}
            </p>
          ) : null}
        </div>
      ) : null}
      <BriefSection
        title="Evidence summary"
        body={
          companyBrief.evidenceSummary ??
          companyBrief.fallbackReason ??
          websiteBrief.body
        }
        empty="No evidence summary is available yet."
      />
      <div className="grid gap-3 md:grid-cols-2">
        <BriefList title="Top website signals" items={websiteBrief.signals} />
        <BriefList title="Useful pages checked" items={websiteBrief.pages} />
      </div>
      <div className="flex flex-wrap gap-2">
        <StatusBadge tone={getEvidenceQualityTone(evidenceQuality)}>
          Evidence quality: {evidenceQuality}
        </StatusBadge>
        {detail.latestScoreResult && (
          <StatusBadge tone="neutral">Local score available</StatusBadge>
        )}
        {detail.latestWebsiteResearchResult && (
          <StatusBadge tone="neutral">Website evidence available</StatusBadge>
        )}
        {detail.latestAiAssessment ? (
          <StatusBadge tone="info">AI assessment available</StatusBadge>
        ) : (
          <StatusBadge tone="neutral">AI assessment pending</StatusBadge>
        )}
      </div>
    </div>
  );
}

function BriefSection({
  title,
  body,
  empty,
}: {
  title: string;
  body: string | null;
  empty: string;
}) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <p className="mt-2 text-sm leading-6 text-foreground">
        {body || empty}
      </p>
    </div>
  );
}

function SnapshotRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all text-right font-medium">
        {value || "Not provided"}
      </span>
    </div>
  );
}

function ProfileLinkRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  const href = normalizeExternalHref(value);

  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 break-all text-right font-medium text-blue-700 hover:underline"
        >
          {value}
          <ExternalLink className="h-3 w-3" />
        </a>
      ) : (
        <span className="break-all text-right font-medium">Not provided</span>
      )}
    </div>
  );
}

function BriefList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {items.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {items.map((item) => (
            <StatusBadge key={item} tone="neutral">
              {item}
            </StatusBadge>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Specific solution not available from stored evidence.
        </p>
      )}
    </div>
  );
}

function DetailBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 leading-6">{value}</p>
    </div>
  );
}

function HistoryCard({
  title,
  subtitle,
  meta,
  latest,
  children,
}: {
  title: string;
  subtitle: string;
  meta: string | null;
  latest: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{title}</span>
        {latest && <Badge variant="secondary">Latest</Badge>}
      </div>
      <p className="text-xs text-muted-foreground">{subtitle}</p>
      <p className="text-xs text-muted-foreground">{meta || "Timestamp unavailable"}</p>
      {children}
    </div>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function AiJobEmptyState({ detail }: { detail: CompanyRecordDetail }) {
  const job = detail.latestAiJob;

  if (!job) {
    return (
      <EmptyPanel message="AI not run yet or AI is disabled. Local scoring and SDR review still work. AI is a second opinion only." />
    );
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
      <StatusBadge tone={getAiJobTone(job.status)}>
        {formatAiJobStatus(job.status)}
      </StatusBadge>
      <p className="leading-6 text-muted-foreground">
        {getAiJobStatusCopy(job)}
      </p>
      {job.nextAttemptAt && (
        <SnapshotRow
          label="Next retry"
          value={formatDateTime(job.nextAttemptAt)}
        />
      )}
      <div className="grid gap-2 md:grid-cols-2">
        <SnapshotRow label="Provider" value={job.provider} />
        <SnapshotRow label="Model" value={job.model} />
        <SnapshotRow label="Prompt version" value={job.promptVersion} />
        <SnapshotRow
          label="Attempts"
          value={`${job.attemptCount}/${job.maxAttempts}`}
        />
        <SnapshotRow label="Last error code" value={job.lastErrorCode} />
        <SnapshotRow label="Updated at" value={formatDateTime(job.updatedAt)} />
      </div>
      {job.lastErrorMessage && (
        <DetailBlock
          label="Last AI job message"
          value={getFriendlyAiStatusMessage(job.lastErrorMessage)}
        />
      )}
    </div>
  );
}

function CompanyAiQueueActionCard({
  detail,
  onDetailRefresh,
}: {
  detail: CompanyRecordDetail;
  onDetailRefresh: (detail: CompanyRecordDetail) => void;
}) {
  const [status, setStatus] = useState<"idle" | "queueing" | "queued" | "failed">(
    "idle"
  );
  const [message, setMessage] = useState<string | null>(null);
  const latestJob = detail.latestAiJob;
  const hasAssessment = Boolean(detail.latestAiAssessment);
  const pendingOrRunning =
    latestJob?.status === "pending" || latestJob?.status === "running";
  const canQueue =
    !hasAssessment &&
    !pendingOrRunning &&
    !Boolean(detail.companyRecord.deletedAt);
  const buttonLabel = latestJob?.status === "failed" ? "Retry AI assessment" : "Run AI assessment";

  async function handleQueueAiAssessment() {
    setStatus("queueing");
    setMessage(null);

    try {
      const result = await enqueueCompanyAiAssessment(detail.companyRecord.id);
      const refreshed = await getCompanyRecordDetail(detail.companyRecord.id);
      onDetailRefresh(refreshed);
      setStatus(result.skipped ? "idle" : "queued");
      setMessage(
        result.reason ??
          "AI assessment queued. Background worker must be running to process it."
      );
    } catch (error) {
      setStatus("failed");
      setMessage(
        error instanceof Error ? error.message : "AI assessment could not be queued."
      );
    }
  }

  return (
    <section className="space-y-3">
      <SectionTitle title="AI assessment queue" />
      <div className="space-y-3 rounded-md border border-blue-100 bg-blue-50/30 p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          {hasAssessment ? (
            <StatusBadge tone="success">AI completed</StatusBadge>
          ) : latestJob ? (
            <StatusBadge tone={getAiJobTone(latestJob.status)}>
              {formatAiJobStatus(latestJob.status)}
            </StatusBadge>
          ) : (
            <StatusBadge tone="neutral">AI not requested</StatusBadge>
          )}
          {latestJob?.cacheHit && <StatusBadge tone="success">Cache hit</StatusBadge>}
        </div>
        <p className="leading-6 text-muted-foreground">
          {hasAssessment
            ? "AI assessment is complete. It remains a second opinion only."
            : latestJob
              ? getAiJobStatusCopy(latestJob)
              : "No AI job has been requested for this company. Queueing a job does not process it directly from the drawer."}
        </p>
        {latestJob?.nextAttemptAt && (
          <SnapshotRow
            label="Next attempt"
            value={formatDateTime(latestJob.nextAttemptAt)}
          />
        )}
        {latestJob && (
          <div className="grid gap-2 md:grid-cols-2">
            <SnapshotRow label="Provider" value={latestJob.provider} />
            <SnapshotRow label="Model" value={latestJob.model} />
            <SnapshotRow
              label="Prompt version"
              value={latestJob.promptVersion}
            />
            <SnapshotRow
              label="Attempts"
              value={`${latestJob.attemptCount}/${latestJob.maxAttempts}`}
            />
            <SnapshotRow
              label="Updated at"
              value={formatDateTime(latestJob.updatedAt)}
            />
          </div>
        )}
        {latestJob?.lastErrorCode && (
          <SnapshotRow label="Last error code" value={latestJob.lastErrorCode} />
        )}
        {latestJob?.lastErrorMessage && (
          <DetailBlock
            label="Last AI job message"
            value={getFriendlyAiStatusMessage(latestJob.lastErrorMessage)}
          />
        )}
        {!hasAssessment && (
          <Button
            type="button"
            size="sm"
            onClick={() => void handleQueueAiAssessment()}
            disabled={!canQueue || status === "queueing"}
          >
            {pendingOrRunning
              ? "AI already queued/running"
              : status === "queueing"
                ? "Queueing AI assessment..."
                : buttonLabel}
          </Button>
        )}
        {message && (
          <p
            className={`text-xs ${
              status === "failed" ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {message}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Drawer actions only enqueue or requeue one company. The protected
          background worker creates CompanyAiAssessment records.
        </p>
      </div>
    </section>
  );
}

function AgreementBadge({
  label,
  value,
}: {
  label: string;
  value: boolean | null;
}) {
  const text = value === null ? "Not available" : value ? "Agree" : "Disagree";
  const variant = value === false ? "destructive" : "outline";

  return (
    <Badge variant={variant}>
      {label}: {text}
    </Badge>
  );
}

function getDisagreementBadgeVariant(
  level: "none" | "minor" | "major" | "not_available"
) {
  if (level === "major") {
    return "destructive";
  }

  if (level === "none") {
    return "secondary";
  }

  return "outline";
}

function JsonDetails({
  title,
  value,
  emptyMessage,
}: {
  title: string;
  value: unknown;
  emptyMessage: string;
}) {
  return (
    <details className="rounded-md border bg-muted/20 p-3">
      <summary className="cursor-pointer text-sm font-medium">{title}</summary>
      <pre className="mt-3 max-h-80 overflow-auto rounded-md bg-background p-3 text-xs leading-5">
        {formatJson(value, emptyMessage)}
      </pre>
    </details>
  );
}

function formatJson(value: unknown, emptyMessage: string) {
  if (value === null || value === undefined) {
    return emptyMessage;
  }

  return JSON.stringify(value, null, 2);
}

function formatNullableNumber(value: number | null) {
  return value === null ? null : String(value);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return new Date(value).toLocaleString();
}

function normalizeBrief(value: string | null | undefined) {
  const trimmed = value?.trim();

  return trimmed || null;
}

function buildWebsiteBrief(detail: CompanyRecordDetail) {
  const website = detail.latestWebsiteResearchResult;

  if (!website) {
    return {
      body: null,
      signals: [],
      pages: [],
    };
  }

  const signalLabels = uniqueStrings([
    ...readSignalLabels(website.signalsJson),
    ...readKeywordLabels(website.signalsJson),
    ...readClassificationHintLabels(website.classificationHintsJson),
  ]).slice(0, 8);
  const pages = readUsefulPages(website.pagesCheckedJson).slice(0, 3);
  const errorLabels = readWebsiteErrors(website.errorsJson).slice(0, 2);
  const bodyParts = [
    `Website research status is ${website.status} with ${website.quality} evidence quality.`,
    website.reachable ? "Website is reachable." : "Website is not reachable.",
    website.finalUrl ? `Final URL: ${website.finalUrl}.` : null,
    normalizeBrief(website.summary),
    signalLabels.length > 0
      ? `Top signals: ${signalLabels.slice(0, 5).join(", ")}.`
      : "Specific product signals were not available from stored evidence.",
    pages.length > 0
      ? `Useful pages checked: ${pages.join("; ")}.`
      : "No useful page snippets were saved.",
    errorLabels.length > 0
      ? `Caution: ${errorLabels.join("; ")}.`
      : null,
  ].filter((part): part is string => Boolean(part));

  return {
    body: bodyParts.join(" "),
    signals: signalLabels,
    pages,
  };
}

function toCompanyReviewRowFromDetail(detail: CompanyRecordDetail): CompanyReviewRow {
  return {
    companyRecordId: detail.companyRecord.id,
    uploadJobId: detail.companyRecord.uploadJobId,
    companyName: detail.companyRecord.companyName,
    website: detail.companyRecord.website,
    normalizedDomain: detail.latestWebsiteResearchResult?.normalizedDomain ?? null,
    companyLinkedInUrl: detail.companyRecord.companyLinkedInUrl,
    companyCountry: detail.companyRecord.companyCountry,
    companyIndustry: detail.companyRecord.companyIndustry,
    companyStaffCountRange: detail.companyRecord.companyStaffCountRange,
    duplicateKey: null,
    duplicateRecordCount: 1,
    hiddenDuplicateRecordCount: 0,
    duplicateUploadCount: detail.uploadJob ? 1 : 0,
    archivedAt: detail.companyRecord.archivedAt,
    deletedAt: detail.companyRecord.deletedAt,
    scoreResult: detail.latestScoreResult
      ? {
          id: detail.latestScoreResult.id,
          companyScore: detail.latestScoreResult.companyScore,
          qualification: detail.latestScoreResult.qualification,
          companyType: detail.latestScoreResult.companyType,
          confidence: detail.latestScoreResult.confidence,
          reason: detail.latestScoreResult.reason,
          oneSentenceCompanySummary:
            detail.latestScoreResult.oneSentenceCompanySummary,
          hardRuleFlagsJson: detail.latestScoreResult.hardRuleFlagsJson,
          reviewState: detail.latestScoreResult.reviewState,
          scoringSource: detail.latestScoreResult.scoringSource,
          scoringVersion: detail.latestScoreResult.scoringVersion,
          createdAt: detail.latestScoreResult.createdAt,
        }
      : null,
    websiteResearch: detail.latestWebsiteResearchResult
      ? {
          id: detail.latestWebsiteResearchResult.id,
          status: detail.latestWebsiteResearchResult.status,
          quality: detail.latestWebsiteResearchResult.quality,
          reachable: detail.latestWebsiteResearchResult.reachable,
          normalizedDomain: detail.latestWebsiteResearchResult.normalizedDomain,
          finalUrl: detail.latestWebsiteResearchResult.finalUrl,
          summary: detail.latestWebsiteResearchResult.summary,
          signalsJson: detail.latestWebsiteResearchResult.signalsJson,
          classificationHintsJson:
            detail.latestWebsiteResearchResult.classificationHintsJson,
          pagesCheckedJson: detail.latestWebsiteResearchResult.pagesCheckedJson,
          errorsJson: detail.latestWebsiteResearchResult.errorsJson,
          researchedAt: detail.latestWebsiteResearchResult.researchedAt,
          createdAt: detail.latestWebsiteResearchResult.createdAt,
        }
      : null,
    latestFeedbackExample: detail.latestFeedbackExample
      ? {
          id: detail.latestFeedbackExample.id,
          companyRecordId: detail.companyRecord.id,
          companyScoreResultId: detail.latestFeedbackExample.companyScoreResultId,
          predictedCompanyScore:
            detail.latestFeedbackExample.predictedCompanyScore,
          predictedCompanyType: detail.latestFeedbackExample.predictedCompanyType,
          predictedQualification:
            detail.latestFeedbackExample.predictedQualification,
          predictedReason: detail.latestFeedbackExample.predictedReason,
          finalCompanyScore: detail.latestFeedbackExample.finalCompanyScore,
          finalCompanyType: detail.latestFeedbackExample.finalCompanyType,
          finalQualification: detail.latestFeedbackExample.finalQualification,
          finalNote: detail.latestFeedbackExample.finalNote,
          approvedForLearning:
            detail.latestFeedbackExample.approvedForLearning ?? false,
          useForPromptRefinement:
            detail.latestFeedbackExample.useForPromptRefinement ?? false,
          useForRuleTuning:
            detail.latestFeedbackExample.useForRuleTuning ?? false,
          useForModelTraining:
            detail.latestFeedbackExample.useForModelTraining ?? false,
          useForEvaluationBenchmark:
            detail.latestFeedbackExample.useForEvaluationBenchmark ?? false,
          datasetSplit: detail.latestFeedbackExample.datasetSplit ?? "UNSPECIFIED",
          source: detail.latestFeedbackExample.source ?? "LOCAL_UI",
          rawExampleJson: detail.latestFeedbackExample.rawExampleJson ?? null,
          createdAt: detail.latestFeedbackExample.createdAt,
          updatedAt: detail.latestFeedbackExample.updatedAt,
        }
      : null,
    latestAiJob: detail.latestAiJob,
    latestAiAssessment: detail.latestAiAssessment
      ? {
          id: detail.latestAiAssessment.id,
          provider: detail.latestAiAssessment.provider,
          modelName: detail.latestAiAssessment.modelName,
          promptVersion: detail.latestAiAssessment.promptVersion,
          mode: detail.latestAiAssessment.mode,
          qualification: detail.latestAiAssessment.qualification,
          companyType: detail.latestAiAssessment.companyType,
          companyScore: detail.latestAiAssessment.companyScore,
          confidence: detail.latestAiAssessment.confidence,
          reason: detail.latestAiAssessment.reason,
          oneSentenceCompanySummary:
            detail.latestAiAssessment.oneSentenceCompanySummary,
          brief: detail.latestAiAssessment.brief,
          cacheHit: detail.latestAiAssessment.cacheHit,
          createdAt: detail.latestAiAssessment.createdAt,
        }
      : null,
    latestIcpInsight: detail.latestIcpInsight
      ? {
          id: detail.latestIcpInsight.id,
          targetCustomerSegment: detail.latestIcpInsight.targetCustomerSegment,
          sdrMessagingAngle: detail.latestIcpInsight.sdrMessagingAngle,
          source: detail.latestIcpInsight.source,
          createdAt: detail.latestIcpInsight.createdAt,
        }
      : null,
  };
}

function readSignalLabels(value: unknown) {
  const record = asRecord(value);
  const labels: string[] = [];

  if (record.hasProductSignal) labels.push("Product signal");
  if (record.hasCloudSignal) labels.push("Cloud");
  if (record.hasApiSignal) labels.push("API");
  if (record.hasAiSignal) labels.push("AI");
  if (record.hasDataSignal) labels.push("Data");
  if (record.hasSecuritySignal) labels.push("Security");
  if (record.hasPricingSignal) labels.push("Pricing page");
  if (record.hasServiceSignal) labels.push("Service-led");

  return labels;
}

function readKeywordLabels(value: unknown) {
  const record = asRecord(value);
  const labels: string[] = [];
  const keys = [
    "positiveKeywords",
    "productSignals",
    "aiSignals",
    "cloudSignals",
    "dataSignals",
    "securitySignals",
    "serviceSignals",
    "negativeKeywords",
  ];

  for (const key of keys) {
    const valueForKey = record[key];

    if (!Array.isArray(valueForKey)) {
      continue;
    }

    for (const item of valueForKey) {
      if (typeof item === "string") {
        labels.push(item);
      } else {
        const itemRecord = asRecord(item);
        const keyword =
          typeof itemRecord.keyword === "string"
            ? itemRecord.keyword
            : typeof itemRecord.category === "string"
              ? itemRecord.category
              : null;

        if (keyword) {
          labels.push(keyword);
        }
      }
    }
  }

  return labels;
}

function readClassificationHintLabels(value: unknown) {
  const record = asRecord(value);
  const labels: string[] = [];

  if (record.likelySaas) labels.push("SaaS");
  if (record.likelyCloud) labels.push("Cloud");
  if (record.likelyAi) labels.push("AI");
  if (record.likelyDataSolution) labels.push("Data solution");
  if (record.likelyCyberSecurity) labels.push("Cyber security");
  if (record.likelyProductLed) labels.push("Product-led");
  if (record.likelyServiceLed) labels.push("Service-led");

  return labels;
}

function readUsefulPages(value: unknown) {
  const records = Array.isArray(value) ? value : [];

  return records
    .map((item) => {
      const record = asRecord(item);
      const title =
        typeof record.title === "string"
          ? record.title
          : typeof record.url === "string"
            ? record.url
            : null;
      const snippet =
        typeof record.textSnippet === "string"
          ? record.textSnippet
          : typeof record.metaDescription === "string"
            ? record.metaDescription
            : null;

      return uniqueStrings([title, snippet ? snippet.slice(0, 120) : null]).join(
        " - "
      );
    })
    .filter((item) => item.length > 0);
}

function readWebsiteErrors(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }

      const record = asRecord(item);
      return typeof record.message === "string"
        ? record.message
        : typeof record.error === "string"
          ? record.error
          : null;
    })
    .filter((item): item is string => Boolean(item));
}

function asRecord(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
    )
  );
}

function normalizeEvidenceQuality(value: string | null | undefined) {
  const normalized = value?.toLowerCase();

  if (!normalized) {
    return "unavailable";
  }

  if (normalized.includes("strong")) {
    return "strong";
  }

  if (normalized.includes("weak")) {
    return "weak";
  }

  return "medium";
}

function getEvidenceQualityTone(quality: string) {
  if (quality === "strong") {
    return "success";
  }

  if (quality === "weak") {
    return "warning";
  }

  if (quality === "unavailable") {
    return "neutral";
  }

  return "info";
}

function getBriefSourceTone(source: StructuredCompanyBrief["source"]) {
  if (source === "ai") return "info";
  if (source === "website") return "success";
  if (source === "local_rule") return "warning";

  return "neutral";
}

function getAiJobTone(status: string) {
  if (status === "failed") {
    return "danger";
  }

  if (status === "retry_scheduled") {
    return "warning";
  }

  if (status === "succeeded") {
    return "success";
  }

  return "neutral";
}

function formatAiJobStatus(status: string) {
  if (status === "retry_scheduled") {
    return "AI waiting for retry";
  }

  if (status === "pending") {
    return "AI queued";
  }

  if (status === "running") {
    return "AI processing";
  }

  if (status === "failed") {
    return "AI failed";
  }

  return `AI ${status.replaceAll("_", " ")}`;
}

function getAiJobStatusCopy(job: CompanyRecordDetail["latestAiJob"]) {
  if (!job) {
    return "No AI job is queued for this company.";
  }

  if (job.status === "pending") {
    return "This company is waiting for AI assessment. Local scoring and SDR review are available now.";
  }

  if (job.status === "running") {
    return "AI assessment is currently processing. Local scoring and SDR review are available now.";
  }

  if (job.status === "retry_scheduled") {
    return "AI assessment is waiting for retry after provider quota or rate-limit recovery. Local scoring and SDR review still work.";
  }

  if (job.status === "failed") {
    return job.lastErrorMessage
      ? `AI assessment failed: ${job.lastErrorMessage}`
      : "AI assessment failed for this company. Local scoring and SDR review still work.";
  }

  if (job.status === "succeeded") {
    return "AI job is marked succeeded, but no AI assessment result is available in this detail payload yet. Refresh or inspect the job.";
  }

  return "AI job exists for this company, but no AI assessment has been saved yet.";
}

function normalizeExternalHref(value: string | null | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
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

  return "AI assessment could not complete. Local scoring and SDR review still work.";
}
