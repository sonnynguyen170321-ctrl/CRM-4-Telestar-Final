type CreateUploadJobInput = {
  fileName: string;
  totalRows: number;
};

export type UploadJobListFilter = "active" | "archived" | "deleted" | "all";

export type UploadJobListItem = {
  id: string;
  fileName: string;
  status: string;
  totalRows: number;
  processedRows: number;
  qualifiedRows: number;
  rejectedRows: number;
  uncertainRows: number;
  errorMessage: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  latestCreatedAt: string;
  latestUpdatedAt: string;
  companyRecordCount: number;
  scoreResultCount: number;
  websiteResearchResultCount: number;
  feedbackExampleCount: number;
  exportJobCount: number;
};

export type UploadJobDetail = {
  uploadJob: {
    id: string;
    fileName: string;
    status: string;
    totalRows: number;
    processedRows: number;
    qualifiedRows: number;
    rejectedRows: number;
    uncertainRows: number;
    errorMessage: string | null;
    archivedAt: string | null;
    deletedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  counts: {
    companyRecords: number;
    companyScoreResults: number;
    websiteResearchResults: number;
    feedbackExamples: number;
    exportJobs: number;
  };
  recentCompanyRecords: Array<{
    id: string;
    sourceRowIndex: number | null;
    companyName: string;
    website: string | null;
    companyCountry: string | null;
    companyIndustry: string | null;
    createdAt: string;
  }>;
  recentExportJobs: Array<{
    id: string;
    fileName: string;
    exportType: string;
    rowCount: number;
    createdAt: string;
  }>;
  latestScoreResult: {
    id: string;
    createdAt: string;
  } | null;
  latestFeedbackExample: {
    id: string;
    createdAt: string;
  } | null;
  aiUsageSummary: UploadAiUsageSummary;
  aiJobStatus: UploadAiJobStatus;
};

export type UploadAiUsageSummary = {
  uploadJobId: string;
  provider: string;
  model: string;
  promptVersion: string;
  mode: string;
  maxRowsPerUpload: number;
  assessmentCount: number;
  successfulAssessmentCount: number;
  failedAssessmentCount: number;
  remainingCapacity: number;
  capReached: boolean;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  totalTokens: number | null;
  averageLatencyMs: number | null;
  latestAssessmentAt: string | null;
};

export type UploadAiJobStatus = {
  uploadJobId: string;
  aiEnabled: boolean;
  adminProcessUiEnabled: boolean;
  workerRequired?: boolean;
  provider: string;
  model: string;
  mode: string;
  aiStatusReason?: string | null;
  totalJobs?: number;
  byStatus?: {
    pending: number;
    running: number;
    succeeded: number;
    retry_scheduled: number;
    failed: number;
    skipped: number;
  };
  total: number;
  pending: number;
  running: number;
  succeeded: number;
  retryScheduled: number;
  failed: number;
  skipped: number;
  terminalJobs?: number;
  activeJobs?: number;
  cacheHitCount: number;
  providerCallCount: number;
  progressPercent: number;
  actionableState:
    | "disabled"
    | "not_requested"
    | "queued"
    | "processing"
    | "partially_completed"
    | "completed"
    | "retry_waiting"
    | "failed"
    | "quota_blocked";
  quotaPaused: boolean;
  budgetPaused?: boolean;
  pausedReason?: "daily_request_budget_reached" | "provider_quota_or_rate_limit" | null;
  dailyRequestBudget?: number;
  dailyRequestBudgetRemaining?: number;
  nextAttemptAt: string | null;
  nextRetryAt?: string | null;
  oldestPendingJobCreatedAt: string | null;
  oldestPendingAt?: string | null;
  latestJobActivityAt?: string | null;
  latestSucceededAt?: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  latestErrorCode?: string | null;
  latestErrorMessage?: string | null;
  healthStatus?:
    | "disabled"
    | "healthy"
    | "busy"
    | "worker_likely_not_running"
    | "quota_paused"
    | "budget_paused"
    | "blocked"
    | "needs_manual_retry";
  healthLabel?: string;
  healthMessage?: string;
  recommendedAction?: string;
  cap?: {
    cap: number;
    used: number;
    remaining: number;
    capReached: boolean;
  };
  workerHint: string;
  latestPendingJobs: UploadAiJobExample[];
  latestRunningJobs: UploadAiJobExample[];
  latestCompletedJobs: UploadAiJobExample[];
  latestFailedJobs: UploadAiJobExample[];
};

export type UploadAiJobExample = {
  companyRecordId: string;
  companyName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  nextAttemptAt: string | null;
  cacheHit: boolean;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
};

type CreateUploadJobResponse = {
  data: {
    id: string;
  };
};

type ListUploadJobsResponse = {
  data?: UploadJobListItem[];
  items?: UploadJobListItem[];
  error?: string;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
  };
};

