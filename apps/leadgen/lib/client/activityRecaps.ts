import type {
  ActivityColumnMapping,
  CompanyMatchSummary,
  SdrActivitySummary,
  StandardizedSdrActivityRow,
} from "@/lib/activityRecaps/types";

export type SavedActivityRecapListItem = {
  id: string;
  fileName: string;
  fileType: string | null;
  fileSize: number | null;
  sheetName: string | null;
  totalRows: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  sdrCount: number;
  managerReviewCount: number;
  managerReviewItemCount: number;
  openManagerReviewItemCount: number;
  totalActivityCount: number;
  companyMatchSummary: CompanyMatchSummary;
};

export type SavedActivityRecapDetail = SavedActivityRecapListItem & {
  uploadedBy: string | null;
  detectedHeaders: string[];
  mappingProfile: ActivityColumnMapping;
  rows: StandardizedSdrActivityRow[];
  summary: SdrActivitySummary[];
  managerReviewRows: StandardizedSdrActivityRow[];
};

export type SaveActivityRecapPayload = {
  fileName: string;
  fileType?: string;
  fileSize?: number;
  sheetName?: string;
  detectedHeaders: string[];
  mappingProfile: ActivityColumnMapping;
  rows: StandardizedSdrActivityRow[];
};

export type SaveActivityRecapResult = {
  id: string;
  fileName: string;
  totalRows: number;
  createdAt: string;
  summary: SdrActivitySummary[];
  managerReviewCount: number;
  managerReviewItemCount: number;
  openManagerReviewItemCount: number;
  sdrCount: number;
  totalActivityCount: number;
  companyMatchSummary: CompanyMatchSummary;
};

export type ActivityRecapCompanyMatchResult = {
  uploadId: string;
  totalRows: number;
  matched: number;
  suggested: number;
  noMatch: number;
  ambiguous: number;
  matchRate: number;
  contactSync?: ContactSyncResult;
  managerReviewSync?: ManagerReviewSyncResult;
};

export type ContactSyncResult = {
  uploadId: string;
  totalRows: number;
  contactsCreated: number;
  contactsUpdated: number;
  rowsLinked: number;
  rowsSkipped: number;
  managerReviewSync?: ManagerReviewSyncResult;
};

export type ManagerReviewSyncResult = {
  uploadId: string;
  created: number;
  updated: number;
  skipped: number;
  totalFlaggedRows: number;
};

type ApiResponse<T> = {
  data: T;
};

export async function saveActivityRecap(payload: SaveActivityRecapPayload) {
  const response = await fetch("/api/activity-recaps", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return readApiResponse<SaveActivityRecapResult>(
    response,
    "Activity recap save failed."
  );
}

export async function listActivityRecaps() {
  const response = await fetch("/api/activity-recaps", {
    cache: "no-store",
  });

  return readApiResponse<SavedActivityRecapListItem[]>(
    response,
    "Saved activity recaps could not be loaded."
  );
}

export async function getActivityRecap(id: string) {
  const response = await fetch(`/api/activity-recaps/${id}`, {
    cache: "no-store",
  });

  return readApiResponse<SavedActivityRecapDetail>(
    response,
    "Saved activity recap could not be loaded."
  );
}

export async function deleteActivityRecap(id: string) {
  const response = await fetch(`/api/activity-recaps/${id}`, {
    method: "DELETE",
  });

  return readApiResponse<{ id: string }>(
    response,
    "Activity recap delete failed."
  );
}

export async function rerunActivityRecapCompanyMatching(id: string) {
  const response = await fetch(`/api/activity-recaps/${id}/match-companies`, {
    method: "POST",
  });

  return readApiResponse<ActivityRecapCompanyMatchResult>(
    response,
    "Company matching rerun failed."
  );
}

export async function syncContactsForActivityRecap(id: string) {
  const response = await fetch(`/api/activity-recaps/${id}/sync-contacts`, {
    method: "POST",
  });

  return readApiResponse<ContactSyncResult>(
    response,
    "Contact sync failed."
  );
}

export async function syncManagerReviewForActivityRecap(id: string) {
  const response = await fetch(`/api/activity-recaps/${id}/sync-manager-review`, {
    method: "POST",
  });

  return readApiResponse<ManagerReviewSyncResult>(
    response,
    "Manager review sync failed."
  );
}

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
