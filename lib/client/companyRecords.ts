import type { ParsedCsvRow } from "@/lib/csv";
import type { RuleAiComparison } from "@/lib/ai/compareRuleAndAi";
import {
  dedupeCompanyRows,
  type CompanyRowDuplicate,
} from "@/lib/normalization/dedupeCompanyRows";

type CreateCompanyRecordInput = {
  uploadJobId: string;
  row: ParsedCsvRow;
  sourceRowIndex: number;
};

type CreateCompanyRecordResponse = {
  data: {
    id: string;
    sourceRowIndex: number | null;
  };
};

export type SavedCompanyRecordReference = {
  id: string;
  sourceRowIndex: number;
};

export type CreateCompanyRecordsForUploadResult = {
  count: number;
  duplicateCount: number;
  idsBySourceRowIndex: Record<number, string>;
  persistedSourceRowIndexes: number[];
  duplicates: CompanyRowDuplicate[];
};

export type CompanyRecordDetail = {
  companyRecord: {
    id: string;
    uploadJobId: string | null;
    sourceRowIndex: number | null;
    companyName: string;
    website: string | null;
    companyCountry: string | null;
    companyLinkedInUrl: string | null;
    companyIndustry: string | null;
    companyPhone1: string | null;
    companyStaffCountRange: string | null;
    type: string | null;
    note: string | null;
    rawRowJson: unknown;
    archivedAt: string | null;
    deletedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  uploadJob: {
    id: string;
    fileName: string;
    createdAt: string;
  } | null;
  counts: {
    scoreResults: number;
    websiteResearchResults: number;
    feedbackExamples: number;
    aiAssessments: number;
    icpInsights?: number;
  };
  latestScoreResult: {
    id: string;
    companyType: string;
    companyScore: number;
    qualification: string;
    confidence: number;
    reason: string;
    oneSentenceCompanySummary: string | null;
    hardRuleFlagsJson: unknown;
    reviewState: string;
    scoringSource: string;
    scoringVersion: string;
    createdAt: string;
  } | null;
  latestWebsiteResearchResult: {
    id: string;
    status: string;
    quality: string;
    reachable: boolean;
    normalizedDomain: string | null;
    finalUrl: string | null;
    httpStatus: number | null;
    summary: string;
    signalsJson: unknown;
    classificationHintsJson: unknown;
    pagesCheckedJson: unknown;
    errorsJson: unknown;
    researchedAt: string;
    createdAt: string;
  } | null;
  latestFeedbackExample: {
    id: string;
    companyScoreResultId: string | null;
    predictedCompanyScore: number | null;
    predictedCompanyType: string | null;
    predictedQualification: string | null;
    predictedReason: string | null;
    finalCompanyScore: number;
    finalCompanyType: string;
    finalQualification: string;
    finalNote: string | null;
    approvedForLearning?: boolean;
    useForPromptRefinement?: boolean;
    useForRuleTuning?: boolean;
    useForModelTraining?: boolean;
    useForEvaluationBenchmark?: boolean;
    datasetSplit?: string;
    source?: string;
    rawExampleJson?: unknown;
    createdAt: string;
    updatedAt: string;
  } | null;
  latestAiAssessment: CompanyAiAssessmentSummary | null;
  latestAiJob: CompanyAiJobSummary | null;
  latestIcpInsight: CompanyIcpInsightSummary | null;
  aiRuleComparison: RuleAiComparison;
  scoreResultHistory: Array<{
    id: string;
    companyType: string;
    companyScore: number;
    qualification: string;
    confidence: number;
    reason: string;
    oneSentenceCompanySummary: string | null;
    hardRuleFlagsJson: unknown;
    reviewState: string;
    scoringSource: string;
    scoringVersion: string;
    createdAt: string;
  }>;
  websiteResearchHistory: Array<{
    id: string;
    status: string;
    quality: string;
    reachable: boolean;
    normalizedDomain: string | null;
    finalUrl: string | null;
    httpStatus: number | null;
    summary: string;
    signalsJson: unknown;
    classificationHintsJson: unknown;
    researchedAt: string;
    createdAt: string;
  }>;
  feedbackHistory: Array<{
    id: string;
    companyScoreResultId: string | null;
    predictedCompanyScore: number | null;
    predictedCompanyType: string | null;
    predictedQualification: string | null;
    predictedReason: string | null;
    finalCompanyScore: number;
    finalCompanyType: string;
    finalQualification: string;
    finalNote: string | null;
    approvedForLearning: boolean;
    useForPromptRefinement: boolean;
    useForRuleTuning: boolean;
    useForModelTraining: boolean;
    useForEvaluationBenchmark: boolean;
    datasetSplit: string;
    source: string;
    rawExampleJson: unknown;
    createdAt: string;
    updatedAt: string;
  }>;
  aiAssessmentHistory: CompanyAiAssessmentSummary[];
};

export type CompanyIcpInsightSummary = {
  id: string;
  companyRecordId: string;
  targetCustomerSegment: string | null;
  targetVerticals: string[];
  buyerPersonas: string[];
  useCasesPainPoints: string[];
  sdrMessagingAngle: string | null;
  confidence: number | null;
  evidenceNote: string | null;
  source: string;
  provider: string | null;
  modelName: string | null;
  promptVersion: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CompanyAiAssessmentSummary = {
  id: string;
  companyRecordId: string;
  localScoreResultId: string | null;
  provider: string;
  modelName: string;
  promptVersion: string;
  mode: string;
  qualification: string;
  companyType: string;
  companyScore: number;
  confidence: number;
  reason: string;
  oneSentenceCompanySummary: string | null;
  brief: CompanyAiBriefFields;
  inputSnapshotJson: unknown;
  websiteSignalsSnapshotJson: unknown;
  finishReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  errorMessage: string | null;
  cacheHit: boolean;
  createdAt: string;
};

export type CompanyAiBriefFields = {
  icpSegment: string | null;
  outreachAngle: string | null;
  evidenceSummary: string | null;
  targetCustomers: string | null;
  productOrService: string | null;
  industry: string | null;
  niche: string | null;
  keyPainPoints: string[];
  risks: string | null;
  recommendedNextAction: string | null;
};

export type CompanyAiJobSummary = {
  id: string;
  uploadJobId: string | null;
  companyRecordId: string;
  status: string;
  scope: string;
  provider: string;
  model: string;
  promptVersion: string;
  cacheHit: boolean;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lockedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function createCompanyRecordsForUpload({
  uploadJobId,
  rows,
}: {
  uploadJobId: string;
  rows: ParsedCsvRow[];
}): Promise<CreateCompanyRecordsForUploadResult> {
  if (!uploadJobId.trim()) {
    throw new Error("Upload job id is required.");
  }

  const dedupedRows = dedupeCompanyRows(rows);
  const companyRecords = await Promise.all(
    dedupedRows.uniqueRows.map(({ row, sourceRowIndex }) =>
      createCompanyRecord({
        uploadJobId,
        row,
        sourceRowIndex,
      })
    )
  );

  const persisted = companyRecords.reduce<{
    count: number;
    idsBySourceRowIndex: Record<number, string>;
    persistedSourceRowIndexes: number[];
  }>(
    (summary, companyRecord) => {
      summary.count += 1;
      summary.idsBySourceRowIndex[companyRecord.sourceRowIndex] =
        companyRecord.id;
      summary.persistedSourceRowIndexes.push(companyRecord.sourceRowIndex);
      return summary;
    },
    { count: 0, idsBySourceRowIndex: {}, persistedSourceRowIndexes: [] }
  );

  return {
    ...persisted,
    duplicateCount: dedupedRows.duplicates.length,
    duplicates: dedupedRows.duplicates,
  };
}

async function createCompanyRecord({
  uploadJobId,
  row,
  sourceRowIndex,
}: CreateCompanyRecordInput) {
  const response = await fetch("/api/company-records", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      uploadJobId,
      sourceRowIndex,
      companyName: getCell(row, "Company Name") || "Not provided",
      website: getCell(row, "Website"),
      companyCountry: getCell(row, "Company Country"),
      companyLinkedInUrl: getCell(row, "Company LinkedIn URL"),
      companyIndustry: getCell(row, "Company Industry"),
      companyPhone1: getCell(row, "Company Phone 1"),
      companyStaffCountRange: getCell(row, "Company Staff Count Range"),
      note: getCell(row, "Notes / Tags"),
      rawRowJson: row,
    }),
  });

  if (!response.ok) {
    throw new Error("Company row save failed.");
  }

  const body = (await response.json()) as CreateCompanyRecordResponse;

  if (!body.data?.id) {
    throw new Error("Company row response did not include an id.");
  }

  return {
    id: body.data.id,
    sourceRowIndex,
  } satisfies SavedCompanyRecordReference;
}