type UploadJobDetailResponse = {
  data?: UploadJobDetail;
  error?: string;
};

type UploadJobActionResponse = {
  data?: unknown;
  error?: string;
};

export type AiScoreUncertainSummary = {
  success: true;
  skipped: boolean;
  reason: string | null;
  uploadJobId: string;
  scope?: string;
  enqueued?: number;
  skippedAlreadyAssessed?: number;
  skippedDuplicateJob?: number;
  skippedNoEligibleRows?: number;
  cacheHits?: number;
  candidateCount: number;
  alreadyAssessedCount: number;
  scoredCount: number;
  failedCount: number;
  skippedDueToCapCount: number;
  requeuedFailed?: number;
  requeuedRetryScheduled?: number;
  maxRowsPerUpload: number;
  provider: string;
  model: string;
  promptVersion: string;
  mode: string;
  results: Array<{
    companyRecordId: string;
    companyName: string;
    status: "scored" | "skipped" | "failed";
    reason?: string;
  }>;
};

type AiScoreUncertainResponse = {
  data?: AiScoreUncertainSummary;
  error?: string;
};

type UploadAiUsageResponse = {
  data?: UploadAiUsageSummary;
  error?: string;
};

type UploadAiJobStatusResponse = {
  data?: UploadAiJobStatus;
  error?: string;
};

export async function createUploadJob(input: CreateUploadJobInput) {
  if (!input.fileName.trim()) {
    throw new Error("File name is required.");
  }

  if (!Number.isFinite(input.totalRows)) {
    throw new Error("Total rows must be a number.");
  }

  const response = await fetch("/api/upload-jobs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fileName: input.fileName,
      totalRows: input.totalRows,
    }),
  });

  if (!response.ok) {
    throw new Error("Upload metadata save failed.");
  }

  const body = (await response.json()) as CreateUploadJobResponse;

  if (!body.data?.id) {
    throw new Error("Upload metadata response did not include an id.");
  }

  return body.data;
}

