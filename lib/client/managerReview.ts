export type ManagerReviewStatus =
  | "open"
  | "reviewed"
  | "needs_follow_up"
  | "dismissed";

export type ManagerReviewPriority = "high" | "medium" | "low";

export type ManagerReviewItem = {
  id: string;
  source: string;
  sourceActivityRowId: string | null;
  activityUploadId: string | null;
  contactRecordId: string | null;
  companyRecordId: string | null;
  sdrName: string | null;
  leadName: string | null;
  companyName: string | null;
  priority: ManagerReviewPriority;
  status: ManagerReviewStatus;
  reasons: string[];
  sourceNote: string | null;
  managerNote: string | null;
  nextAction: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  contact: {
    id: string;
    fullName: string;
    title: string | null;
    email: string | null;
    contactLinkedInUrl: string | null;
  } | null;
  company: {
    id: string;
    companyName: string;
    website: string | null;
    companyCountry: string | null;
  } | null;
  activityRow: {
    id: string;
    rowIndex: number;
    activityUploadId: string;
    activityDate: string | null;
    weekLabel: string | null;
    linkedinStageNormalized: string;
    emailStageNormalized: string;
    callStageNormalized: string;
    otherChannelNormalized: string;
    totalActivityCount: number;
    noteCombined: string | null;
    managerReviewReasons: string[];
    activityUpload: {
      id: string;
      fileName: string;
      createdAt: string;
    };
  } | null;
};

export type ManagerReviewSummary = {
  total: number;
  open: number;
  high: number;
  medium: number;
  low: number;
  reviewed: number;
  needsFollowUp: number;
  dismissed: number;
};

export type ManagerReviewListResponse = {
  data: ManagerReviewItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
  summary: ManagerReviewSummary;
};

export type ManagerReviewListFilters = {
  status?: ManagerReviewStatus | "all";
  priority?: ManagerReviewPriority | "all";
  sdrName?: string;
  search?: string;
  page?: number;
  pageSize?: number;
};

export type ManagerReviewSyncResult = {
  uploadId: string;
  created: number;
  updated: number;
  skipped: number;
  totalFlaggedRows: number;
};

export async function listManagerReviewItems(
  filters: ManagerReviewListFilters = {}
) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") {
      searchParams.set(key, String(value));
    }
  }

  const response = await fetch(`/api/manager-review?${searchParams.toString()}`, {
    cache: "no-store",
  });

  return readApiResponse<ManagerReviewListResponse>(
    response,
    "Manager review items could not be loaded."
  );
}

export async function getManagerReviewItem(id: string) {
  const response = await fetch(`/api/manager-review/${id}`, {
    cache: "no-store",
  });

  return readApiResponse<ManagerReviewItem>(
    response,
    "Manager review item could not be loaded."
  );
}

export async function updateManagerReviewItem(
  id: string,
  payload: {
    status?: ManagerReviewStatus;
    managerNote?: string | null;
    nextAction?: string | null;
    reviewedBy?: string | null;
  }
) {
  const response = await fetch(`/api/manager-review/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return readApiResponse<ManagerReviewItem>(
    response,
    "Manager review item update failed."
  );
}

export async function syncManagerReviewForActivityRecap(activityUploadId: string) {
  const response = await fetch(
    `/api/activity-recaps/${activityUploadId}/sync-manager-review`,
    { method: "POST" }
  );

  return readApiResponse<ManagerReviewSyncResult>(
    response,
    "Manager review sync failed."
  );
}

type ApiResponse<T> = {
  data: T;
};

async function readApiResponse<T>(response: Response, fallback: string) {
  const body = (await response.json().catch(() => ({}))) as
    | ApiResponse<T>
    | { error?: string };

  if (!response.ok) {
    throw new Error(getErrorMessage(body, fallback));
  }

  if (!("data" in body)) {
    throw new Error(fallback);
  }

  return body.data;
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
