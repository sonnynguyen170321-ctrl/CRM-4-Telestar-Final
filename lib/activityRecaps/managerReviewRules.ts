import type {
  ManagerReviewPriority,
  StandardizedSdrActivityRow,
} from "@/lib/activityRecaps/types";

export type ManagerReviewResult = {
  managerReviewFlag: boolean;
  managerReviewPriority: ManagerReviewPriority;
  managerReviewReasons: string[];
};

type ReviewCandidate = Pick<
  StandardizedSdrActivityRow,
  | "sdrName"
  | "leadName"
  | "companyName"
  | "activityDate"
  | "weekLabel"
  | "linkedinStageNormalized"
  | "emailStageNormalized"
  | "callStageNormalized"
  | "noteCombined"
  | "meetingDate"
  | "meetingStatus"
  | "channelResponded"
  | "totalActivityCount"
>;

export function evaluateManagerReviewRules(
  row: ReviewCandidate
): ManagerReviewResult {
  const highReasons: string[] = [];
  const mediumReasons: string[] = [];
  const lowReasons: string[] = [];
  const note = (row.noteCombined ?? "").toLowerCase();

  if (row.meetingDate) {
    highReasons.push("Meeting date is present.");
  }

  if (row.meetingStatus) {
    highReasons.push("Meeting status is present.");
  }

  if (row.channelResponded) {
    highReasons.push("Response channel is present.");
  }

  if (
    /\b(interested|qualified|asked|requested|send info|send details|call back|callback|meeting|schedule|intro|referral|replied|reply|got response|positive)\b/.test(
      note
    )
  ) {
    highReasons.push("Note contains a positive or response signal.");
  }

  if (row.callStageNormalized === "pickup" && note.length > 24) {
    highReasons.push("Pickup call has a detailed note.");
  }

  if (row.callStageNormalized === "pickup" && note.length === 0) {
    mediumReasons.push("Pickup call has no note.");
  }

  if (row.callStageNormalized === "not_interested" && note.length === 0) {
    mediumReasons.push("Not-interested call has no note.");
  }

  if (
    /\b(not interested|wrong number|no budget|using vendor|no need|no longer working|moved|title not relevant|individual contributor|call later)\b/.test(
      note
    )
  ) {
    mediumReasons.push("Note contains an objection or follow-up cue.");
  }

  if (note.length > 40) {
    mediumReasons.push("Note is detailed enough for manager review.");
  }

  if (/\b(\d{1,2}[/-]\d{1,2}|\d{4}-\d{2}-\d{2})\b/.test(note)) {
    mediumReasons.push("Note contains date-like follow-up text.");
  }

  const channelsTouched = [
    row.linkedinStageNormalized !== "none",
    row.emailStageNormalized !== "none",
    row.callStageNormalized !== "none",
  ].filter(Boolean).length;

  if (channelsTouched > 1) {
    mediumReasons.push("Multiple channels were touched in one row.");
  }

  if (row.sdrName === "Unknown SDR") {
    lowReasons.push("SDR name is missing.");
  }

  if (!row.leadName) {
    lowReasons.push("Lead name is missing.");
  }

  if (!row.companyName) {
    lowReasons.push("Company name is missing.");
  }

  if (row.totalActivityCount > 0 && !row.activityDate && !row.weekLabel) {
    lowReasons.push("Activity exists but no activity date or week label is mapped.");
  }

  if (note.length > 0 && row.totalActivityCount === 0) {
    lowReasons.push("Note exists but no stage or channel is mapped.");
  }

  if (highReasons.length > 0) {
    return reviewResult("high", highReasons);
  }

  if (mediumReasons.length > 0) {
    return reviewResult("medium", mediumReasons);
  }

  if (lowReasons.length > 0) {
    return reviewResult("low", lowReasons);
  }

  return reviewResult("none", []);
}

function reviewResult(
  priority: ManagerReviewPriority,
  reasons: string[]
): ManagerReviewResult {
  return {
    managerReviewFlag: priority !== "none",
    managerReviewPriority: priority,
    managerReviewReasons: reasons,
  };
}

