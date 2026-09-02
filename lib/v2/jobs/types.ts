export const V2_JOB_TYPES = [
  "INGESTION_PARSE",
  "INGESTION_NORMALIZE",
  "IDENTITY_MATCH",
  "LEAD_ASSIGNMENT_UPSERT",
  "ACTIVITY_EVENT_UPSERT",
  "COMPANY_ENRICHMENT",
  "ICP_SCORE",
  "ACTIVITY_APPLY",
  "EXPORT_GENERATE",
  "AI_INSIGHT_GENERATE",
  "RESEARCH_DISCOVERY",
  "RESEARCH_ENRICH",
  "EMAIL_SEND",
  "SEQUENCE_STEP_EXECUTE",
] as const;

export const V2_JOB_STATUSES = [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "RETRY_SCHEDULED",
] as const;

export const V2_JOB_SOURCE_TYPES = [
  "INGESTION_JOB",
  "INGESTION_ROW",
  "LEAD_ASSIGNMENT",
  "HARD_RULE_ASSESSMENT",
  "AI_INSIGHT",
  "EXPORT_JOB",
  "EMAIL_SEND",
  "SEQUENCE_ENROLLMENT",
  "MANUAL",
] as const;

export type V2JobType = (typeof V2_JOB_TYPES)[number];
export type V2JobStatus = (typeof V2_JOB_STATUSES)[number];
export type V2JobSourceType = (typeof V2_JOB_SOURCE_TYPES)[number];

export type JsonObject = Record<string, unknown>;

export type V2JobRecord = {
  id: string;
  organizationId: string;
  jobType: V2JobType;
  sourceType: V2JobSourceType;
  sourceId: string | null;
  status: V2JobStatus;
  progressCurrent: number;
  progressTotal: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  retryCount: number;
  nextAttemptAt: Date | null;
  idempotencyKey: string;
  payloadSnapshotJson: unknown;
  resultSnapshotJson: unknown;
  errorSnapshotJson: unknown;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SqlTag = <T = unknown>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<T>;

export type V2JobDatabase = {
  $queryRaw: SqlTag;
  $executeRaw: SqlTag;
  $transaction: <T>(callback: (tx: V2JobDatabase) => Promise<T>) => Promise<T>;
};

export type EnqueueV2JobInput = {
  organizationId: string;
  jobType: V2JobType;
  sourceType: V2JobSourceType;
  sourceId?: string | null;
  idempotencyKey: string;
  payload: unknown;
  createdByUserId?: string | null;
};

export type EnqueueV2JobResult =
  | { kind: "created"; job: V2JobRecord }
  | { kind: "existing"; job: V2JobRecord }
  | {
      kind: "conflict";
      code: "PAYLOAD_MISMATCH" | "MALFORMED_EXISTING_PAYLOAD";
      existingJob: V2JobRecord;
    };

export type ClaimNextJobOptions = {
  organizationId?: string;
  jobId?: string;
  jobType?: V2JobType;
  ingestionJobId?: string;
  sourceType?: V2JobSourceType;
  sourceId?: string | null;
};

export type ProcessJobOptions = {
  maxAttempts?: number;
  handlers?: Partial<Record<V2JobType, V2JobHandler>>;
  signal?: AbortSignal;
};

export type ProcessJobResult =
  | { kind: "no_job" }
  | { kind: "succeeded"; job: V2JobRecord }
  | { kind: "retry_scheduled"; job: V2JobRecord }
  | { kind: "failed"; job: V2JobRecord };

export type V2JobHandlerContext = {
  db: V2JobDatabase;
  job: V2JobRecord;
  organizationId: string;
  payload: unknown;
  updateProgress: (progress: { current: number; total?: number }) => Promise<void>;
  signal: AbortSignal;
};

export type V2JobHandlerResult = {
  resultSnapshotJson?: unknown;
  progressCurrent?: number;
  progressTotal?: number;
};

export type V2JobHandler = (
  context: V2JobHandlerContext
) => Promise<V2JobHandlerResult>;

export type ReclaimStaleJobsOptions = {
  organizationId?: string;
  jobType?: V2JobType;
  staleAfterMs?: number;
  maxAttempts?: number;
};

export type ReclaimStaleJobsResult = {
  scanned: number;
  retryScheduled: number;
  failed: number;
};
