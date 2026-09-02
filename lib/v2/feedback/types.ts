import "server-only";

// Canonical qualification values a human may record as the corrected truth.
// UNCERTAIN is deprecated for canonical V2 output (Invariant 7) and must NOT be
// writable as a feedback final qualification.
export const FEEDBACK_FINAL_QUALIFICATIONS = [
  "QUALIFIED",
  "NEEDS_REVIEW",
  "UNQUALIFIED",
  "COMPANY_QUALIFIED_NEEDS_CONTACT",
] as const;

export type FeedbackFinalQualification =
  (typeof FEEDBACK_FINAL_QUALIFICATIONS)[number];

export const FEEDBACK_DATASET_SPLITS = [
  "UNSPECIFIED",
  "TRAIN",
  "EVAL",
  "HOLDOUT",
] as const;

export type FeedbackDatasetSplit = (typeof FEEDBACK_DATASET_SPLITS)[number];

export const FEEDBACK_DEFAULT_SOURCE = "manual_review";

export type FeedbackExampleRow = {
  id: string;
  organizationId: string;
  leadAssignmentId: string;
  icpVersionId: string;
  hardRuleAssessmentId: string | null;
  reviewedByUserId: string | null;
  source: string;
  predictedFitScore: number | null;
  predictedQualification: string | null;
  predictedCompanyType: string | null;
  predictedReason: string | null;
  finalFitScore: number | null;
  finalQualification: string;
  finalCompanyType: string | null;
  finalReason: string | null;
  approvedForLearning: boolean;
  datasetSplit: string;
  createdAt: string;
};

export function isFeedbackFinalQualification(
  value: string
): value is FeedbackFinalQualification {
  return (FEEDBACK_FINAL_QUALIFICATIONS as readonly string[]).includes(value);
}

export function isFeedbackDatasetSplit(
  value: string
): value is FeedbackDatasetSplit {
  return (FEEDBACK_DATASET_SPLITS as readonly string[]).includes(value);
}
