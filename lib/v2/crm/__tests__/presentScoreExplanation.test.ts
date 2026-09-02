import { describe, expect, it } from "vitest";

import { presentScoreExplanation } from "../presentScoreExplanation";

describe("presentScoreExplanation", () => {
  it("returns null when nothing is persisted", () => {
    expect(presentScoreExplanation({})).toBeNull();
  });

  it("maps sub-scores, gate hits, and missing evidence into display shape", () => {
    const out = presentScoreExplanation({
      evidenceSnapshotJson: { subScores: { geo: 100, persona: 25, size: 60 } },
      hardGateResultsJson: { hardDisqualifiersHit: [{ label: "Excluded country" }] },
      dataQualityJson: { reasonCodes: ["fit_score_needs_review"], missingEvidence: ["target_persona_missing_required"] },
    });
    expect(out).not.toBeNull();
    expect(out!.dimensions.find((d) => d.key === "geo")?.score).toBe(100);
    expect(out!.dimensions.find((d) => d.key === "persona")?.label).toBe("Persona");
    expect(out!.gateHits).toContain("Excluded country");
    expect(out!.missingEvidence[0]).toMatch(/Persona/);
  });
});
