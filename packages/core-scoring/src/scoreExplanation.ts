export type ScoreExplanationDimension = {
  key: string;
  label: string;
  score: number;
};

export type ScoreExplanation = {
  dimensions: ScoreExplanationDimension[];
  gateHits: Array<{ label: string; reason: string | null }>;
  missingEvidence: string[];
  reasonCodes: string[];
};

const DIMENSION_LABELS: Record<string, string> = {
  geo: "Geography",
  geography: "Geography",
  industry: "Industry",
  companyType: "Company type",
  size: "Company size",
  persona: "Persona",
  signals: "Signals",
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function humanize(value: string): string {
  return value
    .split(/[_.-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Turns persisted scoring evidence into display data. It never recalculates a score. */
export function presentScoreExplanation(input: {
  evidenceJson?: unknown;
}): ScoreExplanation {
  const evidence = record(input.evidenceJson);
  const subScores = record(evidence.subScores);
  const gates = record(evidence.gates);

  const dimensions = Object.entries(subScores)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .map(([key, score]) => ({
      key,
      label: DIMENSION_LABELS[key] ?? humanize(key),
      score: Math.max(0, Math.min(100, Math.round(score))),
    }));

  const gateHits = (Array.isArray(gates.hardDisqualifiersHit)
    ? gates.hardDisqualifiersHit
    : []
  ).map((value) => {
    const hit = record(value);
    const id = typeof hit.id === "string" ? hit.id : "terminal_gate";
    const reason = typeof hit.reasonCode === "string" ? humanize(hit.reasonCode) : null;
    return {
      label: typeof hit.label === "string" ? hit.label : humanize(id),
      reason,
    };
  });

  return {
    dimensions,
    gateHits,
    missingEvidence: stringArray(evidence.missingEvidence).map(humanize),
    reasonCodes: stringArray(evidence.reasonCodes).map(humanize),
  };
}
