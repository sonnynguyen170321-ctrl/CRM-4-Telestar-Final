import { describe, expect, it } from "vitest";

import { hasPermission } from "../permissions";

// Locks the SDR-centric reframe: the SDR is the real reviewer + operator, so the
// day-to-day loop is self-serve, while org-shaping powers stay manager/admin-only.

describe("SDR permission policy", () => {
  it("grants SDR the day-to-day operator loop", () => {
    for (const perm of ["crm.read", "score.enqueue", "workflow.update", "manager_review.decide", "ingestion.apply", "feedback.write"] as const) {
      expect(hasPermission("SDR", perm)).toBe(true);
    }
  });

  it("keeps org-shaping powers off SDR", () => {
    for (const perm of ["lead.assign", "outreach.admin", "ai.admin", "feedback.approve", "product_tree.write"] as const) {
      expect(hasPermission("SDR", perm)).toBe(false);
    }
  });

  it("keeps OWNER/ADMIN fully privileged", () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      expect(hasPermission(role, "workflow.update")).toBe(true);
      expect(hasPermission(role, "manager_review.decide")).toBe(true);
      expect(hasPermission(role, "outreach.admin")).toBe(true);
    }
  });
});
