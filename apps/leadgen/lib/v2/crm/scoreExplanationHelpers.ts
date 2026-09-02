import type {
  LeadWorkspaceAccountPreRank,
  LeadWorkspaceAssessment,
  LeadWorkspaceConfidenceBand,
  LeadWorkspaceQualification,
} from "./types";

export type ScoreExplanationTone = "neutral" | "positive" | "negative" | "warning";

export type ScoreExplanationGroup = {
  label: string;
  items: Array<{
    label: string;
    detail: string | null;
    tone: ScoreExplanationTone;
  }>;
};

export type RulesV2DimensionExplanation = {
  key: string;
  label: string;
  score: number | null;
  hits: Array<{ label: string; detail: string | null; tone: ScoreExplanationTone }>;
  missingEvidence: string[];
};

export type RulesV2GateExplanation = {
  id: string;
  label: string;
  reasonCode: string | null;
  evidence: string | null;
};

export type RulesV2LeadExplanation = {
  kind: "rules-v2";
  headline: {
    qualification: LeadWorkspaceQualification;
    fitScore: number;
    confidenceScore: number | null;
    confidenceBand: LeadWorkspaceConfidenceBand | null;
    accountPreRank: LeadWorkspaceAccountPreRank | null;
    accountFitScore: number | null;
    scoringVersion: string;
  };
  dimensions: RulesV2DimensionExplanation[];
  terminalGates: RulesV2GateExplanation[];
  reviewBlockers: Array<{ label: string; detail: string | null; tone: ScoreExplanationTone }>;
  personaEvidence: Array<[string, string]>;
  accountEvidence: Array<[string, string]>;
  dictionaryVersions: Array<[string, string]>;
};

export type LegacyLeadExplanation = {
  kind: "legacy";
  groups: ScoreExplanationGroup[];
};

export type LeadScoreExplanation = RulesV2LeadExplanation | LegacyLeadExplanation;

type JsonRecord = Record<string, unknown>;

const DIMENSION_LABELS: Record<string, string> = {
  geo: "Geography",
  industry: "Industry",
  companyType: "Company type",
  size: "Size",
  persona: "Persona",
  signals: "Signals",
};

const DIMENSION_ORDER = ["geo", "industry", "companyType", "size", "persona", "signals"];

export function buildLeadScoreExplanation(
  assessment: LeadWorkspaceAssessment | null
): LeadScoreExplanation {
  if (isRulesV2Assessment(assessment)) {
    return buildRulesV2Explanation(assessment);
  }

  return { kind: "legacy", groups: buildLegacyScoreExplanation(assessment) };
}

export function buildScoreExplanation(
  assessment: LeadWorkspaceAssessment | null
): ScoreExplanationGroup[] {
  const explanation = buildLeadScoreExplanation(assessment);
  return explanation.kind === "legacy" ? explanation.groups : rulesV2ToGroups(explanation);
}

function buildRulesV2Explanation(
  assessment: LeadWorkspaceAssessment
): RulesV2LeadExplanation {
  const evidenceSnapshot = asRecord(assessment.evidenceSnapshotJson);
  const hardGateSnapshot = asRecord(assessment.hardGateResultsJson);
  const confidenceSnapshot = asRecord(assessment.confidenceBreakdownJson);
  const dataQualitySnapshot = asRecord(assessment.dataQualityJson);
  const inputSnapshot = asRecord(evidenceSnapshot.inputSnapshot);
  const companyEvidence = asRecord(inputSnapshot.companyEvidence);
  const personaEvidence = asRecord(inputSnapshot.personaEvidence);
  const subScores = asRecord(evidenceSnapshot.subScores);
  const dimensions = readDimensionResults(evidenceSnapshot.dimensionResults, subScores);

  return {
    kind: "rules-v2",
    headline: {
      qualification: assessment.qualification,
      fitScore: assessment.fitScore,
      confidenceScore: readNumber(confidenceSnapshot.confidenceScore) ?? assessment.confidenceScore,
      confidenceBand: assessment.confidenceBand,
      accountPreRank: assessment.accountPreRank,
      accountFitScore: readNumber(evidenceSnapshot.accountFitScore),
      scoringVersion: assessment.scoringVersion,
    },
    dimensions,
    terminalGates: readTerminalGates(hardGateSnapshot),
    reviewBlockers: readReviewBlockers(dataQualitySnapshot),
    personaEvidence: readPersonaEvidence(personaEvidence),
    accountEvidence: readAccountEvidence(companyEvidence),
    dictionaryVersions: readDictionaryVersions(evidenceSnapshot.dictionaryVersions),
  };
}

