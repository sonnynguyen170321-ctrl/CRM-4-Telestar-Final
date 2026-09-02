"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  X,
} from "lucide-react";

import {
  CompanyIcpInsightCard,
  type CompanyIcpFallbackContext,
} from "@/components/companies/CompanyIcpInsightCard";
import {
  buildCompanyBrief,
  formatAiAgreementLabel,
  formatAiConfidence,
  getClassificationHints,
  getCompanyBrief,
  getAiDisplayState,
  getEvidenceItems,
  getHardRuleFlags,
  getRuleAiComparisonForCompany,
  getSignalLabels,
  type AiDisplayModel,
  type CompanyReviewRow,
  type StructuredCompanyBrief,
} from "@/components/companies/companyReviewUtils";
import {
  CompanyTypeBadge,
  QualificationBadge,
  ScoreBadge,
  StatusBadge,
} from "@/components/shared/statusBadges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  enqueueCompanyAiAssessment,
  getCompanyRecordDetail,
} from "@/lib/client/companyRecords";
import { saveCompanyReviewFeedback } from "@/lib/client/feedbackExamples";
import type { CompanyType, Qualification } from "@/lib/types";

const companyTypes: CompanyType[] = [
  "Not Relevant",
  "PAAS",
  "SAAS",
  "Cloud",
  "ITO",
  "Data Solution",
  "AI Solution",
  "AI Service",
  "Cyber Security",
  "Blockchain Solution",
];

const qualifications: Qualification[] = [
  "qualified",
  "unqualified",
  "uncertain",
];

type DrawerTab = "overview" | "ai" | "history" | "raw";
type AiQueueUiStatus =
  | "idle"
  | "queueing"
  | "queued"
  | "processing"
  | "completed"
  | "failed";

export function CompanyReviewDrawer({
  company,
  open,
  queuePosition,
  canGoPrevious,
  canGoNext,
  onPrevious,
  onNext,
  onOpenChange,
}: {
  company: CompanyReviewRow | null;
  open: boolean;
  queuePosition: { current: number; total: number } | null;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="fixed inset-y-0 right-0 left-auto z-50 h-dvh !w-[72vw] !min-w-[960px] !max-w-none overflow-y-auto border-l border-slate-200 bg-white p-0 shadow-2xl sm:!max-w-none max-lg:!w-[calc(100vw-24px)] max-lg:!min-w-0"
      >
        {company ? (
          <ReviewContent
            key={company.companyRecordId}
            company={company}
            queuePosition={queuePosition}
            canGoPrevious={canGoPrevious}
            canGoNext={canGoNext}
            onPrevious={onPrevious}
            onNext={onNext}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <EmptyContent />
        )}
      </SheetContent>
    </Sheet>
  );
}

