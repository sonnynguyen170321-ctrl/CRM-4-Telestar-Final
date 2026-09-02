import {
  CompanyType,
  DatasetSplit,
  FeedbackSource,
  Qualification,
  ReviewState,
  UploadJobStatus,
} from "@/app/generated/prisma/client";

export const companyTypeValues = [
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
] as const;

export const qualificationValues = [
  "qualified",
  "unqualified",
  "uncertain",
] as const;

export const reviewStateValues = [
  "unreviewed",
  "needs_review",
  "reviewed",
] as const;

export const uploadJobStatusValues = [
  "queued",
  "processing",
  "completed",
  "failed",
] as const;

export const feedbackSourceValues = ["local_ui", "imported_csv", "api"] as const;

export const datasetSplitValues = [
  "unspecified",
  "train",
  "eval",
  "holdout",
] as const;

function includesValue<T extends readonly string[]>(
  values: T,
  value: string
): value is T[number] {
  return (values as readonly string[]).includes(value);
}

export function isCompanyTypeValue(value: string) {
  return includesValue(companyTypeValues, value);
}

export function isQualificationValue(value: string) {
  return includesValue(qualificationValues, value);
}

export function isReviewStateValue(value: string) {
  return includesValue(reviewStateValues, value);
}

export function isUploadJobStatusValue(value: string) {
  return includesValue(uploadJobStatusValues, value);
}

export function isDatasetSplitValue(value: string) {
  return includesValue(datasetSplitValues, value);
}

export function isFeedbackSourceValue(value: string) {
  return includesValue(feedbackSourceValues, value);
}

export function normalizeCompanyTypeForPrisma(value: string) {
  const map: Record<string, CompanyType> = {
    "Not Relevant": CompanyType.NOT_RELEVANT,
    PAAS: CompanyType.PAAS,
    SAAS: CompanyType.SAAS,
    Cloud: CompanyType.CLOUD,
    ITO: CompanyType.ITO,
    "Data Solution": CompanyType.DATA_SOLUTION,
    "AI Solution": CompanyType.AI_SOLUTION,
    "AI Service": CompanyType.AI_SERVICE,
    "Cyber Security": CompanyType.CYBER_SECURITY,
    "Blockchain Solution": CompanyType.BLOCKCHAIN_SOLUTION,
  };

  return map[value];
}

export function normalizeQualificationForPrisma(value: string) {
  const map: Record<string, Qualification> = {
    qualified: Qualification.QUALIFIED,
    unqualified: Qualification.UNQUALIFIED,
    uncertain: Qualification.UNCERTAIN,
  };

  return map[value];
}

export function normalizeReviewStateForPrisma(value: string) {
  const map: Record<string, ReviewState> = {
    unreviewed: ReviewState.UNREVIEWED,
    needs_review: ReviewState.NEEDS_REVIEW,
    reviewed: ReviewState.REVIEWED,
  };

  return map[value];
}

export function normalizeUploadJobStatusForPrisma(value: string) {
  const map: Record<string, UploadJobStatus> = {
    queued: UploadJobStatus.QUEUED,
    processing: UploadJobStatus.PROCESSING,
    completed: UploadJobStatus.COMPLETED,
    failed: UploadJobStatus.FAILED,
  };

  return map[value];
}

export function normalizeDatasetSplitForPrisma(value: string) {
  const map: Record<string, DatasetSplit> = {
    unspecified: DatasetSplit.UNSPECIFIED,
    train: DatasetSplit.TRAIN,
    eval: DatasetSplit.EVAL,
    holdout: DatasetSplit.HOLDOUT,
  };

  return map[value];
}

export function normalizeFeedbackSourceForPrisma(value: string) {
  const map: Record<string, FeedbackSource> = {
    local_ui: FeedbackSource.LOCAL_UI,
    imported_csv: FeedbackSource.IMPORTED_CSV,
    api: FeedbackSource.API,
  };

  return map[value];
}

export function companyTypeFromPrisma(value: CompanyType) {
  const map: Record<CompanyType, (typeof companyTypeValues)[number]> = {
    [CompanyType.NOT_RELEVANT]: "Not Relevant",
    [CompanyType.PAAS]: "PAAS",
    [CompanyType.SAAS]: "SAAS",
    [CompanyType.CLOUD]: "Cloud",
    [CompanyType.ITO]: "ITO",
    [CompanyType.DATA_SOLUTION]: "Data Solution",
    [CompanyType.AI_SOLUTION]: "AI Solution",
    [CompanyType.AI_SERVICE]: "AI Service",
    [CompanyType.CYBER_SECURITY]: "Cyber Security",
    [CompanyType.BLOCKCHAIN_SOLUTION]: "Blockchain Solution",
  };

  return map[value];
}

export function qualificationFromPrisma(value: Qualification) {
  return value.toLowerCase() as (typeof qualificationValues)[number];
}

export function reviewStateFromPrisma(value: ReviewState) {
  const map: Record<ReviewState, (typeof reviewStateValues)[number]> = {
    [ReviewState.UNREVIEWED]: "unreviewed",
    [ReviewState.NEEDS_REVIEW]: "needs_review",
    [ReviewState.REVIEWED]: "reviewed",
  };

  return map[value];
}

export function uploadJobStatusFromPrisma(value: UploadJobStatus) {
  return value.toLowerCase() as (typeof uploadJobStatusValues)[number];
}

export function datasetSplitFromPrisma(value: DatasetSplit) {
  return value.toLowerCase() as (typeof datasetSplitValues)[number];
}

export function feedbackSourceFromPrisma(value: FeedbackSource) {
  const map: Record<FeedbackSource, (typeof feedbackSourceValues)[number]> = {
    [FeedbackSource.LOCAL_UI]: "local_ui",
    [FeedbackSource.IMPORTED_CSV]: "imported_csv",
    [FeedbackSource.API]: "api",
  };

  return map[value];
}
