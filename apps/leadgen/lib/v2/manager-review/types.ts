// import "server-only";

export const V2_MANAGER_REVIEW_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "SNOOZED",
  "RESOLVED",
  "DISMISSED",
  "ARCHIVED",
] as const;

export const V2_MANAGER_REVIEW_ACTIVE_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "SNOOZED",
] as const;

export const V2_MANAGER_REVIEW_PRIORITIES = [
  "LOW",
  "NORMAL",
  "HIGH",
  "CRITICAL",
] as const;

export const V2_MANAGER_REVIEW_CONFIDENCES = [
  "HIGH",
  "MEDIUM",
  "LOW",
  "UNKNOWN",
] as const;

export const V2_MANAGER_REVIEW_SOURCE_TYPES = [
  "HARD_RULE_ASSESSMENT",
  "MANUAL_SDR_REQUEST",
  "WORKFLOW_CONFLICT",
  "INGESTION_ROW",
  "IDENTITY_MATCH",
  "ACTIVITY_RECAP_ROW",
  "AI_SUGGESTION",
  "FEEDBACK_EXAMPLE",
] as const;

export const V2_MANAGER_REVIEW_REASON_CODES = [
  "SCORING_NEEDS_REVIEW",
  "MISSING_REQUIRED_EVIDENCE",
  "LOW_CONFIDENCE_HARD_DISQUALIFIER",
  "WEAK_COMPANY_ONLY_EVIDENCE",
  "SDR_REQUESTED_REVIEW",
  "WORKFLOW_STATUS_CONFLICT",
  "NO_MATCH_FROM_RECAP",
  "MULTIPLE_COMPANY_CANDIDATES",
  "MULTIPLE_CONTACT_CANDIDATES",
  "GENERIC_EMAIL_ONLY",
  "FUZZY_NAME_ONLY",
  "NO_PROJECT_CONTEXT",
  "POSSIBLE_DUPLICATE_ACTIVITY",
  "STATUS_CHANGE_SUGGESTED",
  "STALE_ACTIVITY_DATE",
  "COMPANY_DOMAIN_CONFLICT",
  "AI_DISAGREEMENT",
] as const;

export const V2_MANAGER_REVIEW_RESOLUTION_TYPES = [
  "APPROVE_CONFIRM",
  "REJECT_DISMISS",
  "REQUEST_CHANGES",
  "LINK_EXISTING",
  "CREATE_MISSING_ENTITY_LATER",
  "NO_ACTION_NON_ACTIONABLE",
  "CONVERT_TO_FEEDBACK_LATER",
  "UPDATE_WORKFLOW_STATUS_LATER",
] as const;

export type ManagerReviewStatus =
  (typeof V2_MANAGER_REVIEW_STATUSES)[number];
export type ManagerReviewActiveStatus =
  (typeof V2_MANAGER_REVIEW_ACTIVE_STATUSES)[number];
export type ManagerReviewPriority =
  (typeof V2_MANAGER_REVIEW_PRIORITIES)[number];
export type ManagerReviewConfidence =
  (typeof V2_MANAGER_REVIEW_CONFIDENCES)[number];
export type ManagerReviewSourceType =
  (typeof V2_MANAGER_REVIEW_SOURCE_TYPES)[number];
export type ManagerReviewReasonCode =
  (typeof V2_MANAGER_REVIEW_REASON_CODES)[number];
export type ManagerReviewResolutionType =
  (typeof V2_MANAGER_REVIEW_RESOLUTION_TYPES)[number];

export type ManagerReviewDb = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $transaction<T>(
    callback: (tx: ManagerReviewTransactionDb) => Promise<T>
  ): Promise<T>;
};

export type ManagerReviewTransactionDb = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

