// Pure presenter for the persisted v2 scoring explanation. The graduated engine writes
// per-dimension sub-scores, gate hits, reason codes, and missing evidence into the
// HardRuleAssessment JSON snapshots (mapIcpAssessmentToPersistence). This turns those blobs
// into a display-ready shape so the lead drawer can show WHY a lead scored as it did. No AI.

export type ScoreDimension = { key: string; label: string; score: number };
export type ScoreExplanation = {
  dimensions: ScoreDimension[];
  gateHits: string[];
  reasonCodes: string[];
  missingEvidence: string[];
};

const DIMENSION_LABELS: Record<string, string> = {
  geo: "Geography",
  geography: "Geography",
  industry: "Industry",
  companyType: "Company type",
  size: "Size",
  persona: "Persona",
  signals: "Signals",
};

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}
function humanize(token: string): string {
  return token.split(/[_.]/).map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : p)).join(" ");
}

export function presentScoreExplanation(input: {
  evidenceSnapshotJson?: unknown;
  hardGateResultsJson?: unknown;
  dataQualityJson?: unknown;
}): ScoreExplanation | null {
  const evidence = obj(input.evidenceSnapshotJson);
  const gates = obj(input.hardGateResultsJson);
  const dq = obj(input.dataQualityJson);

  const subScores = obj(evidence.subScores);
  const dimensions: ScoreDimension[] = Object.entries(subScores)
    .filter(([, v]) => typeof v === "number")
    .map(([key, v]) => ({ key, label: DIMENSION_LABELS[key] ?? humanize(key), score: Math.max(0, Math.min(100, Math.round(v as number))) }));

  const gateHits = (Array.isArray(gates.hardDisqualifiersHit) ? gates.hardDisqualifiersHit : [])
    .map((h) => {
      const rec = obj(h);
      return (typeof rec.label === "string" && rec.label) || (typeof rec.reasonCode === "string" && humanize(rec.reasonCode)) || (typeof rec.id === "string" && humanize(rec.id)) || null;
    })
    .filter((v): v is string => Boolean(v));

  const reasonCodes = strArray(dq.reasonCodes).map(humanize);
  const missingEvidence = strArray(dq.missingEvidence).map(humanize);

  if (dimensions.length === 0 && gateHits.length === 0 && reasonCodes.length === 0 && missingEvidence.length === 0) {
    return null;
  }
  return { dimensions, gateHits, reasonCodes, missingEvidence };
}
