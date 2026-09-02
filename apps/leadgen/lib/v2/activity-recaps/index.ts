export type {
  ActivityExpansionResult,
  ActivityChannel,
  ActivityIdentityMatchResult,
  ActivityMatchConfidence,
  ActivityMatchReasonCode,
  ActivityMatchResult,
  ActivityOutcome,
  ActivityType,
  CanonicalActivityRow,
  ComputeSourceActivityHashInput,
  ExpandedActivityEvent,
  ExpandActivityRowsFromRawRowInput,
  ImportRowKind,
  NormalizeActivityRowInput,
  NormalizeActivityRowResult,
  RawActivityRecapRow,
  SuggestedAction,
  TimestampQuality,
  ResolveActivityMatchInput,
  V2ActivityCandidateCompany,
  V2ActivityCandidateContact,
  V2ActivityCandidateLeadAssignment,
  WideRowChannelMapping,
} from "./types";

export {
  computeSourceActivityHash,
  computeSourceRowHash,
  expandActivityRowsFromRawRow,
  normalizeActivityChannel,
  normalizeActivityOutcome,
  normalizeActivityRow,
  normalizeActivityType,
  normalizeText,
  parseTimestampQuality,
} from "./normalizeActivityRow";

export {
  isGenericEmail,
  isPublicEmailDomain,
  normalizeMatchDomain,
  normalizeMatchText,
  resolveActivityMatch,
} from "./matchResolver";

export {
  ACTIVITY_APPLY_JOB_SCHEMA_VERSION,
  activityApplyJobHandler,
  buildActivityApplyJobIdempotencyKey,
  parseActivityApplyJobPayload,
} from "./applyActivityRows";
export type { ActivityApplyJobPayload, ActivityApplyRow } from "./applyActivityRows";

export { enqueueActivityApplyJob } from "./enqueueActivityApplyJob";
export type { EnqueueActivityApplyInput } from "./enqueueActivityApplyJob";

export { queryActivityRecapStats } from "./queryActivityRecapStats";
export type { ActivityRecapStats, ActivityRecordRow } from "./queryActivityRecapStats";
