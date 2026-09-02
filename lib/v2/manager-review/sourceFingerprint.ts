import { createHash } from "node:crypto";

import type {
  ManagerReviewReasonCode,
  ManagerReviewSourceType,
} from "./types";
import { createInvalidResult, type ManagerReviewInvalidResult } from "./types";

export type ManagerReviewSourceFingerprintInput = {
  organizationId: string;
  sourceType: ManagerReviewSourceType;
  reasonCode: ManagerReviewReasonCode;
  leadAssignmentId?: string | null;
  hardRuleAssessmentId?: string | null;
  sourceId?: string | null;
  ingestionJobId?: string | null;
  ingestionRowId?: string | null;
  sourceRowHash?: string | null;
  eventIndexWithinRow?: number | null;
};

export type ManagerReviewSourceFingerprintResult =
  | {
      kind: "ok";
      canonicalInput: string;
      sourceFingerprint: string;
      sourceId: string | null;
    }
  | ManagerReviewInvalidResult;

export function buildManagerReviewSourceFingerprint(
  input: ManagerReviewSourceFingerprintInput
): ManagerReviewSourceFingerprintResult {
  const canonicalInput = buildCanonicalInput(input);

  if (canonicalInput.kind === "invalid") {
    return canonicalInput;
  }

  return {
    kind: "ok",
    canonicalInput: canonicalInput.value,
    sourceFingerprint: createHash("sha256")
      .update(canonicalInput.value)
      .digest("hex"),
    sourceId: canonicalInput.sourceId,
  };
}

function buildCanonicalInput(input: ManagerReviewSourceFingerprintInput) {
  const base = `v1|org:${input.organizationId}|source:${input.sourceType}`;

  if (input.sourceType === "MANUAL_SDR_REQUEST") {
    if (!input.leadAssignmentId) {
      return invalid("MANUAL_SDR_REQUEST requires leadAssignmentId.");
    }

    return {
      kind: "ok" as const,
      value: `${base}|lead:${input.leadAssignmentId}|reason:${input.reasonCode}`,
      sourceId: input.leadAssignmentId,
    };
  }

  if (input.sourceType === "HARD_RULE_ASSESSMENT") {
    if (!input.hardRuleAssessmentId) {
      return invalid("HARD_RULE_ASSESSMENT requires hardRuleAssessmentId.");
    }

    return {
      kind: "ok" as const,
      value: `${base}|assessment:${input.hardRuleAssessmentId}|reason:${input.reasonCode}`,
      sourceId: input.hardRuleAssessmentId,
    };
  }

  if (input.sourceType === "WORKFLOW_CONFLICT") {
    if (!input.leadAssignmentId) {
      return invalid("WORKFLOW_CONFLICT requires leadAssignmentId.");
    }

    return {
      kind: "ok" as const,
      value: `${base}|lead:${input.leadAssignmentId}|reason:${input.reasonCode}`,
      sourceId: input.leadAssignmentId,
    };
  }

  if (input.sourceType === "ACTIVITY_RECAP_ROW") {
    if (
      !input.ingestionJobId ||
      !input.sourceRowHash ||
      input.eventIndexWithinRow === undefined ||
      input.eventIndexWithinRow === null
    ) {
      return invalid(
        "ACTIVITY_RECAP_ROW requires ingestionJobId, sourceRowHash, and eventIndexWithinRow."
      );
    }

    return {
      kind: "ok" as const,
      value: `${base}|job:${input.ingestionJobId}|row:${input.sourceRowHash}|event:${input.eventIndexWithinRow}|reason:${input.reasonCode}`,
      sourceId: input.ingestionRowId ?? input.sourceRowHash,
    };
  }

  if (!input.sourceId) {
    return invalid(`${input.sourceType} requires stable sourceId.`);
  }

  return {
    kind: "ok" as const,
    value: `${base}|sourceId:${input.sourceId}|reason:${input.reasonCode}`,
    sourceId: input.sourceId,
  };
}

function invalid(message: string): ManagerReviewInvalidResult {
  return createInvalidResult("INVALID_FINGERPRINT_INPUT", message);
}
