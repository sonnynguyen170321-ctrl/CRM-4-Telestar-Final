import { describe, expect, it } from "vitest";

import {
  ALL_V2_DURABLE_QUEUE_NAMES,
  V2_DURABLE_QUEUE_BY_JOB_TYPE,
  V2_INGEST_QUEUE_BY_JOB_TYPE,
  V2_QUEUE_NAMES,
} from "../queueNames";

// Locks the durable-job Bull coverage: outreach sends, sequence steps, and exports ride
// BullMQ (instant pickup) while the V2Job row stays the durable source of truth. A job
// type silently dropping out of this map = back to slow DB-poll pickup, so the map is
// pinned by test.

describe("durable V2Job -> BullMQ queue map", () => {
  it("covers outreach sends, sequence steps, exports, and research discovery", () => {
    expect(V2_DURABLE_QUEUE_BY_JOB_TYPE).toEqual({
      EMAIL_SEND: V2_QUEUE_NAMES.outreachSend,
      SEQUENCE_STEP_EXECUTE: V2_QUEUE_NAMES.outreachSequence,
      EXPORT_GENERATE: V2_QUEUE_NAMES.exportGenerate,
      RESEARCH_DISCOVERY: V2_QUEUE_NAMES.prospectDiscover,
      RESEARCH_ENRICH: V2_QUEUE_NAMES.prospectDiscover,
    });
  });

  it("does not overlap the ingestion stage map (each type has exactly one bridge)", () => {
    const ingestTypes = new Set(Object.keys(V2_INGEST_QUEUE_BY_JOB_TYPE));
    for (const jobType of Object.keys(V2_DURABLE_QUEUE_BY_JOB_TYPE)) {
      expect(ingestTypes.has(jobType)).toBe(false);
    }
  });

  it("exposes each durable queue exactly once for worker registration", () => {
    expect(new Set(ALL_V2_DURABLE_QUEUE_NAMES).size).toBe(ALL_V2_DURABLE_QUEUE_NAMES.length);
    expect(ALL_V2_DURABLE_QUEUE_NAMES).toContain("v2.outreach.send");
    expect(ALL_V2_DURABLE_QUEUE_NAMES).toContain("v2.outreach.sequence");
    expect(ALL_V2_DURABLE_QUEUE_NAMES).toContain("v2.export.generate");
  });
});
