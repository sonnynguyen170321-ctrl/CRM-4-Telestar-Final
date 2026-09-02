import { createHash } from "node:crypto";

import type { FeedbackFinalQualification } from "./types";

/**
 * Idempotency fingerprint for a feedback example. Policy (M3): allow distinct
 * author / correction examples; block an EXACT duplicate. The fingerprint
 * therefore includes the author (reviewedByUserId) and the corrected values, so
 * a different author or a different correction produces a distinct example, but
 * the same author re-submitting the identical correction for the same lead +
 * assessment is deduped. Time is deliberately NOT part of the fingerprint.
 */
export type FeedbackFingerprintInput = {
  organizationId: string;
  leadAssignmentId: string;
  icpVersionId: string;
  hardRuleAssessmentId: string | null;
  reviewedByUserId: string | null;
  finalQualification: FeedbackFinalQualification;
  finalFitScore: number | null;
  finalReason: string | null;
  source: string;
};

export function buildFeedbackFingerprint(
  input: FeedbackFingerprintInput
): string {
  const canonical = [
    "v1",
    `org:${input.organizationId}`,
    `lead:${input.leadAssignmentId}`,
    `icp:${input.icpVersionId}`,
    `assessment:${input.hardRuleAssessmentId ?? "none"}`,
    `reviewer:${input.reviewedByUserId ?? "none"}`,
    `finalQ:${input.finalQualification}`,
    `finalFit:${input.finalFitScore ?? "none"}`,
    `finalReason:${(input.finalReason ?? "").trim().toLowerCase()}`,
    `source:${input.source}`,
  ].join("|");

  return createHash("sha256").update(canonical).digest("hex");
}
