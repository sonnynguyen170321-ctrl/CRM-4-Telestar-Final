import { createHash } from "node:crypto";
import {
  SCORE_HV0_RULES_V2_SCORING_SOURCE,
  SCORE_HV0_RULES_V2_SCORING_VERSION,
  type HardRuleAssessmentPersistenceInput,
  type MapRulesV2AssessmentToPersistenceInput,
} from "./types";

// The coarse v1 mapper (mapIcpAssessmentToPersistence) was retired with the v1 assessor —
// production persists only the graduated v2 assessment below.

export function mapRulesV2AssessmentToPersistence({
  scoringInput,
  assessment,
}: MapRulesV2AssessmentToPersistenceInput): HardRuleAssessmentPersistenceInput {
  const icpRulesHash = stableHash(scoringInput.icpRules);
  const inputSnapshot = {
    companyEvidence: scoringInput.companyEvidence,
    personaEvidence: scoringInput.personaEvidence ?? null,
    contactIdentifiers: scoringInput.contactIdentifiers,
  };
  const inputFingerprint = stableHash({
    leadAssignmentId: scoringInput.leadAssignment.id,
    icpVersionId: scoringInput.icpVersion.id,
    icpVersionSchemaVersion: scoringInput.icpRules.schemaVersion,
    icpVersionNumber: scoringInput.icpVersion.versionNumber,
    icpOptimisticVersion: scoringInput.icpVersion.version,
    inputSnapshot,
    icpRulesHash,
    dictionaryVersions: scoringInput.icpRules.dictionaryVersions,
    scoringVersion: SCORE_HV0_RULES_V2_SCORING_VERSION,
  });

  return {
    organizationId: scoringInput.leadAssignment.organizationId,
    leadAssignmentId: scoringInput.leadAssignment.id,
    icpVersionId: scoringInput.icpVersion.id,
    fitScore: assessment.fitScore,
    confidenceDecimal: toDecimalConfidence(assessment.confidenceScore),
    qualification: assessment.qualification,
    accountPreRank: assessment.accountPreRank,
    companyType: null,
    reason: buildRulesV2Reason(assessment),
    oneSentenceCompanySummary: null,
    evidenceSnapshotJson: {
      schemaVersion: "v2.score-hv0.evidence-snapshot.rules-v2.v1",
      inputSnapshot,
      rulesSnapshot: scoringInput.icpRules,
      dictionaryVersions: scoringInput.icpRules.dictionaryVersions,
      assignmentSnapshot: scoringInput.leadAssignment,
      companySnapshot: scoringInput.company,
      contactSnapshot: scoringInput.contact,
      accountPreRank: assessment.accountPreRank,
      accountFitScore: assessment.accountFitScore,
      fitScore: assessment.fitScore,
      subScores: assessment.subScores,
      dimensionResults: assessment.dimensionResults,
    },
    hardGateResultsJson: {
      schemaVersion: "v2.score-hv0.hard-gates.rules-v2.v1",
      hardDisqualifiersHit: assessment.gates.hits,
      disqualified: assessment.gates.disqualified,
    },
    confidenceBreakdownJson: {
      schemaVersion: "v2.score-hv0.confidence.rules-v2.v1",
      confidenceScore: assessment.confidenceScore,
      confidence: assessment.confidenceBand,
      persistedDecimalConfidence: toDecimalConfidence(assessment.confidenceScore),
    },
    dataQualityJson: {
      schemaVersion: "v2.score-hv0.data-quality.rules-v2.v1",
      reasonCodes: assessment.reasonCodes,
      reviewFlags:
        assessment.qualification === "NEEDS_REVIEW" ||
        assessment.qualification === "COMPANY_QUALIFIED_NEEDS_CONTACT"
          ? ["needs_human_review"]
          : [],
      missingEvidence: assessment.missingEvidence,
      requiredEvidenceMissing: assessment.requiredEvidenceMissing,
      validationWarnings: [],
    },
    inputFingerprint,
    icpRulesHash,
    scoringSource: SCORE_HV0_RULES_V2_SCORING_SOURCE,
    scoringVersion: SCORE_HV0_RULES_V2_SCORING_VERSION,
  };
}

function buildRulesV2Reason(assessment: MapRulesV2AssessmentToPersistenceInput["assessment"]): string {
  if (assessment.gates.disqualified) {
    const firstGate = assessment.gates.hits[0];
    return firstGate
      ? `Rules-v2 terminal gate: ${firstGate.label}`
      : "Rules-v2 terminal gate hit.";
  }

  if (assessment.qualification === "QUALIFIED") {
    return "Rules-v2 qualified: fit, confidence, and required evidence passed.";
  }

  if (assessment.qualification === "COMPANY_QUALIFIED_NEEDS_CONTACT") {
    return "Rules-v2 company fit: target contact/persona evidence is still needed.";
  }

  if (assessment.qualification === "NEEDS_REVIEW") {
    return "Rules-v2 needs review: plausible fit with incomplete or borderline evidence.";
  }

  return "Rules-v2 unqualified: fit score below review threshold or clear mismatch.";
}

export function stableHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const entries = Object.keys(objectValue)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`);

    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value);
}

function toDecimalConfidence(confidenceScore: number): number {
  return Math.max(0, Math.min(1, Math.round(confidenceScore) / 100));
}