export type ManagerReviewSqlRow = {
  id: string;
  organizationId: string;
  leadAssignmentId: string | null;
  hardRuleAssessmentId: string | null;
  projectId: string | null;
  companyId: string | null;
  contactId: string | null;
  icpVersionId: string | null;
  sourceType: ManagerReviewSourceType;
  sourceId: string | null;
  sourceRefJson: unknown;
  sourceFingerprint: string;
  reasonCode: ManagerReviewReasonCode;
  reasonDetail: string | null;
  suggestedAction: string | null;
  priority: ManagerReviewPriority;
  confidence: ManagerReviewConfidence;
  candidateSummariesJson: unknown;
  metadataJson: unknown;
  status: ManagerReviewStatus;
  assignedToUserId: string | null;
  createdByUserId: string | null;
  resolvedByUserId: string | null;
  resolutionType: ManagerReviewResolutionType | null;
  resolutionNote: string | null;
  resolutionMetadataJson: unknown;
  dueAt: Date | string | null;
  snoozedUntil: Date | string | null;
  resolvedAt: Date | string | null;
  archivedAt: Date | string | null;
  deletedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type ManagerReviewItem = Omit<
  ManagerReviewSqlRow,
  "createdAt" | "updatedAt" | "dueAt" | "snoozedUntil" | "resolvedAt" | "archivedAt" | "deletedAt"
> & {
  createdAt: string;
  updatedAt: string;
  dueAt: string | null;
  snoozedUntil: string | null;
  resolvedAt: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
};

export type ManagerReviewLinkedContext = {
  assignee: { id: string; name: string | null; emailNormalized: string } | null;
  createdBy: { id: string; name: string | null; emailNormalized: string } | null;
  resolvedBy: { id: string; name: string | null; emailNormalized: string } | null;
  leadAssignment: {
    id: string;
    assignmentLevel: string;
    workflowStatus: string;
    latestHardRuleAssessmentId: string | null;
  } | null;
  company: {
    id: string;
    name: string;
    canonicalDomain: string | null;
    websiteUrl: string | null;
  } | null;
  contact: {
    id: string;
    fullName: string;
    title: string | null;
  } | null;
  project: { id: string; name: string } | null;
  icpVersion: {
    id: string;
    versionNumber: number;
    icpProfileName: string | null;
  } | null;
  latestAssessment: ManagerReviewAssessmentSummary | null;
};

export type ManagerReviewAssessmentSummary = {
  id: string;
  fitScore: number;
  confidence: number;
  qualification: string;
  companyType: string | null;
  reason: string;
  createdAt: string;
};

export type ManagerReviewQueueRow = {
  item: ManagerReviewItem;
  context: ManagerReviewLinkedContext;
};

export type ManagerReviewInvalidCode =
  | "INVALID_INPUT"
  | "INVALID_SOURCE_TYPE"
  | "INVALID_REASON_CODE"
  | "INVALID_PRIORITY"
  | "INVALID_CONFIDENCE"
  | "INVALID_STATUS"
  | "INVALID_TRANSITION"
  | "INVALID_RESOLUTION_TYPE"
  | "INVALID_FINGERPRINT_INPUT"
  | "INVALID_MEMBERSHIP"
  | "INVALID_ASSIGNEE"
  | "LINKED_RECORD_NOT_FOUND"
  | "SNOOZED_UNTIL_REQUIRED"
  | "RESOLUTION_TYPE_REQUIRED";

export type ManagerReviewInvalidResult = {
  kind: "invalid";
  code: ManagerReviewInvalidCode;
  message: string;
};

export type ManagerReviewNotFoundResult = {
  kind: "not_found";
  code: "REVIEW_ITEM_NOT_FOUND";
  message: string;
};

export type ManagerReviewNoChangeResult = {
  kind: "no_change";
  item: ManagerReviewItem;
};

export type ManagerReviewMutationSource =
  | "CRM_UI"
  | "MANAGER_REVIEW_RUNTIME"
  | "SCORING"
  | "ACTIVITY_RECAP"
  | "SYSTEM";

export type ManagerReviewMutationInputBase = {
  organizationId: string;
  actorUserId: string;
  membershipId: string;
  source?: ManagerReviewMutationSource;
};

export const ACTIVE_STATUS_SQL = "'OPEN', 'IN_PROGRESS', 'SNOOZED'";

export function mapReviewItem(row: ManagerReviewSqlRow): ManagerReviewItem {
  return {
    ...row,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    dueAt: toNullableIso(row.dueAt),
    snoozedUntil: toNullableIso(row.snoozedUntil),
    resolvedAt: toNullableIso(row.resolvedAt),
    archivedAt: toNullableIso(row.archivedAt),
    deletedAt: toNullableIso(row.deletedAt),
  };
}

export function isManagerReviewSourceType(
  value: string
): value is ManagerReviewSourceType {
  return (V2_MANAGER_REVIEW_SOURCE_TYPES as readonly string[]).includes(value);
}

export function isManagerReviewReasonCode(
  value: string
): value is ManagerReviewReasonCode {
  return (V2_MANAGER_REVIEW_REASON_CODES as readonly string[]).includes(value);
}

export function isManagerReviewPriority(
  value: string
): value is ManagerReviewPriority {
  return (V2_MANAGER_REVIEW_PRIORITIES as readonly string[]).includes(value);
}

export function isManagerReviewConfidence(
  value: string
): value is ManagerReviewConfidence {
  return (V2_MANAGER_REVIEW_CONFIDENCES as readonly string[]).includes(value);
}

export function isManagerReviewResolutionType(
  value: string
): value is ManagerReviewResolutionType {
  return (V2_MANAGER_REVIEW_RESOLUTION_TYPES as readonly string[]).includes(value);
}

export function isActiveReviewStatus(
  value: ManagerReviewStatus
): value is ManagerReviewActiveStatus {
  return (V2_MANAGER_REVIEW_ACTIVE_STATUSES as readonly string[]).includes(value);
}

export function createInvalidResult(
  code: ManagerReviewInvalidCode,
  message: string
): ManagerReviewInvalidResult {
  return { kind: "invalid", code, message };
}

export function createNotFoundResult(): ManagerReviewNotFoundResult {
  return {
    kind: "not_found",
    code: "REVIEW_ITEM_NOT_FOUND",
    message: "Manager review item was not found.",
  };
}

export async function getDefaultManagerReviewDb(): Promise<ManagerReviewDb> {
  const { prisma } = await import("@/lib/server/prisma");

  return prisma;
}

export async function validateActorMembership(
  db: ManagerReviewTransactionDb,
  input: ManagerReviewMutationInputBase
): Promise<ManagerReviewInvalidResult | null> {
  const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `
      SELECT membership."id"
      FROM "V2OrganizationMembership" membership
      INNER JOIN "V2User" app_user
        ON app_user."id" = membership."userId"
        AND app_user."status" = 'ACTIVE'
      INNER JOIN "V2Organization" org
        ON org."id" = membership."organizationId"
        AND org."status" = 'ACTIVE'
      WHERE membership."id" = $1
        AND membership."organizationId" = $2
        AND membership."userId" = $3
        AND membership."status" = 'ACTIVE'
      LIMIT 1
    `,
    input.membershipId,
    input.organizationId,
    input.actorUserId
  );

  return rows[0]
    ? null
    : createInvalidResult(
        "INVALID_MEMBERSHIP",
        "Actor membership is not active in this organization."
      );
}

export async function validateAssignableUser(
  db: ManagerReviewTransactionDb,
  organizationId: string,
  assignedToUserId: string
): Promise<ManagerReviewInvalidResult | null> {
  const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `
      SELECT app_user."id"
      FROM "V2User" app_user
      INNER JOIN "V2OrganizationMembership" membership
        ON membership."userId" = app_user."id"
        AND membership."organizationId" = $1
        AND membership."status" = 'ACTIVE'
      WHERE app_user."id" = $2
        AND app_user."status" = 'ACTIVE'
      LIMIT 1
    `,
    organizationId,
    assignedToUserId
  );

  return rows[0]
    ? null
    : createInvalidResult(
        "INVALID_ASSIGNEE",
        "Assignee is not active in this organization."
      );
}

function toNullableIso(value: Date | string | null): string | null {
  return value ? toIso(value) : null;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
