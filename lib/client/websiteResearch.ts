import type { WebsiteResearchResult } from "@/lib/types";

type ApiResponse<T> = {
  data?: T;
  error?: string;
};

type SavedWebsiteResearchRecord = {
  id: string;
};

export async function researchWebsite(website: string) {
  const response = await fetch("/api/website-research", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ website }),
  });
  const body = (await response.json().catch(() => ({}))) as
    | ApiResponse<WebsiteResearchResult>
    | Record<string, never>;

  if (!response.ok) {
    throw new Error(getErrorMessage(body, "Website research failed."));
  }

  if (!("data" in body) || !body.data) {
    throw new Error("Website research response did not include data.");
  }

  return body.data;
}

export async function saveWebsiteResearchResult({
  companyRecordId,
  uploadJobId,
  result,
}: {
  companyRecordId: string;
  uploadJobId?: string | null;
  result: WebsiteResearchResult;
}) {
  const response = await fetch("/api/website-research-results", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      companyRecordId,
      uploadJobId: uploadJobId ?? undefined,
      result,
    }),
  });
  const body = (await response.json().catch(() => ({}))) as
    | ApiResponse<SavedWebsiteResearchRecord>
    | Record<string, never>;

  if (!response.ok) {
    throw new Error(getErrorMessage(body, "Website research save failed."));
  }

  if (!("data" in body) || !body.data?.id) {
    throw new Error("Website research save response did not include an id.");
  }

  return body.data;
}

export async function researchAndSaveWebsiteForCompanyRecord({
  companyRecordId,
  uploadJobId,
  website,
}: {
  companyRecordId: string;
  uploadJobId?: string | null;
  website: string;
}) {
  const result = await researchWebsite(website);

  await saveWebsiteResearchResult({
    companyRecordId,
    uploadJobId,
    result,
  });

  return result;
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
