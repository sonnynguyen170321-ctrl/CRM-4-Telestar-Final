import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("manager ICP and scoring surface", () => {
  // The panel is built from shared parts: the editor card (version actions and banners) and the rule
  // editor (the form). Automation and the campaign ICP page both use them.
  const panel = [
    "components/automation/IcpScoringPanel.tsx",
    "components/icp/IcpEditorCard.tsx",
    "components/icp/IcpRuleEditor.tsx",
    "components/icp/useIcpDraft.ts",
    "components/icp/icpClient.ts",
  ]
    .map(source)
    .join("\n");
  const automation = source("app/automation/page.tsx");

  it("replaces editable point weights with two independent plain-language signals", () => {
    expect(automation).toContain("<IcpScoringPanel />");
    expect(automation).toContain("hidden={activeTab !== 'scoring'}");
    expect(automation).toContain("ICP &amp; Scoring");
    expect(automation).not.toContain("Save Scoring Weights");
    expect(panel).toContain('title="ICP Match"');
    expect(panel).toContain('title="Engagement"');
    expect(panel).toContain("Fit · Review · No fit");
    expect(panel).toContain("Hot · Warm · Cold");
    expect(panel).not.toContain('type="range"');
    expect(panel).toContain('<option value="VP">VP</option>');
    expect(panel).not.toContain('VP_LEVEL');
  });

  it("makes version safety and campaign-scoped reuse visible", () => {
    expect(panel).toContain("Published versions are immutable");
    // The clone action is the "Edit" button now (owner, 2026-10-03: "I need an edit button for a
    // published ICP"). It still makes a new draft; it is just findable.
    expect(panel).toContain('label="Edit"');
    expect(panel).toContain("makes a new draft from this one");
    expect(panel).toContain("The same prospect can use a different published ICP in every campaign");
    expect(panel).toContain("old results stale until campaign rescore");
    expect(panel).toContain("No ICP (don't score)");
    expect(panel).toContain("Advanced criteria from an older template are active");
    expect(panel).toContain("Unsaved changes");
    expect(panel).toContain("acknowledgeSimplification");
    expect(panel).toContain("managerSimplificationNotes");
    expect(panel).toContain("may be broader");
  });

  it("supports the scoring deep link", () => {
    expect(automation).toContain("window.location.search");
    expect(automation).toContain("requestedTab === 'scoring'");
  });
});

describe("ICP authoring route contract", () => {
  const routes = [
    "app/api/icp/profiles/route.ts",
    "app/api/icp/versions/route.ts",
    "app/api/icp/versions/[id]/route.ts",
    "app/api/icp/versions/[id]/publish/route.ts",
    "app/api/icp/versions/[id]/approve/route.ts",
    "app/api/icp/versions/[id]/reject/route.ts",
    "app/api/icp/versions/[id]/withdraw/route.ts",
    "app/api/icp/campaigns/route.ts",
    "app/api/icp/campaigns/[id]/route.ts",
    "app/api/icp/reviews/route.ts",
  ].map(source);

  it("puts every authoring surface behind one of the three ICP guards", () => {
    for (const route of routes) {
      expect(route).toMatch(/requireIcp(Manager|Staff|User)/);
    }
  });

  it("checks the object, not just the role, on every route that edits or decides", () => {
    for (const path of [
      "app/api/icp/versions/route.ts",
      "app/api/icp/versions/[id]/route.ts",
    ]) {
      expect(source(path)).toContain("authorizeVersionEdit");
    }
    expect(source("app/api/icp/versions/[id]/publish/route.ts")).toContain("publishModeFor");
    expect(source("app/api/icp/versions/[id]/approve/route.ts")).toContain("canReviewSubmission");
    expect(source("app/api/icp/versions/[id]/reject/route.ts")).toContain("canReviewSubmission");
  });

  it("keeps mutating request bodies strict and tenant identity server-derived", () => {
    for (const route of routes.filter((route) => route.includes("safeParse("))) {
      expect(route).toContain(".strict()");
      expect(route).toContain("requireTenantId(user)");
      expect(route).not.toMatch(/tenantId:\s*parsed\.data/);
    }
  });
});