function buildLegacyScoreExplanation(
  assessment: LeadWorkspaceAssessment | null
): ScoreExplanationGroup[] {
  if (!assessment) {
    return [];
  }

  const groups: ScoreExplanationGroup[] = [];
  const hardGates = asRecord(assessment.hardGateResultsJson);
  const dataQuality = asRecord(assessment.dataQualityJson);
  const evidenceSnapshot = asRecord(assessment.evidenceSnapshotJson);

  const reviewFlags = readStringArray(dataQuality.reviewFlags);
  const missingEvidence = readStringArray(dataQuality.missingEvidence);
  const reasonCodes = readStringArray(dataQuality.reasonCodes);

  const issueItems: ScoreExplanationGroup["items"] = [];
  for (const flag of reviewFlags) {
    issueItems.push({ label: formatLabel(flag), detail: "Review required", tone: "warning" });
  }
  for (const evidence of missingEvidence) {
    issueItems.push({ label: formatLabel(evidence), detail: "Missing evidence", tone: "negative" });
  }
  for (const code of reasonCodes) {
    if (!reviewFlags.includes(code) && !missingEvidence.includes(code)) {
      issueItems.push({ label: formatLabel(code), detail: "Reason code", tone: "neutral" });
    }
  }
  if (issueItems.length > 0) {
    groups.push({ label: "Flags & reasons", items: issueItems });
  }

  const hardHits = readLegacyHits(hardGates.hardDisqualifiersHit);
  if (hardHits.length > 0) {
    groups.push({ label: "Hard disqualifiers", items: hardHits });
  }

  const positiveHits = readLegacyHits(evidenceSnapshot.positiveSignalsHit, "positive");
  if (positiveHits.length > 0) {
    groups.push({ label: "Positive signals", items: positiveHits });
  }

  const negativeHits = readLegacyHits(evidenceSnapshot.negativeSignalsHit, "negative");
  if (negativeHits.length > 0) {
    groups.push({ label: "Negative signals", items: negativeHits });
  }

  const evidenceSummary = readStringArray(evidenceSnapshot.evidenceSummary);
  if (evidenceSummary.length > 0) {
    groups.push({
      label: "Evidence summary",
      items: evidenceSummary.map((item) => ({
        label: item,
        detail: null,
        tone: "neutral",
      })),
    });
  }

  return groups;
}

function readDimensionResults(
  rawDimensionResults: unknown,
  subScores: JsonRecord
): RulesV2DimensionExplanation[] {
  const byKey = new Map<string, JsonRecord>();
  if (Array.isArray(rawDimensionResults)) {
    for (const raw of rawDimensionResults) {
      const dimension = asRecord(raw);
      const key = readString(dimension.dimension);
      if (key) {
        byKey.set(key, dimension);
      }
    }
  } else {
    const record = asRecord(rawDimensionResults);
    for (const [key, raw] of Object.entries(record)) {
      const dimension = asRecord(raw);
      if (Object.keys(dimension).length > 0) {
        byKey.set(key, { ...dimension, dimension: readString(dimension.dimension) ?? key });
      }
    }
  }

  return DIMENSION_ORDER.map((key) => {
    const dimension = byKey.get(key);
    const rawScore = dimension ? readNumber(dimension.score) : readNumber(subScores[key]);
    const hits = readDimensionHits(dimension?.hits);
    const missingEvidence = readStringArray(dimension?.missingEvidence);

    return {
      key,
      label: DIMENSION_LABELS[key] ?? formatLabel(key),
      score: rawScore,
      hits,
      missingEvidence,
    };
  });
}

function readDimensionHits(rawHits: unknown): RulesV2DimensionExplanation["hits"] {
  if (!Array.isArray(rawHits)) {
    return [];
  }

  return rawHits.map((raw) => {
    const hit = asRecord(raw);
    const label = readString(hit.label) ?? readString(hit.id) ?? "Recorded hit";
    const reasonCode = readString(hit.reasonCode);

    return {
      label,
      detail: reasonCode ? formatLabel(reasonCode) : null,
      tone: "positive" as const,
    };
  });
}

function readTerminalGates(snapshot: JsonRecord): RulesV2GateExplanation[] {
  const rawHits = Array.isArray(snapshot.hardDisqualifiersHit)
    ? snapshot.hardDisqualifiersHit
    : [];

  return rawHits.map((raw) => {
    const hit = asRecord(raw);
    return {
      id: readString(hit.id) ?? "terminal_gate",
      label: readString(hit.label) ?? "Terminal disqualifier",
      reasonCode: readString(hit.reasonCode),
      evidence: readString(hit.evidence),
    };
  });
}

