import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("manager ICP and scoring surface", () => {
  const panel = source("components/automation/IcpScoringPanel.tsx");
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
    expect(panel).toContain("Create editable draft");
    expect(panel).toContain("The same prospect can use a different published ICP in every campaign");
    expect(panel).toContain("old results stale until campaign rescore");
    expect(panel).toContain("(pinned)");
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
    "app/api/icp/campaigns/route.ts",
    "app/api/icp/campaigns/[id]/route.ts",
  ].map(source);

  it("requires manager authorization on every authoring surface", () => {
    for (const route of routes) expect(route).toContain("requireIcpManager");
  });

  it("keeps mutating request bodies strict and tenant identity server-derived", () => {
    for (const route of routes.filter((route) => route.includes("export async function POST") || route.includes("export async function PATCH"))) {
      expect(route).toContain(".strict()");
      expect(route).toContain("requireTenantId(user)");
      expect(route).not.toMatch(/tenantId:\s*parsed\.data/);
    }
  });
});