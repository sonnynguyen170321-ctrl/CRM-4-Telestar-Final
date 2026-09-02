import { describe, expect, it } from "vitest";

import { computeLeadPriority } from "../leadPriority";

// The priority score drives BOTH the queue badge and the SQL sort order, so these lock the
// formula: tier boundaries, the clamp, and the ranking intent (urgent work floats up).

const NOW = Date.parse("2026-07-01T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe("computeLeadPriority", () => {
  it("ranks an untouched QUALIFIED lead as hot", () => {
    const r = computeLeadPriority(
      { qualification: "QUALIFIED", workflowStatus: "WORKING", fitScore: 80, lastTouchAt: null },
      NOW
    );
    expect(r.score).toBe(89); // 55 + 10 + 12 + 12
    expect(r.tier).toBe("hot");
  });

  it("ranks a freshly-touched NEEDS_REVIEW lead as warm", () => {
    const r = computeLeadPriority(
      { qualification: "NEEDS_REVIEW", workflowStatus: "NEW", fitScore: 50, lastTouchAt: daysAgo(0) },
      NOW
    );
    expect(r.tier).toBe("warm"); // 38 + 12 + 7.5 - 6 = 51.5 -> 52
  });

  it("floats a stale QUALIFIED above a fresh NEEDS_REVIEW (the whole point)", () => {
    const staleQualified = computeLeadPriority(
      { qualification: "QUALIFIED", workflowStatus: "CONTACTED", fitScore: 60, lastTouchAt: daysAgo(10) },
      NOW
    );
    const freshReview = computeLeadPriority(
      { qualification: "NEEDS_REVIEW", workflowStatus: "NEW", fitScore: 60, lastTouchAt: daysAgo(0) },
      NOW
    );
    expect(staleQualified.score).toBeGreaterThan(freshReview.score);
  });

  it("sinks terminal-workflow leads to cool and clamps at 0", () => {
    const r = computeLeadPriority(
      { qualification: "UNQUALIFIED", workflowStatus: "ARCHIVED", fitScore: 0, lastTouchAt: null },
      NOW
    );
    expect(r.score).toBe(0); // 5 - 40 -> clamped
    expect(r.tier).toBe("cool");
  });

  it("clamps the top at 100", () => {
    const r = computeLeadPriority(
      { qualification: "QUALIFIED", workflowStatus: "RESPONDED", fitScore: 100, lastTouchAt: null },
      NOW
    );
    expect(r.score).toBe(100); // 55 + 28 + 15 + 12 = 110 -> clamped
    expect(r.tier).toBe("hot");
  });

  it("treats an unscored lead as a mid-low baseline, not zero", () => {
    const r = computeLeadPriority(
      { qualification: "NOT_SCORED", workflowStatus: "NEW", fitScore: null, lastTouchAt: null },
      NOW
    );
    expect(r.score).toBe(34); // 22 + 12 + 0 + 0
    expect(r.tier).toBe("cool");
  });
});
