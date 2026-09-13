import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { classifyCampaignProspect } from "@/lib/leadFilter/classification";
import { presentScoreExplanation } from "@telestar/core-scoring/scoreExplanation";

describe("phase 5 campaign-scoped lead filtering", () => {
  it("does not reuse a verdict after the campaign ICP changes", () => {
    expect(
      classifyCampaignProspect({
        qualification: "qualified",
        assessedIcpVersionId: "icp-v1",
        currentIcpVersionId: "icp-v2",
      }),
    ).toEqual({ verdict: "needs_review", reason: "stale_assessment" });

    expect(
      classifyCampaignProspect({
        qualification: "qualified",
        assessedIcpVersionId: "icp-v1",
        currentIcpVersionId: "icp-v1",
      }),
    ).toEqual({ verdict: "qualified", reason: "qualified" });
  });

  it("keeps never-scored prospects separate from human review", () => {
    expect(
      classifyCampaignProspect({
        qualification: null,
        assessedIcpVersionId: null,
        currentIcpVersionId: "icp-v1",
      }),
    ).toEqual({ verdict: "not_scored", reason: "not_scored" });
  });

  it("presents persisted rule evidence without inventing another score", () => {
    expect(
      presentScoreExplanation({
        evidenceJson: {
          subScores: { geo: 100, persona: 72 },
          gates: {
            hardDisqualifiersHit: [
              { id: "blocked_geo", reasonCode: "excluded_country" },
            ],
          },
          missingEvidence: ["employee_count"],
          reasonCodes: ["simple_known_mismatch"],
        },
      }),
    ).toMatchObject({
      dimensions: [
        { key: "geo", label: "Geography", score: 100 },
        { key: "persona", label: "Persona", score: 72 },
      ],
      gateHits: [{ label: "Blocked Geo", reason: "Excluded Country" }],
      missingEvidence: ["Employee Count"],
      reasonCodes: ["Simple Known Mismatch"],
    });
  });
});

describe("phase 5 surface wiring", () => {
  const source = (path: string) =>
    readFileSync(join(process.cwd(), path), "utf8");

  it("adds a manager-only Lead Filter route and navigation entry", () => {
    expect(source("app/lead-filter/page.tsx")).toContain("LeadFilterWorkspace");
    expect(source("components/Sidebar.tsx")).toContain("href: '/lead-filter'");
    expect(source("components/Sidebar.tsx")).toContain("name: 'Lead Filter'");
    expect(source("components/Sidebar.tsx")).toContain("canManageLeadFilter(userRole)");
    expect(source("components/Sidebar.tsx")).toContain("role === 'leadgen_manager'");
  });

  it("reads CampaignProspect assessment truth and exposes accessible states", () => {
    const readModel = source("lib/leadFilter/readModel.ts");
    const workspace = source("components/lead-filter/LeadFilterWorkspace.tsx");
    const route = source("app/api/lead-filter/route.ts");
    expect(readModel).toContain("campaignProspect.findMany");
    expect(readModel).toContain("latestAssessment");
    expect(readModel).not.toContain("icpFitScore");
    expect(readModel).toContain("actor.tenantId !== tenantId");
    expect(readModel).toContain("tenantId,");
    expect(route).toContain("requireResearchManager");
    expect(route).toContain("requireTenantId(user)");
    expect(workspace).toContain("Why they fit");
    expect(workspace).toContain("aria-label=\"Filter by verdict\"");
    expect(workspace).toContain("No prospects match these filters");
  });
});