export async function listUploadJobs({
  filter,
  search,
}: {
  filter: UploadJobListFilter;
  search?: string;
}) {
  const params = new URLSearchParams();
  params.set("pageSize", "100");

  if (filter === "archived" || filter === "deleted" || filter === "all") {
    params.set("includeArchived", "true");
  }

  if (filter === "deleted" || filter === "all") {
    params.set("includeDeleted", "true");
  }

  if (search?.trim()) {
    params.set("search", search.trim());
  }

  const response = await fetch(`/api/upload-jobs?${params.toString()}`, {
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as
    | ListUploadJobsResponse
    | Record<string, never>;

  if (!response.ok) {
    throw new Error(getErrorMessage(body, "Upload jobs could not be loaded."));
  }

  const items = "items" in body && body.items ? body.items : body.data ?? [];

  return {
    items: filterUploadJobs(items, filter),
    pagination: body.pagination,
  };
}

export async function getUploadJob(id: string) {
  const response = await fetch(`/api/upload-jobs/${id}`, {
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as
    | UploadJobDetailResponse
    | Record<string, never>;

  if (!response.ok) {
    throw new Error(getErrorMessage(body, "Upload job details could not be loaded."));
  }

  if (!("data" in body) || !body.data) {
    throw new Error("Upload job detail response did not include data.");
  }

  return body.data;
}

export function archiveUploadJob(id: string) {
  return postUploadJobAction(`/api/upload-jobs/${id}/archive`);
}

export function restoreUploadJob(id: string) {
  return postUploadJobAction(`/api/upload-jobs/${id}/restore`);
}

export function softDeleteUploadJob(id: string) {
  return postUploadJobAction(`/api/upload-jobs/${id}/delete`, {
    confirm: "DELETE",
  });
}

export async function hardDeleteUploadJob(id: string) {
  const response = await fetch(`/api/upload-jobs/${id}?confirm=DELETE`, {
    method: "DELETE",
  });
  const body = (await response.json().catch(() => ({}))) as
    | UploadJobActionResponse
    | Record<string, never>;

  if (!response.ok) {
    throw new Error(getErrorMessage(body, "Upload job hard delete failed."));
  }

  return body.data;
}

export async function scoreUncertainRowsWithAi(id: string) {
  const response = await fetch(`/api/upload-jobs/${id}/ai-score-uncertain`, {
    method: "POST",
  });
  const body = (await response.json().catch(() => ({}))) as
    | AiScoreUncertainResponse
    | Record<string, never>;

  if (!response.ok) {
    throw new Error(getErrorMessage(body, "AI assessment pass failed."));
  }

  if (!("data" in body) || !body.data) {
    throw new Error("AI assessment response did not include data.");
  }

  return body.data;
}

export async function enqueueUploadAiJobs({
  id,
  scope,
  retryFailed,
  retryScheduledNow,
  maxRows,
}: {
  id: string;
  scope: "uncertain_only" | "qualified_and_uncertain" | "all_active";
  retryFailed?: boolean;
  retryScheduledNow?: boolean;
  maxRows?: number;
}) {
  const response = await fetch(`/api/upload-jobs/${id}/ai-jobs/enqueue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      scope,
      retryFailed,
      retryScheduledNow,
      maxRows,
    }),
  });
  const body = (await response.json().catch(() => ({}))) as
    | AiScoreUncertainResponse
    | Record<string, never>;

  if (!response.ok) {
    throw new Error(getErrorMessage(body, "AI job enqueue failed."));
  }

  if (!("data" in body) || !body.data) {
    throw new Error("AI job enqueue response did not include data.");
  }

  return body.data;
}

export async function processNextAiJobForUpload(uploadJobId: string) {
  const response = await fetch(`/api/upload-jobs/${uploadJobId}/ai-jobs/process-next`, {
    method: "POST",
  });
  const body = (await response.json().catch(() => ({}))) as
    | UploadJobActionResponse
    | Record<string, never>;

  if (!response.ok) {
    throw new Error(getErrorMessage(body, "AI job processing failed."));
  }

  return body.data;
}

export async function getUploadAiJobStatus(uploadJobId: string) {
  const response = await fetch(`/api/upload-jobs/${uploadJobId}/ai-jobs/status`, {
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as
    | UploadAiJobStatusResponse
    | Record<string, never>;

  if (!response.ok) {
    throw new Error(getErrorMessage(body, "AI job status could not be loaded."));
  }

  if (!("data" in body) || !body.data) {
    throw new Error("AI job status response did not include data.");
  }

  return body.data;
}

export async function getUploadAiUsage(id: string) {
  const response = await fetch(`/api/upload-jobs/${id}/ai-usage`, {
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as
    | UploadAiUsageResponse
    | Record<string, never>;

  if (!response.ok) {
    throw new Error(getErrorMessage(body, "AI usage could not be loaded."));
  }

  if (!("data" in body) || !body.data) {
    throw new Error("AI usage response did not include data.");
  }

  return body.data;
}

async function postUploadJobAction(
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
    | UploadJobActionResponse
    | Record<string, never>;

  if (!response.ok) {
    throw new Error(getErrorMessage(responseBody, "Upload job action failed."));
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

function filterUploadJobs(
  items: UploadJobListItem[],
  filter: UploadJobListFilter
) {
  if (filter === "archived") {
    return items.filter((item) => item.archivedAt && !item.deletedAt);
  }

  if (filter === "deleted") {
    return items.filter((item) => item.deletedAt);
  }

  return items;
}