type ApiResponse<T> = {
  data?: T;
  error?: string;
};

export async function getCompanyRecordDetail(id: string) {
  const response = await fetch(`/api/company-records/${id}`, {
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as
    | ApiResponse<CompanyRecordDetail>
    | Record<string, never>;

  if (!response.ok) {
    throw new Error(getErrorMessage(body, "Company row details could not be loaded."));
  }

  if (!("data" in body) || !body.data) {
    throw new Error("Company row detail response did not include data.");
  }

  return body.data;
}

export function archiveCompanyRecord(id: string) {
  return postCompanyRecordAction(`/api/company-records/${id}/archive`);
}

export function restoreCompanyRecord(id: string) {
  return postCompanyRecordAction(`/api/company-records/${id}/restore`);
}

export function softDeleteCompanyRecord(id: string) {
  return postCompanyRecordAction(`/api/company-records/${id}/delete`, {
    confirm: "DELETE",
  });
}

export async function hardDeleteCompanyRecord(id: string) {
  const response = await fetch(`/api/company-records/${id}?confirm=DELETE`, {
    method: "DELETE",
  });
  const body = (await response.json().catch(() => ({}))) as
    | ApiResponse<unknown>
    | Record<string, never>;

  if (!response.ok) {
    throw new Error(getErrorMessage(body, "Company row hard delete failed."));
  }

  return body.data;
}

export function rerunCompanyWebsiteResearch(id: string) {
  return postCompanyRecordAction(
    `/api/company-records/${id}/rerun-website-research`
  );
}

export function rerunCompanyLocalScoring(id: string) {
  return postCompanyRecordAction(
    `/api/company-records/${id}/rerun-local-scoring`
  );
}

export function enqueueCompanyAiAssessment(id: string) {
  return postCompanyRecordAction(`/api/company-records/${id}/ai-jobs/enqueue`) as Promise<{
    skipped?: boolean;
    reason?: string | null;
    job?: CompanyAiJobSummary | null;
    cacheHit?: boolean;
    alreadyAssessed?: boolean;
  }>;
}

async function postCompanyRecordAction(
  url: string,
  body?: Record<string, unknown>
) {
  const response = await fetch(url, {
    method: "POST",
    headers: body
      ? {
          "Content-Type": "application/json",
        }
      : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const responseBody = (await response.json().catch(() => ({}))) as
    | ApiResponse<unknown>
    | Record<string, never>;

  if (!response.ok) {
    throw new Error(getErrorMessage(responseBody, "Company row action failed."));
  }

  return responseBody.data;
}

function getErrorMessage(body: unknown, fallback: string) {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "string"
  ) {
    return body.error;
  }

  return fallback;
}

function getCell(row: ParsedCsvRow, key: string) {
  const value = row[key]?.trim();
  return value ? value : undefined;
}
