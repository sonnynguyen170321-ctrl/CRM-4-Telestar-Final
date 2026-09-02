import { ArrowRight, Search } from "lucide-react";

import { DataTableShell } from "@/components/shared/DataTableShell";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatCard } from "@/components/shared/StatCard";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  companyTypeValues,
  datasetSplitValues,
  feedbackSourceValues,
  isCompanyTypeValue,
  isDatasetSplitValue,
  isFeedbackSourceValue,
  isQualificationValue,
  normalizeCompanyTypeForPrisma,
  normalizeDatasetSplitForPrisma,
  normalizeFeedbackSourceForPrisma,
  normalizeQualificationForPrisma,
  qualificationValues,
} from "@/lib/server/api/enums";
import {
  listFeedbackExamples,
  type FeedbackListRow,
} from "@/lib/server/feedback/listFeedbackExamples";

// DB-backed page — render per request, never prerender at build (no DB in CI/Docker build).
export const dynamic = "force-dynamic";

type FeedbackPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function FeedbackPage({
  searchParams,
}: FeedbackPageProps) {
  const params = await searchParams;
  const page = parsePositiveInt(getParam(params, "page"), 1);
  const pageSize = Math.min(parsePositiveInt(getParam(params, "pageSize"), 25), 100);
  const search = getParam(params, "search");
  const uploadJobId = getParam(params, "uploadJobId");
  const finalQualificationParam = getParam(params, "finalQualification");
  const finalCompanyTypeParam = getParam(params, "finalCompanyType");
  const approvedForLearning = parseBooleanFilter(
    getParam(params, "approvedForLearning")
  );
  const datasetSplitParam = getParam(params, "datasetSplit");
  const sourceParam = getParam(params, "source");
  const finalQualification =
    finalQualificationParam && isQualificationValue(finalQualificationParam)
      ? finalQualificationParam
      : undefined;
  const finalCompanyType =
    finalCompanyTypeParam && isCompanyTypeValue(finalCompanyTypeParam)
      ? finalCompanyTypeParam
      : undefined;
  const datasetSplit =
    datasetSplitParam && isDatasetSplitValue(datasetSplitParam)
      ? datasetSplitParam
      : undefined;
  const source =
    sourceParam && isFeedbackSourceValue(sourceParam)
      ? sourceParam
      : undefined;

  const result = await listFeedbackExamples({
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    search,
    uploadJobId,
    finalQualification: finalQualification
      ? normalizeQualificationForPrisma(finalQualification)
      : undefined,
    finalCompanyType: finalCompanyType
      ? normalizeCompanyTypeForPrisma(finalCompanyType)
      : undefined,
    approvedForLearning,
    datasetSplit: datasetSplit
      ? normalizeDatasetSplitForPrisma(datasetSplit)
      : undefined,
    source: source ? normalizeFeedbackSourceForPrisma(source) : undefined,
  });
  const feedbackExamples = result.data;
  const stats = buildFeedbackStats(feedbackExamples);
  const filterValues = {
    search,
    uploadJobId,
    finalQualification,
    finalCompanyType,
    approvedForLearning: booleanToQueryValue(approvedForLearning),
    datasetSplit,
    source,
    pageSize: String(pageSize),
  };
  const totalPages = Math.max(1, Math.ceil(result.pagination.total / pageSize));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="SDR review history"
        title="Feedback examples"
        description="Feedback examples are SDR source-of-truth corrections stored separately from predicted score results for review, evaluation, and controlled improvement."
        className="rounded-md border shadow-xs"
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Loaded feedback"
          value={feedbackExamples.length.toLocaleString()}
          description={`${result.pagination.total.toLocaleString()} matching examples.`}
          icon={Search}
        />
        <StatCard
          title="Approved"
          value={stats.approved.toLocaleString()}
          description="Approved for future learning use."
          icon={Search}
        />
        <StatCard
          title="Evaluation"
          value={stats.evaluationBenchmark.toLocaleString()}
          description="Marked for evaluation benchmark."
          icon={Search}
        />
        <StatCard
          title="Latest saved"
          value={stats.latestSaved}
          description="Newest feedback in current result set."
          icon={Search}
        />
      </div>

      <PageToolbar className="items-stretch">
        <form className="grid w-full gap-3 xl:grid-cols-[minmax(240px,1fr)_180px_180px_170px_160px_140px_minmax(190px,1fr)_auto_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              name="search"
              placeholder="Search company or website"
              defaultValue={search ?? ""}
            />
          </div>
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            name="finalQualification"
            defaultValue={finalQualification ?? "all"}
          >
            <option value="all">All qualifications</option>
            {qualificationValues.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            name="finalCompanyType"
            defaultValue={finalCompanyType ?? "all"}
          >
            <option value="all">All types</option>
            {companyTypeValues.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            name="approvedForLearning"
            defaultValue={booleanToQueryValue(approvedForLearning) ?? "all"}
          >
            <option value="all">All approval states</option>
            <option value="true">Approved</option>
            <option value="false">Not approved</option>
          </select>
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            name="datasetSplit"
            defaultValue={datasetSplit ?? "all"}
          >
            <option value="all">All splits</option>
            {datasetSplitValues.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            name="source"
            defaultValue={source ?? "all"}
          >
            <option value="all">All sources</option>
            {feedbackSourceValues.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <Input
            name="uploadJobId"
            placeholder="Upload job ID"
            defaultValue={uploadJobId ?? ""}
          />
          <input type="hidden" name="pageSize" value={pageSize} />
          <Button type="submit" variant="secondary">
            Apply
          </Button>
          <Button asChild variant="outline">
            <a href="/feedback">Clear</a>
          </Button>
        </form>
      </PageToolbar>

      {feedbackExamples.length === 0 ? (
        <EmptyState
          title="No feedback examples found"
          description="Save feedback from upload review or the company review drawer, or clear filters to inspect all saved examples."
        />
      ) : (
        <DataTableShell
          title={`${result.pagination.total.toLocaleString()} matching feedback examples`}
          description="Predicted values stay separate from SDR final corrections."
        >
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead className="min-w-[280px]">Company</TableHead>
                <TableHead className="min-w-[220px]">Predicted</TableHead>
                <TableHead className="min-w-[240px]">Final SDR correction</TableHead>
                <TableHead className="min-w-[260px]">Note</TableHead>
                <TableHead className="min-w-[160px]">Source</TableHead>
                <TableHead className="min-w-[150px]">Created</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {feedbackExamples.map((feedback) => (
                <FeedbackRow key={feedback.id} feedback={feedback} />
              ))}
            </TableBody>
          </Table>
        </DataTableShell>
      )}

      {result.pagination.total > pageSize && (
        <div className="flex flex-col gap-3 rounded-md border bg-background p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} of {totalPages} -{" "}
            {result.pagination.total.toLocaleString()} matching feedback examples
          </p>
          <div className="flex gap-2">
            {page > 1 ? (
              <Button asChild variant="outline" size="sm">
                <a
                  href={`/feedback?${buildQueryString({
                    ...filterValues,
                    page: String(page - 1),
                  })}`}
                >
                  Previous
                </a>
              </Button>
            ) : (
              <Button type="button" variant="outline" size="sm" disabled>
                Previous
              </Button>
            )}
            {page < totalPages ? (
              <Button asChild variant="outline" size="sm">
                <a
                  href={`/feedback?${buildQueryString({
                    ...filterValues,
                    page: String(page + 1),
                  })}`}
                >
                  Next
                </a>
              </Button>
            ) : (
              <Button type="button" variant="outline" size="sm" disabled>
                Next
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FeedbackRow({ feedback }: { feedback: FeedbackListRow }) {
  const companyHref = feedback.uploadJobId
    ? `/companies?${buildQueryString({
        uploadJobId: feedback.uploadJobId,
        search: feedback.companyName,
      })}`
    : `/companies?${buildQueryString({ search: feedback.companyName })}`;

  return (
    <TableRow>
      <TableCell className="align-top">
        <div className="space-y-1">
          <p className="font-medium">{feedback.companyName}</p>
          <p className="max-w-72 truncate text-xs text-muted-foreground">
            {feedback.website || "No website"} /{" "}
            {feedback.company?.companyCountry || "No country"} /{" "}
            {feedback.company?.companyIndustry || "No industry"}
          </p>
        </div>
      </TableCell>
      <TableCell className="align-top">
        <div className="space-y-1">
          <CompanyTypeBadge companyType={feedback.predictedCompanyType} />
          <QualificationBadge qualification={feedback.predictedQualification} />
          <ScoreBadge score={feedback.predictedCompanyScore} />
        </div>
      </TableCell>
      <TableCell className="align-top">
        <div className="space-y-1">
          <CompanyTypeBadge companyType={feedback.finalCompanyType} />
          <QualificationBadge qualification={feedback.finalQualification} />
          <ScoreBadge score={feedback.finalCompanyScore} />
        </div>
      </TableCell>
      <TableCell className="align-top">
        <p className="line-clamp-2 max-w-72 text-sm text-muted-foreground">
          {feedback.finalNote || "No final reviewer note saved."}
        </p>
      </TableCell>
      <TableCell className="align-top">
        <div className="space-y-1">
          <StatusBadge tone="neutral">{feedback.source}</StatusBadge>
          <Badge variant="outline">{feedback.datasetSplit}</Badge>
          <LearningFlag label="Approved" enabled={feedback.approvedForLearning} />
          <LearningFlag
            label="Eval benchmark"
            enabled={feedback.useForEvaluationBenchmark}
          />
        </div>
      </TableCell>
      <TableCell className="align-top text-sm text-muted-foreground">
        {formatDateTime(feedback.createdAt)}
      </TableCell>
      <TableCell className="align-top text-right">
        <Button asChild variant="outline" size="sm">
          <a href={companyHref}>
            Open
            <ArrowRight className="ml-1 h-4 w-4" />
          </a>
        </Button>
      </TableCell>
    </TableRow>
  );
}

function LearningFlag({
  label,
  enabled,
}: {
  label: string;
  enabled: boolean;
}) {
  return (
    <Badge variant={enabled ? "secondary" : "outline"}>
      {label}: {enabled ? "yes" : "no"}
    </Badge>
  );
}

function buildFeedbackStats(feedbackExamples: FeedbackListRow[]) {
  const latest = feedbackExamples[0]?.createdAt;

  return {
    approved: feedbackExamples.filter(
      (feedback) => feedback.approvedForLearning
    ).length,
    evaluationBenchmark: feedbackExamples.filter(
      (feedback) => feedback.useForEvaluationBenchmark
    ).length,
    latestSaved: latest ? formatDate(latest) : "None",
  };
}

function getParam(
  params: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = params[key];

  if (Array.isArray(value)) {
    return normalizeParamValue(value[0]);
  }

  return normalizeParamValue(value);
}

function normalizeParamValue(value: string | undefined) {
  const trimmed = value?.trim();

  return trimmed && trimmed !== "all" ? trimmed : undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBooleanFilter(value: string | undefined) {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return undefined;
}

function booleanToQueryValue(value: boolean | undefined) {
  if (value === true) {
    return "true";
  }

  if (value === false) {
    return "false";
  }

  return undefined;
}

function buildQueryString(values: Record<string, string | undefined>) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    if (value) {
      query.set(key, value);
    }
  }

  return query.toString();
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}
