export type CanonicalActivityField =
  | "sdrName"
  | "leadName"
  | "companyName"
  | "website"
  | "title"
  | "contactLinkedInUrl"
  | "email"
  | "phone"
  | "companyCountry"
  | "contactCountry"
  | "companyLinkedInUrl"
  | "companyIndustry"
  | "companyStaffCountRange"
  | "activityDate"
  | "weekLabel"
  | "linkedinStage"
  | "linkedinDate"
  | "emailStage"
  | "emailDate"
  | "callStage"
  | "callDate"
  | "otherChannelStage"
  | "otherChannelDate"
  | "channelResponded"
  | "meetingDate"
  | "meetingStatus"
  | "noteCombined";

export type LinkedInStageNormalized =
  | "sent"
  | "message"
  | "connected"
  | "replied"
  | "not_interested"
  | "none";

export type EmailStageNormalized = "sent" | "replied" | "bounced" | "none";

export type CallStageNormalized =
  | "made"
  | "pickup"
  | "no_pick_up"
  | "not_interested"
  | "callback"
  | "none";

export type OtherChannelNormalized =
  | "whatsapp"
  | "zalo"
  | "other"
  | "none";

export type ManagerReviewPriority = "high" | "medium" | "low" | "none";

export type CompanyMatchStatus =
  | "matched"
  | "suggested"
  | "no_match"
  | "ambiguous";

export type CompanyMatchSummary = {
  totalRows: number;
  matchedRows: number;
  suggestedRows: number;
  noMatchRows: number;
  ambiguousRows: number;
  matchRate: number;
};

export type StandardizedSdrActivityRow = {
  rowIndex: number;

  sdrName: string;
  leadName: string;
  companyName: string;
  website?: string;
  title?: string;
  contactLinkedInUrl?: string;
  email?: string;
  phone?: string;
  companyCountry?: string;
  contactCountry?: string;
  companyLinkedInUrl?: string;
  companyIndustry?: string;
  companyStaffCountRange?: string;

  activityDate?: string;
  weekLabel?: string;

  linkedinStageRaw?: string;
  linkedinStageNormalized: LinkedInStageNormalized;

  emailStageRaw?: string;
  emailStageNormalized: EmailStageNormalized;

  callStageRaw?: string;
  callStageNormalized: CallStageNormalized;

  otherChannelRaw?: string;
  otherChannelNormalized: OtherChannelNormalized;

  noteCombined?: string;
  meetingDate?: string;
  meetingStatus?: string;
  channelResponded?: string;

  linkedinCount: number;
  emailCount: number;
  callCount: number;
  noPickupCount: number;
  notInterestedCount: number;
  otherChannelCount: number;
  totalActivityCount: number;

  managerReviewFlag: boolean;
  managerReviewPriority: ManagerReviewPriority;
  managerReviewReasons: string[];

  matchedCompanyRecordId?: string;
  matchedCompanyName?: string;
  matchedCompanyWebsite?: string;
  companyMatchStatus?: CompanyMatchStatus;
  companyMatchConfidence?: number;
  companyMatchReason?: string;
  companyMatchKey?: string;
  contactRecordId?: string;
  managerReviewItemId?: string;
  managerReviewStatus?: string;

  rawRow: Record<string, string>;
};

export type ActivityFileType = "csv" | "xlsx";

export type ParsedActivityFile = {
  fileName: string;
  fileType: ActivityFileType;
  fileSize?: number;
  headers: string[];
  rows: Record<string, string>[];
  rowCount: number;
  sheetName?: string;
};

export type ActivityColumnMappingSuggestion = {
  canonicalField: CanonicalActivityField;
  selectedColumns: string[];
  confidence: number;
  reason: string;
};

export type ActivityColumnMapping = Partial<
  Record<CanonicalActivityField, string[]>
>;

export type SdrActivitySummary = {
  sdrName: string;
  linkedinCount: number;
  emailCount: number;
  callCount: number;
  noPickupCount: number;
  notInterestedCount: number;
  otherChannelCount: number;
  totalActivityCount: number;
  uniqueLeadsTouched: number;
  uniqueCompaniesTouched: number;
  managerReviewCount: number;
};

export type ActivityParseError = {
  message: string;
};