function readReviewBlockers(
  snapshot: JsonRecord
): RulesV2LeadExplanation["reviewBlockers"] {
  const items: RulesV2LeadExplanation["reviewBlockers"] = [];

  for (const missing of readStringArray(snapshot.requiredEvidenceMissing)) {
    items.push({
      label: formatLabel(missing),
      detail: "Required evidence missing",
      tone: "warning",
    });
  }

  for (const missing of readStringArray(snapshot.missingEvidence)) {
    items.push({
      label: formatLabel(missing),
      detail: "Dimension evidence missing",
      tone: "warning",
    });
  }

  for (const flag of readStringArray(snapshot.reviewFlags)) {
    items.push({ label: formatLabel(flag), detail: "Review flag", tone: "warning" });
  }

  for (const reason of readStringArray(snapshot.reasonCodes)) {
    items.push({ label: formatLabel(reason), detail: "Reason code", tone: "neutral" });
  }

  return dedupeItems(items);
}

function readPersonaEvidence(persona: JsonRecord): Array<[string, string]> {
  if (Object.keys(persona).length === 0) {
    return [["Contact evidence", "Not recorded"]];
  }

  return compactRows([
    ["Title", readString(persona.rawTitle) ?? readString(persona.title)],
    ["Email", readString(persona.email)],
    ["Contact country", readString(persona.contactCountry)],
    ["Locale", readString(persona.locale)],
  ]);
}

function readAccountEvidence(company: JsonRecord): Array<[string, string]> {
  return compactRows([
    ["Company", readString(company.companyName)],
    ["Country", readString(company.country)],
    ["Office countries", readStringList(company.officeCountries)],
    ["Industry", readString(company.industry)],
    ["Industry tags", readStringList(company.industryTags)],
    ["Employees", readNumber(company.employeeCount)?.toLocaleString("en-US")],
    ["Employee range", readString(company.employeeRange)],
    ["Revenue", formatCurrency(readNumber(company.revenueUsd))],
    ["Website status", readString(company.websiteStatus)],
    ["Location count", readNumber(company.locationCount)?.toLocaleString("en-US")],
  ]);
}

function readDictionaryVersions(raw: unknown): Array<[string, string]> {
  const record = asRecord(raw);
  return Object.entries(record)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .sort(([a], [b]) => a.localeCompare(b));
}

function rulesV2ToGroups(explanation: RulesV2LeadExplanation): ScoreExplanationGroup[] {
  const groups: ScoreExplanationGroup[] = [];

  if (explanation.terminalGates.length > 0) {
    groups.push({
      label: "Terminal gates",
      items: explanation.terminalGates.map((gate) => ({
        label: gate.label,
        detail: gate.evidence ?? gate.reasonCode,
        tone: "negative",
      })),
    });
  }

  if (explanation.reviewBlockers.length > 0) {
    groups.push({ label: "Review blockers", items: explanation.reviewBlockers });
  }

  for (const dimension of explanation.dimensions) {
    if (dimension.hits.length === 0 && dimension.missingEvidence.length === 0) {
      continue;
    }

    groups.push({
      label: dimension.label,
      items: [
        ...dimension.hits,
        ...dimension.missingEvidence.map((missing) => ({
          label: formatLabel(missing),
          detail: "Missing evidence",
          tone: "warning" as const,
        })),
      ],
    });
  }

  return groups;
}

function readLegacyHits(
  rawHits: unknown,
  tone: ScoreExplanationTone = "negative"
): ScoreExplanationGroup["items"] {
  if (!Array.isArray(rawHits)) {
    return [];
  }

  return rawHits.map((raw) => {
    const hit = asRecord(raw);
    const label = readString(hit.label) ?? readString(hit.id) ?? "Recorded signal";
    const source =
      readString(hit.evidenceSource) ?? readString(hit.evidence) ?? readString(hit.reasonCode);

    return {
      label,
      detail: source ? `Source: ${source}` : null,
      tone,
    };
  });
}

function isRulesV2Assessment(
  assessment: LeadWorkspaceAssessment | null
): assessment is LeadWorkspaceAssessment {
  return assessment?.scoringVersion === "V2.SCORE-HV0:rules-v2.v1";
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function readStringList(value: unknown): string | undefined {
  const values = readStringArray(value);
  return values.length > 0 ? values.join(", ") : undefined;
}

function compactRows(rows: Array<[string, string | undefined | null]>): Array<[string, string]> {
  return rows
    .filter((row): row is [string, string] => typeof row[1] === "string" && row[1].trim().length > 0)
    .map(([label, value]) => [label, value]);
}

function dedupeItems(
  items: RulesV2LeadExplanation["reviewBlockers"]
): RulesV2LeadExplanation["reviewBlockers"] {
  const seen = new Set<string>();
  const result: RulesV2LeadExplanation["reviewBlockers"] = [];

  for (const item of items) {
    const key = `${item.label}:${item.detail ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }

  return result;
}

function formatCurrency(value: number | null): string | undefined {
  if (value === null) {
    return undefined;
  }

  return `$${value.toLocaleString("en-US")}`;
}

function formatLabel(value: string): string {
  return value
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}