function ReviewContent({
  company,
  queuePosition,
  canGoPrevious,
  canGoNext,
  onPrevious,
  onNext,
  onClose,
}: {
  company: CompanyReviewRow;
  queuePosition: { current: number; total: number } | null;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [drawerCompany, setDrawerCompany] = useState(company);
  const feedback = drawerCompany.latestFeedbackExample;
  const [activeTab, setActiveTab] = useState<DrawerTab>("overview");
  const [finalQualification, setFinalQualification] = useState<Qualification>(
    toQualification(
      feedback?.finalQualification ?? company.scoreResult?.qualification
    ) ?? "uncertain"
  );
  const [finalCompanyType, setFinalCompanyType] = useState<CompanyType>(
    toCompanyType(feedback?.finalCompanyType ?? company.scoreResult?.companyType) ??
      "Not Relevant"
  );
  const [finalScore, setFinalScore] = useState(
    feedback
      ? String(feedback.finalCompanyScore)
      : company.scoreResult
        ? String(company.scoreResult.companyScore)
        : ""
  );
  const [finalNote, setFinalNote] = useState(feedback?.finalNote ?? "");
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "failed"
  >("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [aiQueueStatus, setAiQueueStatus] =
    useState<AiQueueUiStatus>("idle");
  const [aiQueueMessage, setAiQueueMessage] = useState<string | null>(null);

  const signalLabels = useMemo(
    () => getSignalLabels(drawerCompany.websiteResearch?.signalsJson),
    [drawerCompany.websiteResearch?.signalsJson]
  );
  const evidence = useMemo(
    () => getEvidenceItems(drawerCompany.websiteResearch?.signalsJson, 5),
    [drawerCompany.websiteResearch?.signalsJson]
  );
  const hints = useMemo(
    () =>
      getClassificationHints(
        drawerCompany.websiteResearch?.classificationHintsJson
      ),
    [drawerCompany.websiteResearch?.classificationHintsJson]
  );
  const hardRuleFlags = useMemo(
    () => getHardRuleFlags(drawerCompany.scoreResult?.hardRuleFlagsJson),
    [drawerCompany.scoreResult?.hardRuleFlagsJson]
  );
  const structuredBrief = useMemo(
    () => buildCompanyBrief(drawerCompany),
    [drawerCompany]
  );
  const aiDisplayState = useMemo(
    () =>
      getAiDisplayState({
        latestAiAssessment: drawerCompany.latestAiAssessment,
        latestAiJob: drawerCompany.latestAiJob,
      }),
    [drawerCompany.latestAiAssessment, drawerCompany.latestAiJob]
  );
  const aiComparison = useMemo(
    () => getRuleAiComparisonForCompany(drawerCompany),
    [drawerCompany]
  );
  const companyBrief = getCompanyBrief(drawerCompany);
  const icpFallbackContext: CompanyIcpFallbackContext = useMemo(
    () => ({
      companyName: drawerCompany.companyName,
      companyType:
        drawerCompany.latestFeedbackExample?.finalCompanyType ??
        drawerCompany.latestAiAssessment?.companyType ??
        drawerCompany.scoreResult?.companyType ??
        null,
      qualification:
        drawerCompany.latestFeedbackExample?.finalQualification ??
        drawerCompany.latestAiAssessment?.qualification ??
        drawerCompany.scoreResult?.qualification ??
        null,
      industry: drawerCompany.companyIndustry,
      companyBrief,
      signalLabels,
      aiReason: drawerCompany.latestAiAssessment?.reason ?? null,
      aiSummary:
        drawerCompany.latestAiAssessment?.oneSentenceCompanySummary ?? null,
    }),
    [
      companyBrief,
      drawerCompany.companyIndustry,
      drawerCompany.companyName,
      drawerCompany.latestAiAssessment,
      drawerCompany.latestFeedbackExample,
      drawerCompany.scoreResult,
      signalLabels,
    ]
  );

  async function handleSaveFeedback() {
    const numericScore = validateFinalScore();

    if (numericScore === null) {
      return;
    }

    setSaveStatus("saving");
    setSaveError(null);

    try {
      await saveCompanyReviewFeedback({
        company: drawerCompany,
        finalQualification,
        finalCompanyType,
        finalCompanyScore: numericScore,
        finalNote,
      });
      setSaveStatus("saved");
    } catch (error) {
      setSaveStatus("failed");
      setSaveError(
        error instanceof Error ? error.message : "Feedback save failed."
      );
    }
  }

  function handleScoreChange(event: ChangeEvent<HTMLInputElement>) {
    setFinalScore(event.target.value);
    resetSaveState();

    if (scoreError) {
      setScoreError(null);
    }
  }

  function validateFinalScore() {
    const trimmedScore = finalScore.trim();

    if (!trimmedScore) {
      setScoreError("Final score is required.");
      return null;
    }

    const numericScore = Number(trimmedScore);

    if (
      !Number.isFinite(numericScore) ||
      !Number.isInteger(numericScore) ||
      numericScore < 0 ||
      numericScore > 100
    ) {
      setScoreError("Final score must be a whole number from 0 to 100.");
      return null;
    }

    setScoreError(null);
    return numericScore;
  }

  function resetSaveState() {
    if (saveStatus !== "idle") {
      setSaveStatus("idle");
    }

    if (saveError) {
      setSaveError(null);
    }
  }

  async function handleQueueAiAssessment() {
    setAiQueueStatus("queueing");
    setAiQueueMessage(null);

    try {
      const result = await enqueueCompanyAiAssessment(drawerCompany.companyRecordId);
      setAiQueueStatus(result.skipped ? "processing" : "queued");
      setAiQueueMessage(
        result.reason ??
          "AI assessment queued. Background worker must be running to process it."
      );
      router.refresh();
      await refreshAiAssessment("AI assessment queued. Checking for saved result...");
      await pollForAiAssessment();
    } catch (error) {
      setAiQueueStatus("failed");
      setAiQueueMessage(
        error instanceof Error ? error.message : "AI assessment could not be queued."
      );
    }
  }

  async function refreshAiAssessment(message = "Refreshing AI result...") {
    setAiQueueMessage(message);

    try {
      const detail = await getCompanyRecordDetail(drawerCompany.companyRecordId);
      const refreshedAssessment = detail.latestAiAssessment
        ? toRowAiAssessment(detail.latestAiAssessment)
        : null;

      setDrawerCompany((current) => ({
        ...current,
        latestAiAssessment:
          refreshedAssessment ?? current.latestAiAssessment,
        latestAiJob: detail.latestAiJob ?? current.latestAiJob,
      }));

      if (refreshedAssessment) {
        setAiQueueStatus("completed");
        setAiQueueMessage("AI assessment saved. Insight boxes updated.");
        return true;
      }

      const jobStatus = detail.latestAiJob?.status;

      if (jobStatus === "failed") {
        setAiQueueStatus("failed");
        setAiQueueMessage(
          detail.latestAiJob?.lastErrorMessage ??
            "AI assessment failed. Local scoring and SDR review still work."
        );
        return false;
      }

      setAiQueueStatus(
        jobStatus === "running" || jobStatus === "pending" || jobStatus === "retry_scheduled"
          ? "processing"
          : "queued"
      );
      setAiQueueMessage(
        jobStatus
          ? `${formatAiJobStatus(jobStatus)}. Waiting for saved assessment.`
          : "AI assessment not saved yet. Refresh later if the worker is still processing."
      );
      return false;
    } catch (error) {
      setAiQueueStatus("failed");
      setAiQueueMessage(
        error instanceof Error ? error.message : "AI result refresh failed."
      );
      return false;
    }
  }

  async function pollForAiAssessment() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await sleep(3000);
      const completed = await refreshAiAssessment(
        `Waiting for AI result... ${attempt + 1}/20`
      );

      if (completed) {
        return;
      }
    }

    setAiQueueStatus("processing");
    setAiQueueMessage("Still processing. Refresh AI result later.");
  }

  return (
    <>
      <SheetHeader className="sticky top-0 z-20 border-b border-slate-200 bg-white px-5 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3">
            <CompanyAvatar name={drawerCompany.companyName} />
            <div>
              <SheetTitle className="text-lg font-semibold text-slate-950">
                {drawerCompany.companyName}
              </SheetTitle>
              <a
                href={normalizeExternalHref(drawerCompany.website) ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline"
              >
                {drawerCompany.website || "No website"}
                {drawerCompany.website && <ExternalLink className="h-3 w-3" />}
              </a>
              <p className="mt-1 text-xs text-slate-500">
                {drawerCompany.companyCountry || "No country"} /{" "}
                {drawerCompany.companyStaffCountRange || "Staff not provided"}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <ScoreBadge
                  score={
                    feedback?.finalCompanyScore ??
                    drawerCompany.scoreResult?.companyScore
                  }
                />
                <QualificationBadge
                  qualification={
                    feedback?.finalQualification ??
                    drawerCompany.scoreResult?.qualification ??
                    "unscored"
                  }
                />
                {feedback && <Badge variant="secondary">Reviewed</Badge>}
              </div>
            </div>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 rounded-lg text-slate-500 hover:bg-slate-100"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </SheetHeader>

      <div className="sticky top-[6.5rem] z-10 flex border-b border-slate-200 bg-white px-5">
        {[
          ["overview", "Overview"],
          ["ai", "AI Insights"],
          ["history", "History"],
          ["raw", "Raw Data"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setActiveTab(value as DrawerTab)}
            className={`border-b-2 px-3 py-3 text-sm font-medium ${
              activeTab === value
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-4 p-5">
        {activeTab === "overview" && (
          <>
            <div className="grid gap-4 xl:grid-cols-[minmax(360px,420px)_minmax(0,1fr)]">
              <div className="space-y-4">
                <DrawerCard title="SDR Review">
                  <SdrReviewForm
                    finalQualification={finalQualification}
                    setFinalQualification={(value) => {
                      setFinalQualification(value);
                      resetSaveState();
                    }}
                    finalCompanyType={finalCompanyType}
                    setFinalCompanyType={(value) => {
                      setFinalCompanyType(value);
                      resetSaveState();
                    }}
                    finalScore={finalScore}
                    onScoreChange={handleScoreChange}
                    finalNote={finalNote}
                    setFinalNote={(value) => {
                      setFinalNote(value);
                      resetSaveState();
                    }}
                    scoreError={scoreError}
                    saveStatus={saveStatus}
                    saveError={saveError}
                    onSave={() => void handleSaveFeedback()}
                  />
                </DrawerCard>

                <DrawerCard title="AI Second Opinion">
                  <CompanyAiStatusPanel
                    company={drawerCompany}
                    displayState={aiDisplayState}
                    aiComparison={aiComparison}
                    queueStatus={aiQueueStatus}
                    queueMessage={aiQueueMessage}
                    onQueue={() => void handleQueueAiAssessment()}
                    onRefresh={() => void refreshAiAssessment()}
                  />
                </DrawerCard>

                <DrawerCard title="Website research (AI)">
                  <div className="mb-3 flex flex-wrap gap-2">
                    <Badge variant="outline">
                      {drawerCompany.websiteResearch?.status ?? "No research"}
                    </Badge>
                    <Badge variant="secondary">
                      {drawerCompany.websiteResearch?.quality ?? "Unknown quality"}
                    </Badge>
                  </div>
                  <DetailBlock
                    label="Website summary"
                    value={drawerCompany.websiteResearch?.summary ?? "No summary saved."}
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    {signalLabels.length > 0 ? (
                      signalLabels.map((label) => (
                        <Badge key={label} variant="outline">
                          {label}
                        </Badge>
                      ))
                    ) : (
                      <Badge variant="outline">No signal chips</Badge>
                    )}
                  </div>
                </DrawerCard>
              </div>

              <div className="space-y-4">
                <DrawerCard title="Company Brief">
                  <CompanyBriefSummary brief={structuredBrief} />
                </DrawerCard>

                <DrawerCard title="ICP / persona insight">
                  <AiRunStateBanner
                    status={aiQueueStatus}
                    message={aiQueueMessage}
                    hasAssessment={Boolean(drawerCompany.latestAiAssessment)}
                    onRefresh={() => void refreshAiAssessment()}
                  />
                  <CompanyIcpInsightCard
                    companyRecordId={drawerCompany.companyRecordId}
                    fallbackContext={icpFallbackContext}
                  />
                </DrawerCard>

                <DrawerCard title="Rule vs AI comparison">
                  <ComparisonRow
                    label="ICP fit"
                    ruleValue={drawerCompany.scoreResult?.companyScore}
                    aiValue={drawerCompany.latestAiAssessment?.companyScore}
                  />
                  <ComparisonRow
                    label="Confidence"
                    ruleValue={
                      drawerCompany.scoreResult
                        ? Math.round(drawerCompany.scoreResult.confidence * 100)
                        : null
                    }
                    aiValue={
                      drawerCompany.latestAiAssessment
                        ? Math.round(drawerCompany.latestAiAssessment.confidence * 100)
                        : null
                    }
                  />
                  <div className="mt-3 grid gap-2 text-sm">
                    <SnapshotRow
                      label="Rule type"
                      value={drawerCompany.scoreResult?.companyType}
                    />
                    <SnapshotRow
                      label="AI type"
                      value={drawerCompany.latestAiAssessment?.companyType}
                    />
                  </div>
                </DrawerCard>
              </div>
            </div>
          </>
        )}

        {activeTab === "ai" && (
          <>
            <DrawerCard title="SDR insight boxes">
              <AiRunStateBanner
                status={aiQueueStatus}
                message={aiQueueMessage}
                hasAssessment={Boolean(drawerCompany.latestAiAssessment)}
                onRefresh={() => void refreshAiAssessment()}
              />
              <CompanyIcpInsightCard
                companyRecordId={drawerCompany.companyRecordId}
                fallbackContext={icpFallbackContext}
              />
            </DrawerCard>

            <DrawerCard title="Rule baseline">
              <DetailBlock label="Company brief" value={companyBrief} />
              <DetailBlock
                label="Reason"
                value={drawerCompany.scoreResult?.reason ?? "No reason saved."}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {hardRuleFlags.slice(0, 8).map((flag) => (
                  <Badge key={flag.key} variant={flag.triggered ? "destructive" : "outline"}>
                    {flag.key.replaceAll("_", " ")}
                  </Badge>
                ))}
              </div>
            </DrawerCard>

            <DrawerCard title="AI suggestion">
              <CompanyAiStatusPanel
                company={drawerCompany}
                displayState={aiDisplayState}
                aiComparison={aiComparison}
                queueStatus={aiQueueStatus}
                queueMessage={aiQueueMessage}
                onQueue={() => void handleQueueAiAssessment()}
                onRefresh={() => void refreshAiAssessment()}
              />
            </DrawerCard>
            <DrawerCard title="Evidence Snippets">
              <div className="space-y-3">
                {evidence.length > 0 ? (
                  evidence.map((item, index) => (
                    <div key={`${item.keyword}-${index}`} className="rounded-lg border border-slate-200 p-3">
                      <Badge variant="secondary">{item.category}</Badge>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        {item.snippet}
                      </p>
                    </div>
                  ))
                ) : (
                  <EmptyPanel message="No evidence snippets available." />
                )}
              </div>
            </DrawerCard>
          </>
        )}

        {activeTab === "history" && (
          <>
            <DrawerCard title="Latest saved feedback">
              {feedback ? (
                <>
                  <SnapshotRow label="Final qualification" value={feedback.finalQualification} />
                  <SnapshotRow label="Final company type" value={feedback.finalCompanyType} />
                  <SnapshotRow label="Final score" value={String(feedback.finalCompanyScore)} />
                  <DetailBlock
                    label="Reviewer note"
                    value={feedback.finalNote || "No reviewer note saved."}
                  />
                </>
              ) : (
                <EmptyPanel message="No saved feedback for this company yet." />
              )}
            </DrawerCard>
            <DrawerCard title="Classification hints">
              {hints ? (
                <div className="grid gap-2">
                  {Object.entries(hints).map(([key, value]) => (
                    <SnapshotRow key={key} label={formatHintName(key)} value={value ? "yes" : "no"} />
                  ))}
                </div>
              ) : (
                <EmptyPanel message="No classification hints saved." />
              )}
            </DrawerCard>
          </>
        )}

        {activeTab === "raw" && (
          <div className="space-y-3">
            {[
              ["Contacts", "Contact data is available in the dedicated People/Contacts workspace when matched."],
              ["Activities", "Activity recap data remains in the activity workspace."],
              ["AI Insights", drawerCompany.latestAiAssessment?.reason ?? "No AI assessment saved."],
              ["History", feedback ? `Latest feedback saved ${new Date(feedback.updatedAt).toLocaleString()}` : "No saved feedback history."],
              ["Raw Data", `Company record ID: ${drawerCompany.companyRecordId}`],
            ].map(([title, body]) => (
              <details key={title} className="rounded-xl border border-slate-200 bg-white">
                <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-900">
                  {title}
                </summary>
                <div className="border-t border-slate-200 px-4 py-3 text-sm leading-6 text-slate-600">
                  {body}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
      <ReviewQueueFooter
        queuePosition={queuePosition}
        canGoPrevious={canGoPrevious}
        canGoNext={canGoNext}
        onPrevious={onPrevious}
        onNext={onNext}
      />
    </>
  );
}

function ReviewQueueFooter({
  queuePosition,
  canGoPrevious,
  canGoNext,
  onPrevious,
  onNext,
}: {
  queuePosition: { current: number; total: number } | null;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="sticky bottom-0 z-20 border-t border-slate-200 bg-white px-5 py-3 shadow-[0_-8px_20px_rgba(15,23,42,0.06)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-600">
          {queuePosition
            ? `${queuePosition.current} of ${queuePosition.total}`
            : "Review queue"}
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-lg border-slate-200 bg-white px-3"
            onClick={onPrevious}
            disabled={!canGoPrevious}
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-lg border-slate-200 bg-white px-3"
            onClick={onNext}
            disabled={!canGoNext}
          >
            Next
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function CompanyBriefSummary({ brief }: { brief: StructuredCompanyBrief }) {
  const contextRows = ([
    ["Industry", brief.industry],
    ["Product/service", brief.productOrService],
    ["ICP segment", brief.icpSegment],
    ["Target customers", brief.targetCustomers],
    ["Niche", brief.niche],
    [
      "Confidence/source date",
      brief.confidence !== undefined
        ? `${formatAiConfidence(brief.confidence)} / ${
            formatDateTime(brief.generatedAt) ?? "date unavailable"
          }`
        : formatDateTime(brief.generatedAt),
    ],
  ] as Array<[string, string | null | undefined]>).filter(([, value]) =>
    Boolean(value)
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={getBriefSourceTone(brief.source)}>
          {brief.sourceLabel}
        </StatusBadge>
        <span className="text-xs text-slate-500">{brief.sourceCopy}</span>
      </div>

      <p className="text-sm leading-6 text-slate-900">
        {brief.oneLineSummary}
      </p>

      {contextRows.length > 0 ? (
        <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm md:grid-cols-2">
          {contextRows.map(([label, value]) => (
            <SnapshotRow key={label} label={label} value={value} />
          ))}
        </div>
      ) : null}

      {brief.outreachAngle ||
      brief.recommendedNextAction ||
      brief.keyPainPoints.length > 0 ? (
        <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-3">
          <p className="text-xs font-semibold uppercase text-blue-700">
            SDR angle
          </p>
          {brief.outreachAngle ? (
            <p className="mt-2 text-sm leading-6 text-slate-700">
              {brief.outreachAngle}
            </p>
          ) : null}
          {brief.keyPainPoints.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {brief.keyPainPoints.map((painPoint) => (
                <Badge key={painPoint} variant="outline">
                  {painPoint}
                </Badge>
              ))}
            </div>
          ) : null}
          {brief.recommendedNextAction ? (
            <p className="mt-2 text-xs font-medium text-slate-600">
              Next action: {brief.recommendedNextAction}
            </p>
          ) : null}
        </div>
      ) : null}

      {brief.evidenceSummary || brief.fallbackReason || brief.risks ? (
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
          <p className="text-xs font-semibold uppercase text-slate-500">
            Evidence
          </p>
          {brief.evidenceSummary ? (
            <p className="mt-2 leading-6 text-slate-700">
              {brief.evidenceSummary}
            </p>
          ) : null}
          {brief.risks ? (
            <p className="mt-2 text-xs text-amber-700">Risk: {brief.risks}</p>
          ) : null}
          {brief.fallbackReason ? (
            <p className="mt-2 text-xs text-slate-500">
              {brief.fallbackReason}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CompanyAiStatusPanel({
  company,
  displayState,
  aiComparison,
  queueStatus,
  queueMessage,
  onQueue,
  onRefresh,
}: {
  company: CompanyReviewRow;
  displayState: AiDisplayModel;
  aiComparison: ReturnType<typeof getRuleAiComparisonForCompany>;
  queueStatus: AiQueueUiStatus;
  queueMessage: string | null;
  onQueue: () => void;
  onRefresh: () => void;
}) {
  const assessment = company.latestAiAssessment;
  const job = company.latestAiJob;
  const pendingOrRunning = job?.status === "pending" || job?.status === "running";
  const canQueue = !assessment && !pendingOrRunning && !company.deletedAt;

  if (assessment) {
    return (
      <div className="space-y-3">
        <p className="text-sm leading-6 text-slate-600">
          AI is a second opinion. SDR final feedback remains the source of
          truth.
        </p>
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone="success">{displayState.label}</StatusBadge>
          <CompanyTypeBadge companyType={assessment.companyType} />
          <QualificationBadge qualification={assessment.qualification} />
          <ScoreBadge score={assessment.companyScore} />
          <Badge variant="outline">
            {formatAiConfidence(assessment.confidence)} confidence
          </Badge>
          {assessment.cacheHit && <Badge variant="outline">Cache hit</Badge>}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase text-slate-500">
              AI recommendation
            </p>
            <div className="mt-2 grid gap-2 text-sm">
              <SnapshotRow label="Qualification" value={assessment.qualification} />
              <SnapshotRow label="Company type" value={assessment.companyType} />
              <SnapshotRow
                label="Score"
                value={String(assessment.companyScore)}
              />
              <SnapshotRow
                label="Confidence"
                value={formatAiConfidence(assessment.confidence)}
              />
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase text-slate-500">
              Rule vs AI
            </p>
            <div className="mt-2 grid gap-2 text-sm">
              <SnapshotRow
                label="Agreement"
                value={formatAiAgreementLabel(aiComparison)}
              />
              <SnapshotRow
                label="Rule score"
                value={
                  aiComparison.localScore === null
                    ? null
                    : String(aiComparison.localScore)
                }
              />
              <SnapshotRow
                label="AI score"
                value={
                  aiComparison.aiScore === null
                    ? null
                    : String(aiComparison.aiScore)
                }
              />
              <SnapshotRow
                label="Score delta"
                value={
                  aiComparison.scoreDelta === null
                    ? null
                    : String(aiComparison.scoreDelta)
                }
              />
            </div>
          </div>
        </div>
        <DetailBlock
          label="Rule-vs-AI summary"
          value={aiComparison.summary}
        />
        <DetailBlock
          label="AI one-line summary"
          value={
            assessment.oneSentenceCompanySummary ?? "No AI summary saved."
          }
        />
        <DetailBlock label="AI reason" value={assessment.reason} />
        <div className="grid gap-2 text-sm md:grid-cols-2">
          <SnapshotRow label="Provider" value={assessment.provider} />
          <SnapshotRow label="Model" value={assessment.modelName} />
          <SnapshotRow label="Prompt version" value={assessment.promptVersion} />
          <SnapshotRow label="Created at" value={formatDateTime(assessment.createdAt)} />
        </div>
      </div>
    );
  }

  if (job) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone={getAiDisplayTone(displayState.tone)}>
            {displayState.label}
          </StatusBadge>
          {job.cacheHit ? <StatusBadge tone="success">Cache hit</StatusBadge> : null}
        </div>
        <p className="text-sm leading-6 text-slate-600">
          {displayState.recommendedAction}
        </p>
        <div className="grid gap-2 text-sm md:grid-cols-2">
          <SnapshotRow label="Status" value={job.status} />
          <SnapshotRow label="Provider" value={job.provider} />
          <SnapshotRow label="Model" value={job.model} />
          <SnapshotRow label="Prompt version" value={job.promptVersion} />
          <SnapshotRow
            label="Attempts"
            value={
              job.attemptCount === undefined || job.maxAttempts === undefined
                ? null
                : `${job.attemptCount}/${job.maxAttempts}`
            }
          />
          <SnapshotRow
            label="Next attempt"
            value={formatDateTime(job.nextAttemptAt)}
          />
          <SnapshotRow label="Last error code" value={job.lastErrorCode} />
          <SnapshotRow
            label="Updated at"
            value={formatDateTime(job.updatedAt)}
          />
        </div>
        {displayState.showJobError && job.lastErrorMessage ? (
          <DetailBlock
            label="Last AI job message"
            value={getFriendlyAiStatusMessage(job.lastErrorMessage)}
          />
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canQueue || queueStatus === "queueing"}
            onClick={onQueue}
          >
            {pendingOrRunning
              ? "AI already queued/running"
              : queueStatus === "queueing"
                ? "Queueing AI assessment..."
                : displayState.canRetry
                  ? "Retry AI second opinion"
                  : "Run AI second opinion"}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onRefresh}>
            Refresh AI status
          </Button>
        </div>
        {queueMessage && (
          <p
            className={`text-xs ${
              queueStatus === "failed" ? "text-destructive" : "text-slate-500"
            }`}
          >
            {queueMessage}
          </p>
        )}
        <p className="text-xs text-slate-500">
          Drawer actions only enqueue or requeue an existing AI job. The
          protected background worker creates CompanyAiAssessment records.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <EmptyPanel message="No AI assessment yet. Run AI if this company needs a second opinion." />
      <Button
        type="button"
        size="sm"
        onClick={onQueue}
        disabled={!canQueue || queueStatus === "queueing"}
      >
        {queueStatus === "queueing" ? "Queueing AI assessment..." : "Run AI second opinion"}
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={onRefresh}>
        Refresh AI status
      </Button>
      {queueMessage && (
        <p
          className={`text-xs ${
            queueStatus === "failed" ? "text-destructive" : "text-slate-500"
          }`}
        >
          {queueMessage}
        </p>
      )}
      <p className="text-xs text-slate-500">
        AI is a second opinion only. Queueing does not process AI from the
        browser and does not expose worker secrets.
      </p>
    </div>
  );
}

function SdrReviewForm({
  finalQualification,
  setFinalQualification,
  finalCompanyType,
  setFinalCompanyType,
  finalScore,
  onScoreChange,
  finalNote,
  setFinalNote,
  scoreError,
  saveStatus,
  saveError,
  onSave,
}: {
  finalQualification: Qualification;
  setFinalQualification: (value: Qualification) => void;
  finalCompanyType: CompanyType;
  setFinalCompanyType: (value: CompanyType) => void;
  finalScore: string;
  onScoreChange: (event: ChangeEvent<HTMLInputElement>) => void;
  finalNote: string;
  setFinalNote: (value: string) => void;
  scoreError: string | null;
  saveStatus: "idle" | "saving" | "saved" | "failed";
  saveError: string | null;
  onSave: () => void;
}) {
  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <label className="text-xs font-medium text-slate-500">
          Final qualification
        </label>
        <Select
          value={finalQualification}
          onValueChange={(value) => setFinalQualification(value as Qualification)}
        >
          <SelectTrigger className="h-10 rounded-lg border-slate-200 bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {qualifications.map((qualification) => (
              <SelectItem key={qualification} value={qualification}>
                {qualification}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <label className="text-xs font-medium text-slate-500">
          Company type
        </label>
        <Select
          value={finalCompanyType}
          onValueChange={(value) => setFinalCompanyType(value as CompanyType)}
        >
          <SelectTrigger className="h-10 rounded-lg border-slate-200 bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {companyTypes.map((type) => (
              <SelectItem key={type} value={type}>
                {type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <label className="text-xs font-medium text-slate-500">
          Score override
        </label>
        <Input
          inputMode="numeric"
          min={0}
          max={100}
          type="number"
          value={finalScore}
          onChange={onScoreChange}
          className="h-10 rounded-lg border-slate-200"
        />
        {scoreError && <p className="text-xs text-destructive">{scoreError}</p>}
      </div>

      <div className="grid gap-2">
        <label className="text-xs font-medium text-slate-500">Final note</label>
        <Textarea
          placeholder="Reviewer note"
          value={finalNote}
          onChange={(event) => setFinalNote(event.target.value)}
          className="min-h-28 rounded-lg border-slate-200"
        />
      </div>

      <Button
        type="button"
        className="h-10 rounded-lg bg-blue-600 font-semibold text-white hover:bg-blue-700"
        onClick={onSave}
        disabled={saveStatus === "saving"}
      >
        {saveStatus === "saving" ? "Saving feedback..." : "Save feedback"}
      </Button>
      <p className="text-center text-xs text-slate-500">
        SDR feedback is the final source of truth.
      </p>
      {saveStatus === "saved" && (
        <p className="rounded-md border bg-slate-50 p-3 text-sm text-slate-600">
          Feedback saved. Refresh to see it reflected in the table.
        </p>
      )}
      {saveStatus === "failed" && saveError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {saveError}
        </p>
      )}
    </div>
  );
}

function AiRunStateBanner({
  status,
  message,
  hasAssessment,
  onRefresh,
}: {
  status: AiQueueUiStatus;
  message: string | null;
  hasAssessment: boolean;
  onRefresh: () => void;
}) {
  const content = getAiRunStateCopy(status, hasAssessment);

  return (
    <div className="mb-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${content.dotClass}`} />
            <p className="text-sm font-semibold text-slate-950">
              {content.label}
            </p>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {message ?? content.description}
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onRefresh}>
          Refresh AI result
        </Button>
      </div>
    </div>
  );
}

function getAiRunStateCopy(status: AiQueueUiStatus, hasAssessment: boolean) {
  if (hasAssessment || status === "completed") {
    return {
      label: "AI insight available",
      description: "Saved AI assessment is being used in the insight boxes.",
      dotClass: "bg-emerald-500",
    };
  }

  if (status === "queueing") {
    return {
      label: "Queueing AI assessment",
      description: "Creating the existing company AI job.",
      dotClass: "bg-blue-500",
    };
  }

  if (status === "queued") {
    return {
      label: "AI assessment queued",
      description: "Waiting for the background worker to create an assessment.",
      dotClass: "bg-blue-500",
    };
  }

  if (status === "processing") {
    return {
      label: "AI assessment processing",
      description: "Polling existing company detail for a saved assessment.",
      dotClass: "bg-amber-500",
    };
  }

  if (status === "failed") {
    return {
      label: "AI assessment unavailable",
      description: "AI did not complete. Local scoring and SDR feedback still work.",
      dotClass: "bg-rose-500",
    };
  }

  return {
    label: "No AI insight saved",
    description: "Run AI assessment to queue the existing company AI flow.",
    dotClass: "bg-slate-300",
  };
}

function ComparisonRow({
  label,
  ruleValue,
  aiValue,
}: {
  label: string;
  ruleValue: number | null | undefined;
  aiValue: number | null | undefined;
}) {
  return (
    <div className="grid grid-cols-[90px_1fr_1fr] items-center gap-3 py-2 text-sm">
      <span className="font-medium text-slate-600">{label}</span>
      <ScoreBar label="Rule" value={ruleValue} color="bg-amber-500" />
      <ScoreBar label="AI" value={aiValue} color="bg-emerald-500" />
    </div>
  );
}

function ScoreBar({
  label,
  value,
  color,
}: {
  label: string;
  value: number | null | undefined;
  color: string;
}) {
  const score = typeof value === "number" ? Math.max(0, Math.min(100, value)) : null;

  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-slate-500">
        <span>{label}</span>
        <span>{score ?? "-"}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${score ?? 0}%` }}
        />
      </div>
    </div>
  );
}

function DrawerCard({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {action}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
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
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-700 to-violet-700 text-sm font-semibold text-white shadow-sm">
      {initials || "CO"}
    </div>
  );
}

function EmptyContent() {
  return (
    <SheetHeader className="p-5">
      <SheetTitle>No company selected</SheetTitle>
    </SheetHeader>
  );
}

function DetailBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-sm leading-6 text-slate-900">{value}</p>
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
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-900">
        {value || "Not provided"}
      </span>
    </div>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
      {message}
    </div>
  );
}

function toQualification(value: string | null | undefined) {
  return qualifications.includes(value as Qualification)
    ? (value as Qualification)
    : null;
}

function toCompanyType(value: string | null | undefined) {
  return companyTypes.includes(value as CompanyType)
    ? (value as CompanyType)
    : null;
}

function toRowAiAssessment(
  assessment: NonNullable<
    Awaited<ReturnType<typeof getCompanyRecordDetail>>["latestAiAssessment"]
  >
): NonNullable<CompanyReviewRow["latestAiAssessment"]> {
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
    createdAt: assessment.createdAt,
  };
}

function formatHintName(value: string) {
  return value
    .replace(/^likely/, "likely ")
    .replace(/[A-Z]/g, (match) => ` ${match.toLowerCase()}`)
    .trim();
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

function getAiDisplayTone(tone: "slate" | "blue" | "amber" | "rose" | "green") {
  if (tone === "green") return "success";
  if (tone === "rose") return "danger";
  if (tone === "amber") return "warning";
  if (tone === "blue") return "info";

  return "neutral";
}

function getBriefSourceTone(source: StructuredCompanyBrief["source"]) {
  if (source === "ai") return "info";
  if (source === "website") return "success";
  if (source === "local_rule") return "warning";
  if (source === "csv") return "neutral";

  return "neutral";
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return new Date(value).toLocaleString();
}

function getFriendlyAiStatusMessage(message: string) {
  const lower = message.toLowerCase();

  if (
    lower.includes("429") ||
    lower.includes("quota") ||
    lower.includes("rate limit")
  ) {
    return "AI hit quota/rate-limit or provider issue. It will retry automatically when due if a retry is scheduled.";
  }

  if (lower.includes("disabled")) {
    return "AI is disabled. Local scoring and SDR review still work.";
  }

  return "AI assessment could not complete. Local scoring and SDR review still work.";
}

function normalizeExternalHref(value: string | null | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
