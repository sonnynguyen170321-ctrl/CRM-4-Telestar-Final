export type CompanyIcpInsight = {
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

export type CompanyIcpInsightsResponse = {
  latestInsight: CompanyIcpInsight | null;
  historyCount: number;
};

export type SaveCompanyIcpInsightInput = {
  targetCustomerSegment?: string | null;
  targetVerticals: string[];
  buyerPersonas: string[];
  useCasesPainPoints: string[];
  sdrMessagingAngle?: string | null;
  confidence?: number | null;
  evidenceNote?: string | null;
};

type ApiResponse<T> = {
  data?: T;
  error?: string;
};

export async function getCompanyIcpInsights(companyRecordId: string) {
  const response = await fetch(
    `/api/company-records/${companyRecordId}/icp-insights`,
    { cache: "no-store" }
  );
  const body = (await response.json().catch(() => ({}))) as
    | ApiResponse<CompanyIcpInsightsResponse>
    | Record<string, never>;

  if (!response.ok) {
    throw new Error(getErrorMessage(body, "Company ICP could not be loaded."));
  }

  if (!("data" in body) || !body.data) {
    throw new Error("Company ICP response did not include data.");
  }

  return body.data;
}

export async function generateCompanyIcpInsight(companyRecordId: string) {
  const response = await fetch(
    `/api/company-records/${companyRecordId}/icp-insights/generate`,
    { method: "POST" }
  );
  const body = (await response.json().catch(() => ({}))) as
    | ApiResponse<CompanyIcpInsight>
    | Record<string, never>;

  if (!response.ok) {
    throw new Error(getErrorMessage(body, "Company ICP generation failed."));
  }

  if (!("data" in body) || !body.data) {
    throw new Error("Company ICP generation response did not include data.");
  }

  return body.data;
}

export async function saveCompanyIcpInsight(
  companyRecordId: string,
  input: SaveCompanyIcpInsightInput
) {
  const response = await fetch(
    `/api/company-records/${companyRecordId}/icp-insights`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    }
  );
  const body = (await response.json().catch(() => ({}))) as
    | ApiResponse<CompanyIcpInsight>
    | Record<string, never>;

  if (!response.ok) {
    throw new Error(getErrorMessage(body, "Company ICP save failed."));
  }

  if (!("data" in body) || !body.data) {
    throw new Error("Company ICP save response did not include data.");
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
