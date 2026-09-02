export type ContactListItem = {
  id: string;
  fullName: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  contactLinkedInUrl: string | null;
  companyNameRaw: string | null;
  companyRecordId: string | null;
  matchedCompanyName: string | null;
  matchedCompanyWebsite: string | null;
  matchedCompanyCountry: string | null;
  matchedCompanyIndustry: string | null;
  matchedCompanyStaffCountRange: string | null;
  matchedCompanyType: string | null;
  ownerSdrName: string | null;
  latestSdrName: string | null;
  source: string;
  sourceUploadId: string | null;
  hasMeetingBooked: boolean;
  activityCount: number;
  linkedinCount: number;
  emailCount: number;
  callCount: number;
  noPickupCount: number;
  notInterestedCount: number;
  managerReviewCount: number;
  firstActivityDate: string | null;
  latestActivityDate: string | null;
  latestActivitySummary: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ContactDetail = ContactListItem & {
  normalizedEmail: string | null;
  normalizedPhone: string | null;
  normalizedLinkedInUrl: string | null;
  normalizedCompanyName: string | null;
  companyRecord: {
    id: string;
    companyName: string;
    website: string | null;
    companyCountry: string | null;
  } | null;
  activityRows: Array<{
    id: string;
    activityUploadId: string;
    activityUploadFileName: string;
    activityUploadCreatedAt: string;
    rowIndex: number;
    sdrName: string;
    leadName: string | null;
    companyName: string | null;
    title: string | null;
    email: string | null;
    phone: string | null;
    contactLinkedInUrl: string | null;
    contactCountry: string | null;
    activityDate: string | null;
    weekLabel: string | null;
    linkedinStageNormalized: string;
    emailStageNormalized: string;
    callStageNormalized: string;
    otherChannelNormalized: string;
    meetingDate: string | null;
    meetingStatus: string | null;
    channelResponded: string | null;
    noteCombined: string | null;
    managerReviewFlag: boolean;
    managerReviewPriority: string;
    managerReviewReasonsJson: unknown;
    totalActivityCount: number;
    createdAt: string;
  }>;
  managerReviewItems: Array<{
    id: string;
    priority: string;
    status: string;
    reasonsJson: unknown;
    nextAction: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
};

export type ContactListResponse = {
  data: ContactListItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
  counts: {
    totalContacts: number;
    withCompanyMatch: number;
    missingCompanyMatch: number;
    withActivity: number;
    withManagerReview: number;
    withEmail: number;
    withPhone: number;
    withLinkedIn: number;
    meetingBooked: number;
  };
};

export type ContactListFilters = {
  search?: string;
  sdrName?: string;
  companyRecordId?: string;
  hasCompanyMatch?: boolean;
  hasManagerReview?: boolean;
  page?: number;
  pageSize?: number;
};

export async function listContacts(filters: ContactListFilters = {}) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") {
      searchParams.set(key, String(value));
    }
  }

  const response = await fetch(`/api/contacts?${searchParams.toString()}`, {
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as
    | ContactListResponse
    | { error?: string };

  if (!response.ok) {
    throw new Error(getErrorMessage(body, "Contacts could not be loaded."));
  }

  if (!("data" in body)) {
    throw new Error("Contacts response did not include data.");
  }

  return body;
}

export async function getContact(id: string) {
  const response = await fetch(`/api/contacts/${id}`, {
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as
    | { data: ContactDetail }
    | { error?: string };

  if (!response.ok) {
    throw new Error(getErrorMessage(body, "Contact could not be loaded."));
  }

  if (!("data" in body)) {
    throw new Error("Contact response did not include data.");
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

