// The V2 queue registry. Stable names so workers and producers agree. Pure constant —
// no Redis. `noop` exists to prove the wiring end-to-end without touching real work.
// The rest are the live execution queues, wired to real processors by the bull runtime
// worker via makeRuntimeWorkerHandlers() (lib/v2/bullmq/events.ts).

export const V2_QUEUE_NAMES = {
  noop: "v2.noop",

  scoringPlan: "v2.scoring.plan",
  scoringChunk: "v2.scoring.chunk",
  scoringReduce: "v2.scoring.reduce",

  researchDiscover: "v2.research.discover",
  researchFetch: "v2.research.fetch",
  researchExtract: "v2.research.extract",
  researchProfile: "v2.research.profile",

  // Ingestion pipeline (INGEST-HV0 on BullMQ). Each ingestion-sourced V2Job stage gets a
  // Redis queue so stage transitions fire on enqueue instead of waiting for a DB poll.
  // One bridge handler drains all of them (it claims the exact stage V2Job by
  // org+ingestionJobId+jobType). Pointer payloads only — the V2Job row stays durable.
  ingestParse: "v2.ingest.parse",
  ingestNormalize: "v2.ingest.normalize",
  ingestIdentity: "v2.ingest.identity",
  ingestLeadUpsert: "v2.ingest.lead-upsert",
  ingestActivity: "v2.ingest.activity",
  ingestActivityApply: "v2.ingest.activity-apply",
  ingestEnrich: "v2.ingest.enrich",
  ingestScore: "v2.ingest.score",

  readmodelRefresh: "v2.readmodel.refresh",
  outreachSend: "v2.outreach.send",
  outreachSequence: "v2.outreach.sequence",
  exportGenerate: "v2.export.generate",
  prospectDiscover: "v2.prospect.discover",
} as const;

export type V2QueueName = (typeof V2_QUEUE_NAMES)[keyof typeof V2_QUEUE_NAMES];

export const ALL_V2_QUEUE_NAMES: readonly string[] = Object.values(V2_QUEUE_NAMES);

/**
 * Ingestion-sourced V2Job types that ride BullMQ when V2_BULL_ENABLED. The producer
 * (`enqueueV2Job`) mirrors a created INGESTION_JOB-sourced row onto the matching queue;
 * the bridge handler then claims+runs that exact stage. Job types absent here keep the
 * DB-drain path. Pure constant — no Redis.
 */
export const V2_INGEST_QUEUE_BY_JOB_TYPE: Readonly<Record<string, string>> = {
  INGESTION_PARSE: V2_QUEUE_NAMES.ingestParse,
  INGESTION_NORMALIZE: V2_QUEUE_NAMES.ingestNormalize,
  IDENTITY_MATCH: V2_QUEUE_NAMES.ingestIdentity,
  LEAD_ASSIGNMENT_UPSERT: V2_QUEUE_NAMES.ingestLeadUpsert,
  ACTIVITY_EVENT_UPSERT: V2_QUEUE_NAMES.ingestActivity,
  ACTIVITY_APPLY: V2_QUEUE_NAMES.ingestActivityApply,
  COMPANY_ENRICHMENT: V2_QUEUE_NAMES.ingestEnrich,
  ICP_SCORE: V2_QUEUE_NAMES.ingestScore,
};

export const ALL_V2_INGEST_QUEUE_NAMES: readonly string[] = Object.values(
  V2_INGEST_QUEUE_BY_JOB_TYPE
);

/**
 * Non-ingestion durable V2Job types that ALSO ride BullMQ when enabled (outreach sends,
 * sequence steps, exports). Same contract as the ingestion bridge: the V2Job row stays the
 * durable source of truth (progress / retries / gates all enforced by the SAME DB handler);
 * Redis only supplies instant pickup instead of a DB poll. Types absent from this map keep
 * the DB-drain path. Pure constant — no Redis.
 */
export const V2_DURABLE_QUEUE_BY_JOB_TYPE: Readonly<Record<string, string>> = {
  EMAIL_SEND: V2_QUEUE_NAMES.outreachSend,
  SEQUENCE_STEP_EXECUTE: V2_QUEUE_NAMES.outreachSequence,
  EXPORT_GENERATE: V2_QUEUE_NAMES.exportGenerate,
  RESEARCH_DISCOVERY: V2_QUEUE_NAMES.prospectDiscover,
  RESEARCH_ENRICH: V2_QUEUE_NAMES.prospectDiscover,
};

export const ALL_V2_DURABLE_QUEUE_NAMES: readonly string[] = Array.from(
  new Set(Object.values(V2_DURABLE_QUEUE_BY_JOB_TYPE))
);
