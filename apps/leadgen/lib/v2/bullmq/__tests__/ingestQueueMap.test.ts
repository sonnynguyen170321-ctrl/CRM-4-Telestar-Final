import { describe, expect, it } from "vitest";

import { V2_JOB_TYPES } from "../../jobs/types";
import {
  ALL_V2_INGEST_QUEUE_NAMES,
  V2_INGEST_QUEUE_BY_JOB_TYPE,
  V2_QUEUE_NAMES,
} from "../queueNames";

// Guards the BullMQ ingestion wiring: every ingestion-pipeline job type that should ride
// Redis must map to a real v2.ingest.* queue, and every mapped queue must be a registered
// queue name. If a new stage job type is added to the chain, this fails until it is wired.

const EXPECTED_INGEST_JOB_TYPES = [
  "INGESTION_PARSE",
  "INGESTION_NORMALIZE",
  "IDENTITY_MATCH",
  "LEAD_ASSIGNMENT_UPSERT",
  "ACTIVITY_EVENT_UPSERT",
  "ACTIVITY_APPLY",
  "COMPANY_ENRICHMENT",
  "ICP_SCORE",
];

describe("V2_INGEST_QUEUE_BY_JOB_TYPE", () => {
  it("maps every expected ingestion-pipeline job type to a queue", () => {
    for (const jobType of EXPECTED_INGEST_JOB_TYPES) {
      expect(V2_INGEST_QUEUE_BY_JOB_TYPE[jobType]).toMatch(/^v2\.ingest\./);
    }
  });

  it("only maps known V2 job types", () => {
    for (const jobType of Object.keys(V2_INGEST_QUEUE_BY_JOB_TYPE)) {
      expect(V2_JOB_TYPES).toContain(jobType);
    }
  });

  it("maps to registered queue names with no duplicates", () => {
    const registered = new Set<string>(Object.values(V2_QUEUE_NAMES));
    for (const queueName of ALL_V2_INGEST_QUEUE_NAMES) {
      expect(registered.has(queueName)).toBe(true);
    }
    expect(new Set(ALL_V2_INGEST_QUEUE_NAMES).size).toBe(ALL_V2_INGEST_QUEUE_NAMES.length);
  });
});
